import "server-only";
import { getConfig } from "@/lib/config";
import type { RunContext } from "@/lib/chat/chat.types";
import type { CitationDoc } from "@/lib/chat/citations";
import { docCoverage, sectionsLabel } from "@/lib/chat/coverage";
import { finish, notice } from "@/lib/chat/finish";
import { answerSystemPrompt, documentsBlock } from "@/lib/chat/prompts";
import { scanDocuments } from "@/lib/chat/scan";
import { streamAnswer } from "@/lib/chat/stream";
import { chatWithTools, estimateMessagesTokens, isAbortError, isToolsRejection, type streamChat } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/llm.types";
import { countTokens } from "@/lib/llm/tokens";
import { cleanSlice } from "@/lib/retrieval/context";
import { clauseRows, searchChunkSpans } from "@/lib/retrieval/search";
import { sectionAt } from "@/lib/chat/citations";
import type { DocData } from "@/lib/text/docData.types";
import type { TraceStep } from "@/types/chat";
import type { Range } from "@/types/document";
import type { AgentOutcome, RawToolCall, ToolEnv, ToolResult } from "./agent.types";
import { dispatch, fitResult, type DispatchContext } from "./dispatch";
import { toolLabel } from "./labels";
import { defaultCaps, Ledger, type Caps } from "./ledger";
import { agentSystemPrompt, budgetNote, CUT_OFF_NOTE, describeOutcome, REPEAT_NUDGE, WIND_DOWN_NOTE } from "./prompts";
import { TOOLS, toolSchemas } from "./tools";

export type AgentDeps = {
  chat?: typeof chatWithTools;
  streamImpl?: typeof streamChat;
  env?: Partial<Pick<ToolEnv, "search" | "clauses" | "scan">>;
  /** Standard pipeline, used when the provider rejects tool calling. */
  fallback?: (ctx: RunContext) => Promise<void>;
  caps?: Partial<Caps>;
  now?: () => number;
};

/** Consecutive identical failures (same tool + same error) → nudge, then stop (§14.3). */
export class RepeatGuard {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit: number) {}

  update(calls: RawToolCall[], results: ToolResult[]): "ok" | "nudge" | "stop" {
    let signal: "ok" | "nudge" | "stop" = "ok";
    results.forEach((r, i) => {
      const key = `${calls[i]!.name}:${r.ok ? "ok" : r.errorCode}`;
      if (r.ok) {
        this.counts.delete(key);
        return;
      }
      const n = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, n);
      if (n >= this.limit) signal = "stop";
      else if (n === this.limit - 1 && signal !== "stop") signal = "nudge";
    });
    return signal;
  }
}

function parseArgsForLabel(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const FINISH = "finish_research";

function defaultEnv(ctx: RunContext): Pick<ToolEnv, "search" | "clauses" | "scan"> {
  return {
    search: async (doc, query, limit) => (await searchChunkSpans(doc, query, limit)).map((h) => ({ start: h.start, end: h.end })),
    clauses: (doc, type) => clauseRows(doc.id, type),
    scan: async (doc, question) => {
      const tag = ctx.docs.find((d) => d.data.id === doc.id)?.tag ?? "D1";
      const [r] = await scanDocuments(ctx, [{ tag, doc }], question);
      return { findings: r?.findings ?? [], okRanges: r?.okRanges ?? [], failedRanges: r?.failedRanges ?? [] };
    },
  };
}

/** Research passages per document for the final answer, in document order, within a token budget. */
function evidenceBody(doc: DocData, ranges: Range[], budget: number): { body: string; used: Range[]; omitted: number } {
  const parts: string[] = [];
  const used: Range[] = [];
  let tokens = 0;
  for (const [s, e] of ranges) {
    const sec = sectionAt(doc, s);
    const head = sec.number ? `── §${sec.number} ${sec.title ?? ""} ──` : `── ${sec.title ?? "Passage"} ──`;
    const piece = `${head}\n${cleanSlice(doc, s, e)}`;
    const t = countTokens(piece);
    if (tokens + t > budget) continue;
    parts.push(piece);
    used.push([s, e]);
    tokens += t;
  }
  return { body: parts.join("\n[…]\n"), used, omitted: ranges.length - used.length };
}

/**
 * Part C: agentic research (§14). Non-streaming research rounds with tools, hard caps checked
 * BEFORE each call, a forced final answer when a cap is hit, and a separate streaming answer with
 * tools disabled that goes through the same quote parser + verifier as the standard modes.
 */
export async function runAgent(ctx: RunContext, deps: AgentDeps = {}): Promise<void> {
  const cfg = getConfig();
  const caps = defaultCaps({ maxRounds: cfg.AGENT_MAX_ROUNDS, maxToolCalls: cfg.AGENT_MAX_TOOL_CALLS, ...deps.caps });
  const ledger = new Ledger(caps, deps.now);
  const chat = deps.chat ?? chatWithTools;
  const env: ToolEnv = { docs: ctx.docs, multi: ctx.docs.length > 1, ...defaultEnv(ctx), ...deps.env, signal: ctx.signal, ledger };
  const dc: DispatchContext = { env, cache: new Map(), toolTimeoutMs: caps.toolTimeoutMs, scanTimeoutMs: caps.scanTimeoutMs };
  const tools = toolSchemas();
  const msgs: ChatMessage[] = [{ role: "system", content: agentSystemPrompt(ctx.docs, caps) }, ...ctx.history, { role: "user", content: ctx.question }];
  const repeat = new RepeatGuard(caps.repeatFailureLimit);
  let outcome: AgentOutcome = "cap";
  let cutOffNudged = false;

  for (let round = 1; round <= caps.maxRounds; round++) {
    if (ctx.signal.aborted) break;
    if (ledger.elapsed() > caps.wallClockMs) {
      outcome = "timeout";
      break;
    }
    const last = round === caps.maxRounds;
    if (last) msgs.push({ role: "user", content: `${WIND_DOWN_NOTE} ${budgetNote(1, ledger.remainingCalls())}` });
    if (!ledger.canAfford(estimateMessagesTokens(msgs))) {
      outcome = "cap";
      break;
    }
    ledger.rounds = round;
    ctx.emit("status", { text: round === 1 ? "Planning research…" : "Deciding what to read next…" });

    let resp: Awaited<ReturnType<typeof chatWithTools>>;
    try {
      resp = await chat(msgs, tools, {
        signal: ctx.signal,
        label: "agent-round",
        onRetry: ({ attempt }) => ctx.emit("notice", { code: "RETRYING", text: `The AI provider is busy — retrying (attempt ${attempt + 1})…` }),
      });
    } catch (err) {
      if (ctx.signal.aborted || isAbortError(err)) break;
      if (round === 1 && isToolsRejection(err) && deps.fallback) {
        notice(ctx, { code: "TOOLS_UNSUPPORTED", text: "This model doesn't support tool use; answered with standard mode instead." });
        await deps.fallback(ctx);
        return;
      }
      throw err;
    }
    ledger.add(resp.usage);
    ctx.state.usage.inputTokens += resp.usage.inputTokens;
    ctx.state.usage.outputTokens += resp.usage.outputTokens;
    ctx.state.usage.calls += resp.usage.calls;

    const rawCalls = (resp.message.tool_calls ?? []).filter((c): c is Extract<typeof c, { type: "function" }> => c.type === "function");
    const calls: RawToolCall[] = rawCalls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments ?? "" }));
    msgs.push({ role: "assistant", content: resp.message.content ?? null, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) });

    if (calls.length === 0) {
      // Truncated at max tokens with no tool calls is NOT finished (§14.4) — nudge once.
      if (resp.finishReason === "length" && !cutOffNudged) {
        cutOffNudged = true;
        msgs.push({ role: "user", content: CUT_OFF_NOTE });
        continue;
      }
      // The model answered in text (or wrote pretend tool calls as text): go to the answer phase.
      outcome = "model_text";
      break;
    }

    const results = await Promise.all(
      calls.map(async (c, i): Promise<ToolResult> => {
        const label = toolLabel(c.name, parseArgsForLabel(c.arguments), ctx.docs, env.multi);
        const step: TraceStep = { round, callId: c.id, name: c.name, label, args: parseArgsForLabel(c.arguments), ok: false, summary: "", ms: 0 };
        ctx.state.trace.push(step);
        ctx.emit("tool_call", { callId: c.id, name: c.name, label, args: step.args, round });
        ctx.flush();
        const t0 = Date.now();
        let r: ToolResult & { args?: unknown };
        const cost = TOOLS.find((t) => t.name === c.name)?.cost ?? 1;
        if (i >= caps.maxCallsPerRound) {
          r = { ok: false, errorCode: "TOO_MANY_CALLS", payload: { error: "TOO_MANY_CALLS", message: `Too many calls in one round; at most ${caps.maxCallsPerRound} run per round.` }, summary: "Refused — too many calls in one round" };
        } else if (c.name !== FINISH && !ledger.claimToolCall(cost)) {
          r = { ok: false, errorCode: "CALL_LIMIT", payload: { error: "CALL_LIMIT", message: "Tool-call limit reached; call finish_research." }, summary: "Refused — tool-call limit reached" };
        } else {
          r = await dispatch(c, dc);
        }
        step.ok = r.ok;
        step.summary = r.summary;
        step.ms = Date.now() - t0;
        step.error = r.ok ? undefined : r.errorCode;
        if (r.args !== undefined) step.args = r.args;
        ctx.emit("tool_result", { callId: c.id, ok: r.ok, summary: r.summary, ms: step.ms, error: step.error });
        ctx.flush();
        return r;
      }),
    );
    // EVERY tool call gets a result message (API requirement).
    calls.forEach((c, i) => msgs.push({ role: "tool", tool_call_id: c.id, content: fitResult(results[i]!.payload, caps.maxToolResultChars) }));

    if (results.some((r) => r.finish)) {
      outcome = "finished";
      break;
    }
    const rg = repeat.update(calls, results);
    if (rg === "stop") {
      outcome = "repeat_failures";
      break;
    }
    const nudges = [rg === "nudge" ? REPEAT_NUDGE : "", !last ? budgetNote(caps.maxRounds - round, ledger.remainingCalls()) : ""].filter(Boolean);
    if (nudges.length) msgs.push({ role: "user", content: nudges.join(" ") });
  }

  const perDocCoverage = (): ReturnType<typeof docCoverage>[] =>
    ctx.docs.map((d) =>
      docCoverage(d.data, d.tag, ledger.readRanges(d.data.id), {
        checkedEntireDocument: ledger.checkedComplete.has(d.data.id),
        failedRanges: ledger.failedByDoc.get(d.data.id),
      }),
    );

  if (ctx.signal.aborted) {
    finish(ctx, perDocCoverage(), { notFound: false, stopped: true, text: "", finishReason: "stopped" });
    return;
  }
  if (outcome !== "finished" && outcome !== "model_text") {
    notice(ctx, { code: "AGENT_CAP", text: `Research limit reached (${describeOutcome(outcome)}). Answering from what was found.` });
  }

  // ANSWER PHASE — streaming, tools disabled, same parser + verifier as the standard modes.
  ctx.emit("status", { text: "Writing the answer from the research…" });
  const coverage = perDocCoverage();
  const budget = Math.max(cfg.CONTEXT_BUDGET_TOKENS, 24_000);
  const perDocBudget = Math.floor(budget / ctx.docs.length);
  const contexts = ctx.docs.map((d, i) => {
    const cov = coverage[i]!;
    const ev = evidenceBody(d.data, ledger.readRanges(d.data.id), perDocBudget);
    const pct = Math.round(cov.fraction * 100);
    const checked = ledger.checkedComplete.has(d.data.id);
    const read = sectionsLabel(d.data, ledger.readRanges(d.data.id)) || "nothing";
    return {
      d,
      ev,
      checked,
      statement: checked
        ? `${d.tag}: check_entire_document reported COMPLETE coverage — the entire document was checked for this question.`
        : `${d.tag}: you read ${read} — about ${pct}% of the document. The rest was NOT read.${ev.omitted ? ` (${ev.omitted} passages you read are omitted below for length.)` : ""}`,
    };
  });
  const allChecked = contexts.every((c) => c.checked);
  const coverageText = `${contexts.map((c) => c.statement).join("\n")}
Quotes must be copied from the research passages below.
If the answer is not in what you read, say exactly which sections you checked and that the rest was not read — unless check_entire_document reported complete coverage.`;
  const system: ChatMessage = { role: "system", content: answerSystemPrompt(coverageText, ctx.docs.length > 1) };
  const block = documentsBlock(
    contexts.map((c) => ({
      tag: c.d.tag,
      name: c.d.data.name,
      coverageAttr: c.checked ? "entire document checked; relevant passages shown" : `research passages only (about ${Math.round(coverage[contexts.indexOf(c)]!.fraction * 100)}%)`,
      body: c.ev.body || "(The research did not read any passages of this document.)",
    })),
  );
  const citationDocs: CitationDoc[] = contexts.map((c) => ({ tag: c.d.tag, data: c.d.data, contextRanges: c.ev.used }));
  const answerOutcome = await streamAnswer(
    ctx,
    [system, ...ctx.history, { role: "user", content: `${block}\n\nQuestion: ${ctx.question}` }],
    citationDocs,
    {
      escalateOnNotFound: false,
      notFoundPrefix: allChecked ? "I checked the entire document and found nothing that answers this. " : "I couldn't find this in the parts the research read, so I can't rule it out. ",
      label: "agent-answer",
      streamImpl: deps.streamImpl,
    },
  );
  finish(ctx, perDocCoverage(), answerOutcome);
}
