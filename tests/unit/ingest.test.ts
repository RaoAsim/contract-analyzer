import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeDocument } from "@/lib/ingest/analyze";
import type { Analysis } from "@/lib/ingest/analyze.types";
import { PermanentIngestError } from "@/lib/ingest/errors";
import { quickOpenPdf, sniffFileType } from "@/lib/ingest/validate";
import { detectSections } from "@/lib/ingest/sections";
import { overlapLength } from "@/lib/text/ranges";
import { LONG_MSA_FACTS } from "../../scripts/fixtures/longMsa";

const fx = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join("tests/fixtures", name)));

async function ingestError(p: Promise<unknown>): Promise<PermanentIngestError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PermanentIngestError) return e;
    throw e;
  }
  throw new Error("expected a PermanentIngestError");
}

describe("upload validation (magic bytes)", () => {
  it("detects PDF and DOCX regardless of extension", async () => {
    expect(await sniffFileType(fx("long_msa.pdf"), "contract.docx")).toEqual({ kind: "pdf" });
    expect(await sniffFileType(fx("msa_v1.docx"), "contract.pdf")).toEqual({ kind: "docx" });
  });

  it("rejects a text file with a specific message", async () => {
    const e = await ingestError(sniffFileType(fx("notes.txt"), "notes.txt"));
    expect(e.code).toBe("unsupported_type");
    expect(e.httpStatus).toBe(415);
    expect(e.message).toContain("notes.txt");
    expect(e.message).toMatch(/Only PDF and DOCX/);
  });

  it("rejects a legacy .doc (OLE2) with a save-as-docx message", async () => {
    const e = await ingestError(sniffFileType(fx("legacy.doc"), "old.doc"));
    expect(e.code).toBe("legacy_doc");
    expect(e.message).toMatch(/\.docx/);
  });

  it("rejects a password-protected PDF", async () => {
    const e = await ingestError(quickOpenPdf(fx("encrypted.pdf"), 500));
    expect(e.code).toBe("password_protected");
  });

  it("rejects a damaged PDF", async () => {
    const e = await ingestError(quickOpenPdf(fx("corrupted.pdf"), 500));
    expect(e.code).toBe("corrupted_file");
  });

  it("enforces the page limit", async () => {
    const e = await ingestError(quickOpenPdf(fx("long_msa.pdf"), 100));
    expect(e.code).toBe("too_many_pages");
  });
});

describe("scanned PDFs", () => {
  it("an image-only PDF fails with no_text_layer instead of becoming an empty ready document", async () => {
    const e = await ingestError(analyzeDocument(fx("scanned.pdf"), "pdf"));
    expect(e.code).toBe("no_text_layer");
    expect(e.message).toMatch(/scanned image/);
  });

  it("a partly scanned PDF is analysed, with those pages recorded as unreadable", async () => {
    const a = await analyzeDocument(fx("partial_scan.pdf"), "pdf");
    expect(a.unreadablePages).toEqual([3, 4]);
    expect(a.warnings.find((w) => w.code === "partial_scan")?.message).toMatch(/Pages 3–4/);
  });
});

describe("long_msa.pdf (150-page fixture)", () => {
  let a: Analysis;
  beforeAll(async () => {
    a = await analyzeDocument(fx("long_msa.pdf"), "pdf");
  }, 60_000);

  it("extracts every page with text and no false scanned-page warnings", () => {
    expect(a.pageCount).toBeGreaterThanOrEqual(145);
    expect(a.unreadablePages).toEqual([]);
    expect(a.tokenCount).toBeGreaterThan(50_000);
  });

  it("finds header/footer furniture on at least 95% of pages", () => {
    const pagesWithFurniture = new Set(
      a.furniture.map(([s]) => a.pages.find((p) => s >= p.charStart && s < p.charEnd)?.pageNo),
    );
    expect(pagesWithFurniture.size / a.pages.length).toBeGreaterThanOrEqual(0.95);
    for (const [s, e] of a.furniture) {
      expect(a.text.slice(s, e)).toMatch(/MASTER SERVICES AGREEMENT — CONFIDENTIAL|^Page \d+ of \d+$/);
    }
  });

  it("places the key facts on pages 3, 71 and 142", () => {
    const pageOf = (needle: string): number | undefined => {
      const i = a.text.replace(/\s+/g, " ").indexOf(needle);
      if (i < 0) return undefined;
      // Map back through a whitespace-insensitive search on the raw text.
      const raw = a.text.search(new RegExp(needle.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")));
      return a.pages.find((p) => raw >= p.charStart && raw < p.charEnd)?.pageNo;
    };
    expect(pageOf("AED 100,000 (one hundred thousand dirhams)")).toBe(3);
    expect(pageOf("terminate this Agreement for convenience by giving not less than 30 days")).toBe(71);
    expect(pageOf("the laws of the Emirate of Dubai")).toBe(142);
  });

  it("the page-break clause really spans two pages with furniture in between", () => {
    const start = a.text.indexOf("comprehensive business continuity");
    const endWord = a.text.indexOf("completing them", start);
    expect(start).toBeGreaterThan(0);
    const p1 = a.pages.find((p) => start >= p.charStart && start < p.charEnd)!.pageNo;
    const p2 = a.pages.find((p) => endWord >= p.charStart && endWord < p.charEnd)!.pageNo;
    expect(p2).toBe(p1 + 1);
    expect(overlapLength(start, endWord, a.furniture)).toBeGreaterThan(0);
  });

  it("detects the 40 articles and skips the table of contents", () => {
    const top = a.sections.filter((s) => s.level === 1 && s.number !== null);
    expect(top.map((s) => s.number)).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)));
    // TOC is on page 1; the first real article starts on page 2.
    expect(top[0]!.pageStart).toBe(2);
    expect(top[19]!.title).toBe("Limitation of Liability");
  });

  it("chunks stay within one article, fit the size cap, exclude furniture and cover the document", () => {
    const tops = a.sections.filter((s) => s.level === 1);
    const topAt = (pos: number): number => tops.filter((s) => s.start <= pos).at(-1)?.ord ?? -1;
    for (const c of a.chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(760);
      expect(topAt(c.start)).toBe(topAt(c.end - 1));
      expect(c.text).not.toMatch(/MASTER SERVICES AGREEMENT — CONFIDENTIAL/);
      expect(c.text).not.toMatch(/Page \d+ of \d+/);
    }
    const covered = a.chunks.reduce((n, c) => n + (c.end - c.start), 0);
    expect(covered).toBeGreaterThanOrEqual(a.text.length * 0.95);
  });

  it("the facts are in the chunk index", () => {
    const all = a.chunks.map((c) => c.text.replace(/\s+/g, " ")).join("\n");
    expect(all).toContain("AED 100,000");
    expect(all).toContain(LONG_MSA_FACTS.governingLaw.slice(0, 60));
  });

  it("indexes standard clauses by keyword", () => {
    const types = new Set(a.clauses.map((c) => c.type));
    for (const t of ["limitation_of_liability", "termination", "governing_law", "confidentiality", "force_majeure"]) {
      expect(types.has(t as never)).toBe(true);
    }
  });
});

describe("DOCX parsing with Word auto-numbering", () => {
  it("v1 labels follow 1., 1.1, (a)… and appear in the canonical text", async () => {
    const a = await analyzeDocument(fx("msa_v1.docx"), "docx");
    expect(a.text).toContain("1. Definitions");
    expect(a.text).toContain("1.1 “Agreement” means");
    expect(a.text).toContain("3.1 The Supplier shall provide the Services:\n(a) with reasonable skill and care;\n(b) in accordance");
    expect(a.text).toContain("6.1 The total aggregate liability of the Supplier under or in connection with this Agreement shall not exceed AED 100,000.");
    expect(a.text).toContain("10. Governing Law");
    const numbers = a.sections.filter((s) => s.level === 1 && s.number).map((s) => s.number);
    expect(numbers).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    // (a)/(b) sub-items are never sections.
    expect(a.sections.some((s) => /^\(?[a-z]\)?$/.test(s.number ?? ""))).toBe(false);
  });

  it("renders HTML whose data-o offsets point at the same canonical text", async () => {
    const a = await analyzeDocument(fx("msa_v1.docx"), "docx");
    const spans = [...a.html!.matchAll(/<span(?: class="num")? data-o="(\d+)">([^<]*)<\/span>/g)];
    expect(spans.length).toBeGreaterThan(20);
    const unescape = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    for (const [, o, t] of spans) {
      const off = Number(o);
      const txt = unescape(t!);
      expect(a.text.slice(off, off + txt.length)).toBe(txt);
    }
    // The fees table is rendered as a table and its cells are in the text.
    expect(a.html).toContain('<table class="docx-table">');
    expect(a.text).toContain("Service desk\nAED 25,000");
  });

  it("v2 renumbers after the moved clause", async () => {
    const a = await analyzeDocument(fx("msa_v2.docx"), "docx");
    expect(a.text).toContain("5. Limitation of Liability");
    expect(a.text).toContain("AED 1,000,000");
    expect(a.text).toContain("9. Non-Compete");
  });
});

describe("section detection guards", () => {
  const lines = (arr: string[]): { start: number; end: number; text: string }[] => {
    let pos = 0;
    return arr.map((t) => {
      const r = { start: pos, end: pos + t.length, text: t };
      pos += t.length + 1;
      return r;
    });
  };

  it("skips dot-leader TOC lines and rejects non-monotonic numbers", () => {
    const src = [
      "1. Definitions ........ 2",
      "2. Term ........ 3",
      "3. Payment ........ 4",
      "1. DEFINITIONS",
      "Words and expressions have these meanings.",
      "2. TERM",
      "This Agreement lasts for 100 years.",
      "100 Main Street Dubai",
      "3. PAYMENT",
      "3.1 The Customer shall pay.",
      "(a) on time;",
    ];
    const text = src.join("\n");
    const { sections } = detectSections(text, lines(src), [], "pdf");
    const numbered = sections.filter((s) => s.number !== null).map((s) => s.number);
    expect(numbered).toEqual(["1", "2", "3", "3.1"]);
    expect(sections.find((s) => s.number === "1")!.start).toBe(text.indexOf("1. DEFINITIONS"));
  });
});
