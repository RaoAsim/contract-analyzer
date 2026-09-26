"use client";

import { BookOpenCheck, FileSearch, ScanSearch } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Coverage, CoverageDoc } from "@/types/chat";

function pct(d: CoverageDoc): number {
  return d.fraction >= 0.995 ? 100 : Math.max(d.fraction > 0 ? 1 : 0, Math.round(d.fraction * 100));
}

function docLine(d: CoverageDoc, mode: Coverage["mode"]): string {
  const complete = d.fraction === 1 && !d.failedRanges?.length && !d.unreadablePages?.length;
  const failed = d.failedRanges?.length ? ` · ${d.failedRanges.map((f) => f.label ?? `pp. ${f.pageStart}–${f.pageEnd}`).join(", ")} failed` : "";
  const unreadable = d.unreadablePages?.length ? ` · ${d.unreadablePages.length} scanned page${d.unreadablePages.length === 1 ? "" : "s"} not readable` : "";
  if (mode === "agent" && d.checkedEntireDocument) return `Checked every page${failed}${unreadable}`;
  if (complete) return "Based on 100% of the document";
  if (mode === "scan") return `Checked ${pct(d)}% of the document${failed}${unreadable}`;
  const where = [d.sectionsRead, d.pagesRead ? `pp. ${d.pagesRead}` : ""].filter(Boolean).join(" · ");
  return `Based on ${pct(d)}% of the document${where ? ` · ${where}` : ""}${failed}${unreadable}`;
}

/** Coverage on every answer (§11.4): green when complete, blue for excerpts, amber when parts failed. */
export function CoverageBadge({ coverage }: { coverage: Coverage }): React.ReactElement {
  const failed = coverage.perDoc.some((d) => d.failedRanges?.length || d.unreadablePages?.length);
  const tone = coverage.complete ? "green" : failed ? "amber" : "blue";
  const Icon = coverage.mode === "scan" ? ScanSearch : coverage.complete ? BookOpenCheck : FileSearch;
  const multi = coverage.perDoc.length > 1;
  const label = multi
    ? coverage.complete
      ? "Based on 100% of every document"
      : `Based on part of the documents · ${coverage.perDoc.map((d) => `${d.tag} ${pct(d)}%`).join(", ")}`
    : coverage.perDoc[0]
      ? docLine(coverage.perDoc[0], coverage.mode).split(" · ")[0]!
      : "No document read";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex max-w-full cursor-help items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            tone === "green" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
            tone === "blue" && "bg-sky-50 text-sky-800 ring-sky-200",
            tone === "amber" && "bg-amber-50 text-amber-900 ring-amber-200",
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <ul className="space-y-1.5">
          {coverage.perDoc.map((d) => (
            <li key={d.docId}>
              <span className="font-semibold">{multi ? `${d.tag} · ` : ""}{d.name}</span>
              <br />
              {docLine(d, coverage.mode)}
              {d.sectionsRead && !(d.fraction === 1) && (
                <>
                  <br />
                  <span className="opacity-80">Sections: {d.sectionsRead}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
