"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { applyHighlights, buildOffsetIndex, rangeFor, type OffsetIndex } from "./docxHighlight";
import type { DocxViewerProps } from "./viewer.types";

// ::highlight() is injected at runtime (the CSS minifier doesn't know the pseudo-element yet).
const HIGHLIGHT_CSS = `
::highlight(citation){background-color:rgb(250 204 21 / 0.5);}
::highlight(citation-faint){background-color:rgb(250 204 21 / 0.2);}
mark.citation-mark{background-color:rgb(250 204 21 / 0.5);color:inherit;border-radius:2px;}
mark.citation-mark-faint{background-color:rgb(250 204 21 / 0.2);color:inherit;}
`;

/** DOCX viewer (§10.2): our own escaped HTML with `data-o` offset spans. */
export function DocxViewer({ doc, highlight, zoom }: DocxViewerProps): React.ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const flashEl = useRef<HTMLDivElement>(null);
  const index = useRef<OffsetIndex | null>(null);
  const scrolledNonce = useRef<number | null>(null);
  const q = useQuery({
    queryKey: ["document-html", doc.id],
    queryFn: () => apiFetch<{ html: string }>(`/api/documents/${doc.id}/html`),
    staleTime: Infinity,
  });
  const html = q.data?.html;

  useEffect(() => {
    const root = body.current;
    const sc = scroller.current;
    if (!html || !root || !sc || !highlight || highlight.docId !== doc.id) return;
    // (Re)build the offset index against the current DOM.
    index.current = buildOffsetIndex(root);
    const idx = index.current;
    const active = highlight.active.map((s) => rangeFor(idx, s)).filter((r): r is Range => r !== null);
    const faint = highlight.faint.map((s) => rangeFor(idx, s)).filter((r): r is Range => r !== null);
    const first = active[0];
    // Highlights are (re)applied on every run; scrolling and the flash only for a new highlight.
    if (first && scrolledNonce.current !== highlight.nonce) {
      scrolledNonce.current = highlight.nonce;
      const rect = first.getBoundingClientRect();
      const rootRect = sc.getBoundingClientRect();
      const contentTop = sc.scrollTop + rect.top - rootRect.top;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const far = Math.abs(contentTop - 120 - sc.scrollTop) > sc.clientHeight * 3;
      sc.scrollTo({ top: Math.max(0, contentTop - 120), behavior: reduce || far ? "auto" : "smooth" });
      const f = flashEl.current;
      if (f) {
        Object.assign(f.style, {
          display: "block",
          top: `${contentTop - 2}px`,
          left: `${rect.left - rootRect.left - 4}px`,
          width: `${rect.width + 8}px`,
          height: `${rect.height + 4}px`,
        });
        f.classList.remove("citation-flash");
        void f.offsetWidth; // restart the animation
        f.classList.add("citation-flash");
      }
    }
    const cleanup = applyHighlights(root, idx, active, faint);
    return () => {
      cleanup();
      index.current = null;
    };
  }, [highlight, html, doc.id]);

  if (q.isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading document…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6" role="alert">
        <div className="flex max-w-sm flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {q.error.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            <RotateCw aria-hidden="true" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto bg-stone-200/70 px-3 py-4 sm:px-6">
      <style>{HIGHLIGHT_CSS}</style>
      <article
        className="docx-body mx-auto max-w-3xl rounded-sm bg-white px-6 py-8 font-serif leading-7 text-stone-900 shadow-sm sm:px-12 sm:py-12"
        style={{ fontSize: `${15 * zoom}px` }}
      >
        {/* Our parser HTML-escapes every text fragment at write time; no user HTML reaches here. */}
        <div ref={body} dangerouslySetInnerHTML={{ __html: q.data.html }} />
      </article>
      <div ref={flashEl} aria-hidden="true" className="pointer-events-none absolute hidden rounded" />
    </div>
  );
}
