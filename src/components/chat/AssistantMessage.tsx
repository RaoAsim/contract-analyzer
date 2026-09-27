"use client";

import { AlertCircle, BookOpen, Bot, Check, CheckCircle2, Copy, FileSearch, Loader2, MousePointerClick, RotateCw, ScanSearch, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";
import type { AnswerMode } from "@/types/chat";
import type { Citation } from "@/types/citation";
import type { UiMessage } from "./chat.types";
import { citationNumbers, isVerified, plainText } from "./citationFormat";
import { CoverageBadge } from "./CoverageBadge";
import { MessageContent } from "./MessageContent";
import { NoticeList } from "./NoticeList";
import { ResearchTimeline } from "./ResearchTimeline";
import { SourcesList } from "./SourcesList";

const MODE: Record<AnswerMode, { label: string; icon: typeof BookOpen; hint: string }> = {
  full: { label: "Full text", icon: BookOpen, hint: "The whole document fitted in one request, so the answer is based on all of it." },
  retrieval: { label: "Relevant sections", icon: FileSearch, hint: "The document is long, so the most relevant sections were read (see the coverage pill)." },
  scan: { label: "Whole-document scan", icon: ScanSearch, hint: "Every part of the document was read for this question." },
  agent: { label: "Research agent", icon: Bot, hint: "The AI chose what to read using document tools." },
};

type Props = {
  message: UiMessage;
  docName: (docId: string) => string;
  multi: boolean;
  onOpenCitation: (messageId: string, c: Citation) => void;
  onRetry?: () => void;
  onThorough?: () => void;
  busy: boolean;
  /** Show the "click a source" hint (first answer with sources only). */
  showHint: boolean;
};

export function AssistantMessage({ message: m, docName, multi, onOpenCitation, onRetry, onThorough, busy, showHint }: Props): React.ReactElement {
  const running = m.live?.phase === "pending" || m.live?.phase === "streaming";
  const now = useNow(running, 1000);
  const [copied, setCopied] = useState(false);
  const numbers = citationNumbers(m.content, m.citations);
  const verified = m.citations.filter(isVerified).length;
  const open = (c: Citation): void => onOpenCitation(m.id, c);
  const mode = m.mode ? MODE[m.mode] : null;
  const elapsed = Math.max(0, Math.round((now - (m.live?.startedAt ?? now)) / 1000));

  return (
    <article className="rounded-xl border bg-white shadow-xs" aria-busy={running}>
      {/* Header: what kind of answer this is and how much of the document it is based on. */}
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {mode ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex cursor-help items-center gap-1.5 text-xs font-medium text-stone-600">
                <mode.icon className="size-3.5" aria-hidden="true" /> {mode.label}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{mode.hint}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-xs font-medium text-stone-600">Answer</span>
        )}
        <span className="ml-auto flex min-w-0 items-center gap-2">{m.coverage && !running && <CoverageBadge coverage={m.coverage} />}</span>
      </header>

      <div className="px-4 py-3">
        {m.trace.length > 0 && <ResearchTimeline steps={m.trace} running={running && !m.content} />}

        {running && (
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
            <span>{m.live?.status?.text ?? (m.content ? "Writing the answer…" : "Thinking…")}</span>
            {m.live?.status?.progress && (
              <span className="font-mono text-xs tabular-nums">
                {m.live.status.progress.done}/{m.live.status.progress.total}
              </span>
            )}
            {elapsed >= 2 && <span className="ml-auto font-mono text-xs tabular-nums">{elapsed}s</span>}
          </div>
        )}

        {m.content && <MessageContent content={m.content} citations={m.citations} numbers={numbers} docName={docName} multi={multi} onOpen={open} />}
        {running && (m.live?.pending.length ?? 0) > 0 && (
          <span className="ml-1 inline-flex h-5 items-center gap-1 rounded-full bg-stone-100 px-1.5 align-middle text-[11px] font-medium text-stone-500">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" /> checking quote…
          </span>
        )}

        {m.status === "stopped" && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
            <Square className="size-3" aria-hidden="true" /> Stopped{m.content ? " — partial answer kept" : ""}
          </p>
        )}
        {m.status === "interrupted" && (
          <p className="mt-2 rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Interrupted — the page was closed or the server restarted while this was being written.</p>
        )}
        {m.error && (
          <div role="alert" className="mt-3 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 sm:flex-row sm:items-center">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{m.error.message}</span>
            {onRetry && m.error.retryable && (
              <Button size="sm" variant="outline" className="bg-white" onClick={onRetry} disabled={busy}>
                <RotateCw aria-hidden="true" /> Try again
              </Button>
            )}
          </div>
        )}

        <NoticeList notices={running ? m.notices : m.notices.filter((n) => n.code !== "ESCALATING")} onThorough={onThorough} disabled={busy} />

        {!running && verified > 0 && showHint && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="size-3.5 text-primary" aria-hidden="true" />
            Click a numbered source to see it highlighted in the document.
          </p>
        )}
        {!running && <SourcesList citations={m.citations} numbers={numbers} docName={docName} multi={multi} onOpen={open} />}
      </div>

      {!running && (m.content || m.error) && (
        <footer className="flex items-center gap-1 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {m.citations.length > 0 ? (
            <span className={cn("inline-flex items-center gap-1 px-1", verified === m.citations.length ? "text-emerald-700" : "text-amber-800")}>
              {verified === m.citations.length ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <AlertCircle className="size-3.5" aria-hidden="true" />}
              {verified} of {m.citations.length} quote{m.citations.length === 1 ? "" : "s"} verified
            </span>
          ) : (
            <span className="px-1">No quotes</span>
          )}
          <span className="ml-auto" />
          {m.content && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                void navigator.clipboard.writeText(plainText(m.content, m.citations)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          {onRetry && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRetry} disabled={busy}>
              <RotateCw aria-hidden="true" /> Ask again
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}
