import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { buildLongMsa } from "./fixtures/longMsa";
import { buildMsaDocx } from "./fixtures/msaDocx";
import { scannedPagePng } from "./fixtures/png";

const OUT = path.resolve("tests/fixtures");

function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void, options: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", ...options });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  build(doc);
  doc.end();
  return done;
}

function scannedPage(doc: PDFKit.PDFDocument, seed: number): void {
  doc.image(scannedPagePng(850, 1100, seed), 0, 0, { width: doc.page.width, height: doc.page.height });
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const write = (name: string, data: Buffer | string): void => {
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`  ${name} (${(Buffer.byteLength(data) / 1024).toFixed(0)} KB)`);
  };

  console.log("Generating fixtures in tests/fixtures:");
  write("long_msa.pdf", await buildLongMsa());
  write("msa_v1.docx", await buildMsaDocx(false));
  write("msa_v2.docx", await buildMsaDocx(true));

  write("scanned.pdf", await pdfToBuffer((doc) => {
    scannedPage(doc, 1);
    doc.addPage();
    scannedPage(doc, 2);
  }, { margin: 0 }));

  write("partial_scan.pdf", await pdfToBuffer((doc) => {
    for (let p = 1; p <= 5; p++) {
      if (p > 1) doc.addPage();
      if (p === 3 || p === 4) scannedPage(doc, p);
      else {
        doc.font("Helvetica-Bold").fontSize(12).text(`${p}. CLAUSE ${p}`);
        doc.font("Helvetica").fontSize(11).text(
          `${p}.1 The Supplier shall perform its obligations under clause ${p} in accordance with the Service Description and Good Industry Practice. ` +
            "The Customer shall provide reasonable assistance and access to its premises as required.",
        );
      }
    }
  }, { margin: 72 }));

  write("encrypted.pdf", await pdfToBuffer((doc) => {
    doc.text("This document is password protected.");
  }, { userPassword: "secret", ownerPassword: "owner-secret", permissions: { printing: "highResolution" }, pdfVersion: "1.7" }));

  // Starts with a PDF header but the rest is garbage: unreadable.
  write("corrupted.pdf", Buffer.concat([Buffer.from("%PDF-1.7\n%âãÏÓ\n"), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) % 251))]));

  write("notes.txt", "Meeting notes: review the MSA before Friday.\n");

  // OLE2 compound file header (legacy .doc / protected Word).
  const ole = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole, 0);
  write("legacy.doc", ole);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
