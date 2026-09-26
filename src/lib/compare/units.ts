import { countTokens } from "@/lib/llm/tokens";
import { cleanSlice } from "@/lib/retrieval/context";
import type { DocData, DocSection } from "@/lib/text/docData.types";
import { normalizeText } from "@/lib/text/normalize";
import type { Unit } from "./compare.types";

const MAX_UNIT_TOKENS = 1500;
const SIGNATURE = /\bIN WITNESS WHEREOF\b|^\s*(By|Name|Title|Signature|Date)\s*:\s*(_{2,}|$)|^\s*Signed (for and )?on behalf of/im;
const TOC_LINE = /(\.{3,}|…{2,})\s*\d+\s*$/;

export function shingles(spaced: string, k = 3): Set<string> {
  const w = spaced.split(" ").filter(Boolean);
  const out = new Set<string>();
  if (w.length < k) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}

/** Clause number labels ("12.3 ", "5. ") are dropped for comparison so renumbering alone isn't a change. */
export function withoutLabel(text: string): string {
  return text.replace(/^\s*(?:§\s*)?\d{1,3}(?:\.\d{1,3})*\.?\s+/, "");
}

function makeUnit(doc: DocData, index: number, start: number, end: number, number: string | null, title: string): Unit {
  const text = cleanSlice(doc, start, end).replace(/[ \t]+/g, " ");
  const body = withoutLabel(text);
  const spaced = normalizeText(body, "spaced");
  return { id: `${doc.id}:${index}`, docId: doc.id, index, number, title, text, compact: normalizeText(body, "compact"), spaced, shingles: shingles(spaced), start, end };
}

/** Non-substantive: signature blocks, tables of contents, empty headings. */
function substantive(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 4) return false;
  if (SIGNATURE.test(text) && words < 80) return false;
  if (lines.filter((l) => TOC_LINE.test(l)).length >= Math.max(2, lines.length / 2)) return false;
  return true;
}

/** Leaf body text excluding a heading-only first line. */
function isHeadingOnly(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length === 1 && lines[0]!.split(/\s+/).length <= 12 && !/[.;:]$/.test(lines[0]!);
}

/** A readable title: leaf titles derived from the clause's first words fall back to the parent heading. */
function displayTitle(doc: DocData, s: DocSection): string {
  const parent = s.parentId ? doc.sections.find((p) => p.id === s.parentId) : undefined;
  const body = doc.text.slice(s.start, Math.min(s.end, s.start + 200)).replace(/\s+/g, " ");
  const derived = body.replace(/^\s*[\d.()a-z]+\s+/i, "").startsWith(s.title.slice(0, 20)) && s.title.split(" ").length >= 6;
  return derived && parent ? parent.title : s.title;
}

function splitLong(doc: DocData, u: { start: number; end: number; number: string | null; title: string }, next: () => number): Unit[] {
  const whole = makeUnit(doc, next(), u.start, u.end, u.number, u.title);
  if (countTokens(whole.text) <= MAX_UNIT_TOKENS) return [whole];
  // Split into paragraphs, packing up to the cap.
  const parts: Unit[] = [];
  let s = u.start;
  let lastBreak = u.start;
  let part = 1;
  for (let i = doc.text.indexOf("\n", u.start); i !== -1 && i < u.end; i = doc.text.indexOf("\n", i + 1)) {
    if (countTokens(cleanSlice(doc, s, i)) > MAX_UNIT_TOKENS && lastBreak > s) {
      parts.push(makeUnit(doc, next(), s, lastBreak, u.number, `${u.title} (part ${part++})`));
      s = lastBreak;
    }
    lastBreak = i + 1;
  }
  parts.push(makeUnit(doc, next(), s, u.end, u.number, part > 1 ? `${u.title} (part ${part})` : u.title));
  return parts;
}

function paragraphUnits(doc: DocData): Unit[] {
  const out: Unit[] = [];
  let pos = 0;
  let n = 0;
  const text = doc.text;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = text.length;
    const t = cleanSlice(doc, pos, end);
    if (t.split(/\s+/).length >= 5 && substantive(t)) out.push(makeUnit(doc, n++, pos, end, null, t.split(/\s+/).slice(0, 8).join(" ")));
    pos = end + 1;
  }
  return out;
}

/**
 * Comparison units (§13.1): leaf-level sections; a parent's own body text before its first child
 * becomes its own unit; very long units are split into paragraphs; with fewer than 5 real sections
 * the units are paragraphs. Signature blocks, TOCs and empty headings are dropped.
 */
export function buildUnits(doc: DocData): Unit[] {
  const real = doc.sections.filter((s) => !/^(Preamble|Page \d+|Part \d+)$/.test(s.title));
  if (real.length < 5) return paragraphUnits(doc);
  const hasChild = new Set(doc.sections.map((s) => s.parentId).filter(Boolean));
  let n = 0;
  const next = (): number => n++;
  const out: Unit[] = [];
  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i]!;
    const bodyEnd = i + 1 < doc.sections.length ? doc.sections[i + 1]!.start : doc.text.length;
    if (hasChild.has(s.id)) {
      // Parent: only its own body before the first child.
      const own = cleanSlice(doc, s.start, bodyEnd);
      if (!isHeadingOnly(own) && substantive(own)) out.push(...splitLong(doc, { start: s.start, end: bodyEnd, number: s.number, title: s.title }, next));
      continue;
    }
    const own = cleanSlice(doc, s.start, bodyEnd);
    if (!substantive(own) || isHeadingOnly(own)) continue;
    out.push(...splitLong(doc, { start: s.start, end: bodyEnd, number: s.number, title: displayTitle(doc, s) }, next));
  }
  return out.map((u, i) => ({ ...u, index: i, id: `${doc.id}:${i}` }));
}
