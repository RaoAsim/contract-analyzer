"use client";

import { ChevronLeft, ChevronRight, Eraser, Minus, Plus, Scan } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { shortName, tagStyle } from "@/lib/client/docColors";
import { cn } from "@/lib/utils";
import { DocxViewer } from "./DocxViewer";
import type { PdfViewerHandle, ViewerDoc, ViewerHighlight } from "./viewer.types";

// react-pdf touches the DOM: client-only.
const PdfViewer = dynamic(() => import("./PdfViewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading viewer…</div>,
});

type Props = {
  docs: ViewerDoc[];
  activeDocId: string;
  onActiveDocChange: (id: string) => void;
  highlight: ViewerHighlight | null;
  onClearHighlight: () => void;
  onOccurrence: (delta: number) => void;
};

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

/** Viewer with toolbar (§15.2): tabs (multi), page indicator + jump, zoom, clear highlight, occurrence pager. */
export function ViewerPane({ docs, activeDocId, onActiveDocChange, highlight, onClearHighlight, onOccurrence }: Props): React.ReactElement {
  const doc = docs.find((d) => d.id === activeDocId) ?? docs[0]!;
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const handle = useRef<PdfViewerHandle | null>(null);
  const registerHandle = useCallback((h: PdfViewerHandle | null) => {
    handle.current = h;
  }, []);
  const zi = ZOOMS.indexOf(zoom);
  const hl = highlight && highlight.docId === doc.id ? highlight : null;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Document viewer">
      {docs.length > 1 && (
        <div role="tablist" aria-label="Documents" className="flex gap-1 overflow-x-auto border-b bg-white px-2 pt-2">
          {docs.map((d) => {
            const s = tagStyle(d.tag ?? "D1");
            const active = d.id === doc.id;
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={active}
                onClick={() => onActiveDocChange(d.id)}
                className={cn(
                  "flex max-w-56 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                  active ? `${s.border} bg-stone-50 text-stone-900` : "border-transparent text-stone-500 hover:bg-stone-50 hover:text-stone-800",
                )}
              >
                <span className={cn("size-2 rounded-full", s.dot)} aria-hidden="true" />
                <span className="font-semibold">{d.tag}</span>
                <span className="truncate">{shortName(d.name, 24)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 border-b bg-white px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-stone-800" title={doc.name}>
          {doc.name}
        </span>
        {hl?.occurrence && hl.occurrence.total > 1 && (
          <div className="flex items-center gap-0.5 rounded-md border bg-amber-50 px-1 text-xs text-amber-900" aria-label="Occurrences of this quote">
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onOccurrence(-1)} aria-label="Previous occurrence">
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="tabular-nums">
              Occurrence {hl.occurrence.index + 1} of {hl.occurrence.total}
            </span>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => onOccurrence(1)} aria-label="Next occurrence">
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
        {hl && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearHighlight}>
            <Eraser aria-hidden="true" /> Clear highlight
          </Button>
        )}
        {doc.kind === "pdf" && doc.pages.length > 0 && (
          <form
            className="flex items-center gap-1 text-xs text-muted-foreground"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number.parseInt(pageInput, 10);
              if (Number.isFinite(n) && n >= 1 && n <= doc.pages.length) handle.current?.scrollToPage(n);
              setPageInput("");
            }}
          >
            <label htmlFor="page-jump" className="sr-only">
              Go to page
            </label>
            <input
              id="page-jump"
              inputMode="numeric"
              value={pageInput}
              placeholder={String(page)}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              className="h-7 w-11 rounded border bg-white px-1 text-center tabular-nums text-stone-800 placeholder:text-stone-800"
            />
            <span className="tabular-nums">/ {doc.pages.length}</span>
          </form>
        )}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)]!)} disabled={zi <= 0} aria-label="Zoom out">
                <Minus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)]!)} disabled={zi >= ZOOMS.length - 1} aria-label="Zoom in">
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setZoom(1)} aria-label="Fit to width">
                <Scan aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to width</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {doc.kind === "pdf" ? (
          <PdfViewer key={doc.id} doc={doc} highlight={hl} zoom={zoom} onPageChange={setPage} registerHandle={registerHandle} />
        ) : (
          <DocxViewer key={doc.id} doc={doc} highlight={hl} zoom={zoom} />
        )}
      </div>
    </section>
  );
}
