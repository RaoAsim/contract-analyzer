import type { DocData } from "@/lib/text/docData.types";
import { compressNumbers, mergeRanges, overlapLength, rangesLength, subtractRanges } from "@/lib/text/ranges";
import type { AnswerMode, Coverage, CoverageDoc } from "@/types/chat";
import type { Range } from "@/types/document";

export const ABSENCE_CLAIM =
  /\b(does not|doesn't|do not|don't) (contain|include|mention|address|specify|provide|state|say|cover|have)\b|\bno (provision|clause|mention|reference|section|term)s?\b|\bis silent\b|\bnot (addressed|specified|mentioned|covered|included|found|provided)\b|\bthere is no\b|\bthere are no\b|\bcontains no\b|\bmakes no\b/i;

export function hasAbsenceClaim(text: string): boolean {
  return ABSENCE_CLAIM.test(text);
}

function unreadableRanges(doc: DocData): Range[] {
  const bad = new Set(doc.unreadablePages);
  return doc.pages.filter((p) => bad.has(p.pageNo)).map((p): Range => [p.start, p.end]);
}

/** "§3, §12–14" from the top-level sections a set of ranges touches. */
export function sectionsLabel(doc: DocData, ranges: readonly Range[], limit = 12): string {
  const top = doc.sections.filter((s) => s.level === 1 && !/^(Preamble|Page \d+|Part \d+)$/.test(s.title));
  const hit = top.filter((s) => overlapLength(s.start, s.end, ranges) > 20);
  const nums = hit.map((s) => Number(s.number)).filter((n) => Number.isInteger(n));
  if (nums.length === hit.length && nums.length > 0) {
    return compressNumbers(nums)
      .split(", ")
      .map((p) => `§${p}`)
      .join(", ");
  }
  const labels = hit.map((s) => (s.number ? `§${s.number}` : s.title));
  return labels.length > limit ? `${labels.slice(0, limit).join(", ")} and ${labels.length - limit} more` : labels.join(", ");
}

function pagesLabel(doc: DocData, ranges: readonly Range[]): string | undefined {
  if (doc.pages.length === 0) return undefined;
  const pages = doc.pages.filter((p) => overlapLength(p.start, p.end, ranges) > 20).map((p) => p.pageNo);
  return pages.length ? compressNumbers(pages) : undefined;
}

/**
 * What fraction of the document the model actually saw (§11.4). Furniture never counts; unreadable
 * (scanned) pages always count as unread; failed scan windows are listed.
 */
export function docCoverage(
  doc: DocData,
  tag: string,
  readRanges: readonly Range[],
  extra: { failedRanges?: CoverageDoc["failedRanges"]; checkedEntireDocument?: boolean } = {},
): CoverageDoc {
  const read = subtractRanges(subtractRanges(mergeRanges(readRanges), doc.furniture), unreadableRanges(doc));
  const readChars = rangesLength(read);
  const total = Math.max(1, doc.contentChars);
  const fraction = readChars >= total - 2 ? 1 : Math.min(1, readChars / total);
  return {
    docId: doc.id,
    tag,
    name: doc.name,
    totalChars: doc.contentChars,
    readRanges: read,
    fraction,
    pagesRead: pagesLabel(doc, read),
    sectionsRead: sectionsLabel(doc, read) || undefined,
    unreadablePages: doc.unreadablePages.length ? doc.unreadablePages : undefined,
    failedRanges: extra.failedRanges?.length ? extra.failedRanges : undefined,
    checkedEntireDocument: extra.checkedEntireDocument,
  };
}

export function isDocComplete(d: CoverageDoc): boolean {
  return d.fraction === 1 && !d.failedRanges?.length && !d.unreadablePages?.length;
}

export function buildCoverage(mode: AnswerMode, perDoc: CoverageDoc[]): Coverage {
  return { mode, complete: perDoc.length > 0 && perDoc.every(isDocComplete), perDoc };
}

/** Whole document minus furniture (FULL mode reads everything). */
export function fullRange(doc: DocData): Range[] {
  return [[0, doc.text.length]];
}

/** Human summary for notices: "12% of MSA.pdf". */
export function coveragePercent(d: CoverageDoc): string {
  const pct = d.fraction >= 0.995 ? 100 : Math.max(1, Math.round(d.fraction * 100));
  return `${pct}%`;
}
