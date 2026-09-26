"use client";

import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { TraceStep } from "@/types/chat";

/** Live research steps (§14.5): expanded while running, collapsed to a summary afterwards. */
export function ResearchTimeline({ steps, running }: { steps: TraceStep[]; running: boolean }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const expanded = running || open;
  const sections = new Set(steps.filter((s) => s.ok && s.name === "get_section").map((s) => s.label));
  const failures = steps.filter((s) => !s.ok && s.ms >= 0).length;
  const summary = `Researched in ${steps.length} step${steps.length === 1 ? "" : "s"}${sections.size ? ` · ${sections.size} section${sections.size === 1 ? "" : "s"} read` : ""}${failures ? ` · ${failures} failed call${failures === 1 ? "" : "s"} handled` : ""}`;
  return (
    <div className="mb-3 rounded-lg border bg-stone-50/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={running}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-700 disabled:cursor-default"
        aria-expanded={expanded}
      >
        {running ? <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" /> : <ChevronDown className={cn("size-3.5 transition-transform", !expanded && "-rotate-90")} aria-hidden="true" />}
        {running ? "Researching the document…" : summary}
      </button>
      {expanded && (
        <ol className="space-y-1.5 border-t px-3 py-2" aria-live="polite">
          {steps.map((s) => {
            const pending = s.ms < 0;
            return (
              <li key={s.callId} className="flex gap-2 text-xs">
                <span className="mt-0.5 shrink-0">
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" aria-label="Running" />
                  ) : s.ok ? (
                    <Check className="size-3.5 text-emerald-600" aria-label="Done" />
                  ) : (
                    <AlertTriangle className="size-3.5 text-amber-600" aria-label="Problem" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="text-stone-800">{s.label}</span>
                  {!pending && s.summary && <span className={cn("block", s.ok ? "text-muted-foreground" : "text-amber-700")}>{s.summary}</span>}
                </span>
                {!pending && <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
