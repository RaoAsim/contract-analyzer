import type { HighlightSpan } from "./viewer.types";

export type OffsetIndex = { starts: number[]; nodes: Text[] };

/** Sorted index of [canonStart, textNode] from every `[data-o]` span (§10.2). */
export function buildOffsetIndex(root: HTMLElement): OffsetIndex {
  const starts: number[] = [];
  const nodes: Text[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-o]"))) {
    const o = Number(el.dataset.o);
    const t = el.firstChild;
    if (Number.isFinite(o) && t && t.nodeType === Node.TEXT_NODE) {
      starts.push(o);
      nodes.push(t as Text);
    }
  }
  return { starts, nodes };
}

/** Index of the last span whose start is ≤ pos. */
function spanAt(idx: OffsetIndex, pos: number): number {
  let lo = 0;
  let hi = idx.starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.starts[mid]! <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** DOM Range for the canonical span [start, end), or null if outside the rendered text. */
export function rangeFor(idx: OffsetIndex, span: HighlightSpan): Range | null {
  if (idx.starts.length === 0 || span.end <= span.start) return null;
  const a = spanAt(idx, span.start);
  const b = spanAt(idx, span.end - 1);
  const na = idx.nodes[a]!;
  const nb = idx.nodes[b]!;
  const r = document.createRange();
  r.setStart(na, Math.min(Math.max(0, span.start - idx.starts[a]!), na.length));
  r.setEnd(nb, Math.min(Math.max(0, span.end - idx.starts[b]!), nb.length));
  return r;
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): { reg: HighlightRegistry; Ctor: HighlightCtor } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Ctor ? { reg: css.highlights, Ctor } : null;
}

/** Apply highlights with the CSS Custom Highlight API, falling back to <mark> wrapping. Returns a cleanup. */
export function applyHighlights(root: HTMLElement, idx: OffsetIndex, active: Range[], faint: Range[]): () => void {
  const api = registry();
  if (api) {
    api.reg.set("citation", new api.Ctor(...active));
    api.reg.set("citation-faint", new api.Ctor(...faint));
    return () => {
      api.reg.delete("citation");
      api.reg.delete("citation-faint");
    };
  }
  const marks: HTMLElement[] = [];
  const wrap = (range: Range, cls: string): void => {
    for (const node of idx.nodes) {
      if (!range.intersectsNode(node)) continue;
      const s = node === range.startContainer ? range.startOffset : 0;
      const e = node === range.endContainer ? range.endOffset : node.length;
      if (e <= s) continue;
      const target = node.splitText(s);
      target.splitText(e - s);
      const mark = document.createElement("mark");
      mark.className = cls;
      target.parentNode!.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
  };
  faint.forEach((r) => wrap(r, "citation-mark-faint"));
  active.forEach((r) => wrap(r, "citation-mark"));
  return () => {
    for (const m of marks) {
      const parent = m.parentNode;
      if (!parent) continue;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
  };
}
