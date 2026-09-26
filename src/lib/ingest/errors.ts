import { PermanentJobError } from "@/lib/jobs/errors";

export type IngestErrorCode =
  | "unsupported_type"
  | "legacy_doc"
  | "password_protected"
  | "corrupted_file"
  | "too_large"
  | "too_many_pages"
  | "no_text_layer"
  | "empty_document";

/** Permanent ingestion failure (§8.11): the document is marked failed and the job is not retried. */
export class PermanentIngestError extends PermanentJobError {
  readonly code: IngestErrorCode;
  /** HTTP status when raised synchronously at upload. */
  readonly httpStatus: number;

  constructor(code: IngestErrorCode, message: string, httpStatus = 422) {
    super(code, message);
    this.name = "PermanentIngestError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const NO_TEXT_LAYER_MESSAGE =
  "This PDF has no selectable text — it looks like a scanned image. Scanned documents can't be analysed yet " +
  "(OCR isn't supported). Please upload a text-based PDF or the original Word file.";

export const TRANSIENT_FAILURE_MESSAGE = "Processing failed because of a temporary problem.";

export const ingestErrors = {
  unsupported: (name: string): PermanentIngestError =>
    new PermanentIngestError(
      "unsupported_type",
      `"${name}" isn't a PDF or Word (.docx) file. Only PDF and DOCX contracts are supported.`,
      415,
    ),
  officeOther: (name: string, what: "spreadsheet" | "presentation"): PermanentIngestError =>
    new PermanentIngestError(
      "unsupported_type",
      `"${name}" looks like a ${what}, not a Word document. Only PDF and DOCX contracts are supported.`,
      415,
    ),
  legacyDoc: (): PermanentIngestError =>
    new PermanentIngestError(
      "legacy_doc",
      "This looks like a legacy Word .doc file or a password-protected Word document. " +
        "Save it as .docx (unprotected) and upload again.",
      415,
    ),
  password: (): PermanentIngestError =>
    new PermanentIngestError(
      "password_protected",
      "This PDF is password-protected. Remove the password and upload again.",
    ),
  corrupted: (): PermanentIngestError =>
    new PermanentIngestError("corrupted_file", "This file appears to be damaged and can't be read."),
  tooLarge: (name: string, sizeMb: number, limitMb: number): PermanentIngestError =>
    new PermanentIngestError(
      "too_large",
      `"${name}" is ${sizeMb.toFixed(sizeMb < 10 ? 1 : 0)} MB. The limit is ${limitMb} MB.`,
      413,
    ),
  tooManyPages: (pages: number, limit: number): PermanentIngestError =>
    new PermanentIngestError(
      "too_many_pages",
      `This PDF has ${pages} pages. The limit is ${limit} pages.`,
    ),
  noTextLayer: (): PermanentIngestError => new PermanentIngestError("no_text_layer", NO_TEXT_LAYER_MESSAGE),
  emptyDocument: (): PermanentIngestError =>
    new PermanentIngestError("empty_document", "The document contains no text."),
};
