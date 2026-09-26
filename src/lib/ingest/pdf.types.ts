import type { PageItem } from "@/types/document";

/** A visual line on a page, in canonical offsets and normalised page coordinates. */
export type PdfLine = { start: number; end: number; top: number; bottom: number };

export type PdfPage = {
  pageNo: number;
  charStart: number;
  charEnd: number;
  width: number;
  height: number;
  items: PageItem[];
  lines: PdfLine[];
  /** Non-whitespace characters on the page. */
  nonWs: number;
  /** Letters+digits / non-whitespace, ignoring dot leaders. */
  alnumRatio: number;
  /** Replacement, private-use and "(cid:n)" glyphs / non-whitespace. */
  garbageRatio: number;
  /** True if the page paints at least one image (only checked for low-text pages). */
  hasImage: boolean;
};

export type PdfExtraction = { text: string; pages: PdfPage[] };
