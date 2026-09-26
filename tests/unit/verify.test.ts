import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeDocument } from "@/lib/ingest/analyze";
import type { Analysis } from "@/lib/ingest/analyze.types";
import { verifyAttributed } from "@/lib/text/attribute";
import { DocMatchIndex } from "@/lib/text/matchIndex";
import { buildIndex, precleanQuote, toCanonical } from "@/lib/text/normalize";
import { displayText, extractNumbers, tokenCheck, verifyQuote } from "@/lib/text/verify";
import type { Range } from "@/types/document";

const CONTRACT = [
  "12.3 Limitation of Liability. The total aggregate liability of the Supplier shall not exceed AED 100,000 in any Contract Year.",
  "12.4 The Supplier shall\nindemnify the Customer against all losses arising from any breach of clause 12.",
  "13.1 Suspension or termi-\nnation of any Service shall not affect the remaining Services.",
  "13.2 The Customer’s “Confidential Information” includes all data — whether written or oral — disclosed to the Supplier.",
  "13.3 The Supplier’s obligations under this clause are subject to the eﬁnal approval of the Board.",
  "13.4 Either party may terminate this Agreement by giving 30 days’ written notice to the other party.",
  "13.5 Payments are due within 15% of the invoice value as a deposit.",
  "14.1 The liab ility of each party for death or personal injury is unlimited.",
  "14.2 No party may assign this Agreement without the prior written consent of the other party.",
].join("\n");

const idx = new DocMatchIndex(CONTRACT);

const slice = (s: { start: number; end: number }): string => CONTRACT.slice(s.start, s.end);

describe("normalisation keeps an offset map back to the canonical text", () => {
  it("maps every normalised char to a canonical offset", () => {
    const n = buildIndex("A  “B”\n—c", "spaced");
    expect(n.text).toBe('a "b" -c');
    const [s, e] = toCanonical(n, 0, n.text.length);
    expect([s, e]).toEqual([0, 9]);
  });

  it("compact keeps letters, digits and % $ € £ ¥ §", () => {
    expect(buildIndex("AED 1,000 (15%) — §12.3!", "compact").text).toBe("aed100015%§123");
  });

  it("drops soft hyphens and zero-width chars, maps NBSP to space, applies NFKC ligatures", () => {
    expect(buildIndex("con­fi​dential ﬁle", "spaced").text).toBe("confidential file");
  });

  it("pre-cleans wrapping quotes, ellipses and page artefacts", () => {
    expect(precleanQuote("“…the Supplier shall indemnify [p. 12] the Customer...”")).toBe("the Supplier shall indemnify the Customer");
    expect(precleanQuote("“Liability Cap” means the cap.")).toBe("“Liability Cap” means the cap.");
  });
});

describe("verifyQuote — must verify", () => {
  it("line break inside a quote", () => {
    const r = verifyQuote(idx, "the Supplier shall indemnify the Customer against all losses");
    expect(r.status).toBe("verified");
    expect(r.method).toBe("normalized");
    expect(slice(r.occurrences[0]!)).toBe("The Supplier shall\nindemnify the Customer against all losses");
  });

  it("hyphenation at a line end", () => {
    const r = verifyQuote(idx, "Suspension or termination of any Service shall not affect the remaining Services");
    expect(r.status).toBe("verified");
    expect(slice(r.occurrences[0]!)).toContain("termi-\nnation");
  });

  it("curly vs straight quotes, em dash vs hyphen", () => {
    const r = verifyQuote(idx, `The Customer's "Confidential Information" includes all data - whether written or oral - disclosed`);
    expect(r.status).toBe("verified");
  });

  it("ligature in the document vs plain letters in the quote", () => {
    const r = verifyQuote(idx, "subject to the efinal approval of the Board");
    expect(r.status).toBe("verified");
  });

  it("apostrophe variants: straight quote for ’", () => {
    expect(verifyQuote(idx, "giving 30 days' written notice to the other party").status).toBe("verified");
  });

  it("a word split by extraction ('liab ility') matches via T2 compact", () => {
    const r = verifyQuote(idx, "The liability of each party for death or personal injury is unlimited");
    expect(r.status).toBe("verified");
    expect(r.method).toBe("compact");
  });

  it("returns the document's own text for display", () => {
    const r = verifyQuote(idx, "the supplier shall indemnify the customer against all losses");
    // The document's own casing, not the model's.
    expect(displayText(idx, r.occurrences[0]!)).toBe("The Supplier shall indemnify the Customer against all losses");
  });

  it("elided quote with ... → verified with 2 segments", () => {
    const r = verifyQuote(idx, "The total aggregate liability of the Supplier ... in any Contract Year");
    expect(r.status).toBe("verified");
    expect(r.method).toBe("elided");
    expect(r.segments).toHaveLength(2);
  });

  it("OCR-like one-character typo in a long quote → verified_close", () => {
    const r = verifyQuote(idx, "No party may assign this Agreement without the prior writen consent of the other party");
    expect(r.status).toBe("verified_close");
    expect(r.method).toBe("fuzzy");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(slice(r.occurrences[0]!)).toContain("written consent");
  });

  it("a short quote that matches exactly once verifies", () => {
    expect(verifyQuote(idx, "personal injury").status).toBe("verified");
  });
});

describe("verifyQuote — must reject", () => {
  it("a paraphrase: one protected word changed (shall → may)", () => {
    expect(verifyQuote(idx, "the Supplier may indemnify the Customer against all losses arising from any breach").status).toBe("unverified");
  });

  it("a changed amount (AED 100,000 vs AED 1,000,000)", () => {
    expect(verifyQuote(idx, "The total aggregate liability of the Supplier shall not exceed AED 1,000,000 in any Contract Year").status).toBe("unverified");
  });

  it("a changed number that compacts identically (1.5% vs 15%)", () => {
    expect(verifyQuote(idx, "Payments are due within 1.5% of the invoice value as a deposit").status).toBe("unverified");
  });

  it("30 days vs 60 days", () => {
    expect(verifyQuote(idx, "Either party may terminate this Agreement by giving 60 days’ written notice to the other party").status).toBe("unverified");
  });

  it("a merged pair of non-adjacent sentences", () => {
    const r = verifyQuote(idx, "The total aggregate liability of the Supplier shall not exceed AED 100,000 and no party may assign this Agreement without consent");
    expect(r.status).toBe("unverified");
  });

  it("an invented sentence", () => {
    expect(verifyQuote(idx, "The Supplier shall provide free upgrades to the Customer for the lifetime of the Agreement").status).toBe("unverified");
  });

  it("elided segments in the wrong order", () => {
    expect(verifyQuote(idx, "in any Contract Year ... The total aggregate liability of the Supplier").status).toBe("unverified");
  });

  it("a fuzzy match whose changed word is a protected word", () => {
    expect(verifyQuote(idx, "Nor party may assign this Agreement without the prior written consent of the other party").status).toBe("unverified");
  });

  it("a paraphrase that drops a word", () => {
    expect(verifyQuote(idx, "No party may assign this Agreement without prior written consent of the other party").status).toBe("unverified");
  });
});

describe("occurrences and short quotes", () => {
  const boiler = "This clause shall survive termination of this Agreement.";
  const text = [`1.1 First. ${boiler}`, `2.1 Second. ${boiler}`, `3.1 Third. ${boiler}`].join("\n");
  const bIdx = new DocMatchIndex(text);

  it("repeated boilerplate → all occurrences, primary follows the context overlap", () => {
    const secondStart = text.indexOf("2.1");
    const ctx: Range[] = [[secondStart, secondStart + 80]];
    const r = verifyQuote(bIdx, boiler, { contextRanges: ctx });
    expect(r.status).toBe("verified");
    expect(r.occurrences).toHaveLength(3);
    expect(r.primary).toBe(1);
    const noCtx = verifyQuote(bIdx, boiler);
    expect(noCtx.primary).toBe(0);
  });

  it("a short quote with many occurrences → unverified(too_short)", () => {
    const t = Array.from({ length: 40 }, (_, i) => `${i + 1}. the Company agrees.`).join("\n");
    const r = verifyQuote(new DocMatchIndex(t), "the Company");
    expect(r.status).toBe("unverified");
    expect(r.reason).toBe("too_short");
  });
});

describe("furniture skip: a quote across a page break", () => {
  const page1 = "5.2 The Supplier shall maintain comprehensive business continuity arrangements, test them at";
  const footer = "Page 12 of 150";
  const header = "MASTER SERVICES AGREEMENT — CONFIDENTIAL";
  const page2 = "least annually, and provide the Customer with a written summary.";
  const text = `${page1}\n${header}\n${footer}\n\n${page2}`;
  const furniture: Range[] = [
    [text.indexOf(header), text.indexOf(header) + header.length],
    [text.indexOf(footer), text.indexOf(footer) + footer.length],
  ];

  it("verifies when header/footer text sits between the two halves", () => {
    const q = "test them at least annually, and provide the Customer with a written summary";
    expect(verifyQuote(new DocMatchIndex(text, furniture), q).status).toBe("verified");
    // Without furniture ranges it would not verify.
    expect(verifyQuote(new DocMatchIndex(text, []), q).status).toBe("unverified");
  });

  it("display text excludes the furniture", () => {
    const i = new DocMatchIndex(text, furniture);
    const r = verifyQuote(i, "test them at least annually, and provide the Customer");
    expect(displayText(i, r.occurrences[0]!)).toBe("test them at least annually, and provide the Customer");
  });

  it("de-hyphenates a word broken across the page break", () => {
    const t = `the parties agree to the termi-\n${header}\n${footer}\n\nnation of this Agreement on notice.`;
    const f: Range[] = [
      [t.indexOf(header), t.indexOf(header) + header.length],
      [t.indexOf(footer), t.indexOf(footer) + footer.length],
    ];
    expect(verifyQuote(new DocMatchIndex(t, f), "the parties agree to the termination of this Agreement").status).toBe("verified");
  });
});

describe("multi-document attribution", () => {
  const d1 = new DocMatchIndex("1.1 The liability cap is AED 100,000 for all claims under this Agreement.");
  const d2 = new DocMatchIndex("1.1 The liability cap is AED 1,000,000 for all claims under this Agreement.");
  const docs = [
    { tag: "D1", docId: "doc-1", index: d1 },
    { tag: "D2", docId: "doc-2", index: d2 },
  ];

  it("verifies against the tagged document only", () => {
    expect(verifyAttributed(docs, "D2", "The liability cap is AED 1,000,000 for all claims").status).toBe("verified");
  });

  it("quote from D2 tagged D1 → misattributed with foundInDocId", () => {
    const r = verifyAttributed(docs, "D1", "The liability cap is AED 1,000,000 for all claims");
    expect(r.status).toBe("misattributed");
    expect(r.foundInDocId).toBe("doc-2");
    expect(r.occurrences).toEqual([]);
  });

  it("unknown tag → unverified(unknown_document)", () => {
    const r = verifyAttributed(docs, "D7", "The liability cap is AED 100,000 for all claims");
    expect(r.status).toBe("unverified");
    expect(r.reason).toBe("unknown_document");
  });
});

describe("guards", () => {
  it("extracts numbers without thousands separators", () => {
    expect(extractNumbers("aed 100,000 within 30 days or 1.5%")).toEqual(["100000", "30", "1.5"]);
  });

  it("token check accepts a single typo and rejects protected or numeric changes", () => {
    expect(tokenCheck("the supplier shall provide the services", "the suppiier shall provide the services")).toBe(true);
    expect(tokenCheck("the supplier shall provide the services", "the supplier must provide the services")).toBe(false);
    expect(tokenCheck("within thirty days of notice", "within thirtyy days of notice given")).toBe(false);
  });
});

describe("real fixture: long_msa.pdf", () => {
  let a: Analysis;
  let fIdx: DocMatchIndex;
  beforeAll(async () => {
    a = await analyzeDocument(new Uint8Array(fs.readFileSync("tests/fixtures/long_msa.pdf")), "pdf");
    fIdx = new DocMatchIndex(a.text, a.furniture);
  }, 60_000);

  it("the cross-page clause verifies across the header/footer", () => {
    const q = "test them at least annually, and provide the Customer with a written summary of each test within ten Business Days";
    const r = verifyQuote(fIdx, q);
    expect(r.status).toBe("verified");
    const s = r.occurrences[0]!;
    const p1 = a.pages.find((p) => s.start >= p.charStart && s.start < p.charEnd)!.pageNo;
    const p2 = a.pages.find((p) => s.end - 1 >= p.charStart && s.end - 1 < p.charEnd)!.pageNo;
    expect(p2).toBe(p1 + 1);
  });

  it("finds the page-142 governing-law clause and the AED 100,000 cap", () => {
    expect(verifyQuote(fIdx, "shall be governed by and construed in accordance with the laws of the Emirate of Dubai").status).toBe("verified");
    expect(verifyQuote(fIdx, "which shall not exceed AED 100,000 (one hundred thousand dirhams)").status).toBe("verified");
    expect(verifyQuote(fIdx, "which shall not exceed AED 1,000,000 (one hundred thousand dirhams)").status).toBe("unverified");
  });

  it("repeated boilerplate returns every occurrence (capped at 25)", () => {
    const r = verifyQuote(fIdx, "This clause shall survive termination or expiry of this Agreement.");
    expect(r.status).toBe("verified");
    expect(r.occurrences.length).toBeGreaterThan(5);
  });

  it("verifies quickly on a 150-page document (indexes built once)", () => {
    void fIdx.spaced;
    void fIdx.compact;
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) verifyQuote(fIdx, "No party may assign this Agreemnt without the prior written consent of the other party at all");
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(50);
  });
});
