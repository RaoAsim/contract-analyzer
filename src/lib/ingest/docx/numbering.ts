import type { LevelDef, NumberingDefs } from "./docx.types";
import { attr, child, children, intAttr, parseXml } from "./xml";

export function parseNumbering(xml: string | null): NumberingDefs {
  const defs: NumberingDefs = { abstract: new Map(), nums: new Map() };
  if (!xml) return defs;
  const root = parseXml(xml);
  if (!root) return defs;

  for (const an of children(root, "abstractNum")) {
    const id = intAttr(an, "abstractNumId");
    if (id === undefined) continue;
    const levels = new Map<number, LevelDef>();
    for (const lvl of children(an, "lvl")) {
      const ilvl = intAttr(lvl, "ilvl") ?? 0;
      levels.set(ilvl, {
        start: intAttr(child(lvl, "start"), "val") ?? 1,
        numFmt: attr(child(lvl, "numFmt"), "val") ?? "decimal",
        lvlText: attr(child(lvl, "lvlText"), "val") ?? "",
        isLgl: child(lvl, "isLgl") !== undefined,
      });
    }
    defs.abstract.set(id, levels);
  }

  for (const num of children(root, "num")) {
    const numId = intAttr(num, "numId");
    const abstractNumId = intAttr(child(num, "abstractNumId"), "val");
    if (numId === undefined || abstractNumId === undefined) continue;
    const startOverrides = new Map<number, number>();
    for (const ov of children(num, "lvlOverride")) {
      const ilvl = intAttr(ov, "ilvl") ?? 0;
      const so = intAttr(child(ov, "startOverride"), "val");
      if (so !== undefined) startOverrides.set(ilvl, so);
    }
    defs.nums.set(numId, { abstractNumId, startOverrides });
  }
  return defs;
}

function toLetters(n: number, upper: boolean): string {
  if (n <= 0) return String(n);
  // Word repeats the letter: a..z, aa..zz, aaa…
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  const s = letter.repeat(Math.floor((n - 1) / 26) + 1);
  return upper ? s.toUpperCase() : s;
}

function toRoman(n: number, upper: boolean): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  let v = n;
  for (const [k, s] of table) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return upper ? out.toUpperCase() : out;
}

export function formatNumber(n: number, numFmt: string): string {
  switch (numFmt) {
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "lowerLetter":
      return toLetters(n, false);
    case "upperLetter":
      return toLetters(n, true);
    case "lowerRoman":
      return toRoman(n, false);
    case "upperRoman":
      return toRoman(n, true);
    case "none":
      return "";
    default:
      return String(n);
  }
}

export type NumberLabel = { label: string; isBullet: boolean };

/**
 * Approximate Word's list numbering (§8.6). Counters are keyed by abstractNumId; a `num` with a
 * startOverride resets that level on first use; incrementing a level resets all deeper levels;
 * a missing ancestor level uses its start value.
 */
export class NumberingEngine {
  private readonly counters = new Map<number, Map<number, number>>();
  private readonly usedNums = new Set<number>();

  constructor(private readonly defs: NumberingDefs) {}

  next(numId: number | undefined, ilvl: number | undefined): NumberLabel | null {
    if (numId === undefined || numId === 0) return null;
    const num = this.defs.nums.get(numId);
    if (!num) return null;
    const levels = this.defs.abstract.get(num.abstractNumId);
    const level = ilvl ?? 0;
    const def = levels?.get(level);
    if (!levels || !def) return null;

    let counters = this.counters.get(num.abstractNumId);
    if (!counters) this.counters.set(num.abstractNumId, (counters = new Map()));

    if (!this.usedNums.has(numId)) {
      this.usedNums.add(numId);
      for (const [lv, start] of num.startOverrides) {
        counters.set(lv, start - 1);
        for (const k of [...counters.keys()]) if (k > lv) counters.delete(k);
      }
    }

    const current = counters.get(level);
    counters.set(level, current === undefined ? def.start : current + 1);
    for (const k of [...counters.keys()]) if (k > level) counters.delete(k);
    for (let lv = 0; lv < level; lv++) {
      if (!counters.has(lv)) counters.set(lv, levels.get(lv)?.start ?? 1);
    }

    if (def.numFmt === "bullet") return { label: "•", isBullet: true };
    const label = def.lvlText
      .replace(/%(\d)/g, (_, d: string) => {
        const k = Number(d) - 1;
        const kDef = levels.get(k);
        const value = counters.get(k) ?? kDef?.start ?? 1;
        const fmt = def.isLgl ? "decimal" : (kDef?.numFmt ?? "decimal");
        return formatNumber(value, fmt === "bullet" ? "decimal" : fmt);
      })
      .trim();
    if (!label) return null;
    return { label, isBullet: false };
  }
}
