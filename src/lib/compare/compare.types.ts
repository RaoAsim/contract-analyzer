export type Unit = {
  id: string;
  docId: string;
  index: number;
  number: string | null;
  title: string;
  /** Display text (furniture removed, whitespace tidied). */
  text: string;
  /** §9.2 compact normalisation, for exact matching. */
  compact: string;
  /** Spaced normalisation, for "unchanged after normalisation". */
  spaced: string;
  shingles: Set<string>;
  start: number;
  end: number;
};

export type Pair = { a?: Unit; b?: Unit; type: "modified" | "added" | "removed" | "moved" | "unchanged"; textChanged?: boolean };
