import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import type { AnswerMode, Coverage, MessageError, MessageStatus, Notice, TraceStep, Usage } from "@/types/chat";
import type { Citation } from "@/types/citation";

/** Insert the user message and a `streaming` assistant row before calling the LLM (§11.8). */
export async function createTurn(conversationId: string, question: string): Promise<{ userMessageId: string; assistantMessageId: string }> {
  return getDb().transaction(async (tx) => {
    const [u] = await tx.insert(messages).values({ conversationId, role: "user", content: question, status: "complete", completedAt: new Date() }).returning({ id: messages.id });
    const [a] = await tx.insert(messages).values({ conversationId, role: "assistant", content: "", status: "streaming" }).returning({ id: messages.id });
    // Title = first question (60 chars), set once.
    await tx
      .update(conversations)
      .set({
        updatedAt: new Date(),
        title: sql`case when ${conversations.title} = '' then ${question.replace(/\s+/g, " ").trim().slice(0, 60)} else ${conversations.title} end`,
      })
      .where(eq(conversations.id, conversationId));
    return { userMessageId: u!.id, assistantMessageId: a!.id };
  });
}

/** Short periodic write of partial progress (every ~1.5 s while streaming). */
export async function flushMessage(id: string, p: { content: string; citations: Citation[]; trace: TraceStep[] }): Promise<void> {
  await getDb()
    .update(messages)
    .set({ content: p.content, citations: p.citations, trace: p.trace, updatedAt: new Date() })
    .where(and(eq(messages.id, id), eq(messages.status, "streaming")));
}

export async function finalizeMessage(
  id: string,
  p: {
    content: string;
    citations: Citation[];
    coverage?: Coverage;
    trace: TraceStep[];
    notices: Notice[];
    mode: AnswerMode;
    status: Exclude<MessageStatus, "streaming">;
    error?: MessageError;
    usage: Usage;
  },
): Promise<void> {
  await getDb()
    .update(messages)
    .set({
      content: p.content,
      citations: p.citations,
      coverage: p.coverage ?? null,
      trace: p.trace,
      notices: p.notices,
      mode: p.mode,
      status: p.status,
      error: p.error ?? null,
      usage: p.usage,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(messages.id, id));
}

/** Throttle helper: at most one flush per interval, always flushing the latest state. */
export function throttledFlush(fn: () => Promise<void>, intervalMs = 1500): { request: () => void; cancel: () => void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    last = Date.now();
    fn()
      .catch((err: unknown) => console.warn("[chat] flush failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  };
  return {
    request: () => {
      if (timer) return;
      const wait = Math.max(0, intervalMs - (Date.now() - last));
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, wait);
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
