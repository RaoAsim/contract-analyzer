import type { Range } from "@/types/document";

/** Sort and merge overlapping or touching `[start, end)` ranges. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter(([s, e]) => e > s).map(([s, e]): Range => [s, e]).sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

export function rangesLength(ranges: readonly Range[]): number {
  return mergeRanges(ranges).reduce((n, [s, e]) => n + (e - s), 0);
}

/** Length of the intersection of `[start, end)` with a set of ranges. */
export function overlapLength(start: number, end: number, ranges: readonly Range[]): number {
  let n = 0;
  for (const [s, e] of ranges) {
    const lo = Math.max(s, start);
    const hi = Math.min(e, end);
    if (hi > lo) n += hi - lo;
  }
  return n;
}

/** `ranges` minus `remove` (both sets of `[start, end)`). */
export function subtractRanges(ranges: readonly Range[], remove: readonly Range[]): Range[] {
  const rem = mergeRanges(remove);
  const out: Range[] = [];
  for (const [s0, e0] of mergeRanges(ranges)) {
    let s = s0;
    for (const [rs, re] of rem) {
      if (re <= s || rs >= e0) continue;
      if (rs > s) out.push([s, rs]);
      s = Math.max(s, re);
      if (s >= e0) break;
    }
    if (s < e0) out.push([s, e0]);
  }
  return out;
}

/** Index of the range containing `pos` in a sorted, non-overlapping list (binary search), or -1. */
export function findRangeIndex<T extends { start: number; end: number }>(items: readonly T[], pos: number): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = items[mid]!;
    if (pos < it.start) hi = mid - 1;
    else if (pos >= it.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Index of the last item whose start is ≤ pos (items sorted by start), or -1. */
export function lastStartingAtOrBefore<T extends { start: number }>(items: readonly T[], pos: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.start <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** "3–5, 41–44, 88" from a list of integers. */
export function compressNumbers(nums: readonly number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Replace the parts of `text` (which starts at canonical offset `base`) covered by `skip` with one space. */
export function blankRanges(text: string, base: number, skip: readonly Range[]): string {
  if (skip.length === 0) return text;
  let out = "";
  let pos = 0;
  for (const [s, e] of mergeRanges(skip)) {
    const ls = Math.max(0, s - base);
    const le = Math.min(text.length, e - base);
    if (le <= 0 || ls >= text.length) continue;
    if (ls > pos) out += text.slice(pos, ls);
    if (!out.endsWith(" ")) out += " ";
    pos = Math.max(pos, le);
  }
  return out + text.slice(pos);
}
