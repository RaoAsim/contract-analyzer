"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, History, Loader2, MessageSquarePlus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatStream } from "@/hooks/useChatStream";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import type { ConversationDetail, ConversationSummary } from "@/types/chat";
import type { Citation } from "@/types/citation";
import { AssistantMessage } from "./AssistantMessage";
import type { ChatPanelProps } from "./ChatPanel.types";
import type { SendOptions, UiMessage } from "./chat.types";
import { Composer } from "./Composer";
import type { ComposerMode } from "./Composer.types";
import { DocTag } from "./DocTag";

const SINGLE_SUGGESTIONS = [
  "What is the term and how does it renew?",
  "What are the termination rights?",
  "Is there a cap on liability?",
  "Which law governs the agreement?",
];
const MULTI_SUGGESTIONS = [
  "How do the liability caps differ?",
  "Compare the termination rights.",
  "Which law governs each agreement?",
  "What are the key differences in payment terms?",
];

function optionsFor(mode: ComposerMode): SendOptions {
  return mode === "thorough" ? { thorough: true } : mode === "agent" ? { agent: true } : {};
}

export function ChatPanel({ kind, documentId, conversationId, onConversationChange, docs, ready, notReady, warnings, onOpenCitation }: ChatPanelProps): React.ReactElement {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ComposerMode>("standard");
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const threads = useQuery({
    queryKey: ["conversations", "doc", documentId],
    queryFn: () => apiFetch<{ conversations: ConversationSummary[] }>(`/api/conversations?documentId=${documentId}`),
    enabled: kind === "single" && !!documentId,
  });
  const detail = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => apiFetch<ConversationDetail>(`/api/conversations/${conversationId}`),
    enabled: !!conversationId,
  });

  const onFinished = useCallback(
    (id: string) => {
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    [qc],
  );
  const stream = useChatStream(onFinished);

  // Drop the live copy once the persisted version (not `streaming`) has been refetched.
  const persisted = useMemo(() => detail.data?.messages ?? [], [detail.data]);
  const { live, clear } = stream;
  useEffect(() => {
    if (!live) return;
    const phase = live.assistant.live?.phase;
    if (phase === "pending" || phase === "streaming") return;
    const saved = persisted.find((m) => m.id === live.assistant.id);
    if (saved && saved.status !== "streaming") clear();
  }, [persisted, live, clear]);

  const messages: UiMessage[] = useMemo(() => {
    if (!live) return persisted;
    const ids = new Set([live.user.id, live.assistant.id]);
    return [...persisted.filter((m) => !ids.has(m.id)), live.user, live.assistant];
  }, [persisted, live]);

  const docName = useCallback((docId: string) => docs.find((d) => d.documentId === docId)?.name ?? "(deleted document)", [docs]);

  // Keep the newest content in view while streaming, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (question: string, opts: SendOptions) => {
      const q = question.trim();
      if (!q || stream.busy) return;
      if (!conversationId && !documentId) return;
      setInput("");
      stick.current = true;
      // The question shows at once; a new chat is created inside send() (never twice).
      const target =
        conversationId ??
        (async () => {
          const r = await apiFetch<{ conversation: ConversationSummary }>("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentIds: [documentId] }),
          });
          qc.setQueryData<ConversationDetail>(["conversation", r.conversation.id], { conversation: r.conversation, messages: [] });
          onConversationChange(r.conversation.id);
          return r.conversation.id;
        });
      await stream.send(target, q, opts);
    },
    [conversationId, documentId, onConversationChange, qc, stream],
  );

  // The "click a source" hint shows on the most recent answer that has verified sources.
  const firstWithSources = [...messages].reverse().find((m) => m.role === "assistant" && m.citations.some((c) => c.status === "verified" || c.status === "verified_close"))?.id;

  const questionBefore = (assistantId: string): string | undefined => {
    const i = messages.findIndex((m) => m.id === assistantId);
    for (let k = i - 1; k >= 0; k--) if (messages[k]!.role === "user") return messages[k]!.content;
    return undefined;
  };

  const deleteThread = async (id: string): Promise<void> => {
    try {
      await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
      toast.success("Chat deleted");
      if (id === conversationId) onConversationChange(null);
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the chat.");
    }
  };

  const multi = kind === "multi";
  const title = detail.data?.conversation.title;

  return (
    <section className="flex h-full min-h-0 flex-col bg-stone-50" aria-label="Chat">
      <header className="flex items-center gap-2 border-b bg-white px-3 py-2">
        {multi ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {docs.map((d) => (
              <DocTag key={d.tag} tag={d.tag} name={d.documentId ? d.name : `${d.name} (deleted document)`} deleted={!d.documentId} compact />
            ))}
          </div>
        ) : (
          <>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">{conversationId ? title || "New chat" : "New chat"}</h2>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Chat history">
                  <History aria-hidden="true" /> <span className="hidden sm:inline">History</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Chats about this document</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {threads.isPending && <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
                {threads.isError && <p className="px-2 py-1.5 text-sm text-red-700">Couldn&apos;t load chat history.</p>}
                {threads.data?.conversations.filter((t) => t.messageCount > 0).length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No earlier chats yet.</p>}
                {threads.data?.conversations
                  .filter((t) => t.messageCount > 0)
                  .map((t) => (
                    <DropdownMenuItem key={t.id} onSelect={() => onConversationChange(t.id)} className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{t.title}</span>
                        <span className="block text-xs text-muted-foreground">{formatDateTime(t.updatedAt)}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Delete chat “${t.title}”`}
                        className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          void deleteThread(t.id);
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" onClick={() => onConversationChange(null)} disabled={stream.busy || !conversationId}>
              <MessageSquarePlus aria-hidden="true" /> <span className="hidden sm:inline">New chat</span>
            </Button>
          </>
        )}
      </header>

      {warnings && warnings.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note">
          {warnings.map((w) => (
            <p key={w.code} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {w.message}
            </p>
          ))}
        </div>
      )}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {!ready ? (
          notReady
        ) : conversationId && detail.isPending ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading chat">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : conversationId && detail.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>{detail.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
              <RotateCw aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <EmptyChat multi={multi} onPick={(q) => void send(q, optionsFor(mode))} />
        ) : (
          <ol className="space-y-6" data-testid="messages">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === "user" ? (
                  <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-primary-foreground">{m.content}</div>
                ) : (
                  <AssistantMessage
                    message={m}
                    docName={docName}
                    multi={multi}
                    busy={stream.busy}
                    onOpenCitation={(_id, c: Citation) => onOpenCitation(c)}
                    onRetry={() => {
                      const q = questionBefore(m.id);
                      if (q) void send(q, optionsFor(mode));
                    }}
                    onThorough={() => {
                      // One-off: re-ask this question reading the whole document; the mode stays as it was.
                      const q = questionBefore(m.id);
                      if (q) void send(q, { thorough: true });
                    }}
                    showHint={m.id === firstWithSources}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        mode={mode}
        onModeChange={setMode}
        busy={stream.busy}
        starting={stream.live?.assistant.live?.phase === "pending"}
        disabled={!ready || (multi && docs.every((d) => !d.documentId))}
        disabledReason={!ready ? "The document is still being processed…" : "All documents in this chat were deleted."}
        onSend={() => void send(input, optionsFor(mode))}
        onStop={stream.stop}
        placeholder={multi ? "Ask one question across these documents…" : undefined}
      />
    </section>
  );
}

function EmptyChat({ multi, onPick }: { multi: boolean; onPick: (q: string) => void }): React.ReactElement {
  const list = multi ? MULTI_SUGGESTIONS : SINGLE_SUGGESTIONS;
  return (
    <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
      <h3 className="text-base font-semibold text-stone-900">{multi ? "Ask across these documents" : "Ask about this contract"}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Every answer is backed by quotes that are checked against the document before they are shown. Click a quote to see it highlighted.
      </p>
      <div className="mt-5 grid w-full max-w-md gap-2">
        {list.map((q) => (
          <button key={q} type="button" onClick={() => onPick(q)} className="rounded-lg border bg-white px-3 py-2 text-left text-sm text-stone-700 shadow-xs transition-colors hover:border-primary/40 hover:bg-accent active:scale-[0.99]">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatNotReady({ stage, progress }: { stage: string | null; progress: number }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-stone-800">The document is still being processed</p>
      <p className="text-sm text-muted-foreground">
        {stage ?? "Working…"} · {progress}%
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">You can already read it in the viewer. Chat opens as soon as processing finishes.</p>
    </div>
  );
}
