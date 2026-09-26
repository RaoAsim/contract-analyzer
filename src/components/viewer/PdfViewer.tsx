"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { cn } from "@/lib/utils";
import type { Box } from "@/types/citation";
import type { PdfViewerProps } from "./viewer.types";

// Same pdf.js version as the server-side extractor (copied to /public/pdfjs at install time).
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

const OPTIONS = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" };
const PAGE_GAP = 16;
const OVERSCAN = 2;
const SCROLL_OFFSET = 120;

/**
 * Virtualised PDF viewer (§10.1): every page gets a placeholder sized from the stored page box,
 * so scroll offsets are right before a page renders; only pages within ±2 of the viewport render.
 * Highlights are percentage-positioned divs, so zoom never moves them.
 */
export function PdfViewer({ doc, highlight, zoom, onPageChange, registerHandle }: PdfViewerProps): React.ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Fit-to-width base scale, times the user's zoom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxPageWidth = useMemo(() => Math.max(1, ...doc.pages.map((p) => p.width)), [doc.pages]);
  const scale = width > 0 ? (Math.min(width - 32, 1100) / maxPageWidth) * zoom : 1;

  // Track which pages are near the viewport.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "200px 0px" },
    );
    for (const el of pageEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [doc.pages.length, scale, loaded]);

  // Current page = the page crossing the top third of the viewport.
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const probe = root.scrollTop + root.clientHeight / 3;
    let current = 1;
    for (const [n, el] of pageEls.current) {
      if (el.offsetTop <= probe) current = Math.max(current, n);
    }
    onPageChange(current);
  }, [onPageChange]);

  const renderSet = useMemo(() => {
    const s = new Set<number>();
    for (const n of visible) for (let k = n - OVERSCAN; k <= n + OVERSCAN; k++) if (k >= 1 && k <= doc.pages.length) s.add(k);
    return s;
  }, [visible, doc.pages.length]);

  const scrollToPage = useCallback((page: number, yFraction = 0) => {
    const root = scroller.current;
    const el = pageEls.current.get(page);
    if (!root || !el) return;
    const top = el.offsetTop + yFraction * el.clientHeight - SCROLL_OFFSET;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    registerHandle({ scrollToPage: (p) => scrollToPage(p) });
    return () => registerHandle(null);
  }, [registerHandle, scrollToPage]);

  // Scroll to the first rectangle of the active highlight and replay the flash.
  useEffect(() => {
    if (!loaded || !highlight || highlight.docId !== doc.id) return;
    const first = highlight.active.flatMap((s) => s.boxes ?? []).find((b) => b.rects.length > 0);
    if (!first) return;
    scrollToPage(first.page, first.rects[0]![1]);
  }, [highlight, doc.id, scrollToPage, loaded]);

  const boxesByPage = useMemo(() => {
    const active = new Map<number, Box["rects"]>();
    const faint = new Map<number, Box["rects"]>();
    if (highlight && highlight.docId === doc.id) {
      for (const span of highlight.active) for (const b of span.boxes ?? []) active.set(b.page, [...(active.get(b.page) ?? []), ...b.rects]);
      for (const span of highlight.faint) for (const b of span.boxes ?? []) faint.set(b.page, [...(faint.get(b.page) ?? []), ...b.rects]);
    }
    return { active, faint };
  }, [highlight, doc.id]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6" role="alert">
        <div className="flex max-w-sm items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto bg-stone-200/70 px-4 py-4" data-testid="pdf-scroller">
      <Document
        file={`/api/documents/${doc.id}/file`}
        options={OPTIONS}
        loading={<ViewerLoading />}
        onLoadSuccess={() => requestAnimationFrame(() => setLoaded(true))}
        onLoadError={() => setLoadError("The PDF couldn't be displayed. Try reloading the page.")}
        onSourceError={() => setLoadError("The PDF file couldn't be downloaded. Try reloading the page.")}
        className="mx-auto flex flex-col items-center"
      >
        {doc.pages.map((p) => {
          const w = Math.round(p.width * scale);
          const h = Math.round(p.height * scale);
          const active = boxesByPage.active.get(p.pageNo);
          const faint = boxesByPage.faint.get(p.pageNo);
          return (
            <div
              key={p.pageNo}
              data-page={p.pageNo}
              ref={(el) => {
                if (el) pageEls.current.set(p.pageNo, el);
                else pageEls.current.delete(p.pageNo);
              }}
              className="relative bg-white shadow-sm"
              style={{ width: w, height: h, marginBottom: PAGE_GAP }}
              aria-label={`Page ${p.pageNo}`}
            >
              {renderSet.has(p.pageNo) && width > 0 ? (
                <Page
                  pageNumber={p.pageNo}
                  width={w}
                  renderTextLayer
                  renderAnnotationLayer={false}
                  loading={<div style={{ width: w, height: h }} />}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-stone-400">Page {p.pageNo}</div>
              )}
              {(active || faint) && (
                <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
                  {faint?.map(([x, y, rw, rh], i) => (
                    <div key={`f${i}`} className="absolute rounded-[2px] bg-yellow-300/25" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%` }} />
                  ))}
                  {active?.map(([x, y, rw, rh], i) => (
                    <div
                      key={`a${highlight?.nonce ?? 0}-${i}`}
                      className={cn("absolute rounded-[2px] bg-yellow-300/40 outline outline-[1.5px] outline-amber-500", "citation-flash")}
                      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${rw * 100}%`, height: `${rh * 100}%`, mixBlendMode: "multiply" }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Document>
    </div>
  );
}

function ViewerLoading(): React.ReactElement {
  return (
    <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading document…
    </div>
  );
}
