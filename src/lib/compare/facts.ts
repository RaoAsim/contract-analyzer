import type { Fact, FactKind } from "@/types/compare";

const MONEY = /(?:AED|USD|EUR|GBP|SAR|INR|QAR|KWD|\$|€|£)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|m|thousand|k|bn|billion)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dirhams?|dollars?|euros?|pounds?|riyals?)\b/gi;
const SPELLED_MONEY = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|thousand|million)(?:[\s-]+(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|million|and))*\s+(?:dirhams|dollars|euros|pounds|riyals)\b/gi;
const PERCENT = /\b\d+(?:\.\d+)?\s?(?:%|per\s?cent|percent)/gi;
const DURATION = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty|forty|forty-five|sixty|ninety)\s*(?:\(\d+\)\s*)?(?:business\s+|calendar\s+|working\s+)?(?:days?|weeks?|months?|years?)\b/gi;
const DATE = /\b(?:\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi;
const MODALITY = /\b(?:shall not|must not|will not|may not|shall|must|will|may|is entitled to|at its sole discretion|reasonable efforts|best efforts|commercially reasonable efforts|reasonable endeavours|best endeavours)\b/gi;
const NEGATION = /\b(?:not|no|never|without|except|unless|notwithstanding)\b/gi;
const JURISDICTION = /\b(?:laws? of|courts? of|seat of (?:the )?arbitration (?:shall be|is)|arbitration in)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+(?:and|of|the)?\s*[A-Z][A-Za-z]+){0,4})/g;
const DEFINED = /“([A-Z][A-Za-z ]{1,40})”\s+means|\((?:the\s+)?“([A-Z][A-Za-z ]{1,40})”\)|"([A-Z][A-Za-z ]{1,40})"\s+means/g;
const PLAIN_NUMBER = /(?<!(?:clause|section|article|schedule|§)\s*)\b\d+(?:[.,]\d+)*\b/gi;

const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

export function moneyValue(s: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(million|m|thousand|k|bn|billion)?/i.exec(s);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) ? v * (m[2] ? (MULT[m[2].toLowerCase()] ?? 1) : 1) : null;
}

function all(re: RegExp, text: string, group?: number): string[] {
  return [...text.matchAll(re)].map((m) => (group !== undefined ? (m[group] ?? m[0]) : m[0]).replace(/\s+/g, " ").trim());
}

function norm(kind: FactKind, v: string): string {
  const s = v.toLowerCase().replace(/\s+/g, " ").trim();
  if (kind === "duration") return s.replace(/\s*\(\d+\)/, "");
  return s;
}

function multisetDiff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  const added: string[] = [];
  for (const y of b) {
    const n = counts.get(y) ?? 0;
    if (n > 0) counts.set(y, n - 1);
    else added.push(y);
  }
  const removed = [...counts.entries()].flatMap(([k, n]) => Array.from({ length: n }, () => k));
  return { removed, added };
}

type Extractor = { kind: FactKind; get: (t: string) => string[] };

const EXTRACTORS: Extractor[] = [
  { kind: "money", get: (t) => [...all(MONEY, t), ...all(SPELLED_MONEY, t)] },
  { kind: "percent", get: (t) => all(PERCENT, t) },
  { kind: "duration", get: (t) => all(DURATION, t) },
  { kind: "date", get: (t) => all(DATE, t) },
  { kind: "modality", get: (t) => all(MODALITY, t) },
  { kind: "negation", get: (t) => all(NEGATION, t) },
  { kind: "jurisdiction", get: (t) => all(JURISDICTION, t, 1) },
  { kind: "party", get: (t) => [...t.matchAll(DEFINED)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim()).filter(Boolean) },
];

/**
 * Deterministic "facts changed" between the old and new text of a unit (§13.4). Numbers already
 * covered by money/percent/duration/date are not repeated as plain numbers.
 */
export function extractFacts(before: string, after: string): Fact[] {
  const facts: Fact[] = [];
  const claimedNumbers = { a: new Set<string>(), b: new Set<string>() };
  for (const ex of EXTRACTORS) {
    const a = ex.get(before);
    const b = ex.get(after);
    if (["money", "percent", "duration", "date"].includes(ex.kind)) {
      for (const x of a) for (const n of x.match(/\d[\d,.]*/g) ?? []) claimedNumbers.a.add(n.replace(/,/g, ""));
      for (const x of b) for (const n of x.match(/\d[\d,.]*/g) ?? []) claimedNumbers.b.add(n.replace(/,/g, ""));
    }
    const d = multisetDiff(a.map((x) => norm(ex.kind, x)), b.map((x) => norm(ex.kind, x)));
    if (d.removed.length === 0 && d.added.length === 0) continue;
    const pick = (list: string[], src: string[]): string => src.find((s) => list.includes(norm(ex.kind, s))) ?? list[0] ?? "";
    const fact: Fact = { kind: ex.kind, before: d.removed.length ? pick(d.removed, a) : "—", after: d.added.length ? pick(d.added, b) : "—" };
    if (ex.kind === "money") {
      const va = d.removed.length ? moneyValue(fact.before) : null;
      const vb = d.added.length ? moneyValue(fact.after) : null;
      if (va && vb) fact.ratio = Math.round((vb / va) * 1000) / 1000;
    }
    facts.push(fact);
  }
  const numsA = all(PLAIN_NUMBER, before).map((n) => n.replace(/,/g, "")).filter((n) => !claimedNumbers.a.has(n));
  const numsB = all(PLAIN_NUMBER, after).map((n) => n.replace(/,/g, "")).filter((n) => !claimedNumbers.b.has(n));
  const nd = multisetDiff(numsA, numsB);
  if (nd.removed.length || nd.added.length) facts.push({ kind: "number", before: nd.removed[0] ?? "—", after: nd.added[0] ?? "—" });
  return facts;
}

/** Whether a modality changed direction (shall/must ↔ may) or a negation appeared/disappeared. */
export function modalityFlip(facts: Fact[]): boolean {
  const strong = /^(shall|must|will)$/;
  const weak = /^(may|is entitled to)$/;
  return facts.some(
    (f) =>
      f.kind === "modality" &&
      ((strong.test(f.before.toLowerCase()) && weak.test(f.after.toLowerCase())) ||
        (weak.test(f.before.toLowerCase()) && strong.test(f.after.toLowerCase())) ||
        /not/.test(f.before.toLowerCase()) !== /not/.test(f.after.toLowerCase())),
  );
}
