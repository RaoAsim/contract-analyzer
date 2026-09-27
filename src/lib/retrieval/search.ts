import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { chunks, clauses } from "@/lib/db/schema";
import { chatJson } from "@/lib/llm/client";
import type { LlmUsage } from "@/lib/llm/llm.types";
import { QUERY_VARIANTS } from "@/lib/chat/prompts";
import type { DocData } from "@/lib/text/docData.types";
import { rrf } from "./rrf";
import type { ChunkHit, QueryPlan } from "./search.types";

const STOPWORDS = new Set(
  "the a an and or of to in for on by with is are was were be been being this that these those what which who whom whose when where why how does do did can could should would may might must shall will there their them they it its as at from into about any all each every under over than then also not no nor if but so such".split(" "),
);
/** Words present in almost every chunk of a contract: they swamp ts_rank in an OR query. */
const CONTRACT_STOPWORDS = new Set("agreement agreements contract contracts party parties clause clauses section sections document hereof herein thereof".split(" "));

const hitColumns = {
  id: chunks.id,
  ord: chunks.ord,
  start: chunks.charStart,
  end: chunks.charEnd,
  tokenCount: chunks.tokenCount,
  pageStart: chunks.pageStart,
  pageEnd: chunks.pageEnd,
};

const planSchema = z.object({
  queries: z.array(z.string().max(120)).max(6).default([]),
  sections: z.array(z.string().max(30)).max(10).default([]),
  topic: z.string().max(120).nullable().optional(),
});

/** One quick JSON call for keyword variants (skipped if it takes over 2.5 s). */
export async function planQueries(question: string, outlineTop: string, signal: AbortSignal): Promise<{ plan: QueryPlan; usage: LlmUsage | null }> {
  const fallback: QueryPlan = { queries: [], sections: [], topic: null };
  // Gemini with thinking typically answers in 1–3 s; give it room, but don't hold the answer up for long.
  const timeout = AbortSignal.timeout(6000);
  try {
    const { value, usage } = await chatJson(
      [{ role: "user", content: QUERY_VARIANTS(question, outlineTop) }],
      planSchema,
      { signal: AbortSignal.any([signal, timeout]), label: "query-variants", maxTokens: 200 },
    );
    return { plan: { queries: value.queries.filter((q) => q.trim()).slice(0, 4), sections: value.sections, topic: value.topic ?? null }, usage };
  } catch (err) {
    if (!signal.aborted) console.warn(`[search] query planning skipped: ${err instanceof Error ? err.message : err}`);
    return { plan: fallback, usage: null };
  }
}

/** OR-query of the question's content words, safe for to_tsquery (letters/digits only). */
export function orQuery(text: string): string | null {
  const all = [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)))];
  const specific = all.filter((w) => !CONTRACT_STOPWORDS.has(w));
  // Keep a generic word only if it is all the question has ("what is this agreement?").
  const terms = (specific.length ? specific : all).slice(0, 12);
  return terms.length ? terms.join(" | ") : null;
}

/** Quoted phrases and capitalised defined terms ("Force Majeure", "Confidential Information"). */
export function boostPhrases(question: string): string[] {
  const out = new Set<string>();
  for (const m of question.matchAll(/["“']([^"”']{3,60})["”']/g)) out.add(m[1]!.trim());
  for (const m of question.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) out.add(m[1]!);
  return [...out].slice(0, 5);
}

/** "clause 12.3", "section 5", "§ 7.2", "article 4" → ["12.3", …] */
export function sectionRefs(question: string): string[] {
  return [...question.matchAll(/(?:clause|section|article|§)\s*(\d{1,3}(?:\.\d{1,3}){0,3})/gi)].map((m) => m[1]!);
}

async function keywordSearch(documentId: string, websearch: string | null, orq: string | null, limit = 20): Promise<string[]> {
  const db = getDb();
  const run = async (q: ReturnType<typeof sql>): Promise<string[]> =>
    (
      await db
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.documentId, documentId), sql`${chunks.tsv} @@ ${q}`))
        .orderBy(sql`ts_rank_cd(${chunks.tsv}, ${q}) desc`)
        .limit(limit)
    ).map((r) => r.id);
  // Both legs in parallel (each is a network round trip); the precise one ranks first.
  const [precise, loose] = await Promise.all([
    websearch ? run(sql`websearch_to_tsquery('english', ${websearch})`) : Promise.resolve<string[]>([]),
    orq ? run(sql`to_tsquery('english', ${orq})`) : Promise.resolve<string[]>([]),
  ]);
  const out = [...precise];
  for (const id of loose) if (out.length < limit && !out.includes(id)) out.push(id);
  return out;
}

async function phraseSearch(documentId: string, phrase: string): Promise<string[]> {
  const pattern = `%${phrase.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await getDb()
    .select({ id: chunks.id })
    .from(chunks)
    .where(and(eq(chunks.documentId, documentId), sql`${chunks.searchText} ilike ${pattern}`))
    .orderBy(asc(chunks.ord))
    .limit(10);
  return rows.map((r) => r.id);
}

/** Chunks overlapping the named sections (and their children). */
async function sectionLookup(doc: DocData, numbers: string[]): Promise<string[]> {
  const secs = doc.sections.filter((s) => s.number && numbers.some((n) => s.number === n || s.number!.startsWith(`${n}.`)));
  const out: string[] = [];
  const perSection = await Promise.all(
    secs.slice(0, 6).map((s) =>
      getDb()
        .select({ id: chunks.id })
        .from(chunks)
        .where(and(eq(chunks.documentId, doc.id), lte(chunks.charStart, s.end - 1), gte(chunks.charEnd, s.start + 1)))
        .orderBy(asc(chunks.ord))
        .limit(6),
    ),
  );
  for (const rows of perSection) for (const r of rows) if (!out.includes(r.id)) out.push(r.id);
  return out;
}

export type SearchLists = { lists: { ids: string[]; weight?: number }[] };

/** Run all keyword legs for one document (§11.2 steps 2–3). Vector search is an extra, not built. */
export async function searchDocument(doc: DocData, question: string, plan: QueryPlan): Promise<SearchLists> {
  const lists: { ids: string[]; weight?: number }[] = [];
  const variants = [question, ...plan.queries];
  const results = await Promise.all(
    variants.map((v, i) => keywordSearch(doc.id, i === 0 ? null : v, orQuery(v))),
  );
  results.forEach((ids) => lists.push({ ids }));
  const refs = [...new Set([...sectionRefs(question), ...plan.sections])];
  const [phrases, sectionIds] = await Promise.all([
    Promise.all(boostPhrases(question).map((p) => phraseSearch(doc.id, p))),
    refs.length > 0 ? sectionLookup(doc, refs) : Promise.resolve(null),
  ]);
  for (const ids of phrases) lists.push({ ids, weight: 1.5 });
  if (sectionIds) lists.push({ ids: sectionIds, weight: 3 });
  return { lists };
}

export async function chunkHits(ids: string[]): Promise<Map<string, ChunkHit>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select(hitColumns)
    .from(chunks)
    .where(sql`${chunks.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function chunksByOrd(documentId: string, ords: number[]): Promise<ChunkHit[]> {
  if (ords.length === 0) return [];
  return getDb()
    .select(hitColumns)
    .from(chunks)
    .where(and(eq(chunks.documentId, documentId), sql`${chunks.ord} in (${sql.join(ords.map((o) => sql`${o}`), sql`, `)})`));
}

/** All chunks of a document in order (for full-document scan windows). */
export async function allChunks(documentId: string): Promise<ChunkHit[]> {
  return getDb().select(hitColumns).from(chunks).where(eq(chunks.documentId, documentId)).orderBy(asc(chunks.ord));
}

/** Keyword search returning chunk spans (agent search_document tool). */
export async function searchChunkSpans(doc: DocData, query: string, limit: number): Promise<ChunkHit[]> {
  const ids = await keywordSearch(doc.id, query, orQuery(query), Math.max(limit, 8));
  const phrase = boostPhrases(query);
  const lists = [{ ids }, ...(await Promise.all(phrase.map(async (p) => ({ ids: await phraseSearch(doc.id, p), weight: 1.5 }))))];
  const fused = rrf(lists).slice(0, limit);
  const hits = await chunkHits(fused);
  return fused.map((id) => hits.get(id)).filter((h): h is ChunkHit => !!h);
}

/** Keyword clause index rows for a document (agent list_clauses tool). */
export async function clauseRows(documentId: string, type?: string): Promise<{ type: string; start: number; end: number }[]> {
  const rows = await getDb()
    .select({ type: clauses.type, start: clauses.charStart, end: clauses.charEnd })
    .from(clauses)
    .where(type ? and(eq(clauses.documentId, documentId), eq(clauses.type, type)) : eq(clauses.documentId, documentId))
    .orderBy(asc(clauses.charStart));
  return rows;
}
