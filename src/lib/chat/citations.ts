import { verifyAttributed } from "@/lib/text/attribute";
import type { DocData } from "@/lib/text/docData.types";
import { boxesForSpan } from "@/lib/text/highlight";
import { findRangeIndex } from "@/lib/text/ranges";
import { displayText } from "@/lib/text/verify";
import type { Span } from "@/lib/text/verify.types";
import type { Citation, Occurrence, UnverifiedReason } from "@/types/citation";
import type { Range } from "@/types/document";

export type CitationDoc = { tag: string; data: DocData; contextRanges: Range[] };

function pageAt(doc: DocData, pos: number): number | undefined {
  if (doc.pages.length === 0) return undefined;
  let i = findRangeIndex(doc.pages, pos);
  if (i < 0) i = Math.max(0, doc.pages.findIndex((p) => p.start > pos) - 1);
  return doc.pages[i]?.pageNo;
}

/** Deepest section containing `pos`. */
export function sectionAt(doc: DocData, pos: number): { number?: string; title?: string } {
  let best: DocData["sections"][number] | undefined;
  for (const s of doc.sections) {
    if (s.start <= pos && pos < s.end && (!best || s.level >= best.level)) best = s;
  }
  if (!best || /^(Preamble|Page \d+|Part \d+)$/.test(best.title)) return best ? { title: best.title } : {};
  return { number: best.number ?? undefined, title: best.title };
}

function enrich(doc: DocData, s: Span): Occurrence {
  const sec = sectionAt(doc, s.start);
  return {
    start: s.start,
    end: s.end,
    pageStart: pageAt(doc, s.start),
    pageEnd: pageAt(doc, Math.max(s.start, s.end - 1)),
    sectionNumber: sec.number,
    sectionTitle: sec.title,
    boxes: doc.kind === "pdf" ? boxesForSpan(doc.pages, doc.furniture, s.start, s.end) : undefined,
  };
}

/**
 * Verify a model quote against ITS document and build the Citation (§9.6). The displayed quote is
 * the document's own text; highlight geometry is computed here, once.
 */
export function buildCitation(id: string, docs: readonly CitationDoc[], tag: string, modelText: string): Citation {
  const r = verifyAttributed(
    docs.map((d) => ({ tag: d.tag, docId: d.data.id, index: d.data.index, contextRanges: d.contextRanges })),
    tag,
    modelText,
  );
  const doc = docs.find((d) => d.data.id === r.docId)?.data;
  const base = { id, docId: r.docId ?? "", docTag: tag.toUpperCase(), modelText: modelText.trim() };
  if (r.status === "unverified" || r.status === "misattributed" || !doc) {
    return { ...base, status: r.status === "misattributed" ? "misattributed" : "unverified", reason: r.reason ?? "not_found", occurrences: [], primary: 0, foundInDocId: r.foundInDocId };
  }
  const occurrences = r.occurrences.map((s) => enrich(doc, s));
  const segments = r.segments?.map((s) => enrich(doc, s));
  const primarySpan = r.segments ?? [r.occurrences[r.primary]!];
  return {
    ...base,
    status: r.status,
    method: r.method,
    score: r.score,
    displayText: primarySpan.map((s) => displayText(doc.index, s)).join(" … "),
    occurrences,
    primary: r.primary,
    segments,
  };
}

/** A quote the stream never closed (stop / guard): never shown as a quote. */
export function abandonedCitation(id: string, docs: readonly CitationDoc[], tag: string, modelText: string, reason: UnverifiedReason): Citation {
  const doc = docs.find((d) => d.tag.toUpperCase() === tag.toUpperCase());
  return { id, docId: doc?.data.id ?? "", docTag: tag.toUpperCase(), status: "unverified", reason, modelText: modelText.trim().slice(0, 600), occurrences: [], primary: 0 };
}
