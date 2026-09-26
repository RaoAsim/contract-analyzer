import PDFDocument from "pdfkit";
import { ARTICLE_TITLES, LegalText } from "./legalText";

export const LONG_MSA_FACTS = {
  liabilityCap:
    "“Liability Cap” means the total aggregate liability of the Supplier under or in connection with this Agreement, which shall not exceed AED 100,000 (one hundred thousand dirhams) in any Contract Year.",
  terminationNotice:
    "Either party may terminate this Agreement for convenience by giving not less than 30 days’ written notice to the other party.",
  governingLaw:
    "This Agreement and any dispute or claim arising out of or in connection with it shall be governed by and construed in accordance with the laws of the Emirate of Dubai.",
  pageBreakClause:
    "The Supplier shall maintain comprehensive business continuity arrangements, test them at least annually, and provide the Customer with a written summary of each test within ten Business Days of its completion, including any remediation actions identified and the timetable for completing them.",
  hyphenated: "Suspension or termi-\nnation of any individual Service shall not affect the provision of the remaining Services.",
  boilerplate: "This clause shall survive termination or expiry of this Agreement.",
  forceMajeure:
    "“Force Majeure Event” means any event beyond the reasonable control of the affected party — including fire, flood, epidemic and governmental action — that prevents it from performing its obligations.",
} as const;

const HEADER = "MASTER SERVICES AGREEMENT — CONFIDENTIAL";
const TOTAL_TARGET = 150;

/** Planned first page of each article (index = article number − 1). */
function plannedStarts(): number[] {
  const starts: number[] = [];
  for (let k = 1; k <= 40; k++) {
    if (k <= 25) starts.push(2 + Math.round(((k - 1) * 68) / 25));
    else if (k === 26) starts.push(71);
    else starts.push(73 + Math.round(((k - 27) * 67) / 13));
  }
  return starts;
}

/**
 * ~150-page MSA (§18.1): numbered articles 1–40 with sub-clauses, TOC with dot leaders, running
 * header + "Page n of N" footer, a clause spanning a page break, a hyphenated line break, repeated
 * boilerplate, curly quotes/em dashes, and key facts on pages 3, 71 and 142.
 */
export function buildLongMsa(): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 72, bottom: 72, left: 72, right: 72 }, bufferPages: true, info: { Title: "Master Services Agreement" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const gen = new LegalText(42);
  const page = (): number => doc.bufferedPageRange().count;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const starts = plannedStarts();

  // Page 1: title + table of contents.
  doc.font("Helvetica-Bold").fontSize(16).text("MASTER SERVICES AGREEMENT", { align: "center" });
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(10).text("between Acme Holdings LLC (the “Customer”) and Northwind Services FZ-LLC (the “Supplier”)", { align: "center" });
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).text("Table of Contents");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9);
  ARTICLE_TITLES.forEach((t, i) => {
    doc.text(`${i + 1}. ${t} ${".".repeat(Math.max(4, 60 - t.length))} ${starts[i]}`, { lineGap: 1 });
  });

  const para = (text: string): void => {
    doc.font("Helvetica").fontSize(11).text(text, { align: "left", lineGap: 2 });
    doc.moveDown(0.4);
  };

  let wroteCap = false;
  let wroteSpan = false;
  let wroteHyphen = false;
  let wroteGovLaw = false;

  for (let k = 1; k <= 40; k++) {
    doc.addPage();
    const title = ARTICLE_TITLES[k - 1]!;
    doc.font("Helvetica-Bold").fontSize(12).text(`${k}. ${title.toUpperCase()}`);
    doc.moveDown(0.4);
    const nextStart = k < 40 ? starts[k]! : TOTAL_TARGET;
    let sub = 1;
    const clause = (text: string): void => {
      para(`${k}.${sub++} ${text}`);
    };

    if (k === 1) clause(LONG_MSA_FACTS.forceMajeure);
    if (k === 26) clause(LONG_MSA_FACTS.terminationNotice);
    if (k === 20) clause("The Supplier’s total liability under this Agreement is limited to the Liability Cap, save as set out in clause 20.3.");

    // Fill the article up to one page before the next article's planned start.
    while (page() < nextStart - 1) {
      if (k === 1 && !wroteCap && page() >= 3) {
        clause(LONG_MSA_FACTS.liabilityCap);
        wroteCap = true;
        continue;
      }
      if (k === 3 && !wroteHyphen) {
        clause(LONG_MSA_FACTS.hyphenated);
        wroteHyphen = true;
        continue;
      }
      if (k === 22 && !wroteSpan && page() >= starts[21]!) {
        // Push the clause to the bottom of the page so it wraps across the page break.
        doc.font("Helvetica").fontSize(11);
        while (doc.y + 2 * doc.currentLineHeight(true) < bottomLimit - 4) doc.text("The Business Continuity Plan forms part of the Service Description.", { lineGap: 2 });
        clause(LONG_MSA_FACTS.pageBreakClause);
        wroteSpan = true;
        continue;
      }
      if (k === 40 && !wroteGovLaw && page() >= 142) {
        clause(LONG_MSA_FACTS.governingLaw);
        wroteGovLaw = true;
        continue;
      }
      if (sub % 4 === 0) clause(`${gen.paragraph(2)} ${LONG_MSA_FACTS.boilerplate}`);
      else clause(gen.paragraph(3 + (sub % 3)));
      if (k === 40 && page() >= TOTAL_TARGET - 1) break;
    }
    if (k === 40 && !wroteGovLaw) clause(LONG_MSA_FACTS.governingLaw);
  }

  // Signature block.
  doc.moveDown(1);
  para("IN WITNESS WHEREOF the parties have executed this Agreement on the date first written above.");
  para("Signed for and on behalf of Acme Holdings LLC\nBy: ____________________\nName: Jane Doe\nTitle: Chief Executive Officer");

  // Running header and footer on every page (drawn last, inside the top/bottom 8% bands).
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const { top, bottom } = doc.page.margins;
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#555555");
    doc.text(HEADER, 72, 30, { width: doc.page.width - 144, align: "center", lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, 72, doc.page.height - 40, { width: doc.page.width - 144, align: "center", lineBreak: false });
    doc.fillColor("#000000");
    doc.page.margins.top = top;
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
