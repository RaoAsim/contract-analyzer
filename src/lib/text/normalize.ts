import type { Range } from "@/types/document";
import type { NormIndex, NormMode } from "./normalize.types";

const SINGLE_QUOTES = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x0060, 0x00b4]);
const DOUBLE_QUOTES = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb]);
const DASHES = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]);
const SPACES = new Set([0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]);
const DROP = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const COMPACT_KEEP_SYMBOLS = new Set(["%", "$", "€", "£", "¥", "§"]);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LOWER = /\p{Ll}/u;
const WS = /\s/;

/** Map one (already NFKC'd, lowercased) character to its normalised string (§9.2 steps 4–6). */
function mapChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (DROP.has(cp)) return "";
  if (SINGLE_QUOTES.has(cp)) return "'";
  if (DOUBLE_QUOTES.has(cp)) return '"';
  if (DASHES.has(cp)) return "-";
  if (SPACES.has(cp)) return " ";
  return ch;
}

function normalizeCodePoint(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80) {
    // ASCII fast path (no NFKC needed); the backtick is the only ASCII variant character.
    if (cp === 0x60) return "'";
    return cp >= 0x41 && cp <= 0x5a ? String.fromCharCode(cp + 32) : ch;
  }
  if (DROP.has(cp)) return "";
  let out = "";
  for (const c of ch.normalize("NFKC")) out += mapChar(c);
  return out.toLowerCase();
}

type Emitter = { text: string[]; starts: number[]; ends: number[]; lastSpace: boolean };

function emit(e: Emitter, s: string, start: number, end: number, mode: NormMode): void {
  for (const c of s) {
    if (WS.test(c)) {
      if (mode === "compact") continue;
      if (e.lastSpace || e.text.length === 0) continue;
      e.text.push(" ");
      e.starts.push(start);
      e.ends.push(end);
      e.lastSpace = true;
      continue;
    }
    if (mode === "compact" && !LETTER_OR_DIGIT.test(c) && !COMPACT_KEEP_SYMBOLS.has(c)) continue;
    // Surrogate pairs push one UTF-16 unit per entry so indexes line up with `text`.
    for (let k = 0; k < c.length; k++) {
      e.text.push(c[k]!);
      e.starts.push(start);
      e.ends.push(end);
    }
    e.lastSpace = false;
  }
}

/**
 * Normalise `canon` (§9.2) and keep, for every output character, the canonical span it came from.
 * `skip` ranges (page furniture) are treated as a single whitespace boundary.
 */
export function buildIndex(canon: string, mode: NormMode, skip: readonly Range[] = []): NormIndex {
  const sortedSkip = [...skip].sort((a, b) => a[0] - b[0]);
  let si = 0;
  const e: Emitter = { text: [], starts: [], ends: [], lastSpace: false };

  const inSkip = (pos: number): Range | null => {
    while (si < sortedSkip.length && sortedSkip[si]![1] <= pos) si++;
    const r = sortedSkip[si];
    return r && r[0] <= pos && pos < r[1] ? r : null;
  };

  /** From `pos`, skip whitespace and furniture; returns the next content position and whether a line break was crossed. */
  const skipGap = (pos: number): { next: number; crossedBreak: boolean } => {
    let p = pos;
    let crossed = false;
    let localSi = si;
    for (;;) {
      while (localSi < sortedSkip.length && sortedSkip[localSi]![1] <= p) localSi++;
      const r = sortedSkip[localSi];
      if (r && r[0] <= p && p < r[1]) {
        p = r[1];
        crossed = true;
        continue;
      }
      const c = canon[p];
      if (c === undefined) break;
      if (c === "\n") crossed = true;
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " ") {
        p++;
        continue;
      }
      break;
    }
    return { next: p, crossedBreak: crossed };
  };

  let pos = 0;
  while (pos < canon.length) {
    const r = inSkip(pos);
    if (r) {
      emit(e, " ", r[0], r[1], mode);
      pos = r[1];
      continue;
    }
    const cp = canon.codePointAt(pos)!;
    const ch = String.fromCodePoint(cp);
    const len = ch.length;

    // De-hyphenate words broken across a line (or page) break: "termi-\nnation" → "termination".
    if (ch === "-" || cp === 0x00ad || cp === 0x2010 || cp === 0x2011) {
      const { next, crossedBreak } = skipGap(pos + len);
      const nextCh = canon[next];
      if (crossedBreak && nextCh !== undefined && LOWER.test(nextCh)) {
        pos = next;
        continue;
      }
    }

    emit(e, normalizeCodePoint(ch), pos, pos + len, mode);
    pos += len;
  }

  // Trim a trailing space.
  if (e.text[e.text.length - 1] === " ") {
    e.text.pop();
    e.starts.pop();
    e.ends.pop();
  }
  return { mode, text: e.text.join(""), starts: Int32Array.from(e.starts), ends: Int32Array.from(e.ends) };
}

/** Normalise a quote exactly like the document (no skip ranges). */
export function normalizeText(s: string, mode: NormMode): string {
  return buildIndex(s, mode).text;
}

/** Map a match `[i, j)` in a normalised index back to a canonical `[start, end)` span. */
export function toCanonical(idx: NormIndex, i: number, j: number): [number, number] {
  return [idx.starts[i]!, idx.ends[j - 1]!];
}

const ELLIPSIS_EDGE = /^(\s*(\.\s*){3,}|\s*…)+|((\s*\.){3,}\s*|…\s*)+$/g;

/**
 * Quote pre-clean (§9.2): trim, strip wrapping quotation marks and leading/trailing ellipses,
 * strip bracketed page artefacts, collapse internal newlines.
 */
export function precleanQuote(q: string): string {
  let s = q.replace(/\r?\n+/g, " ").trim();
  s = s.replace(/\[\s*p(?:age|p)?\.?\s*\d+\s*\]/gi, " ");
  for (let k = 0; k < 3; k++) {
    const before = s;
    s = s.trim().replace(ELLIPSIS_EDGE, "").trim();
    // Wrapping quotes only when they wrap the whole quote (a leading “ with no closing inside).
    const m = /^["“”'‘’«»](.*)["“”'‘’«»]$/s.exec(s);
    if (m) s = m[1]!.trim();
    else if (/^["“'‘«]/.test(s) && !/["”'’»]/.test(s.slice(1))) s = s.slice(1).trim();
    else if (/["”'’»]$/.test(s) && !/["“'‘«]/.test(s.slice(0, -1))) s = s.slice(0, -1).trim();
    s = s.replace(/^\*+|\*+$/g, "").trim();
    if (s === before) break;
  }
  return s.replace(/\s+/g, " ");
}
