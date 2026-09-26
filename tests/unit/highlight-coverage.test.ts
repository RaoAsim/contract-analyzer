import { beforeAll, describe, expect, it } from "vitest";
import { buildCitation } from "@/lib/chat/citations";
import { buildCoverage, docCoverage, hasAbsenceClaim, isDocComplete } from "@/lib/chat/coverage";
import { SseWriter } from "@/lib/chat/sse";
import type { DocData } from "@/lib/text/docData.types";
import { boxesForSpan } from "@/lib/text/highlight";
import { fixtureDocData } from "../support/docData";

let pdf: DocData;
let docx: DocData;

beforeAll(async () => {
  pdf = await fixtureDocData("long_msa.pdf", "pdf-1");
  docx = await fixtureDocData("msa_v1.docx", "docx-1");
}, 60_000);

const pageOf = (d: DocData, pos: number): number => d.pages.find((p) => pos >= p.start && pos < p.end)!.pageNo;

describe("PDF citation highlighting (§10.3)", () => {
  it("a quote wrapped over 3 lines → 3 rectangles on 1 page", () => {
    const c = buildCitation("c1", [{ tag: "D1", data: pdf, contextRanges: [] }], "D1",
      "which shall not exceed AED 100,000 (one hundred thousand dirhams) in any Contract Year");
    expect(c.status).toBe("verified");
    const occ = c.occurrences[0]!;
    expect(occ.boxes).toHaveLength(1);
    const lines = new Set(occ.boxes![0]!.rects.map((r) => r[1].toFixed(3)));
    expect(occ.boxes![0]!.rects.length).toBe(lines.size); // one merged rect per line
    expect(occ.boxes![0]!.rects.length).toBeGreaterThanOrEqual(1);
    expect(occ.boxes![0]!.page).toBe(3);
  });

  it("a multi-line quote produces one rectangle per visual line", () => {
    const text = "test them at least annually, and provide the Customer with a written summary of each test within ten Business Days of its completion, including any remediation actions identified";
    const c = buildCitation("c1", [{ tag: "D1", data: pdf, contextRanges: [] }], "D1", text);
    const rects = c.occurrences[0]!.boxes!.flatMap((b) => b.rects);
    expect(rects.length).toBeGreaterThanOrEqual(3);
  });

  it("a quote crossing a page break → rectangles on both pages, none over the header or footer", () => {
    const q = "test them at least annually, and provide the Customer with a written summary";
    const c = buildCitation("c1", [{ tag: "D1", data: pdf, contextRanges: [] }], "D1", q);
    expect(c.status).toBe("verified");
    const boxes = c.occurrences[0]!.boxes!;
    expect(boxes.map((b) => b.page)).toEqual([boxes[0]!.page, boxes[0]!.page + 1]);
    for (const b of boxes) for (const [, y, , h] of b.rects) {
      expect(y).toBeGreaterThan(0.08); // header band
      expect(y + h).toBeLessThan(0.93); // footer band
    }
    // The document's own text is shown, without the header/footer in between.
    expect(c.displayText).toBe("test them at least annually, and provide the Customer with a written summary");
    expect(c.occurrences[0]!.pageStart).toBe(boxes[0]!.page);
    expect(c.occurrences[0]!.pageEnd).toBe(boxes[0]!.page + 1);
  });

  it("a repeated clause → every occurrence has boxes for cycling", () => {
    const c = buildCitation("c1", [{ tag: "D1", data: pdf, contextRanges: [] }], "D1", "This clause shall survive termination or expiry of this Agreement.");
    expect(c.occurrences.length).toBeGreaterThan(3);
    for (const o of c.occurrences) expect(o.boxes!.length).toBeGreaterThan(0);
    const pages = new Set(c.occurrences.map((o) => o.pageStart));
    expect(pages.size).toBeGreaterThan(1);
  });

  it("rects are normalised to 0..1 of the page", () => {
    const start = pdf.text.indexOf("governed by and construed");
    for (const b of boxesForSpan(pdf.pages, pdf.furniture, start, start + 80)) {
      for (const [x, y, w, h] of b.rects) {
        for (const v of [x, y, w, h]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(pageOf(pdf, start)).toBe(142);
  });

  it("citations carry section and page for the source card", () => {
    const c = buildCitation("c1", [{ tag: "D1", data: pdf, contextRanges: [] }], "D1", "shall be governed by and construed in accordance with the laws of the Emirate of Dubai");
    expect(c.occurrences[0]!.sectionNumber).toMatch(/^40\./);
    expect(c.occurrences[0]!.pageStart).toBe(142);
  });

  it("DOCX citations have no boxes (the viewer maps offsets to DOM ranges)", () => {
    const c = buildCitation("c1", [{ tag: "D1", data: docx, contextRanges: [] }], "D1", "shall not exceed AED 100,000");
    expect(c.status).toBe("verified");
    expect(c.occurrences[0]!.boxes).toBeUndefined();
    expect(c.occurrences[0]!.sectionNumber).toBe("6.1");
  });
});

describe("coverage (§11.4)", () => {
  it("reading the whole text is complete; furniture never counts", () => {
    const cov = docCoverage(pdf, "D1", [[0, pdf.text.length]]);
    expect(cov.fraction).toBe(1);
    expect(isDocComplete(cov)).toBe(true);
    expect(cov.totalChars).toBeLessThan(pdf.text.length);
  });

  it("excerpts give a fraction, pages and sections read, and complete=false", () => {
    const s = pdf.sections.find((x) => x.number === "20")!;
    const cov = docCoverage(pdf, "D1", [[s.start, s.end]]);
    expect(cov.fraction).toBeGreaterThan(0);
    expect(cov.fraction).toBeLessThan(0.1);
    expect(cov.sectionsRead).toBe("§20");
    expect(cov.pagesRead).toMatch(/^\d/);
    expect(buildCoverage("retrieval", [cov]).complete).toBe(false);
  });

  it("failed scan windows make coverage incomplete", () => {
    const cov = docCoverage(pdf, "D1", [[0, pdf.text.length]], { failedRanges: [{ pageStart: 46, pageEnd: 60, reason: "analysis_failed" }] });
    expect(isDocComplete(cov)).toBe(false);
  });

  it("unreadable (scanned) pages always count as unread", async () => {
    const partial = await fixtureDocData("partial_scan.pdf", "ps");
    const cov = docCoverage(partial, "D1", [[0, partial.text.length]]);
    expect(cov.unreadablePages).toEqual([3, 4]);
    expect(isDocComplete(cov)).toBe(false);
  });
});

describe("absence-claim regex", () => {
  it.each([
    "The agreement does not contain a non-compete clause.",
    "There is no provision addressing force majeure.",
    "The contract is silent on audit rights.",
    "Termination for convenience is not addressed.",
    "The document doesn't mention exclusivity.",
  ])("flags: %s", (s) => expect(hasAbsenceClaim(s)).toBe(true));

  it.each(["The liability cap is AED 100,000.", "Either party may terminate on 30 days' notice."])("does not flag: %s", (s) =>
    expect(hasAbsenceClaim(s)).toBe(false),
  );
});

describe("SSE writer", () => {
  it("sends exactly one done, always last, and nothing after it", async () => {
    const w = new SseWriter(() => {});
    w.send("meta", { messageId: "m", userMessageId: "u", conversationId: "c", mode: "full", docs: [] });
    w.send("text", { delta: "hi" });
    w.send("done", { status: "complete", messageId: "m" });
    w.send("done", { status: "error", messageId: "m" });
    w.send("text", { delta: "late" });
    const reader = w.stream.getReader();
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    expect(out.startsWith(": ping")).toBe(true);
    expect(out.match(/event: done/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith('"messageId":"m"}')).toBe(true);
    expect(out).not.toContain("late");
    expect(out).toMatch(/id: 1\nevent: meta/);
  });
});
