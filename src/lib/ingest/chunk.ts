import { countTokens, estimateTokens } from "@/lib/llm/tokens";
import { blankRanges, lastStartingAtOrBefore } from "@/lib/text/ranges";
import type { Range } from "@/types/document";
import type { ChunkDraft } from "./chunk.types";
import type { PageSpan, SectionDraft } from "./sections.types";

export const CHUNK_MIN_TOKENS = 400;
export const CHUNK_MAX_TOKENS = 700;
const OVERLAP_TOKENS = 60;

const ABBREVIATIONS = ["No.", "Sec.", "Art.", "Inc.", "Ltd.", "Co.", "e.g.", "i.e.", "U.S.", "Corp.", "cl.", "para.", "Pty.", "L.L.C.", "vs.", "etc."];

/** Section heading as used in search_text / excerpt headings: "§12.3 Limitation of Liability". */
export function sectionLabel(s: Pick<SectionDraft, "number" | "title">): string {
  if (s.number && s.title && s.title !== s.number) return `§${s.number} ${s.title}`;
  if (s.number) return `§${s.number}`;
  return s.title;
}

/** Split points (canonical offsets) at sentence boundaries inside [start, end), with a legal-abbreviation guard. */
function sentenceBreaks(text: string, start: number, end: number): number[] {
  const slice = text.slice(start, end);
  const out: number[] = [];
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const s of seg.segment(slice)) {
    if (s.index === 0) continue;
    const before = slice.slice(Math.max(0, s.index - 8), s.index).trimEnd();
    if (ABBREVIATIONS.some((a) => before.endsWith(a))) continue;
    out.push(start + s.index);
  }
  return out;
}

function paragraphBreaks(text: string, start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = text.indexOf("\n", start); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) {
    if (i + 1 < end) out.push(i + 1);
  }
  return out;
}

/** Greedy packing between break points: each piece is as long as possible within `max`. */
function greedy(text: string, start: number, end: number, breaks: number[], max: number): Range[] {
  const points = [start, ...breaks.filter((x) => x > start && x < end), end];
  const out: Range[] = [];
  let s = start;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    if (estimateTokens(text.slice(s, points[i]!)) > max && prev > s) {
      out.push([s, prev]);
      s = prev;
    }
  }
  if (s < end) out.push([s, end]);
  return out;
}

/**
 * Split [start, end) into pieces of at most `max` tokens: at paragraph breaks first, then sentence
 * breaks, then hard character cuts as a last resort.
 */
function splitRange(text: string, start: number, end: number, max: number): Range[] {
  const out: Range[] = [];
  for (const [ps, pe] of greedy(text, start, end, paragraphBreaks(text, start, end), max)) {
    if (estimateTokens(text.slice(ps, pe)) <= max) {
      out.push([ps, pe]);
      continue;
    }
    for (const [ss, se] of greedy(text, ps, pe, sentenceBreaks(text, ps, pe), max)) {
      if (estimateTokens(text.slice(ss, se)) <= max) out.push([ss, se]);
      else for (let x = ss; x < se; x += max * 4) out.push([x, Math.min(se, x + max * 4)]);
    }
  }
  return out;
}

/** Start offset ~OVERLAP_TOKENS before `pos`, snapped to a word boundary, not before `floor`. */
function overlapStart(text: string, pos: number, floor: number): number {
  let s = Math.max(floor, pos - OVERLAP_TOKENS * 4);
  while (s > floor && s < pos && !/\s/.test(text[s - 1]!)) s++;
  return s;
}

function pageOf(pages: readonly PageSpan[], pos: number): number | null {
  if (pages.length === 0) return null;
  const i = lastStartingAtOrBefore(pages, pos);
  return pages[Math.max(0, i)]!.pageNo;
}

/**
 * Section-aware chunking (§8.8). A section's body runs from its start to the next section's start.
 * Consecutive sections of the same article are packed up to ~700 tokens; large sections are split at
 * paragraph, then sentence, boundaries with ~60 tokens of overlap only inside the same section.
 * Chunks never cross an article boundary.
 */
export function buildChunks(
  text: string,
  sections: readonly SectionDraft[],
  furniture: readonly Range[],
  pages: readonly PageSpan[],
): ChunkDraft[] {
  type Body = { sectionOrd: number; top: number; start: number; end: number; tokens: number };
  const byOrd = new Map(sections.map((s) => [s.ord, s]));
  const topOf = (ord: number): number => {
    let cur = byOrd.get(ord);
    for (let guard = 0; cur && cur.parentOrd !== null && guard < 10; guard++) cur = byOrd.get(cur.parentOrd);
    return cur?.ord ?? ord;
  };
  const bodies: Body[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : text.length;
    if (end <= s.start) continue;
    const clean = blankRanges(text.slice(s.start, end), s.start, furniture);
    if (!clean.trim()) continue;
    bodies.push({ sectionOrd: s.ord, top: topOf(s.ord), start: s.start, end, tokens: estimateTokens(clean) });
  }

  // Pack consecutive section bodies of the same top-level section (article) up to the max size;
  // split oversized bodies on their own. Chunks therefore never span two articles.
  type Group = { sectionOrd: number; start: number; end: number };
  const groups: Group[] = [];
  let open: { sectionOrd: number; top: number; start: number; end: number; tokens: number } | null = null;
  const close = (): void => {
    if (open) groups.push({ sectionOrd: open.sectionOrd, start: open.start, end: open.end });
    open = null;
  };
  for (const b of bodies) {
    if (b.tokens > CHUNK_MAX_TOKENS) {
      close();
      const pieces = splitRange(text, b.start, b.end, CHUNK_MAX_TOKENS - OVERLAP_TOKENS);
      pieces.forEach((r, idx) => {
        groups.push({ sectionOrd: b.sectionOrd, start: idx === 0 ? r[0] : overlapStart(text, r[0], b.start), end: r[1] });
      });
      continue;
    }
    const cur = open as { sectionOrd: number; top: number; start: number; end: number; tokens: number } | null;
    if (cur && cur.top === b.top && cur.tokens + b.tokens <= CHUNK_MAX_TOKENS) {
      cur.end = b.end;
      cur.tokens += b.tokens;
      continue;
    }
    close();
    open = { sectionOrd: b.sectionOrd, top: b.top, start: b.start, end: b.end, tokens: b.tokens };
  }
  close();

  return groups.map((g, ord) => {
    const { start, end } = g;
    const body = blankRanges(text.slice(start, end), start, furniture).trim();
    const sec = byOrd.get(g.sectionOrd);
    const prefix = sec ? `${sectionLabel(sec)} — ` : "";
    return {
      ord,
      sectionOrd: g.sectionOrd,
      start,
      end,
      pageStart: pageOf(pages, start),
      pageEnd: pageOf(pages, Math.max(start, end - 1)),
      text: body,
      searchText: prefix + body,
      tokenCount: countTokens(body),
    };
  });
}
