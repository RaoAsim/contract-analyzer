import JSZip from "jszip";
import type { DocumentKind } from "@/types/document";
import { ingestErrors, PermanentIngestError } from "./errors";
import { loadPdfjs, pdfDocumentOptions } from "./pdfjs";

export type SniffResult = { kind: DocumentKind };

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by junk within the first 1 KB.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

/**
 * Detect the file type from magic bytes — never from the extension or MIME type (§8.1).
 * Throws a PermanentIngestError with a user-facing message for anything we don't accept.
 */
export async function sniffFileType(bytes: Uint8Array, name: string): Promise<SniffResult> {
  if (bytes.length === 0) throw ingestErrors.emptyDocument();
  if (hasPdfHeader(bytes)) return { kind: "pdf" };
  if (startsWith(bytes, OLE2)) throw ingestErrors.legacyDoc();
  if (startsWith(bytes, ZIP)) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw ingestErrors.corrupted();
    }
    const has = (p: string): boolean => zip.file(p) !== null;
    if (has("[Content_Types].xml") && has("word/document.xml")) return { kind: "docx" };
    if (Object.keys(zip.files).some((f) => f.startsWith("xl/"))) throw ingestErrors.officeOther(name, "spreadsheet");
    if (Object.keys(zip.files).some((f) => f.startsWith("ppt/"))) throw ingestErrors.officeOther(name, "presentation");
    throw ingestErrors.unsupported(name);
  }
  throw ingestErrors.unsupported(name);
}

/** Quick PDF open at upload time: password, damage and page-limit checks, under a second (§8.1 step 3). */
export async function quickOpenPdf(bytes: Uint8Array, maxPages: number): Promise<{ pageCount: number }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfDocumentOptions(bytes));
  try {
    const doc = await task.promise;
    const pageCount = doc.numPages;
    if (pageCount > maxPages) throw ingestErrors.tooManyPages(pageCount, maxPages);
    if (pageCount === 0) throw ingestErrors.emptyDocument();
    return { pageCount };
  } catch (err) {
    if (err instanceof PermanentIngestError) throw err;
    if (err instanceof Error && err.name === "PasswordException") throw ingestErrors.password();
    throw ingestErrors.corrupted();
  } finally {
    await task.destroy().catch(() => {});
  }
}

/** Filename cleanup for display: strip paths and control characters, cap the length. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "document").slice(0, 200);
}
