"use client";

import { createParser } from "eventsource-parser";
import { useCallback, useRef, useState } from "react";
import type { UiMessage, SendOptions } from "@/components/chat/chat.types";
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
 * pending → streaming → complete | stopped | error. The question appears (and Send turns into Stop)
 * synchronously on click, before any network round trip; a second click while busy is ignored.
 */
export function useChatStream(onFinished: (conversationId: string) => void): {
  live: Live;
  busy: boolean;
  /** `conversation` may be a function that creates the chat first. */
  send: (conversation: string | (() => Promise<string>), content: string, options: SendOptions) => Promise<void>;
  stop: () => void;
  clear: () => void;
} {
  const [live, setLive] = useState<Live>(null);
  const abort = useRef<AbortController | null>(null);
  const messageId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const sentAt = useRef(0);
  const busy = live?.assistant.live?.phase === "pending" || live?.assistant.live?.phase === "streaming";

  const update = useCallback((fn: (a: UiMessage) => UiMessage) => {
    setLive((l) => (l ? { ...l, assistant: fn(l.assistant) } : l));
  }, []);

  const fail = useCallback(
    (code: string, message: string, retryable = true) =>
      update((a) => ({ ...a, status: "error", error: { code, message, retryable }, live: { ...a.live!, phase: "error", status: undefined } })),
    [update],
  );

  const send = useCallback(
    async (conversation: string | (() => Promise<string>), content: string, options: SendOptions) => {
      if (inFlight.current) return; // synchronous guard against double clicks
      inFlight.current = true;
      sentAt.current = Date.now();
      const ac = new AbortController();
      abort.current = ac;
      messageId.current = null;
      setLive({
        user: blank(`tmp-u-${Date.now()}`, "user", content),
        assistant: { ...blank(`tmp-a-${Date.now()}`, "assistant"), live: { phase: "pending", pending: [], startedAt: Date.now(), status: { text: "Starting…" } } },
      });

      let conversationId = "";
      try {
        conversationId = typeof conversation === "string" ? conversation : await conversation();
        const debug = new URLSearchParams(window.location.search).get("debugInjectFakeQuote") === "1";
        let res: Response;
        try {
          res = await fetch(`/api/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify({ content, options: { ...options, ...(debug ? { debugInjectFakeQuote: true } : {}) } }),
            signal: ac.signal,
          });
        } catch {
          if (ac.signal.aborted) update((a) => ({ ...a, status: "stopped", live: { ...a.live!, phase: "stopped", status: undefined } }));
          else fail("network_error", "Can't reach the server. Check your connection and try again.");
          return;
        }
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
          fail(body?.error?.code ?? "http_error", body?.error?.message ?? `The server returned an error (${res.status}).`, res.status !== 400);
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
          if (ac.signal.aborted) update((a) => ({ ...a, status: "stopped", live: { ...a.live!, phase: "stopped", status: undefined, pending: [] } }));
          else fail("connection_lost", "The connection was lost. The partial answer was saved; reopen the chat to see it.");
        }
      } catch (e) {
        fail("start_failed", e instanceof Error ? e.message : "Couldn't start a new chat.");
      } finally {
        abort.current = null;
        inFlight.current = false;
        if (conversationId) onFinished(conversationId);
      }
    },
    [fail, onFinished, update],
  );

  const stop = useCallback(() => {
    // Stop replaces Send in the same spot: the second click of a double-click on Send must not
    // cancel the question that was just asked.
    if (Date.now() - sentAt.current < 800) return;
    const id = messageId.current;
    if (id) void fetch(`/api/messages/${id}/stop`, { method: "POST" }).catch(() => {});
    // Give the server a moment to send `done` with the partial answer, then abort our side.
    setTimeout(() => abort.current?.abort(), id ? 1500 : 0);
  }, []);

  const clear = useCallback(() => setLive(null), []);

  return { live, busy, send, stop, clear };
}
