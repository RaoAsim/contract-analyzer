import { beforeAll, describe, expect, it } from "vitest";
import { alignUnits } from "@/lib/compare/align";
import { draftComparison } from "@/lib/compare/build";
import { significanceFloor } from "@/lib/compare/classify";
import { redline } from "@/lib/compare/diff";
import { extractFacts } from "@/lib/compare/facts";
import { buildUnits } from "@/lib/compare/units";
import type { DocData } from "@/lib/text/docData.types";
import type { Change } from "@/types/compare";
import { fixtureDocData } from "../support/docData";

let v1: DocData;
let v2: DocData;
let changes: Change[];

beforeAll(async () => {
  v1 = await fixtureDocData("msa_v1.docx", "v1");
  v2 = await fixtureDocData("msa_v2.docx", "v2");
  changes = draftComparison(v1, v2).changes;
}, 60_000);

const find = (pred: (c: Change) => boolean): Change => {
  const c = changes.find(pred);
  if (!c) throw new Error("change not found");
  return c;
};

describe("comparison of msa_v1 → msa_v2", () => {
  it("bucket invariant: every unit of A and B lands in exactly one bucket", () => {
    const A = buildUnits(v1);
    const B = buildUnits(v2);
    const pairs = alignUnits(A, B);
    const aIds = pairs.flatMap((p) => (p.a ? [p.a.id] : []));
    const bIds = pairs.flatMap((p) => (p.b ? [p.b.id] : []));
    expect(new Set(aIds).size).toBe(A.length);
    expect(aIds.length).toBe(A.length);
    expect(new Set(bIds).size).toBe(B.length);
    expect(bIds.length).toBe(B.length);
  });

  it("the liability cap AED 100,000 → AED 1,000,000 is critical with the amounts in the summary", () => {
    const c = find((x) => x.facts.some((f) => f.kind === "money"));
    expect(c.type).toBe("modified");
    expect(c.significance).toBe("critical");
    expect(c.facts[0]).toMatchObject({ before: "AED 100,000", after: "AED 1,000,000", ratio: 10 });
    expect(c.summary).toContain("AED 100,000");
    expect(c.summary).toContain("AED 1,000,000");
    expect(c.a?.number).toBe("6.1");
    expect(c.b?.number).toBe("5.1"); // renumbered as well
  });

  it("notice 30 → 60 days is at least major", () => {
    const c = find((x) => x.facts.some((f) => f.kind === "duration"));
    expect(["major", "critical"]).toContain(c.significance);
  });

  it("shall → may is at least major", () => {
    const c = find((x) => x.facts.some((f) => f.kind === "modality" && f.before === "shall" && f.after === "may"));
    expect(["major", "critical"]).toContain(c.significance);
  });

  it("governing law change is critical", () => {
    const c = find((x) => x.facts.some((f) => f.kind === "jurisdiction"));
    expect(c.significance).toBe("critical");
  });

  it("the punctuation-only change takes the cosmetic short-circuit (no LLM needed)", () => {
    const c = find((x) => x.a?.number === "1.3");
    expect(c.type).toBe("modified");
    expect(c.significance).toBe("cosmetic");
    expect(c.summary).toMatch(/Formatting, punctuation/);
  });

  it("the reworded sentence is paired as a modification, not flagged major", () => {
    const c = find((x) => x.a?.number === "3.3");
    expect(c.b?.number).toBe("3.3");
    expect(c.type).toBe("modified");
    expect(["cosmetic", "minor"]).toContain(c.significance);
  });

  it("the moved clause is detected as moved, the added non-compete and the removed audit clause are found", () => {
    expect(changes.filter((c) => c.type === "moved" && c.b?.title === "Confidentiality").length).toBe(2);
    const added = find((c) => c.type === "added");
    expect(added.b?.title).toBe("Non-Compete");
    expect(added.significance).toBe("major");
    const removed = find((c) => c.type === "removed");
    expect(removed.a?.title).toBe("Audit Rights");
  });

  it("renumbered but identical clauses are unchanged", () => {
    const unchanged = changes.filter((c) => c.type === "unchanged");
    expect(unchanged.some((c) => c.a?.number === "8.1" && c.b?.number === "7.1")).toBe(true);
  });
});

describe("facts and floors", () => {
  it("extracts money with ratio, percentages, durations and modality", () => {
    const f = extractFacts("The cap is USD 2 million and 15% within 30 days; the Supplier shall pay.", "The cap is USD 500,000 and 1.5% within 60 days; the Supplier may pay.");
    const kinds = f.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["money", "percent", "duration", "modality"]));
    expect(f.find((x) => x.kind === "money")!.ratio).toBe(0.25);
  });

  it("ratio ≥ 5× or ≤ 0.2× is critical; other money changes major", () => {
    expect(significanceFloor({ type: "modified", facts: [{ kind: "money", before: "a", after: "b", ratio: 0.1 }] }, "x")).toBe("critical");
    expect(significanceFloor({ type: "modified", facts: [{ kind: "money", before: "a", after: "b", ratio: 2 }] }, "x")).toBe("major");
    expect(significanceFloor({ type: "added", facts: [] }, "Indemnity")).toBe("major");
    expect(significanceFloor({ type: "added", facts: [] }, "Notices")).toBe("minor");
  });

  it("cross-reference numbers are not treated as substantive number changes", () => {
    expect(extractFacts("subject to clause 5", "subject to clause 8")).toEqual([]);
  });

  it("redline consolidates changes separated by ≤ 3 unchanged words", () => {
    const h = redline("pay within thirty days of the invoice", "pay within sixty days of receipt of the invoice");
    const ops = h.map((x) => x.op).join(",");
    expect(ops).not.toMatch(/del,ins,eq,del,ins/);
    expect(h.filter((x) => x.op === "ins").map((x) => x.text).join("")).toContain("sixty");
  });
});
