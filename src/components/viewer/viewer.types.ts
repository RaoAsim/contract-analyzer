import type { Box } from "@/types/citation";
import type { PageSize } from "@/types/document";

export type HighlightSpan = { start: number; end: number; boxes?: Box[] };

/** What the viewer should highlight. A new `nonce` re-scrolls and replays the flash. */
export type ViewerHighlight = {
  nonce: number;
  docId: string;
  /** The active occurrence (or every segment of an elided quote). */
  active: HighlightSpan[];
  /** Other occurrences of the same quote, drawn faintly. */
  faint: HighlightSpan[];
  occurrence?: { index: number; total: number };
  label?: string;
};

export type ViewerDoc = {
  id: string;
  name: string;
  kind: "pdf" | "docx";
  pages: PageSize[];
  tag?: string;
};

export type PdfViewerHandle = { scrollToPage: (page: number) => void };

export type PdfViewerProps = {
  doc: ViewerDoc;
  highlight: ViewerHighlight | null;
  zoom: number;
  onPageChange: (page: number) => void;
  registerHandle: (h: PdfViewerHandle | null) => void;
};

export type DocxViewerProps = { doc: ViewerDoc; highlight: ViewerHighlight | null; zoom: number };
