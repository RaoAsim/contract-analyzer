import { diffWords } from "diff";
import { distance as levenshtein } from "fastest-levenshtein";
import { blankRanges, overlapLength } from "./ranges";
import { findAll, type DocMatchIndex } from "./matchIndex";
import { normalizeText, precleanQuote, toCanonical } from "./normalize";
import type { Span, VerifyOptions, VerifyResult } from "./verify.types";

export const MAX_OCCURRENCES = 25;
const FUZZY_MIN = 40;
const FUZZY_THRESHOLD = 0.95;
const ANCHOR = 16;
const ANCHOR_CAP = 50;
const MAX_CANDIDATES = 12;
const LONG_QUOTE = 1500;
const ELIDED_GAP = 2000;

export const PROTECTED = new Set([
  "shall", "may", "must", "will", "should", "not", "no", "never", "without", "except", "unless",
  "and", "or", "nor", "including", "excluding", "only", "any", "all", "none", "each",
]);

const ELISION = /\s*(?:\[\s*(?:\.\s*){3}\]|\[\s*…\s*\]|(?:\.\s*){3,}|…)\s*/;

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** Numbers in a spaced string, with thousands separators removed: "AED 100,000" → ["100000"]. */
export function extractNumbers(spaced: string): string[] {
  return (spaced.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Spaced normalisation of a canonical span, furniture removed. */
function spacedSpan(idx: DocMatchIndex, s: Span): string {
  return normalizeText(blankRanges(idx.canon.slice(s.start, s.end), s.start, idx.skip), "spaced");
}

function numericGuard(idx: DocMatchIndex, quoteSpaced: string, s: Span): boolean {
  const a = extractNumbers(quoteSpaced);
  const b = extractNumbers(spacedSpan(idx, s));
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

function t1(idx: DocMatchIndex, spacedQ: string, from = 0, max = MAX_OCCURRENCES): Span[] {
  return findAll(idx.spaced.text, spacedQ, max, from).map((i) => {
    const [start, end] = toCanonical(idx.spaced, i, i + spacedQ.length);
    return { start, end };
  });
}

function t2(idx: DocMatchIndex, compactQ: string, spacedQ: string, max = MAX_OCCURRENCES): Span[] {
  return findAll(idx.compact.text, compactQ, max)
    .map((i) => {
      const [start, end] = toCanonical(idx.compact, i, i + compactQ.length);
      return { start, end };
    })
    .filter((s) => numericGuard(idx, spacedQ, s));
}

/** Exact tiers (T1 then T2) — also used for elided segments and misattribution checks. */
function exactMatches(idx: DocMatchIndex, quote: string): { spans: Span[]; method: "normalized" | "compact" } | null {
  const spacedQ = normalizeText(quote, "spaced");
  if (!spacedQ) return null;
  const a = t1(idx, spacedQ);
  if (a.length > 0) return { spans: a, method: "normalized" };
  const compactQ = normalizeText(quote, "compact");
  if (!compactQ) return null;
  const b = t2(idx, compactQ, spacedQ);
  if (b.length > 0) return { spans: b, method: "compact" };
  return null;
}

/**
 * Semi-global edit distance of `q` against `w` (free leading/trailing gaps in `w`).
 * Returns the best distance and the matched window span [ws, we).
 */
function semiGlobal(q: string, w: string): { dist: number; ws: number; we: number } {
  const n = q.length;
  const m = w.length;
  let prev = new Int32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) {
    prev[j] = 0;
    prevStart[j] = j;
  }
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    curStart[0] = 0;
    const qc = q.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1]! + (qc === w.charCodeAt(j - 1) ? 0 : 1);
      const del = prev[j]! + 1; // quote char missing from window
      const ins = cur[j - 1]! + 1; // extra window char
      let best = sub;
      let start = prevStart[j - 1]!;
      if (del < best) {
        best = del;
        start = prevStart[j]!;
      }
      if (ins < best) {
        best = ins;
        start = curStart[j - 1]!;
      }
      cur[j] = best;
      curStart[j] = start;
    }
    [prev, cur] = [cur, prev];
    [prevStart, curStart] = [curStart, prevStart];
  }
  let bestJ = 0;
  for (let j = 1; j <= m; j++) if (prev[j]! < prev[bestJ]!) bestJ = j;
  return { dist: prev[bestJ]!, ws: prevStart[bestJ]!, we: bestJ };
}

/** T4 token check: every changed word pair is a ≤1-edit typo of a ≥4-char, non-protected, non-numeric word. */
export function tokenCheck(quoteSpaced: string, spanSpaced: string): boolean {
  const changes = diffWords(quoteSpaced, spanSpaced);
  const total = words(quoteSpaced).length;
  const allowed = Math.max(1, Math.floor(total / 25));
  let pairs = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!;
    if (!c.added && !c.removed) continue;
    const next = changes[i + 1];
    if (c.removed && next?.added) {
      const a = words(c.value);
      const b = words(next.value);
      if (a.length !== b.length) return false;
      for (let k = 0; k < a.length; k++) {
        const x = a[k]!;
        const y = b[k]!;
        if (x === y) continue;
        if (x.length < 4 || y.length < 4) return false;
        if (PROTECTED.has(x) || PROTECTED.has(y)) return false;
        if (/\d/.test(x) || /\d/.test(y)) return false;
        if (levenshtein(x, y) > 1) return false;
        pairs++;
      }
      i++;
      continue;
    }
    // A word added or removed outright is a paraphrase, unless it is only whitespace.
    if (c.value.trim() !== "") return false;
  }
  return pairs <= allowed;
}

function fuzzy(idx: DocMatchIndex, quote: string): { span: Span; score: number } | null {
  const compactQ = normalizeText(quote, "compact");
  const L = compactQ.length;
  if (L < FUZZY_MIN) return null;
  const hay = idx.compact.text;
  const offsets = [0, Math.floor(L / 3), Math.floor((2 * L) / 3), L - ANCHOR];
  const votes = new Map<number, number>();
  for (const off of offsets) {
    const anchor = compactQ.slice(off, off + ANCHOR);
    for (const pos of findAll(hay, anchor, ANCHOR_CAP)) {
      const start = pos - off;
      // Dedupe implied starts within 8 chars.
      let key = start;
      for (const k of votes.keys()) {
        if (Math.abs(k - start) <= 8) {
          key = k;
          break;
        }
      }
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
  }
  const cands = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES);
  const spacedQ = normalizeText(quote, "spaced");
  let best: { span: Span; score: number } | null = null;
  for (const [start] of cands) {
    const ws = Math.max(0, start - ANCHOR);
    const we = Math.min(hay.length, start + L + ANCHOR);
    if (we - ws < L) continue; // haystack must be at least as long as the needle
    const r = semiGlobal(compactQ, hay.slice(ws, we));
    const score = 1 - r.dist / L;
    if (score < FUZZY_THRESHOLD || r.we <= r.ws) continue;
    const [cs, ce] = toCanonical(idx.compact, ws + r.ws, ws + r.we);
    const span = { start: cs, end: ce };
    if (!numericGuard(idx, spacedQ, span)) continue;
    if (!tokenCheck(spacedQ, spacedSpan(idx, span))) continue;
    if (!best || score > best.score) best = { span, score };
  }
  return best;
}

function choosePrimary(spans: Span[], opts: VerifyOptions): number {
  const ctx = opts.contextRanges ?? [];
  if (ctx.length > 0) {
    const i = spans.findIndex((s) => overlapLength(s.start, s.end, ctx) > 0);
    if (i >= 0) return i;
  }
  return 0;
}

/** T3: segments split on "..." must each match (T1/T2), in order, gaps ≤ 2000 canonical chars. */
function elided(idx: DocMatchIndex, parts: string[], opts: VerifyOptions): { chains: Span[][] } | null {
  const segs = parts.map((p) => p.trim()).filter(Boolean);
  if (segs.length < 2 || segs.some((s) => words(s).length < 3)) return null;
  const matches = segs.map((s) => exactMatches(idx, s)?.spans ?? []);
  if (matches.some((m) => m.length === 0)) return null;
  const chains: Span[][] = [];
  const extend = (chain: Span[], k: number): void => {
    if (chains.length >= MAX_OCCURRENCES) return;
    if (k === segs.length) {
      chains.push(chain);
      return;
    }
    const prev = chain[chain.length - 1]!;
    for (const m of matches[k]!) {
      if (m.start >= prev.end && m.start - prev.end <= ELIDED_GAP) extend([...chain, m], k + 1);
    }
  };
  for (const first of matches[0]!) extend([first], 1);
  if (chains.length === 0) return null;
  // Primary chain: first that overlaps the model's context.
  const ctx = opts.contextRanges ?? [];
  if (ctx.length > 0) {
    const i = chains.findIndex((c) => c.some((s) => overlapLength(s.start, s.end, ctx) > 0));
    if (i > 0) chains.unshift(chains.splice(i, 1)[0]!);
  }
  return { chains };
}

/** Split an over-long quote into sentences (each verified; all must pass). */
function sentences(q: string): string[] {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...seg.segment(q)].map((s) => s.segment.trim()).filter((s) => s.length > 0);
}

const unverified = (reason: VerifyResult["reason"]): VerifyResult => ({ status: "unverified", reason, occurrences: [], primary: 0 });

/**
 * Locate a model-written quote in a document's canonical text (§9.3). Fails closed: anything
 * uncertain is unverified. Never uses model-reported positions.
 */
export function verifyQuote(idx: DocMatchIndex, rawQuote: string, opts: VerifyOptions = {}): VerifyResult {
  const quote = precleanQuote(rawQuote);
  if (!quote) return unverified("not_found");

  // T3: elided quotes.
  const parts = quote.split(ELISION);
  if (parts.filter((p) => p.trim()).length >= 2) {
    const r = elided(idx, parts, opts);
    if (!r) return unverified("not_found");
    const chain = r.chains[0]!;
    return {
      status: "verified",
      method: "elided",
      occurrences: r.chains.map((c) => ({ start: c[0]!.start, end: c[c.length - 1]!.end })),
      primary: 0,
      segments: chain,
    };
  }

  const spacedQ = normalizeText(quote, "spaced");
  const compactQ = normalizeText(quote, "compact");
  if (!spacedQ || !compactQ) return unverified("not_found");

  // Length rules: short quotes verify only as a unique exact match.
  if (words(spacedQ).length < 3 || compactQ.length < 12) {
    const exact = t1(idx, spacedQ, 0, 2);
    if (exact.length === 1) return { status: "verified", method: "normalized", occurrences: exact, primary: 0 };
    return unverified(exact.length === 0 ? "not_found" : "too_short");
  }

  if (compactQ.length > LONG_QUOTE) {
    const parts2 = sentences(quote);
    if (parts2.length < 2) return unverified("not_found");
    let status: VerifyResult["status"] = "verified";
    const spans: Span[] = [];
    for (const s of parts2) {
      const r = verifyQuote(idx, s, opts);
      if (r.status === "unverified") return unverified("not_found");
      const occ = r.occurrences[r.primary]!;
      const prev = spans[spans.length - 1];
      const inOrder = !prev || (occ.start >= prev.start && occ.start - prev.end <= ELIDED_GAP);
      const alt = inOrder ? occ : r.occurrences.find((o) => prev && o.start >= prev.end && o.start - prev.end <= ELIDED_GAP);
      if (!alt) return unverified("not_found");
      spans.push(alt);
      if (r.status === "verified_close") status = "verified_close";
    }
    return {
      status,
      method: status === "verified" ? "normalized" : "fuzzy",
      occurrences: [{ start: spans[0]!.start, end: spans[spans.length - 1]!.end }],
      primary: 0,
    };
  }

  const a = t1(idx, spacedQ);
  if (a.length > 0) return { status: "verified", method: "normalized", occurrences: a, primary: choosePrimary(a, opts) };

  const b = t2(idx, compactQ, spacedQ);
  if (b.length > 0) return { status: "verified", method: "compact", occurrences: b, primary: choosePrimary(b, opts) };

  const f = fuzzy(idx, quote);
  if (f) return { status: "verified_close", method: "fuzzy", score: Math.round(f.score * 1000) / 1000, occurrences: [f.span], primary: 0 };

  return unverified("not_found");
}

/** T1–T3 only (no fuzzy) — used to detect a quote that exists in a *different* document (§9.4). */
export function existsExactly(idx: DocMatchIndex, rawQuote: string): boolean {
  const quote = precleanQuote(rawQuote);
  const parts = quote.split(ELISION).filter((p) => p.trim());
  if (parts.length >= 2) return elided(idx, parts, {}) !== null;
  const spacedQ = normalizeText(quote, "spaced");
  if (words(spacedQ).length < 3) return false;
  return exactMatches(idx, quote) !== null;
}

/** The document's own words for a span: furniture removed, whitespace collapsed (§9.3 display text). */
export function displayText(idx: DocMatchIndex, span: Span): string {
  return blankRanges(idx.canon.slice(span.start, span.end), span.start, idx.skip).replace(/\s+/g, " ").trim();
}
