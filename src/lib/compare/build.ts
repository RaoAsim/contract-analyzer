import type { DocData } from "@/lib/text/docData.types";
import { boxesForSpan } from "@/lib/text/highlight";
import type { Change, ChangeType, ComparisonResult, Significance, UnitRef } from "@/types/compare";
import { alignUnits } from "./align";
import { guessCategory, rulesSummary, significanceFloor } from "./classify";
import type { Pair, Unit } from "./compare.types";
import { redline } from "./diff";
import { extractFacts } from "./facts";
import { buildUnits, withoutLabel } from "./units";

function ref(doc: DocData, u: Unit, withBoxes: boolean): UnitRef {
  const page = doc.pages.find((p) => u.start >= p.start && u.start < p.end)?.pageNo ?? null;
  return {
    number: u.number,
    title: u.title,
    start: u.start,
    end: u.end,
    pageStart: page,
    boxes: withBoxes && doc.kind === "pdf" ? boxesForSpan(doc.pages, doc.furniture, u.start, u.end) : undefined,
  };
}

export type DraftComparison = { changes: Change[]; units: { a: number; b: number } };

/**
 * Deterministic part of the comparison (§13.1–13.4): units → alignment → redline → facts →
 * significance floors and rule-based summaries. The LLM step later refines summary/significance.
 */
export function draftComparison(docA: DocData, docB: DocData): DraftComparison {
  const A = buildUnits(docA);
  const B = buildUnits(docB);
  const pairs = alignUnits(A, B);
  const changes = pairs.map((p: Pair, i): Change => {
    const title = p.b?.title ?? p.a?.title ?? "";
    const before = p.a ? withoutLabel(p.a.text) : "";
    const after = p.b ? withoutLabel(p.b.text) : "";
    const changedText = p.type === "modified" || (p.type === "moved" && p.textChanged);
    const hunks = changedText ? redline(before, after) : p.type === "added" ? [{ op: "ins" as const, text: after }] : p.type === "removed" ? [{ op: "del" as const, text: before }] : [{ op: "eq" as const, text: after }];
    const facts = changedText ? extractFacts(before, after) : [];
    const base = { type: p.type as ChangeType, facts, textChanged: p.textChanged };
    // Cosmetic short-circuit: same letters and digits → only whitespace/punctuation/case changed.
    const cosmetic = changedText && p.a!.compact === p.b!.compact;
    const floor: Significance = p.type === "unchanged" ? "cosmetic" : cosmetic ? "cosmetic" : significanceFloor(base, title);
    return {
      id: `C${i + 1}`,
      type: p.type,
      a: p.a ? ref(docA, p.a, p.type !== "unchanged") : undefined,
      b: p.b ? ref(docB, p.b, p.type !== "unchanged") : undefined,
      significance: floor,
      category: guessCategory(title, after || before),
      summary:
        p.type === "unchanged"
          ? "Unchanged."
          : cosmetic
            ? "Formatting, punctuation or capitalisation only; wording unchanged."
            : rulesSummary(base, title, p.a?.number, p.b?.number),
      favours: "unclear",
      facts,
      hunks,
      classifiedBy: "rules",
      textChanged: p.textChanged,
    };
  });
  return { changes, units: { a: A.length, b: B.length } };
}

export function countChanges(changes: Change[]): Pick<ComparisonResult["counts"], "bySignificance" | "byType"> {
  const bySignificance: Record<Significance, number> = { critical: 0, major: 0, minor: 0, cosmetic: 0 };
  const byType: Record<ChangeType, number> = { modified: 0, added: 0, removed: 0, moved: 0, unchanged: 0 };
  for (const c of changes) {
    byType[c.type]++;
    if (c.type !== "unchanged") bySignificance[c.significance]++;
  }
  return { bySignificance, byType };
}
