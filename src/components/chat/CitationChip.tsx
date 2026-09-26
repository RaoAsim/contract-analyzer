"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { shortName, tagStyle } from "@/lib/client/docColors";
import { cn } from "@/lib/utils";
import type { Citation } from "@/types/citation";
import { locationLabel } from "./citationFormat";

type Props = {
  citation: Citation | undefined;
  number: number | null;
  docName: (docId: string) => string;
  multi: boolean;
  onOpen: (c: Citation) => void;
};

/** Inline citation marker (§11.7). Verified and unverified quotes never look alike. */
export function CitationChip({ citation, number, docName, multi, onOpen }: Props): React.ReactElement {
  if (!citation) {
    return (
      <span className="mx-0.5 inline-flex h-5 items-center gap-1 rounded-full bg-stone-100 px-1.5 align-[1px] text-[11px] font-medium text-stone-500" aria-label="Verifying quote">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" /> verifying
      </span>
    );
  }

  if (citation.status === "unverified" || citation.status === "misattributed") {
    const where = docName(citation.docId) || citation.docTag;
    const tip =
      citation.status === "misattributed" && citation.foundInDocId
        ? `Not found in ${where}. A matching passage exists in ${docName(citation.foundInDocId)}, so it is not shown as a quote from ${where}.`
        : citation.reason === "stopped"
          ? "This quote was still being written when the answer was stopped, so it could not be checked."
          : citation.reason === "truncated"
            ? "This quote was too long to check."
            : citation.reason === "too_short"
              ? "This quote is too short to locate reliably in the document."
              : citation.reason === "unknown_document"
                ? `The quote names a document (${citation.docTag}) that isn't part of this chat.`
                : `This text could not be found in ${where}. It may be paraphrased or invented.`;
    return (
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <span
            tabIndex={0}
            role="note"
            aria-label={`Unverified quote: ${tip}`}
            className="mx-0.5 inline-flex h-5 cursor-help items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 align-[1px] text-[11px] font-medium text-amber-800"
          >
            <AlertTriangle className="size-3" aria-hidden="true" /> unverified
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-80 text-sm">
          <p className="font-medium text-amber-800">Not verified</p>
          <p className="mt-1 text-stone-700">{tip}</p>
          {citation.modelText && citation.reason !== "stopped" && (
            <p className="mt-2 font-serif text-stone-500 line-through decoration-stone-400">“{citation.modelText}”</p>
          )}
        </HoverCardContent>
      </HoverCard>
    );
  }

  const s = tagStyle(citation.docTag);
  const occ = citation.occurrences[citation.primary];
  const loc = locationLabel(occ);
  const name = docName(citation.docId);
  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(citation)}
          aria-label={`Source ${number ?? ""}: verified quote from ${shortName(name)}${loc ? `, ${loc}` : ""}. Show in document.`}
          className={cn(
            "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 align-[1px] text-[11px] font-semibold text-white shadow-xs transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 active:scale-95",
            s.bg,
          )}
        >
          {multi ? `${citation.docTag}·${number}` : number}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-96 text-sm" side="top">
        <p className="font-serif leading-relaxed text-stone-900">“{citation.displayText}”</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {citation.status === "verified_close" ? "Verified (near-exact match)" : "Verified in document"}
          </span>
          {multi && <span>{shortName(name)}</span>}
          {loc && <span>{loc}</span>}
          {citation.occurrences.length > 1 && <span>Appears {citation.occurrences.length} times</span>}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Click to show it in the document.</p>
      </HoverCardContent>
    </HoverCard>
  );
}
