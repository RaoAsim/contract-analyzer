/** Highlight rectangles on one PDF page, normalised 0..1 of the page box (§9.6). */
export type Box = { page: number; rects: [x: number, y: number, w: number, h: number][] };

export type Occurrence = {
  start: number;
  end: number;
  pageStart?: number;
  pageEnd?: number;
  sectionNumber?: string;
  sectionTitle?: string;
  boxes?: Box[];
};

export type CitationStatus = "verified" | "verified_close" | "unverified" | "misattributed";

export type MatchMethod = "normalized" | "compact" | "elided" | "fuzzy";

export type UnverifiedReason = "not_found" | "too_short" | "unknown_document" | "truncated" | "stopped";

export type Citation = {
  /** "c1", "c2"… per message */
  id: string;
  docId: string;
  /** "D1" */
  docTag: string;
  status: CitationStatus;
  method?: MatchMethod;
  /** T4 similarity */
  score?: number;
  reason?: UnverifiedReason;
  /** What the model wrote. The UI shows it ONLY in the unverified style. */
  modelText: string;
  /** The document's own text (verified only). */
  displayText?: string;
  /** Empty for unverified. */
  occurrences: Occurrence[];
  primary: number;
  /** Elided quotes: one per segment (all highlighted). */
  segments?: Occurrence[];
  /** Misattributed: the document where the text was actually found. */
  foundInDocId?: string;
};
