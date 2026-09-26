import type { Range } from "@/types/document";
import type { PdfPage } from "./pdf.types";

const BAND = 0.08;
const MIN_SHARE = 0.4;
const MIN_PAGES = 3;

const PAGE_NUMBER = /^\s*(page\s*)?#(\s*(of|\/)\s*#)?\s*$/i;
const DASHED_NUMBER = /^\s*[-–—]\s*#\s*[-–—]\s*$/;
const ROMAN = /^\s*(?=[ivxlcdm])m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})\s*$/i;

/** Lowercase, digit runs → "#", collapse whitespace. */
export function normalizeFurnitureLine(s: string): string {
  return s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Detect running headers, footers and page numbers (§8.5). Returns canonical ranges.
 * Furniture stays in the canonical text but is excluded from matching, chunks and highlights.
 */
export function detectFurniture(text: string, pages: readonly PdfPage[]): Range[] {
  type Cand = { page: number; start: number; end: number; norm: string };
  const cands: Cand[] = [];
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.top <= BAND || l.bottom >= 1 - BAND) {
        cands.push({ page: p.pageNo, start: l.start, end: l.end, norm: normalizeFurnitureLine(text.slice(l.start, l.end)) });
      }
    }
  }

  const pagesPerLine = new Map<string, Set<number>>();
  for (const c of cands) {
    if (!c.norm) continue;
    let s = pagesPerLine.get(c.norm);
    if (!s) pagesPerLine.set(c.norm, (s = new Set()));
    s.add(c.page);
  }
  const threshold = Math.max(MIN_PAGES, Math.ceil(pages.length * MIN_SHARE));

  const out: Range[] = [];
  for (const c of cands) {
    const repeated = pages.length >= MIN_PAGES && (pagesPerLine.get(c.norm)?.size ?? 0) >= threshold;
    const pattern = PAGE_NUMBER.test(c.norm) || DASHED_NUMBER.test(c.norm) || ROMAN.test(c.norm);
    if (repeated || pattern) out.push([c.start, c.end]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
