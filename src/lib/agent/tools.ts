import { distance as levenshtein } from "fastest-levenshtein";
import { z } from "zod";
import type { ChatDoc } from "@/lib/chat/chat.types";
import { sectionAt } from "@/lib/chat/citations";
import { CLAUSE_LABELS, CLAUSE_TYPES } from "@/lib/ingest/clauses";
import { cleanSlice } from "@/lib/retrieval/context";
import type { DocData } from "@/lib/text/docData.types";
import { countAll, findAll } from "@/lib/text/matchIndex";
import { normalizeText, toCanonical } from "@/lib/text/normalize";
import { compressNumbers } from "@/lib/text/ranges";
import { displayText } from "@/lib/text/verify";
import type { AnyTool, ToolEnv, ToolPayload, ToolResult, ToolSpec } from "./agent.types";

const docArg = z.string().max(10).optional();

function err(code: string, fields: ToolPayload, summary: string): ToolResult {
  return { ok: false, payload: { error: code, ...fields }, summary, errorCode: code };
}

/** Resolve the doc tag (required in multi-document chats, default D1). */
function resolveDoc(env: ToolEnv, tag: string | undefined): { doc: ChatDoc } | { error: ToolResult } {
  const valid = env.docs.map((d) => d.tag);
  if (!tag) {
    if (env.multi) return { error: err("INVALID_ARGUMENTS", { issues: [{ path: "doc", message: "Required in multi-document chats" }], valid }, "Missing document tag") };
    return { doc: env.docs[0]! };
  }
  const d = env.docs.find((x) => x.tag.toUpperCase() === tag.trim().toUpperCase());
  if (!d) return { error: err("UNKNOWN_DOCUMENT", { message: `No document tagged "${tag}".`, valid }, `Unknown document "${tag}"`) };
  return { doc: d };
}

function pagesOf(doc: DocData, start: number, end: number): string | undefined {
  if (doc.kind !== "pdf") return undefined;
  const pages = doc.pages.filter((p) => p.end > start && p.start < end).map((p) => p.pageNo);
  return pages.length ? compressNumbers(pages) : undefined;
}

function sectionName(doc: DocData, pos: number): string {
  const s = sectionAt(doc, pos);
  return s.number ? `${s.number} ${s.title ?? ""}`.trim() : (s.title ?? "");
}

function normalizeSectionNumber(n: string): string {
  return n
    .trim()
    .replace(/^(§|section|clause|article|art\.?|sec\.?)\s*/i, "")
    .replace(/[.:\s]+$/, "")
    .toLowerCase();
}

// ---------------------------------------------------------------------------------------------

const getOutline: ToolSpec<{ doc?: string }> = {
  name: "get_outline",
  description: "List the document's sections (number, title, level, pages). Start here to learn the structure.",
  schema: z.object({ doc: docArg }),
  keys: ["doc"],
  expected: "{doc?: 'D1'}",
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    let secs = d.sections;
    let hint: string | undefined;
    if (secs.length > 150) {
      secs = secs.filter((s) => s.level <= 2);
      hint = `Showing levels 1–2 only (${d.sections.length} sections in total). Use get_section to see subsections.`;
    }
    return {
      ok: true,
      payload: {
        sections: secs.map((s) => ({ number: s.number, title: s.title, level: s.level, pages: pagesOf(d, s.start, s.end) })),
        total_sections: d.sections.length,
        total_pages: d.pageCount ?? undefined,
        hint,
      },
      summary: `${d.sections.length} sections${d.pageCount ? `, ${d.pageCount} pages` : ""}`,
    };
  },
};

const searchDocument: ToolSpec<{ doc?: string; query: string; limit: number }> = {
  name: "search_document",
  description: "Keyword search over the document. Returns the best-matching passages with their section and pages.",
  schema: z.object({ doc: docArg, query: z.string().trim().min(2).max(200), limit: z.number().int().min(1).max(8).default(5) }),
  keys: ["doc", "query", "limit"],
  numberFields: ["limit"],
  expected: "{doc?: 'D1', query: string (2–200 chars), limit?: 1–8}",
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    let hits;
    try {
      hits = await env.search(d, args.query, args.limit);
    } catch (e) {
      // "Nothing searched" is distinct from zero hits (§24.7).
      return { ok: false, payload: { searched: false, reason: e instanceof Error ? e.message : "search failed" }, summary: "Search failed — nothing was searched", errorCode: "SEARCH_FAILED" };
    }
    const shown = hits.slice(0, args.limit).map((h) => {
      const end = Math.min(h.end, h.start + 900);
      return {
        evidenceId: env.ledger.recordRead(d.id, r.doc.tag, h.start, end),
        section: sectionName(d, h.start),
        pages: pagesOf(d, h.start, end),
        text: cleanSlice(d, h.start, end),
        truncated: end < h.end,
      };
    });
    const secs = [...new Set(shown.map((s) => (s.section.split(" ")[0] ? `§${s.section.split(" ")[0]}` : "")).filter(Boolean))].slice(0, 4);
    return {
      ok: true,
      payload: { searched: true, query: args.query, total_hits: hits.length, hits: shown },
      summary: shown.length === 0 ? `No passages matched "${args.query}"` : `${shown.length} passage${shown.length === 1 ? "" : "s"}${secs.length ? ` in ${secs.join(", ")}` : ""}`,
    };
  },
};

const getSection: ToolSpec<{ doc?: string; number: string; offset: number }> = {
  name: "get_section",
  description: "Read a section's full text by its number (e.g. \"12.3\" or \"Schedule 2\"). Long sections are paged with offset.",
  schema: z.object({ doc: docArg, number: z.string().trim().min(1).max(60), offset: z.number().int().min(0).default(0) }),
  keys: ["doc", "number", "offset"],
  numberFields: ["offset"],
  stringFields: ["number"],
  expected: "{doc?: 'D1', number: string, offset?: int}",
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    const want = normalizeSectionNumber(args.number);
    const sec =
      d.sections.find((s) => s.number && normalizeSectionNumber(s.number) === want) ??
      d.sections.find((s) => s.title.toLowerCase() === args.number.trim().toLowerCase());
    if (!sec) {
      const numbered = d.sections.filter((s) => s.number);
      const suggestions = numbered
        .map((s) => ({ n: s.number!, score: levenshtein(normalizeSectionNumber(s.number!), want) - (s.number!.startsWith(want.split(".")[0] ?? "") ? 0.5 : 0) }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((x) => x.n);
      const byTitle = d.sections.filter((s) => s.title.toLowerCase().includes(args.number.trim().toLowerCase())).slice(0, 3).map((s) => s.number ?? s.title);
      const did = [...new Set([...byTitle, ...suggestions])].slice(0, 4);
      return err("SECTION_NOT_FOUND", { did_you_mean: did, hint: "call get_outline to see valid section numbers" }, `Section ${args.number} not found${did[0] ? ` — suggested ${did[0]}` : ""}`);
    }
    const total = sec.end - sec.start;
    if (args.offset >= total) return err("OFFSET_OUT_OF_RANGE", { total_chars: total }, `Offset past the end of §${sec.number}`);
    const LIMIT = 6000;
    const s = sec.start + args.offset;
    const e = Math.min(sec.end, s + LIMIT);
    const subs = d.sections.filter((x) => x.parentId === sec.id).map((x) => ({ number: x.number, title: x.title }));
    return {
      ok: true,
      payload: {
        section: { number: sec.number, title: sec.title, pages: pagesOf(d, sec.start, sec.end) },
        evidenceId: env.ledger.recordRead(d.id, r.doc.tag, s, e),
        text: cleanSlice(d, s, e),
        total_chars: total,
        next_offset: e < sec.end ? e - sec.start : undefined,
        subsections: subs,
      },
      summary: `Read §${sec.number ?? ""} ${sec.title}${e < sec.end ? " (part)" : ""}`.replace("§ ", ""),
    };
  },
};

const readPages: ToolSpec<{ doc?: string; start: number; end: number }> = {
  name: "read_pages",
  description: "Read up to 3 consecutive pages of a PDF by page number.",
  schema: z.object({ doc: docArg, start: z.number().int(), end: z.number().int() }),
  keys: ["doc", "start", "end"],
  numberFields: ["start", "end"],
  expected: "{doc?: 'D1', start: int, end: int} (at most 3 pages)",
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    if (d.kind !== "pdf" || d.pages.length === 0) return err("NO_PAGES", { hint: "This is a Word document without pages; use get_section" }, "Word documents have no pages");
    const total = d.pages.length;
    if (args.start < 1 || args.end > total || args.start > args.end) {
      return err("PAGE_OUT_OF_RANGE", { valid: `1–${total}` }, `Pages ${args.start}–${args.end} are out of range (1–${total})`);
    }
    const last = Math.min(args.end, args.start + 2);
    const bad = new Set(d.unreadablePages);
    const pages = d.pages
      .filter((p) => p.pageNo >= args.start && p.pageNo <= last)
      .map((p) => ({
        page: p.pageNo,
        evidenceId: bad.has(p.pageNo) ? undefined : env.ledger.recordRead(d.id, r.doc.tag, p.start, p.end),
        text: bad.has(p.pageNo) ? "" : cleanSlice(d, p.start, p.end),
        note: bad.has(p.pageNo) ? "Scanned image with no readable text" : undefined,
      }));
    return {
      ok: true,
      payload: { pages, total_pages: total, truncated: last < args.end ? true : undefined, note: last < args.end ? `Only 3 pages per call; read ${last + 1}–${args.end} next.` : undefined },
      summary: `Read page${last > args.start ? `s ${args.start}–${last}` : ` ${args.start}`}`,
    };
  },
};

const findExact: ToolSpec<{ doc?: string; text: string }> = {
  name: "find_exact",
  description: "Find every occurrence of an exact phrase or defined term (whitespace/case-insensitive).",
  schema: z.object({ doc: docArg, text: z.string().trim().min(3).max(200) }),
  keys: ["doc", "text"],
  stringFields: ["text"],
  expected: "{doc?: 'D1', text: string (3–200 chars)}",
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    const needle = normalizeText(args.text, "spaced");
    if (!needle) return err("INVALID_ARGUMENTS", { issues: [{ path: "text", message: "Empty after normalisation" }] }, "Empty search text");
    const idx = d.index.spaced;
    const count = countAll(idx.text, needle, 1000);
    const positions = findAll(idx.text, needle, 15);
    const matches = positions.map((i) => {
      const [s, e] = toCanonical(idx, i, i + needle.length);
      const cs = Math.max(0, s - 120);
      const ce = Math.min(d.text.length, e + 120);
      return { evidenceId: env.ledger.recordRead(d.id, r.doc.tag, cs, ce), section: sectionName(d, s), pages: pagesOf(d, s, e), context: cleanSlice(d, cs, ce).slice(0, 300) };
    });
    return {
      ok: true,
      payload: { match_count: count, matches_shown: matches.length, matches },
      summary: count === 0 ? `No mentions of "${args.text}"` : `${count} mention${count === 1 ? "" : "s"}${count > matches.length ? ` (showing ${matches.length})` : ""}`,
    };
  },
};

const listClauses: ToolSpec<{ doc?: string; type?: (typeof CLAUSE_TYPES)[number] }> = {
  name: "list_clauses",
  description: `List standard clauses found by keyword rules. Optional type: ${CLAUSE_TYPES.join(", ")}.`,
  schema: z.object({ doc: docArg, type: z.enum(CLAUSE_TYPES).optional() }),
  keys: ["doc", "type"],
  expected: `{doc?: 'D1', type?: one of ${CLAUSE_TYPES.join("|")}}`,
  run: async (args, env) => {
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    const d = r.doc.data;
    const rows = await env.clauses(d, args.type);
    if (rows.length === 0) {
      return { ok: true, payload: { clauses: [], source: "keyword", hint: "No section titles matched; try search_document" }, summary: `No ${args.type ? CLAUSE_LABELS[args.type].toLowerCase() : ""} clauses matched by title`.replace("  ", " ") };
    }
    const clauses = rows.slice(0, 40).map((c) => {
      const s = sectionAt(d, c.start);
      const snippetEnd = Math.min(c.end, c.start + 240);
      return { type: c.type, section: s.number ?? undefined, title: s.title, pages: pagesOf(d, c.start, c.end), evidenceId: env.ledger.recordRead(d.id, r.doc.tag, c.start, snippetEnd), snippet: cleanSlice(d, c.start, snippetEnd) };
    });
    return { ok: true, payload: { clauses, source: "keyword" }, summary: `${clauses.length} clause${clauses.length === 1 ? "" : "s"}` };
  },
};

const checkEntireDocument: ToolSpec<{ doc?: string; question: string }> = {
  name: "check_entire_document",
  description:
    "Read the ENTIRE document for one question (slow; at most once per run; costs 3 tool calls). The only way to conclude that something is absent.",
  schema: z.object({ doc: docArg, question: z.string().trim().min(3).max(500) }),
  keys: ["doc", "question"],
  stringFields: ["question"],
  expected: "{doc?: 'D1', question: string}",
  cost: 3,
  pausesClock: true,
  run: async (args, env) => {
    if (env.ledger.scanUsed) return err("ALREADY_USED", { message: "check_entire_document can only run once per research run." }, "Already used");
    const r = resolveDoc(env, args.doc);
    if ("error" in r) return r.error;
    env.ledger.scanUsed = true;
    const d = r.doc.data;
    const out = await env.scan(d, args.question, env.signal);
    for (const [s, e] of out.okRanges) env.ledger.recordRead(d.id, r.doc.tag, s, e);
    const complete = out.failedRanges.length === 0 && d.unreadablePages.length === 0;
    if (complete) env.ledger.checkedComplete.add(d.id);
    if (out.failedRanges.length) env.ledger.failedByDoc.set(d.id, out.failedRanges);
    const findings = out.findings.slice(0, 12).map((f) => ({
      evidenceId: env.ledger.recordRead(d.id, r.doc.tag, f.start, f.end),
      section: sectionName(d, f.start),
      pages: pagesOf(d, f.start, f.end),
      quote: displayText(d.index, f),
    }));
    return {
      ok: true,
      payload: {
        coverage: complete ? "complete" : "partial",
        findings,
        failed_pages: out.failedRanges.length ? out.failedRanges.map((f) => f.label ?? `${f.pageStart}–${f.pageEnd}`) : undefined,
        unreadable_pages: d.unreadablePages.length ? compressNumbers(d.unreadablePages) : undefined,
      },
      summary: `${complete ? "Checked the entire document" : "Checked the document (some parts failed)"} — ${findings.length} relevant passage${findings.length === 1 ? "" : "s"}`,
    };
  },
};

const finishResearch: ToolSpec<{ ready: boolean; note?: string }> = {
  name: "finish_research",
  description: "End the research phase when you have enough evidence (or can't find more).",
  schema: z.object({ ready: z.boolean().default(true), note: z.string().max(500).optional() }),
  keys: ["ready", "note"],
  expected: "{ready: boolean, note?: string}",
  run: async () => ({ ok: true, payload: { ok: true }, summary: "Research finished", finish: true }),
};

/** Erase the argument type: the dispatcher validates args with the tool's own schema before `run`. */
function defineTool<A>(spec: ToolSpec<A>): AnyTool {
  return { ...spec, schema: spec.schema as z.ZodType<unknown>, run: (args, env) => spec.run(args as A, env) };
}

export const TOOLS: AnyTool[] = [
  defineTool(getOutline),
  defineTool(searchDocument),
  defineTool(getSection),
  defineTool(readPages),
  defineTool(findExact),
  defineTool(listClauses),
  defineTool(checkEntireDocument),
  defineTool(finishResearch),
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** OpenAI tool definitions (JSON Schema from zod v4). */
export function toolSchemas(): import("@/lib/llm/llm.types").ToolDef[] {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown> },
  }));
}
