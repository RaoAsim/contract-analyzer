"use client";

import { createParser } from "eventsource-parser";
import { useCallback, useRef, useState } from "react";
import type { UiMessage, SendOptions } from "@/components/chat/chat.types";
import { ClientApiError } from "@/lib/client/api";
import type { Citation } from "@/types/citation";
import type { SseEventMap } from "@/types/sse";

type Live = { user: UiMessage; assistant: UiMessage } | null;

function blank(id: string, role: "user" | "assistant", content = ""): UiMessage {
  return {
    id,
    role,
    content,
    citations: [],
    coverage: null,
    trace: [],
    notices: [],
    mode: null,
    status: role === "user" ? "complete" : "streaming",
    error: null,
    usage: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Streams one answer over a fetch POST (SSE parsed with eventsource-parser, §11.5). State machine:
 * pending → streaming → complete | stopped | error. `stop()` calls the stop endpoint AND aborts the fetch.
 */
export function useChatStream(onFinished: (conversationId: string) => void): {
  live: Live;
  busy: boolean;
  send: (conversationId: string, content: string, options: SendOptions) => Promise<void>;
  stop: () => void;
  clear: () => void;
} {
  const [live, setLive] = useState<Live>(null);
  const abort = useRef<AbortController | null>(null);
  const messageId = useRef<string | null>(null);
  const busy = live?.assistant.live?.phase === "pending" || live?.assistant.live?.phase === "streaming";

  const update = useCallback((fn: (a: UiMessage) => UiMessage) => {
    setLive((l) => (l ? { ...l, assistant: fn(l.assistant) } : l));
  }, []);

  const send = useCallback(
    async (conversationId: string, content: string, options: SendOptions) => {
      const ac = new AbortController();
      abort.current = ac;
      messageId.current = null;
      const tempUser = blank(`tmp-u-${Date.now()}`, "user", content);
      const tempAsst: UiMessage = { ...blank(`tmp-a-${Date.now()}`, "assistant"), live: { phase: "pending", pending: [], startedAt: Date.now() } };
      setLive({ user: tempUser, assistant: tempAsst });

      const debug = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugInjectFakeQuote") === "1";
      let res: Response;
      try {
        res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ content, options: { ...options, ...(debug ? { debugInjectFakeQuote: true } : {}) } }),
          signal: ac.signal,
        });
      } catch {
        update((a) => ({ ...a, status: "error", error: { code: "network_error", message: "Can't reach the server. Check your connection and try again.", retryable: true }, live: { ...a.live!, phase: "error" } }));
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
        const e = new ClientApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? `The server returned an error (${res.status}).`);
        update((a) => ({ ...a, status: "error", error: { code: e.code, message: e.message, retryable: res.status !== 400 }, live: { ...a.live!, phase: "error" } }));
        return;
      }

      let finished = false;
      const handle = <K extends keyof SseEventMap>(event: K, data: SseEventMap[K]): void => {
        switch (event) {
          case "meta": {
            const m = data as SseEventMap["meta"];
            messageId.current = m.messageId;
            setLive((l) => (l ? { user: { ...l.user, id: m.userMessageId }, assistant: { ...l.assistant, id: m.messageId, mode: m.mode, live: { ...l.assistant.live!, phase: "streaming" } } } : l));
            break;
          }
          case "status":
            update((a) => ({ ...a, live: { ...a.live!, status: data as SseEventMap["status"] } }));
            break;
          case "text":
            update((a) => ({ ...a, content: a.content + (data as SseEventMap["text"]).delta }));
            break;
          case "quote_pending":
            update((a) => ({ ...a, live: { ...a.live!, pending: [...a.live!.pending, (data as SseEventMap["quote_pending"]).id] } }));
            break;
          case "citation": {
            const c = data as Citation;
            update((a) => ({ ...a, citations: [...a.citations.filter((x) => x.id !== c.id), c], live: { ...a.live!, pending: a.live!.pending.filter((p) => p !== c.id) } }));
            break;
          }
          case "tool_call": {
            const t = data as SseEventMap["tool_call"];
            update((a) => ({ ...a, mode: "agent", trace: [...a.trace, { round: t.round, callId: t.callId, name: t.name, label: t.label, args: t.args, ok: false, summary: "", ms: -1 }] }));
            break;
          }
          case "tool_result": {
            const t = data as SseEventMap["tool_result"];
            update((a) => ({ ...a, trace: a.trace.map((s) => (s.callId === t.callId ? { ...s, ok: t.ok, summary: t.summary, ms: t.ms, error: t.error } : s)) }));
            break;
          }
          case "coverage":
            update((a) => ({ ...a, coverage: data as SseEventMap["coverage"], mode: (data as SseEventMap["coverage"]).mode }));
            break;
          case "notice": {
            const n = data as SseEventMap["notice"];
            if (n.code === "RETRYING") update((a) => ({ ...a, live: { ...a.live!, status: { text: n.text } } }));
            else update((a) => ({ ...a, notices: [...a.notices.filter((x) => x.code !== n.code || x.text !== n.text), n] }));
            break;
          }
          case "error":
            update((a) => ({ ...a, error: data as SseEventMap["error"] }));
            break;
          case "done": {
            finished = true;
            const d = data as SseEventMap["done"];
            update((a) => ({ ...a, status: d.status, live: { ...a.live!, phase: d.status, status: undefined, pending: [] } }));
            break;
          }
        }
      };

      const parser = createParser({
        onEvent: (ev) => {
          if (!ev.event) return;
          try {
            handle(ev.event as keyof SseEventMap, JSON.parse(ev.data) as SseEventMap[keyof SseEventMap]);
          } catch {
            // ignore a malformed event rather than tearing down the stream
          }
        },
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
      } catch {
        // aborted by Stop, or the connection dropped
      }
      if (!finished) {
        const stoppedByUser = ac.signal.aborted;
        update((a) => ({
          ...a,
          status: stoppedByUser ? "stopped" : "error",
          error: stoppedByUser ? null : { code: "connection_lost", message: "The connection was lost. The partial answer was saved; reopen the chat to see it.", retryable: true },
          live: { ...a.live!, phase: stoppedByUser ? "stopped" : "error", status: undefined, pending: [] },
        }));
      }
      abort.current = null;
      onFinished(conversationId);
    },
    [onFinished, update],
  );

  const stop = useCallback(() => {
    const id = messageId.current;
    if (id) void fetch(`/api/messages/${id}/stop`, { method: "POST" }).catch(() => {});
    // Give the server a moment to send `done` with the partial answer, then abort our side.
    setTimeout(() => abort.current?.abort(), 1500);
  }, []);

  const clear = useCallback(() => setLive(null), []);

  return { live, busy, send, stop, clear };
}
