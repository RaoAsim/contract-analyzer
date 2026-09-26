import { lastStartingAtOrBefore } from "@/lib/text/ranges";
import type { HeadingCandidate, PageSpan, SectionDraft, SectionResult } from "./sections.types";

const RE_ARTICLE = /^(ARTICLE|Article)\s+([IVXLC]+|\d+)\b[.:\s-]*(.*)$/;
const RE_SECTION = /^(SECTION|Section|Clause|CLAUSE)\s+(\d+(?:\.\d+)*)\b[.:\s-]*(.*)$/;
const RE_NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,3})\.?\s+([A-Z“"‘'(][^\n]{0,160})$/;
const RE_SCHEDULE = /^(SCHEDULE|Schedule|EXHIBIT|Exhibit|ANNEX|Annex|APPENDIX|Appendix)\s+([A-Z0-9]+)\b(.*)$/;
const RE_TOC_LINE = /(\.{3,}|…{2,}|\s\.\s\.\s\.)\s*\d+\s*$/;
const RE_SUBITEM = /^\(?([a-z]{1,3}|[ivxlc]{1,6}|\d{1,2})\)/i;

type Raw = {
  start: number;
  end: number;
  number: string | null;
  title: string;
  level: number;
  kind: "article" | "section" | "numbered" | "schedule" | "caps" | "docx";
  /** Trusted structure (DOCX styles/numbering): skip the monotonic guard. */
  trusted: boolean;
};

function romanToInt(s: string): number | null {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]!];
    const next = map[s[i + 1] ?? ""] ?? 0;
    if (v === undefined) return null;
    total += v < next ? -v : v;
  }
  return total || null;
}

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/** Title: text up to the first period (at most 10 words), trimmed of trailing punctuation. */
export function titleFrom(text: string): string {
  const firstSentence = text.split(/(?<=[a-z0-9)\]”"])\.(?:\s|$)/i)[0] ?? text;
  const w = words(firstSentence).slice(0, 10).join(" ").replace(/[\s.:;,–—-]+$/, "").trim();
  const letters = w.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && letters === letters.toUpperCase() ? titleCase(w) : w;
}

function isAllCapsHeading(t: string): boolean {
  const w = words(t);
  if (w.length === 0 || w.length > 10) return false;
  if (/[.;,]$/.test(t.trim())) return false;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4) return false;
  if (letters !== letters.toUpperCase()) return false;
  // Mostly letters (not "AED 100,000" or reference codes).
  return letters.length / t.replace(/\s/g, "").length >= 0.7;
}

function numberLevel(n: string): number {
  return n.split(".").filter(Boolean).length;
}

function cleanLabel(label: string): string {
  return label
    .replace(/^(article|section|clause|schedule|exhibit|annex|appendix)\s+/i, "")
    .replace(/[.):\s]+$/, "")
    .replace(/^\(/, "")
    .trim();
}

function classifyPlain(c: HeadingCandidate): Raw | null {
  const t = c.text.trim();
  if (!t || t.length > 200) return null;
  if (RE_SUBITEM.test(t)) return null; // (a), (i), 1) — never sections
  let m = RE_ARTICLE.exec(t);
  if (m) {
    return { start: c.start, end: c.end, number: m[2]!, title: titleFrom(m[3] ?? "") || `Article ${m[2]}`, level: 1, kind: "article", trusted: false };
  }
  m = RE_SECTION.exec(t);
  if (m) {
    return { start: c.start, end: c.end, number: m[2]!, title: titleFrom(m[3] ?? "") || `Section ${m[2]}`, level: numberLevel(m[2]!), kind: "section", trusted: false };
  }
  m = RE_SCHEDULE.exec(t);
  if (m) {
    const title = `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}${m[3]?.trim() ? ` ${titleFrom(m[3].replace(/^[\s:.–—-]+/, ""))}` : ""}`;
    return { start: c.start, end: c.end, number: `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}`, title, level: 1, kind: "schedule", trusted: false };
  }
  m = RE_NUMBERED.exec(t);
  if (m) {
    return { start: c.start, end: c.end, number: m[1]!, title: titleFrom(m[2]!), level: numberLevel(m[1]!), kind: "numbered", trusted: false };
  }
  if (isAllCapsHeading(t)) {
    return { start: c.start, end: c.end, number: null, title: titleCase(t), level: 1, kind: "caps", trusted: false };
  }
  return null;
}

function titleCase(s: string): string {
  const small = new Set(["of", "and", "or", "the", "to", "in", "for", "a", "an", "on", "by", "with"]);
  return words(s)
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i > 0 && small.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(" ");
}

function classifyDocx(c: HeadingCandidate): Raw | null {
  const t = c.text.trim();
  if (!t || c.inTable) return null;
  const label = c.numLabel;
  const body = label && t.startsWith(label) ? t.slice(label.length).trim() : t;
  if (label) {
    const num = cleanLabel(label);
    if (/^\(?[a-z]{1,3}\)$|^\(?[ivxlc]{1,6}\)$/i.test(label.trim()) || /^\(/.test(label.trim())) return null; // (a) (i)
    // Every auto-numbered clause is a section (like "12.3 …" lines in PDFs); long ones take their
    // first words as the title.
    const title = c.boldLead ? titleFrom(c.boldLead.replace(label, "").trim()) || titleFrom(body) : titleFrom(body);
    const level = /^\d+(\.\d+)*$/.test(num) ? numberLevel(num) : (c.headingLevel ?? 1);
    return { start: c.start, end: c.end, number: num || null, title: title || num, level, kind: "docx", trusted: true };
  }
  if (c.headingLevel) {
    const plain = classifyPlain(c);
    if (plain) return { ...plain, level: c.headingLevel, trusted: true };
    return { start: c.start, end: c.end, number: null, title: titleFrom(t) || t.slice(0, 80), level: c.headingLevel, kind: "docx", trusted: true };
  }
  // Manually numbered headings ("12.3 Limitation of Liability") in short or bold paragraphs.
  const plain = classifyPlain(c);
  if (plain && plain.kind !== "caps" && (words(t).length <= 15 || c.leadingBold)) return plain;
  if (plain && plain.kind === "caps") return plain;
  return null;
}

function tocKey(r: Raw): string {
  return `${r.number ?? ""}|${r.title.toLowerCase().replace(/\s*\d+\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/** Drop table-of-contents entries: dot-leader lines, and first occurrences of a repeated heading sequence. */
function dropToc(raws: Raw[], candidates: Map<number, HeadingCandidate>): Raw[] {
  let out = raws.filter((r) => !RE_TOC_LINE.test(candidates.get(r.start)?.text ?? ""));
  const counts = new Map<string, number>();
  for (const r of out) counts.set(tocKey(r), (counts.get(tocKey(r)) ?? 0) + 1);
  const dupKeys = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupKeys.length >= 3) {
    const seen = new Map<string, number>();
    const drop = new Set<Raw>();
    for (const r of out) {
      const k = tocKey(r);
      const total = counts.get(k) ?? 1;
      const idx = (seen.get(k) ?? 0) + 1;
      seen.set(k, idx);
      if (total > 1 && idx < total) drop.add(r);
    }
    out = out.filter((r) => !drop.has(r));
  }
  return out;
}

/** Top-level numbers must be non-decreasing, stepping by 1 or 2; restart after a Schedule/Exhibit/Annex. */
function monotonic(raws: Raw[]): Raw[] {
  const out: Raw[] = [];
  let lastTop: number | null = null;
  const seenNumbers = new Set<string>();
  for (const r of raws) {
    if (r.trusted || r.kind === "caps") {
      out.push(r);
      continue;
    }
    if (r.kind === "schedule") {
      lastTop = null;
      seenNumbers.clear();
      out.push(r);
      continue;
    }
    const top = r.kind === "article" && /^[IVXLC]+$/.test(r.number ?? "") ? romanToInt(r.number!) : Number.parseInt((r.number ?? "").split(".")[0] ?? "", 10);
    if (top === null || !Number.isFinite(top)) continue;
    if (seenNumbers.has(r.number!)) continue;
    const depth = r.number!.split(".").length;
    let ok: boolean;
    if (lastTop === null) ok = top <= 3;
    else if (depth === 1 || r.kind === "article") ok = top === lastTop + 1 || top === lastTop + 2;
    else ok = top === lastTop || top === lastTop + 1 || top === lastTop + 2;
    if (!ok) continue;
    lastTop = top;
    seenNumbers.add(r.number!);
    out.push(r);
  }
  return out;
}

function pageOf(pages: readonly PageSpan[], pos: number): number | null {
  if (pages.length === 0) return null;
  const i = lastStartingAtOrBefore(pages, pos);
  return pages[Math.max(0, i)]!.pageNo;
}

function finalize(raws: Raw[], textLength: number, pages: readonly PageSpan[]): SectionDraft[] {
  const drafts: SectionDraft[] = raws.map((r, i) => ({
    ord: i,
    number: r.number,
    title: r.title,
    level: Math.max(1, Math.min(r.level, 6)),
    start: r.start,
    end: textLength,
    parentOrd: null,
    pageStart: null,
    pageEnd: null,
  }));
  const stack: SectionDraft[] = [];
  for (const d of drafts) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= d.level) {
      stack.pop()!.end = d.start;
    }
    d.parentOrd = stack.length > 0 ? stack[stack.length - 1]!.ord : null;
    stack.push(d);
  }
  for (const d of drafts) {
    d.pageStart = pageOf(pages, d.start);
    d.pageEnd = pageOf(pages, Math.max(d.start, d.end - 1));
  }
  return drafts;
}

function fallbackSections(text: string, pages: readonly PageSpan[], paragraphs: readonly HeadingCandidate[]): SectionDraft[] {
  const raws: Raw[] = [];
  if (pages.length > 0) {
    for (const p of pages) {
      if (p.end > p.start) raws.push({ start: p.start, end: p.end, number: null, title: `Page ${p.pageNo}`, level: 1, kind: "caps", trusted: true });
    }
  } else {
    let partStart = 0;
    let n = 1;
    for (const para of paragraphs) {
      if (para.start - partStart >= 2000) {
        raws.push({ start: partStart, end: para.start, number: null, title: `Part ${n++}`, level: 1, kind: "caps", trusted: true });
        partStart = para.start;
      }
    }
    if (partStart < text.length) raws.push({ start: partStart, end: text.length, number: null, title: `Part ${n}`, level: 1, kind: "caps", trusted: true });
    if (raws.length > 0) raws[0]!.start = 0;
  }
  return finalize(raws, text.length, pages);
}

/**
 * Section detection (§8.7). `candidates` are PDF lines (furniture excluded) or DOCX paragraphs.
 * Adds a "Preamble" section for text before the first heading, so chunks cover the whole document.
 */
export function detectSections(
  text: string,
  candidates: readonly HeadingCandidate[],
  pages: readonly PageSpan[],
  source: "pdf" | "docx",
): SectionResult {
  const byStart = new Map(candidates.map((c) => [c.start, c]));
  const raw = candidates.map((c) => (source === "docx" ? classifyDocx(c) : classifyPlain(c))).filter((r): r is Raw => r !== null);
  const accepted = monotonic(dropToc(raw, byStart));

  const numbered = accepted.filter((r) => r.number !== null).length;
  if (accepted.length < 3 || (source === "pdf" && numbered < 2 && accepted.length < 5)) {
    return { sections: fallbackSections(text, pages, candidates), structured: false };
  }
  const firstStart = accepted[0]!.start;
  if (text.slice(0, firstStart).replace(/\s+/g, "").length > 0) {
    accepted.unshift({ start: 0, end: firstStart, number: null, title: "Preamble", level: 1, kind: "caps", trusted: true });
  }
  return { sections: finalize(accepted, text.length, pages), structured: true };
}
