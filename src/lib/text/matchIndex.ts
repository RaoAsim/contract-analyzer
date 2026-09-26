import type { Range } from "@/types/document";
import { buildIndex } from "./normalize";
import type { NormIndex } from "./normalize.types";

/** Lazily-built spaced + compact indexes for one document's canonical text. */
export class DocMatchIndex {
  readonly canon: string;
  readonly skip: readonly Range[];
  private _spaced?: NormIndex;
  private _compact?: NormIndex;

  constructor(canon: string, skip: readonly Range[] = []) {
    this.canon = canon;
    this.skip = [...skip].sort((a, b) => a[0] - b[0]);
  }

  get spaced(): NormIndex {
    this._spaced ??= buildIndex(this.canon, "spaced", this.skip);
    return this._spaced;
  }

  get compact(): NormIndex {
    this._compact ??= buildIndex(this.canon, "compact", this.skip);
    return this._compact;
  }
}

/** Every occurrence of `needle` in `hay` (non-overlapping starts allowed to overlap), up to `max`. */
export function findAll(hay: string, needle: string, max = 25, from = 0): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle, from);
  while (i !== -1 && out.length < max) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/** Count occurrences (capped) — used by the short-quote rule and find_exact. */
export function countAll(hay: string, needle: string, cap = 1000): number {
  return findAll(hay, needle, cap).length;
}
