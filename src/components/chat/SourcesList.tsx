"use client";

import { diffWords } from "diff";
import { AlertTriangle, ChevronDown, Crosshair } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { tagStyle } from "@/lib/client/docColors";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/citation";
import { DocTag } from "./DocTag";
import { isVerified, locationLabel } from "./citationFormat";

type Props = {
  citations: Citation[];
  numbers: Map<string, number>;
  docName: (docId: string) => string;
  multi: boolean;
  onOpen: (c: Citation) => void;
};

function WordDiff({ from, to }: { from: string; to: string }): React.ReactElement {
  return (
    <p className="font-serif text-sm leading-relaxed">
      {diffWords(from, to).map((p, i) => (
        <span key={i} className={cn(p.added && "bg-emerald-100 text-emerald-900", p.removed && "bg-red-100 text-red-800 line-through")}>
          {p.value}
        </span>
      ))}
    </p>
  );
}

/** One source: the whole row is the "show in document" button. */
function SourceRow({ c, n, docName, multi, onOpen }: { c: Citation; n: number; docName: (id: string) => string; multi: boolean; onOpen: (c: Citation) => void }): React.ReactElement {
  const [diff, setDiff] = useState(false);
  const loc = locationLabel(c.occurrences[c.primary]);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(c)}
        className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-stone-200 hover:bg-stone-50 focus-visible:border-primary/40"
        aria-label={`Show source ${n} in the document${loc ? ` (${loc})` : ""}`}
      >
        <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", tagStyle(c.docTag).bg)}>{n}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-3 font-serif text-sm leading-relaxed text-stone-800">“{c.displayText}”</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {multi && <DocTag tag={c.docTag} name={docName(c.docId)} compact />}
            {loc && <span>{loc}</span>}
            {c.occurrences.length > 1 && <span>· appears {c.occurrences.length}×</span>}
            {c.status === "verified_close" && <span className="text-emerald-700">· near-exact match</span>}
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Crosshair className="size-3.5" aria-hidden="true" /> Show in document
            </span>
          </span>
        </span>
      </button>
      {c.status === "verified_close" && (
        <div className="pl-10">
          <button type="button" onClick={() => setDiff((d) => !d)} className="text-xs font-medium text-stone-600 hover:underline" aria-expanded={diff}>
            {diff ? "Hide" : "Show"} differences from the AI’s wording
          </button>
          {diff && (
            <div className="mt-1 rounded bg-stone-50 p-2">
              <WordDiff from={c.modelText} to={c.displayText ?? ""} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Verified sources (click to highlight), then a collapsed "Unverified" group (§11.7). */
export function SourcesList({ citations, numbers, docName, multi, onOpen }: Props): React.ReactElement | null {
  const verified = citations.filter(isVerified).sort((a, b) => (numbers.get(a.id) ?? 99) - (numbers.get(b.id) ?? 99));
  const unverified = citations.filter((c) => !isVerified(c));
  if (verified.length === 0 && unverified.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {verified.length > 0 && (
        <section aria-label="Sources">
          <h4 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sources</h4>
          <ol className="mt-1">
            {verified.map((c) => (
              <SourceRow key={c.id} c={c} n={numbers.get(c.id) ?? 0} docName={docName} multi={multi} onOpen={onOpen} />
            ))}
          </ol>
        </section>
      )}
      {unverified.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded px-2 text-[11px] font-semibold uppercase tracking-wide text-amber-800 hover:text-amber-900">
            <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
            Not verified ({unverified.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-2">
              {unverified.map((c) => (
                <li key={c.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {c.status === "misattributed" && c.foundInDocId
                      ? `Not found in ${docName(c.docId)} — a matching passage exists in ${docName(c.foundInDocId)}`
                      : c.reason === "stopped"
                        ? "Interrupted while being written — not checked"
                        : c.reason === "too_short"
                          ? "Too short to locate reliably"
                          : "The AI quoted this, but it isn't in the document"}
                  </p>
                  {c.modelText && <p className="font-serif text-sm text-stone-500 line-through decoration-stone-400">{c.modelText}</p>}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
