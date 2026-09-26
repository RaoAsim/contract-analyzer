import "server-only";
import { getConfig } from "@/lib/config";
import { isAbortError, streamChat } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/llm.types";
import type { RunContext, StreamOutcome } from "./chat.types";
import { abandonedCitation, buildCitation, type CitationDoc } from "./citations";
import { QuoteStreamParser } from "./quoteStreamParser";

const FAKE_QUOTE = ' <quote doc="D1">The Supplier shall provide unlimited free support to the Customer forever.</quote>';

function addUsage(ctx: RunContext, u: { inputTokens: number; outputTokens: number; calls: number }): void {
  ctx.state.usage.inputTokens += u.inputTokens;
  ctx.state.usage.outputTokens += u.outputTokens;
  ctx.state.usage.calls += u.calls;
}

/**
 * Stream one answer (§11.6): LLM tokens → quote parser → verifier → SSE. Citations are emitted
 * BEFORE the text delta containing their ⟦cN⟧ token. If `escalateOnNotFound`, a [[NOT_FOUND]]
 * sentinel aborts this call early so the caller can escalate to a full scan.
 */
export async function streamAnswer(
  ctx: RunContext,
  messages: ChatMessage[],
  citationDocs: CitationDoc[],
  opts: { escalateOnNotFound: boolean; label: string; maxTokens?: number; notFoundPrefix?: string; streamImpl?: typeof streamChat },
): Promise<StreamOutcome> {
  const child = new AbortController();
  const onParentAbort = (): void => child.abort(ctx.signal.reason);
  if (ctx.signal.aborted) child.abort(ctx.signal.reason);
  ctx.signal.addEventListener("abort", onParentAbort);

  let notFound = false;
  let escalated = false;
  const defaultTag = citationDocs[0]?.tag ?? "D1";
  let raw = "";
  const parser = new QuoteStreamParser({
    defaultTag,
    nextId: ctx.nextCitationId,
    onEvent: (e) => {
      switch (e.type) {
        case "not_found":
          notFound = true;
          if (opts.escalateOnNotFound) {
            escalated = true;
            child.abort("escalate");
          } else if (opts.notFoundPrefix) {
            // Complete coverage: the server states the absence; the model's sentence says what it looked for.
            ctx.state.content += opts.notFoundPrefix;
            ctx.emit("text", { delta: opts.notFoundPrefix });
          }
          break;
        case "text":
          if (escalated) return;
          ctx.state.content += e.text;
          ctx.emit("text", { delta: e.text });
          break;
        case "quote_open":
          if (escalated) return;
          ctx.emit("quote_pending", { id: e.id, docTag: e.tag });
          break;
        case "quote": {
          if (escalated) return;
          const c = buildCitation(e.id, citationDocs, e.tag, e.text);
          ctx.state.citations.push(c);
          ctx.emit("citation", c);
          const token = `⟦${e.id}⟧`;
          ctx.state.content += token;
          ctx.emit("text", { delta: token });
          break;
        }
        case "quote_abandoned": {
          if (escalated) return;
          const c = abandonedCitation(e.id, citationDocs, e.tag, e.text, e.reason);
          ctx.state.citations.push(c);
          ctx.emit("citation", c);
          const token = `⟦${e.id}⟧`;
          ctx.state.content += token;
          ctx.emit("text", { delta: token });
          if (e.reason === "truncated") {
            const n = { code: "QUOTE_TRUNCATED", text: "A quote was too long to check and is shown as unverified." };
            ctx.state.notices.push(n);
            ctx.emit("notice", n);
          }
          break;
        }
      }
      ctx.flush();
    },
  });

  let finishReason: string | null = null;
  let stopped = false;
  try {
    const r = await (opts.streamImpl ?? streamChat)(
      messages,
      (delta) => {
        raw += delta;
        parser.push(delta);
      },
      {
        signal: child.signal,
        label: opts.label,
        maxTokens: opts.maxTokens,
        onRetry: ({ attempt }) => ctx.emit("notice", { code: "RETRYING", text: `The AI provider is busy — retrying (attempt ${attempt + 1})…` }),
      },
    );
    addUsage(ctx, r.usage);
    finishReason = r.finishReason;
    if (ctx.options.debugInjectFakeQuote && getConfig().ENABLE_DEBUG_TOGGLES && !notFound) parser.push(FAKE_QUOTE);
    parser.end("complete");
  } catch (err) {
    if (escalated && !ctx.signal.aborted) {
      // Early abort for escalation: not an error. Estimate the partial call's usage.
      ctx.state.usage.calls += 1;
      return { notFound: true, stopped: false, text: raw, finishReason: "escalated" };
    }
    if (ctx.signal.aborted || isAbortError(err)) {
      stopped = true;
      ctx.state.usage.calls += 1;
      parser.end("stopped");
      return { notFound, stopped, text: raw, finishReason: "stopped" };
    }
    // Keep what was generated, then surface the failure to the caller.
    parser.end("stopped");
    throw err;
  } finally {
    ctx.signal.removeEventListener("abort", onParentAbort);
  }
  if (finishReason === "length") {
    const n = { code: "ANSWER_TRUNCATED", text: "The answer reached its length limit and may be incomplete." };
    ctx.state.notices.push(n);
    ctx.emit("notice", n);
  }
  return { notFound, stopped, text: raw, finishReason };
}
