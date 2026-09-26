"use client";

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatElapsed } from "@/lib/client/format";
import type { DocumentSummary } from "@/types/document";

export function DocumentStatus({ doc, now }: { doc: DocumentSummary; now: number }): React.ReactElement {
  if (doc.status === "ready") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span className="text-stone-700">Ready</span>
        {doc.warnings.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="rounded p-0.5 text-amber-600 hover:bg-amber-50" aria-label={`Warnings: ${doc.warnings.map((w) => w.message).join(" ")}`}>
                <AlertTriangle className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <ul className="space-y-1">
                {doc.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  if (doc.status === "failed") {
    return (
      <div className="flex items-start gap-2 text-sm" role="status">
        <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden="true" />
        <span className="text-red-700">{doc.errorMessage ?? "Processing failed."}</span>
      </div>
    );
  }

  const waiting = doc.status === "queued";
  const elapsed = formatElapsed(now - new Date(doc.createdAt).getTime());
  return (
    <div className="flex min-w-0 flex-col gap-1.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <span className="truncate text-stone-700">{doc.stage ?? (waiting ? "Waiting to start" : "Processing")}</span>
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{elapsed}</span>
      </div>
      <Progress value={doc.progress} className="h-1.5" aria-label={`${doc.progress}% processed`} />
    </div>
  );
}
