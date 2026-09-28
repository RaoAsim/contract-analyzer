import "server-only";
import { getConfig } from "@/lib/config";
import { streamChat } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/llm.types";
import type { RunContext, StreamOutcome } from "./chat.types";
import { abandonedCitation, buildCitation, type CitationDoc } from "./citations";
import { QuoteStreamParser } from "./quoteStreamParser";

/** Shown when the AI hasn't replied yet and a backup request was sent (client.ts hedging). */
export const SLOW_STATUS = {
  text: "The AI is slower than usual — sent a second request…",
  hints: ["Still waiting for the AI to reply…", "Whichever request answers first will be used…"],
};

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

  const citationsBefore = ctx.state.citations.length;
  let notFound = false;
  let escalated = false;
  const defaultTag = citationDocs[0]?.tag ?? "D1";
  let raw = "";
  let writing = false;
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
          if (!writing && e.text.trim()) {
            writing = true;
            ctx.emit("status", { text: "Writing the answer…", hints: ["Checking each quote against the document as it's written…"] });
          }
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

  let finishReason: string | null = null; // normalised: stop | length | recitation | blocked
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
        onSlow: () => ctx.emit("status", SLOW_STATUS),
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
    if (ctx.signal.aborted) {
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
  // Safety net: the model sometimes writes quotes as plain "…" text instead of <quote> tags.
  // Verify those passages; genuine ones become numbered sources (the saved answer carries them).
  if (!notFound && ctx.state.citations.length === citationsBefore) recoverPlainQuotes(ctx, citationDocs);

  const stopNotice =
    finishReason === "length"
      ? { code: "ANSWER_TRUNCATED", text: "The answer reached its length limit and may be incomplete." }
      : finishReason === "recitation"
        ? { code: "ANSWER_RECITATION", text: "The AI provider stopped this answer early because it was reproducing source text verbatim. Quotes shown were still checked against the document; try asking a narrower question." }
        : finishReason === "blocked"
          ? { code: "ANSWER_BLOCKED", text: "The AI provider's safety filter stopped this answer. Try rephrasing the question." }
          : null;
  if (stopNotice) {
    ctx.state.notices.push(stopNotice);
    ctx.emit("notice", stopNotice);
  }
  return { notFound, stopped, text: raw, finishReason };
}

const PLAIN_QUOTE = /"([^"\n]{25,800})"|“([^”\n]{25,800})”/g;

/** Turn verified plain-quoted passages in the answer into citations (⟦cN⟧ tokens). */
function recoverPlainQuotes(ctx: RunContext, docs: CitationDoc[]): void {
  let changed = false;
  const content = ctx.state.content.replace(PLAIN_QUOTE, (whole: string, a: string | undefined, b: string | undefined) => {
    const text = (a ?? b ?? "").trim();
    if (text.split(/\s+/).length < 5) return whole; // a defined term or a short phrase, not a quote
    for (const d of docs) {
      const id = ctx.nextCitationId();
      const c = buildCitation(id, docs, d.tag, text);
      if (c.status === "verified" || c.status === "verified_close") {
        ctx.state.citations.push(c);
        ctx.emit("citation", c);
        changed = true;
        return `⟦${id}⟧`;
      }
    }
    return whole; // not in any document: leave it as plain text (it is not shown as a source)
  });
  if (changed) {
    ctx.state.content = content;
    ctx.flush();
  }
}
