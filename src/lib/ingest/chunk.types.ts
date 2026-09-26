export type ChunkDraft = {
  ord: number;
  /** Index (ord) of the section this chunk starts in. */
  sectionOrd: number;
  start: number;
  end: number;
  pageStart: number | null;
  pageEnd: number | null;
  /** Canonical slice with furniture replaced by a single space. */
  text: string;
  /** "§{number} {title} — " + text */
  searchText: string;
  tokenCount: number;
};
