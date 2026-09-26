"use client";

import { diffWords } from "diff";
import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  const parts = diffWords(from, to);
  return (
    <p className="font-serif text-sm leading-relaxed">
      {parts.map((p, i) => (
        <span key={i} className={cn(p.added && "bg-emerald-100 text-emerald-900", p.removed && "bg-red-100 text-red-800 line-through")}>
          {p.value}
        </span>
      ))}
    </p>
  );
}

function SourceCard({ c, n, docName, multi, onOpen }: { c: Citation; n: number; docName: (id: string) => string; multi: boolean; onOpen: (c: Citation) => void }): React.ReactElement {
  const [diff, setDiff] = useState(false);
  const loc = locationLabel(c.occurrences[c.primary]);
  return (
    <li className="rounded-lg border bg-white p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-stone-700">{n}.</span>
        {multi && <DocTag tag={c.docTag} name={docName(c.docId)} compact />}
        {loc && <span>{loc}</span>}
        {c.occurrences.length > 1 && <span>· appears {c.occurrences.length} times</span>}
        {c.status === "verified_close" && <span className="text-emerald-700">· near-exact match</span>}
      </div>
      <blockquote className="border-l-2 border-emerald-500 pl-3 font-serif text-sm leading-relaxed text-stone-900">{c.displayText}</blockquote>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={() => onOpen(c)} className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline">
          <ExternalLink className="size-3.5" aria-hidden="true" /> Open in document
        </button>
        {c.status === "verified_close" && (
          <button type="button" onClick={() => setDiff((d) => !d)} className="text-xs font-medium text-stone-600 hover:underline" aria-expanded={diff}>
            {diff ? "Hide" : "Show"} differences from the AI’s wording
          </button>
        )}
      </div>
      {diff && (
        <div className="mt-2 rounded bg-stone-50 p-2">
          <WordDiff from={c.modelText} to={c.displayText ?? ""} />
        </div>
      )}
    </li>
  );
}

/** Verified sources, then a collapsed "Unverified (n)" group (§11.7). */
export function SourcesList({ citations, numbers, docName, multi, onOpen }: Props): React.ReactElement | null {
  const verified = citations.filter(isVerified).sort((a, b) => (numbers.get(a.id) ?? 99) - (numbers.get(b.id) ?? 99));
  const unverified = citations.filter((c) => !isVerified(c));
  if (verified.length === 0 && unverified.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {verified.length > 0 && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-stone-800">
            <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
            Sources ({verified.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-2 space-y-2">
              {verified.map((c) => (
                <SourceCard key={c.id} c={c} n={numbers.get(c.id) ?? 0} docName={docName} multi={multi} onOpen={onOpen} />
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      )}
      {unverified.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide text-amber-800 hover:text-amber-900">
            <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" aria-hidden="true" />
            Unverified ({unverified.length})
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
                          : "Not found in document"}
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
