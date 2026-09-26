"use client";

import { AlertCircle, Check, Copy, Loader2, RotateCw, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/useNow";
import type { Citation } from "@/types/citation";
import type { UiMessage } from "./chat.types";
import { citationNumbers, isVerified, plainText } from "./citationFormat";
import { CoverageBadge } from "./CoverageBadge";
import { MessageContent } from "./MessageContent";
import { NoticeList } from "./NoticeList";
import { ResearchTimeline } from "./ResearchTimeline";
import { SourcesList } from "./SourcesList";

const MODE_LABEL: Record<string, string> = { full: "Full document", retrieval: "Relevant excerpts", scan: "Full-document scan", agent: "Research agent" };

type Props = {
  message: UiMessage;
  docName: (docId: string) => string;
  multi: boolean;
  onOpenCitation: (messageId: string, c: Citation) => void;
  onRetry?: () => void;
  onThorough?: () => void;
  busy: boolean;
};

export function AssistantMessage({ message: m, docName, multi, onOpenCitation, onRetry, onThorough, busy }: Props): React.ReactElement {
  const running = m.live?.phase === "pending" || m.live?.phase === "streaming";
  const now = useNow(running, 1000);
  const [copied, setCopied] = useState(false);
  const numbers = citationNumbers(m.content, m.citations);
  const verified = m.citations.filter(isVerified).length;
  const open = (c: Citation): void => onOpenCitation(m.id, c);

  return (
    <article className="group" aria-busy={running}>
      {m.trace.length > 0 && <ResearchTimeline steps={m.trace} running={running && !m.content} />}

      {running && (
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          <span>{m.live?.status?.text ?? (m.live?.phase === "pending" ? "Starting…" : m.content ? "Writing the answer…" : "Thinking…")}</span>
          {m.live?.status?.progress && (
            <span className="font-mono text-xs tabular-nums">
              {m.live.status.progress.done}/{m.live.status.progress.total}
            </span>
          )}
          <span className="ml-auto font-mono text-xs tabular-nums">{Math.max(0, Math.round((now - (m.live?.startedAt ?? now)) / 1000))}s</span>
        </div>
      )}

      {m.content && <MessageContent content={m.content} citations={m.citations} numbers={numbers} docName={docName} multi={multi} onOpen={open} />}
      {running && (m.live?.pending.length ?? 0) > 0 && (
        <span className="ml-1 inline-flex h-5 items-center gap-1 rounded-full bg-stone-100 px-1.5 align-middle text-[11px] font-medium text-stone-500">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> verifying quote…
        </span>
      )}

      {m.status === "stopped" && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
          <Square className="size-3" aria-hidden="true" /> Stopped{m.content ? " — partial answer kept" : ""}
        </p>
      )}
      {m.status === "interrupted" && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Interrupted — the page was closed or the server restarted while this was being written.</p>
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

      <NoticeList notices={m.notices} onThorough={onThorough} disabled={busy} />
      {!running && <SourcesList citations={m.citations} numbers={numbers} docName={docName} multi={multi} onOpen={open} />}

      {!running && (m.content || m.coverage) && (
        <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          {m.coverage && <CoverageBadge coverage={m.coverage} />}
          {m.citations.length > 0 && (
            <span className={verified === m.citations.length ? "text-emerald-700" : "text-amber-800"}>
              {verified} of {m.citations.length} quote{m.citations.length === 1 ? "" : "s"} verified
            </span>
          )}
          {m.mode && <span>{MODE_LABEL[m.mode] ?? m.mode}</span>}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-stone-100 hover:text-stone-800"
            onClick={() => {
              void navigator.clipboard.writeText(plainText(m.content, m.citations)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            aria-label="Copy answer"
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {onRetry && (
            <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50" onClick={onRetry} disabled={busy} aria-label="Regenerate answer">
              <RotateCw className="size-3.5" aria-hidden="true" /> Regenerate
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
