export type DocumentKind = "pdf" | "docx";

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

export type SearchMode = "keyword" | "semantic_and_keyword";

/** A canonical `[start, end)` range into `documents.text` (invariant I1). */
export type Range = [start: number, end: number];

export type DocumentWarningCode =
  | "partial_scan"
  | "keyword_only_search"
  | "simplified_docx_render"
  | "no_structure_detected";

export type DocumentWarning = { code: DocumentWarningCode; message: string };

/**
 * One text item on a PDF page: `[canonStart, length, x, y, w, h]`.
 * Geometry is normalised to 0..1 of the page box with a top-left origin.
 */
export type PageItem = [canonStart: number, length: number, x: number, y: number, w: number, h: number];

/** Library row shape returned by `GET /api/documents` (no text or bytes). */
export type DocumentSummary = {
  id: string;
  name: string;
  kind: DocumentKind;
  sizeBytes: number;
  status: DocumentStatus;
  stage: string | null;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  attempt: number | null;
  maxAttempts: number | null;
  pageCount: number | null;
  charCount: number;
  warnings: DocumentWarning[];
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};
