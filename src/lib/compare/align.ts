import { distance as levenshtein } from "fastest-levenshtein";
import type { Pair, Unit } from "./compare.types";

const MATCH_FLOOR = 0.35;
const MOVE_FLOOR = 0.5;

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function titleSim(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

function words(u: Unit): Set<string> {
  return new Set(u.spaced.split(" ").filter((w) => w.length > 1));
}

/**
 * sim(a, b) = jaccard(word 3-shingles) + 0.05·[same number] + 0.05·[title similarity ≥ 0.8] (§13.2).
 * Without embeddings, a reworded clause shares few 3-shingles; when the two units share a number or
 * title we also accept 0.75 × word-level jaccard (deviation from the plan, noted in the README).
 */
export function similarity(a: Unit, b: Unit): number {
  const sameNumber = !!a.number && a.number === b.number;
  const sameTitle = titleSim(a.title, b.title) >= 0.8;
  const base = Math.max(jaccard(a.shingles, b.shingles), sameNumber || sameTitle ? 0.75 * jaccard(words(a), words(b)) : 0);
  return base + (sameNumber ? 0.05 : 0) + (sameTitle ? 0.05 : 0);
}

/** Indices (into `seq`) of one longest strictly increasing subsequence. */
function lis(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  const tailIdx: number[] = [];
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1;
  });
  const out = new Set<number>();
  let k = tailIdx[tails.length - 1] ?? -1;
  while (k >= 0) {
    out.add(k);
    k = prev[k]!;
  }
  return out;
}

/**
 * Order-aware alignment of two unit sequences (§13.2): exact pass (renumbering- and move-proof),
 * monotone Needleman–Wunsch over the rest with a similarity floor, move detection among what is
 * left, then removed/added. Asserts every unit lands in exactly one bucket.
 */
export function alignUnits(A: Unit[], B: Unit[]): Pair[] {
  const pairs: Pair[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();

  // 1. Exact pass by compact text.
  const byCompact = new Map<string, number[]>();
  B.forEach((b, j) => byCompact.set(b.compact, [...(byCompact.get(b.compact) ?? []), j]));
  const exact: { i: number; j: number }[] = [];
  A.forEach((a, i) => {
    const js = byCompact.get(a.compact);
    const j = js?.find((x) => !usedB.has(x));
    if (j === undefined) return;
    usedA.add(i);
    usedB.add(j);
    exact.push({ i, j });
  });
  const inOrder = lis(exact.map((e) => e.j));
  exact.forEach((e, k) => {
    // Same letters and digits; only whitespace/punctuation/case may differ (→ cosmetic "modified").
    const cosmetic = A[e.i]!.spaced !== B[e.j]!.spaced;
    pairs.push({ a: A[e.i], b: B[e.j], type: inOrder.has(k) ? (cosmetic ? "modified" : "unchanged") : "moved", textChanged: cosmetic });
  });

  // 2–3. Monotone alignment over the remaining units.
  const ra = A.map((_, i) => i).filter((i) => !usedA.has(i));
  const rb = B.map((_, j) => j).filter((j) => !usedB.has(j));
  const n = ra.length;
  const m = rb.length;
  if (n > 0 && m > 0) {
    const sim = Array.from({ length: n }, (_, x) => Float64Array.from(rb, (j) => similarity(A[ra[x]!]!, B[j]!)));
    const S = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let x = 1; x <= n; x++) {
      for (let y = 1; y <= m; y++) {
        const s = sim[x - 1]![y - 1]!;
        const diag = s >= MATCH_FLOOR ? S[x - 1]![y - 1]! + s : -Infinity;
        S[x]![y] = Math.max(S[x - 1]![y]!, S[x]![y - 1]!, diag);
      }
    }
    let x = n;
    let y = m;
    const matched: { i: number; j: number }[] = [];
    while (x > 0 && y > 0) {
      const s = sim[x - 1]![y - 1]!;
      if (s >= MATCH_FLOOR && S[x]![y] === S[x - 1]![y - 1]! + s) {
        matched.push({ i: ra[x - 1]!, j: rb[y - 1]! });
        x--;
        y--;
      } else if (S[x]![y] === S[x - 1]![y]) x--;
      else y--;
    }
    for (const { i, j } of matched.reverse()) {
      usedA.add(i);
      usedB.add(j);
      const same = A[i]!.spaced === B[j]!.spaced;
      pairs.push({ a: A[i], b: B[j], type: same ? "unchanged" : "modified", textChanged: !same });
    }
  }

  // 4. Move detection among what is still unmatched (best-first, sim ≥ 0.5).
  const la = A.map((_, i) => i).filter((i) => !usedA.has(i));
  const lb = B.map((_, j) => j).filter((j) => !usedB.has(j));
  const cands: { i: number; j: number; s: number }[] = [];
  for (const i of la) for (const j of lb) {
    const s = similarity(A[i]!, B[j]!);
    if (s >= MOVE_FLOOR) cands.push({ i, j, s });
  }
  cands.sort((p, q) => q.s - p.s);
  for (const c of cands) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    pairs.push({ a: A[c.i], b: B[c.j], type: "moved", textChanged: A[c.i]!.spaced !== B[c.j]!.spaced });
  }

  // 5. Leftovers.
  A.forEach((a, i) => {
    if (!usedA.has(i)) pairs.push({ a, type: "removed" });
  });
  B.forEach((b, j) => {
    if (!usedB.has(j)) pairs.push({ b, type: "added" });
  });

  // 6. Invariant: every unit of A and B in exactly one bucket.
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const p of pairs) {
    if (p.a) countA.set(p.a.id, (countA.get(p.a.id) ?? 0) + 1);
    if (p.b) countB.set(p.b.id, (countB.get(p.b.id) ?? 0) + 1);
  }
  if (A.some((a) => countA.get(a.id) !== 1) || B.some((b) => countB.get(b.id) !== 1)) {
    throw new Error("Comparison invariant violated: a unit was dropped or duplicated.");
  }

  // Document order: revised-document order, with each removed unit placed after its nearest
  // preceding original neighbour.
  const ordered = pairs.filter((p) => p.b).sort((p, q) => p.b!.index - q.b!.index);
  for (const r of pairs.filter((p) => !p.b).sort((p, q) => p.a!.index - q.a!.index)) {
    let at = 0;
    ordered.forEach((p, k) => {
      if (p.a && p.a.index < r.a!.index) at = k + 1;
    });
    ordered.splice(at, 0, r);
  }
  return ordered;
}
