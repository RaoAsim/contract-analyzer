import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { comparisons } from "@/lib/db/schema";
import { JobAbortedError, PermanentJobError } from "@/lib/jobs/errors";
import type { JobContext, JobHandler } from "@/lib/jobs/worker.types";
import { chatJson } from "@/lib/llm/client";
import type { LlmUsage } from "@/lib/llm/llm.types";
import { loadDocData } from "@/lib/text/cache";
import type { Change, ComparisonResult } from "@/types/compare";
import { countChanges, draftComparison } from "./build";
import { addUsage, CLASSIFY_PROMPT, classificationSchema, maxSig, rank, SUMMARY_PROMPT, summarySchema } from "./classify";
import { changedSnippet } from "./diff";

const ACTIVE = ["queued", "processing"] as const;
const BATCH = 8;

async function setStage(id: string, stage: string, progress: number): Promise<void> {
  const rows = await getDb()
    .update(comparisons)
    .set({ status: "processing", stage, progress, updatedAt: new Date() })
    .where(and(eq(comparisons.id, id), inArray(comparisons.status, [...ACTIVE])))
    .returning({ id: comparisons.id });
  if (rows.length === 0) throw new JobAbortedError("comparison deleted");
}

function describe(c: Change): string {
  const label = (r?: Change["a"]): string => (r ? `${r.number ? `§${r.number} ` : ""}${r.title}` : "—");
  const facts = c.facts.length ? c.facts.map((f) => `${f.kind}: ${f.before} → ${f.after}${f.ratio ? ` (×${f.ratio})` : ""}`).join("; ") : "none";
  return [
    `### ${c.id} (${c.type}${c.type === "moved" ? `, text ${c.textChanged ? "changed" : "unchanged"}` : ""}) ${label(c.a)} → ${label(c.b)}`,
    `Old text: ${c.type === "added" ? "(none — new clause)" : changedSnippet(c.hunks, "before", 2400)}`,
    `New text: ${c.type === "removed" ? "(none — clause removed)" : changedSnippet(c.hunks, "after", 2400)}`,
    `Extracted facts: ${facts}`,
  ].join("\n");
}

/** LLM classification in batches of 8; floors are applied after — the LLM can raise, never lower (§13.5). */
async function classify(ctx: JobContext, id: string, changes: Change[], usage: LlmUsage): Promise<void> {
  const todo = changes.filter((c) => c.type !== "unchanged" && !(c.type === "moved" && !c.textChanged) && !c.summary.startsWith("Formatting, punctuation"));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    await setStage(id, `Classifying changes ${Math.min(i + BATCH, todo.length)}/${todo.length}…`, 40 + Math.round((50 * (i + batch.length)) / Math.max(1, todo.length)));
    try {
      const { value, usage: u } = await chatJson([{ role: "user", content: CLASSIFY_PROMPT(batch.map(describe).join("\n\n")) }], classificationSchema, {
        signal: ctx.signal,
        label: "compare-classify",
        maxTokens: 1600,
      });
      addUsage(usage, u);
      for (const r of value.changes) {
        const c = batch.find((x) => x.id === r.id);
        if (!c) continue; // ignore invented ids
        c.significance = maxSig(r.significance, c.significance);
        c.summary = r.summary.trim() || c.summary;
        c.category = r.category;
        c.favours = r.favours;
        c.classifiedBy = "llm";
      }
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      console.warn(`[compare] classification batch ${i / BATCH + 1} failed; using rules:`, err instanceof Error ? err.message : err);
    }
  }
}

async function executiveSummary(ctx: JobContext, changes: Change[], usage: LlmUsage): Promise<ComparisonResult["summary"]> {
  const material = changes.filter((c) => c.type !== "unchanged" && rank(c.significance) >= rank("major"));
  const fallback = (): ComparisonResult["summary"] => ({
    bullets: [...changes]
      .filter((c) => c.type !== "unchanged" && c.significance !== "cosmetic")
      .sort((a, b) => rank(b.significance) - rank(a.significance))
      .slice(0, 5)
      .map((c) => `${c.summary} [${c.id}]`),
    source: "rules",
  });
  if (material.length === 0) return fallback();
  try {
    const items = material
      .slice(0, 40)
      .map((c) => `${c.id} | ${c.significance} | ${c.category} | ${c.summary} | facts: ${c.facts.map((f) => `${f.kind} ${f.before} → ${f.after}`).join("; ") || "none"}`)
      .join("\n");
    const { value, usage: u } = await chatJson([{ role: "user", content: SUMMARY_PROMPT(items) }], summarySchema, { signal: ctx.signal, label: "compare-summary", maxTokens: 700 });
    addUsage(usage, u);
    const ids = new Set(changes.map((c) => c.id));
    // Keep only references to real changes.
    const bullets = value.bullets.map((b) => b.replace(/\[(C\d+(?:\s*,\s*C\d+)*)\]/g, (m, list: string) => {
      const keep = list.split(/\s*,\s*/).filter((x) => ids.has(x));
      return keep.length ? `[${keep.join(", ")}]` : "";
    }).trim());
    return { bullets: bullets.filter(Boolean).slice(0, 6), source: "llm" };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    return fallback();
  }
}

async function runCompare(ctx: JobContext): Promise<void> {
  const id = ctx.job.targetId;
  await setStage(id, "Preparing clauses", 10);
  const [row] = await getDb().select({ a: comparisons.docAId, b: comparisons.docBId }).from(comparisons).where(eq(comparisons.id, id));
  if (!row) throw new JobAbortedError("comparison deleted");
  const [docA, docB] = await Promise.all([loadDocData(row.a), loadDocData(row.b)]);
  if (!docA || !docB) throw new PermanentJobError("document_missing", "One of the documents was deleted or isn't ready, so it can't be compared.");

  await setStage(id, "Aligning clauses…", 25);
  const draft = draftComparison(docA, docB);
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  await setStage(id, "Comparing wording…", 38);
  await classify(ctx, id, draft.changes, usage);
  await setStage(id, "Writing the summary…", 94);
  const summary = await executiveSummary(ctx, draft.changes, usage);

  const notes: string[] = [];
  const llmFailed = draft.changes.filter((c) => c.type !== "unchanged" && c.classifiedBy === "rules" && c.summary.startsWith("Changed; classification unavailable")).length;
  if (llmFailed) notes.push(`${llmFailed} change${llmFailed === 1 ? " couldn't" : "s couldn't"} be classified by the AI; ${llmFailed === 1 ? "it is" : "they are"} rated by rules only.`);
  if (docA.unreadablePages.length || docB.unreadablePages.length) notes.push("Scanned pages without text were not compared.");

  const result: ComparisonResult = {
    docA: { id: docA.id, name: docA.name, kind: docA.kind },
    docB: { id: docB.id, name: docB.name, kind: docB.kind },
    summary,
    counts: { ...countChanges(draft.changes), units: draft.units },
    changes: draft.changes,
    notes,
  };
  const rows = await getDb()
    .update(comparisons)
    .set({ status: "ready", stage: "Ready", progress: 100, result, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(comparisons.id, id), inArray(comparisons.status, [...ACTIVE])))
    .returning({ id: comparisons.id });
  if (rows.length === 0) throw new JobAbortedError("comparison deleted");
  console.log(`[compare] ${id}: ${draft.changes.length} units compared, llm calls=${usage.calls} in=${usage.inputTokens} out=${usage.outputTokens}`);
}

async function onCompareFailure(ctx: JobContext, info: { permanent: boolean; outcome: "retrying" | "failed"; error: unknown }): Promise<void> {
  const where = and(eq(comparisons.id, ctx.job.targetId), inArray(comparisons.status, [...ACTIVE]));
  if (!info.permanent && info.outcome === "retrying") {
    await getDb().update(comparisons).set({ status: "queued", stage: `Temporary problem — retrying (attempt ${ctx.job.attempts + 1} of ${ctx.job.maxAttempts})…`, updatedAt: new Date() }).where(where);
    return;
  }
  const message = info.error instanceof PermanentJobError ? info.error.message : "The comparison failed because of a temporary problem. You can retry.";
  await getDb().update(comparisons).set({ status: "failed", stage: null, errorMessage: message, updatedAt: new Date() }).where(where);
}

export const compareDocumentsHandler: JobHandler = { run: runCompare, onFailure: onCompareFailure };
