import "server-only";
import { ApiError } from "@/lib/api/errors";
import { conversationDocs, getConversation } from "@/lib/db/queries/conversations";
import { LlmUnavailableError } from "@/lib/llm/client";
import { loadDocData } from "@/lib/text/cache";
import type { MessageStatus } from "@/types/chat";
import type { AnswerState, ChatDoc, ChatOptions, RunContext } from "./chat.types";
import { runChat } from "./engine";
import { loadHistory } from "./history";
import { createTurn, finalizeMessage, flushMessage, throttledFlush } from "./persist";
import { runRegistry } from "./runRegistry";
import { SSE_HEADERS, SseWriter } from "./sse";

/**
 * Start an answer and return its SSE response (§11.5, §11.8). Order: validate → create the user
 * message and a `streaming` assistant row → stream → in `finally` persist the final state and send
 * exactly one `done`.
 */
export async function startAnswer(conversationId: string, question: string, options: ChatOptions, reqSignal: AbortSignal): Promise<Response> {
  const convo = await getConversation(conversationId);
  if (!convo) throw new ApiError(404, "not_found", "This chat was not found. It may have been deleted.");
  if (runRegistry.isActive(conversationId)) throw new ApiError(409, "busy", "An answer is still being generated. Stop it or wait for it to finish.");

  const links = await conversationDocs(conversationId);
  const docs: ChatDoc[] = [];
  for (const l of links) {
    const data = await loadDocData(l.documentId);
    if (data) docs.push({ tag: l.tag, data });
  }
  if (docs.length === 0) {
    throw new ApiError(409, "no_documents", convo.conversation.kind === "multi" ? "All documents in this chat were deleted." : "This document is not ready yet.");
  }

  const { userMessageId, assistantMessageId } = await createTurn(conversationId, question);
  const history = await loadHistory(conversationId, [userMessageId, assistantMessageId]);
  const controller = runRegistry.start(conversationId, assistantMessageId);

  const writer = new SseWriter(() => runRegistry.stop(assistantMessageId, "disconnect"));
  reqSignal.addEventListener("abort", () => runRegistry.stop(assistantMessageId, "disconnect"));

  let n = 0;
  const state: AnswerState = { content: "", citations: [], trace: [], notices: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, mode: "full" };
  const flusher = throttledFlush(() => flushMessage(assistantMessageId, { content: state.content, citations: state.citations, trace: state.trace }));

  const ctx: RunContext = {
    conversationId,
    messageId: assistantMessageId,
    question,
    docs,
    options,
    signal: controller.signal,
    emit: writer.send,
    state,
    history: history.messages,
    flush: flusher.request,
    nextCitationId: () => `c${++n}`,
    startedAt: Date.now(),
  };

  writer.send("meta", {
    messageId: assistantMessageId,
    userMessageId,
    conversationId,
    mode: options.agent ? "agent" : "full",
    docs: docs.map((d) => ({ tag: d.tag, id: d.data.id, name: d.data.name })),
    historyIncluded: history.dropped > 0 ? { turns: history.turns, dropped: history.dropped } : undefined,
  });
  const missing = links.length - docs.length;
  if (missing > 0) {
    const n2 = { code: "DOCS_UNAVAILABLE", text: `${missing} document${missing === 1 ? " is" : "s are"} no longer available and ${missing === 1 ? "was" : "were"} left out of this answer.` };
    state.notices.push(n2);
    writer.send("notice", n2);
  }

  void (async () => {
    let status: Exclude<MessageStatus, "streaming"> = "complete";
    let error: { code: string; message: string; retryable: boolean } | undefined;
    try {
      await runChat(ctx);
      if (controller.signal.aborted) status = "stopped";
    } catch (err) {
      if (controller.signal.aborted) status = "stopped";
      else {
        status = "error";
        console.error(`[chat] answer ${assistantMessageId} failed:`, err instanceof LlmUnavailableError ? `${err.message} (${err.detail})` : err);
        error =
          err instanceof LlmUnavailableError
            ? { code: "llm_unavailable", message: err.message, retryable: true }
            : { code: "internal_error", message: "Something went wrong while generating the answer. Please try again.", retryable: true };
        writer.send("error", error);
      }
    } finally {
      flusher.cancel();
      try {
        // Stopped runs keep the text so far + verified citations, and usage is still recorded (I5).
        await finalizeMessage(assistantMessageId, {
          content: state.content,
          citations: state.citations,
          coverage: state.coverage,
          trace: state.trace,
          notices: state.notices,
          mode: state.mode,
          status,
          error,
          usage: state.usage,
        });
      } catch (e) {
        console.error(`[chat] could not persist answer ${assistantMessageId}:`, e);
      }
      runRegistry.finish(assistantMessageId);
      writer.send("done", { status: status === "stopped" ? "stopped" : status === "error" ? "error" : "complete", messageId: assistantMessageId });
      writer.close();
    }
  })();

  return new Response(writer.stream, { headers: SSE_HEADERS });
}
