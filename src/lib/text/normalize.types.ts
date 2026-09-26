export type NormMode = "spaced" | "compact";

/** A normalised form of the canonical text with a map back to canonical offsets (§9.1). */
export type NormIndex = {
  mode: NormMode;
  text: string;
  /** For each normalised char: canonical offset where its source code point starts. */
  starts: Int32Array;
  /** For each normalised char: canonical offset just after its source code point. */
  ends: Int32Array;
};
