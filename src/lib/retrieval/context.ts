import "server-only";
import { sectionLabel } from "@/lib/ingest/chunk";
import { countTokens } from "@/lib/llm/tokens";
import type { DocData } from "@/lib/text/docData.types";
import { blankRanges, mergeRanges, rangesLength } from "@/lib/text/ranges";
import type { Range } from "@/types/document";
import type { DocContext } from "@/lib/chat/chat.types";
import { sectionAt } from "@/lib/chat/citations";
import { sectionsLabel } from "@/lib/chat/coverage";
import { rrf } from "./rrf";
import { chunkHits, chunksByOrd, searchDocument } from "./search";
import type { ChunkHit, QueryPlan } from "./search.types";

const OUTLINE_MAX_TOKENS = 1500;
const OVERHEAD_TOKENS = 600;

/** Furniture-free text of a canonical range, blank lines tidied. */
export function cleanSlice(doc: DocData, start: number, end: number): string {
  return blankRanges(doc.text.slice(start, end), start, doc.furniture)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Compact outline of every section number + title, capped at 1.5k tokens (§11.2 step 7). If capped,
 * deeper levels are dropped first and the cap is stated (I4).
 */
export function buildOutline(doc: DocData, maxTokens = OUTLINE_MAX_TOKENS): string {
  const secs = doc.sections.filter((s) => !/^(Preamble)$/.test(s.title));
  for (let maxLevel = 6; maxLevel >= 1; maxLevel--) {
    const shown = secs.filter((s) => s.level <= maxLevel);
    const lines = shown.map((s) => `${"  ".repeat(Math.max(0, s.level - 1))}${s.number ? `${s.number} ` : ""}${s.title}`);
    const text = lines.join("\n");
    if (countTokens(text) <= maxTokens || maxLevel === 1) {
      const hidden = secs.length - shown.length;
      let out = text;
      if (countTokens(out) > maxTokens) {
        // Even level 1 is too long: truncate and say so.
        const keep: string[] = [];
        let n = 0;
        for (const l of lines) {
          n += countTokens(l) + 1;
          if (n > maxTokens) break;
          keep.push(l);
        }
        out = `${keep.join("\n")}\n(outline truncated: ${lines.length - keep.length} more top-level sections not listed)`;
      } else if (hidden > 0) out += `\n(outline shows levels 1–${maxLevel}; ${hidden} deeper subsections not listed)`;
      return out;
    }
  }
  return "";
}

export function topSectionsList(doc: DocData): string {
  return doc.sections
    .filter((s) => s.level === 1 && s.number)
    .slice(0, 60)
    .map((s) => `${s.number} ${s.title}`)
    .join("; ");
}

const TOC_LINE = /(\.{4,}|…{2,}|(\s\.){3,})\s*\d+\s*$/;

function withoutTocLines(text: string): string {
  return text
    .split("\n")
    .filter((l) => !TOC_LINE.test(l))
    .join("\n");
}

/** Topics an overview should cover; the first matching pattern (in order) wins. */
const KEY_TOPICS: RegExp[][] = [
  [/\bterm of (this|the) agreement\b/i, /\binitial term\b/i, /\bshall (commence|continue)\b/i, /\brenew/i],
  [/\b(total|aggregate) liability\b/i, /\bliability cap\b/i, /\bshall not be liable\b/i],
  [/\bterminate this agreement\b/i, /\bmay terminate\b/i],
  [/\bgoverned by\b/i, /\bgoverning law\b/i],
  [/\b(fees|charges)\b[^.\n]{0,120}\b(pay|payable|invoice|within)\b/i, /\bshall pay\b/i],
  [/\bconfidential information\b/i],
  [/\bindemnif/i],
  [/\bforce majeure event\b/i, /\bforce majeure\b/i],
  [/\bintellectual property\b/i],
  [/\bpersonal data\b/i, /\bdata protection\b/i],
];

/** Canonical ranges (≈ a paragraph) around the first real occurrence of each key topic. */
function keyPassages(doc: DocData): Range[] {
  const out: Range[] = [];
  const inFurniture = (pos: number): boolean => doc.furniture.some(([s, e]) => pos >= s && pos < e);
  for (const patterns of KEY_TOPICS) {
    let found: number | null = null;
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
      for (let m = g.exec(doc.text); m && found === null; m = g.exec(doc.text)) {
        const lineStart = doc.text.lastIndexOf("\n", m.index) + 1;
        const lineEnd = doc.text.indexOf("\n", m.index);
        const line = doc.text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        // Skip TOC entries, page furniture and bare headings ("20. LIMITATION OF LIABILITY").
        if (TOC_LINE.test(line) || inFurniture(m.index) || line.trim().split(/\s+/).length < 6) continue;
        found = lineStart;
      }
      if (found !== null) break;
    }
    if (found !== null) out.push([found, Math.min(doc.text.length, found + 700)]);
  }
  return out;
}

/**
 * Context for overview questions on a large document: the outline, the opening of the document
 * (title, parties, recitals) and the first lines of every top-level section, within the budget.
 */
export function overviewContext(tag: string, doc: DocData, budgetTokens: number): DocContext {
  const outline = buildOutline(doc);
  let available = Math.max(1500, budgetTokens - countTokens(outline) - OVERHEAD_TOKENS);
  const ranges: Range[] = [];
  const add = (start: number, end: number): boolean => {
    if (end <= start) return true;
    const t = countTokens(cleanSlice(doc, start, end));
    if (t > available) return false;
    ranges.push([start, end]);
    available -= t;
    return true;
  };
  // Opening (title, parties, recitals): up to the first numbered section, capped.
  const firstTop = doc.sections.find((s) => s.level === 1 && s.number);
  add(0, Math.min(doc.text.length, Math.max(firstTop?.start ?? 0, 0) + 1200, 5000));
  // The first real passage on each key topic, found in the text (skipping the TOC and page furniture).
  for (const [start, end] of keyPassages(doc)) add(start, end);
  // First ~350 characters of each top-level section, in order, while the budget lasts.
  for (const s of doc.sections.filter((x) => x.level === 1 && !/^(Preamble|Page \d+|Part \d+)$/.test(x.title))) {
    if (!add(s.start, Math.min(s.end, s.start + 350))) break;
  }
  const merged = mergeRanges(ranges);
  const excerpts = merged.map(([s, e]) => `${heading(doc, s)}\n${withoutTocLines(cleanSlice(doc, s, e))}`).filter((x) => x.trim().split("\n").length > 1);
  const pct = Math.max(1, Math.round((100 * rangesLength(merged)) / Math.max(1, doc.contentChars)));
  return {
    tag,
    doc,
    mode: "retrieval",
    body: `OUTLINE OF THE WHOLE DOCUMENT (titles only):\n${outline}\n\nTHE OPENING, THE KEY CLAUSES AND THE FIRST LINES OF EACH SECTION (about ${pct}% of the document; everything else was NOT provided):\n${excerpts.join("\n[…]\n")}`,
    coverageAttr: `overview excerpts (about ${pct}%)`,
    readRanges: merged,
    contextRanges: merged,
    noteForModel: "the opening and the first lines of each section",
  };
}

export function fullContext(tag: string, doc: DocData): DocContext {
  const all: Range[] = [[0, doc.text.length]];
  return {
    tag,
    doc,
    mode: "full",
    body: cleanSlice(doc, 0, doc.text.length),
    coverageAttr: "full",
    readRanges: all,
    contextRanges: all,
  };
}

function heading(doc: DocData, pos: number): string {
  const s = sectionAt(doc, pos);
  const label = s.number ? sectionLabel({ number: s.number, title: s.title ?? "" }) : s.title;
  return label ? `── ${label} ──` : "──";
}

/**
 * RETRIEVAL context for one document (§11.2): keyword legs fused with RRF, budget-filled, ±1
 * neighbours of the top 3, reordered by position, adjacent chunks merged, `[…]` between gaps,
 * the outline always included, and NO page markers.
 */
export async function retrievalContext(tag: string, doc: DocData, question: string, plan: QueryPlan, budgetTokens: number): Promise<DocContext> {
  const outline = buildOutline(doc);
  const available = Math.max(1500, budgetTokens - countTokens(outline) - OVERHEAD_TOKENS);
  const { lists } = await searchDocument(doc, question, plan);
  const fused = rrf(lists);
  const hits = await chunkHits(fused.slice(0, 60));

  const chosen: ChunkHit[] = [];
  let used = 0;
  for (const id of fused) {
    const h = hits.get(id);
    if (!h) continue;
    if (used + h.tokenCount > available) continue;
    chosen.push(h);
    used += h.tokenCount;
    if (used >= available * 0.97) break;
  }
  // Neighbours (±1) of the top 3, if room remains.
  const have = new Set(chosen.map((c) => c.ord));
  const wanted = chosen.slice(0, 3).flatMap((c) => [c.ord - 1, c.ord + 1]).filter((o) => o >= 0 && !have.has(o));
  for (const n of await chunksByOrd(doc.id, [...new Set(wanted)])) {
    if (used + n.tokenCount > available) continue;
    chosen.push(n);
    used += n.tokenCount;
    have.add(n.ord);
  }

  // Reorder by document position and merge overlapping/adjacent chunks.
  const ranges = mergeRanges(chosen.map((c): Range => [c.start, c.end]));
  const excerpts = ranges.map(([s, e]) => `${heading(doc, s)}\n${cleanSlice(doc, s, e)}`);
  const pct = Math.max(1, Math.round((100 * rangesLength(ranges)) / Math.max(1, doc.contentChars)));
  const sections = sectionsLabel(doc, ranges);
  const body =
    ranges.length === 0
      ? `(No passages matched the question.)\n\nOUTLINE OF THE WHOLE DOCUMENT:\n${outline}`
      : `OUTLINE OF THE WHOLE DOCUMENT (titles only):\n${outline}\n\nEXCERPTS (${ranges.length}, about ${pct}% of the document; everything else was NOT provided):\n${excerpts.join("\n[…]\n")}`;
  return {
    tag,
    doc,
    mode: "retrieval",
    body,
    coverageAttr: `excerpts: ${sections || "selected passages"} (about ${pct}%)`,
    readRanges: ranges,
    contextRanges: ranges,
    noteForModel: sections,
  };
}
