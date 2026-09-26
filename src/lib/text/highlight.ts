import type { Box } from "@/types/citation";
import type { Range } from "@/types/document";
import type { DocPage } from "./docData.types";
import { findRangeIndex, overlapLength } from "./ranges";

type Rect = [x: number, y: number, w: number, h: number];

function pagesOverlapping(pages: readonly DocPage[], start: number, end: number): DocPage[] {
  let i = findRangeIndex(pages, start);
  if (i < 0) i = pages.findIndex((p) => p.end > start);
  if (i < 0) return [];
  const out: DocPage[] = [];
  for (let k = i; k < pages.length && pages[k]!.start < end; k++) out.push(pages[k]!);
  return out;
}

/** Merge rectangles on the same visual line (|Δy| < 0.3h, horizontal gap < 0.6h), then pad. */
function mergeLine(rects: Rect[], page: DocPage): Rect[] {
  const ar = page.height / page.width; // convert height units into width units
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last) {
      const h = Math.max(last[3], r[3]);
      const sameLine = Math.abs(last[1] - r[1]) < 0.3 * h;
      const gap = r[0] - (last[0] + last[2]);
      if (sameLine && gap < 0.6 * h * ar && gap > -0.5 * last[2]) {
        const x = Math.min(last[0], r[0]);
        const y = Math.min(last[1], r[1]);
        const x2 = Math.max(last[0] + last[2], r[0] + r[2]);
        const y2 = Math.max(last[1] + last[3], r[1] + r[3]);
        out[out.length - 1] = [x, y, x2 - x, y2 - y];
        continue;
      }
    }
    out.push([...r]);
  }
  return out.map(([x, y, w, h]) => {
    const pad = 0.15 * h;
    const padX = pad * ar;
    const r4 = (n: number): number => Math.round(n * 10000) / 10000;
    return [r4(Math.max(0, x - padX)), r4(Math.max(0, y - pad)), r4(Math.min(1, w + 2 * padX)), r4(Math.min(1, h + 2 * pad))];
  });
}

/**
 * Highlight rectangles for canonical span [start, end) (§10.1): overlapping items on each page,
 * skipping furniture, with proportional character widths inside an item. Can cover several pages.
 */
export function boxesForSpan(pages: readonly DocPage[], furniture: readonly Range[], start: number, end: number): Box[] {
  const boxes: Box[] = [];
  for (const page of pagesOverlapping(pages, start, end)) {
    const rects: Rect[] = [];
    for (const [cs, len, x, y, w, h] of page.items) {
      const ce = cs + len;
      if (ce <= start || cs >= end || len === 0) continue;
      if (overlapLength(cs, ce, furniture) > 0) continue;
      const s = Math.max(start, cs) - cs;
      const e = Math.min(end, ce) - cs;
      if (e <= s) continue;
      rects.push([x + (w * s) / len, y, (w * (e - s)) / len, h]);
    }
    if (rects.length > 0) boxes.push({ page: page.pageNo, rects: mergeLine(rects, page) });
  }
  return boxes;
}
