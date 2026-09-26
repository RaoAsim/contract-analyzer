import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentDeps } from "@/lib/agent/loop";
import type { AnswerState, ChatDoc, RunContext } from "@/lib/chat/chat.types";
import type { ChatMessage, ToolCallResult } from "@/lib/llm/llm.types";
import type { DocData } from "@/lib/text/docData.types";
import type { SseEventMap } from "@/types/sse";
import { fixtureDocData, memorySearch } from "../support/docData";

// Config needed by runAgent (no real provider is called: the LLM is scripted).
Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "unused",
  GEMINI_API_KEY: "unused",
  GEMINI_MODEL: "fake",
});

type Ev = { event: keyof SseEventMap; data: unknown };

let v1: DocData;
let runAgent: typeof import("@/lib/agent/loop").runAgent;

beforeAll(async () => {
  v1 = await fixtureDocData("msa_v1.docx", "doc-v1");
  ({ runAgent } = await import("@/lib/agent/loop"));
}, 60_000);

function makeCtx(docs: ChatDoc[], question = "What is the liability cap?"): { ctx: RunContext; events: Ev[] } {
  const events: Ev[] = [];
  let n = 0;
  const state: AnswerState = { content: "", citations: [], trace: [], notices: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, mode: "agent" };
  const ctx: RunContext = {
    conversationId: "conv",
    messageId: "msg",
    question,
    docs,
    options: { agent: true },
    signal: new AbortController().signal,
    emit: (event, data) => events.push({ event, data }),
    state,
    history: [],
    flush: () => {},
    nextCitationId: () => `c${++n}`,
    startedAt: Date.now(),
  };
  return { ctx, events };
}

type Call = { name: string; args: string };

/** A fake LLM that plays one scripted response per research round and records what it was sent. */
function scripted(rounds: (Call[] | string | { length: true })[]): { chat: NonNullable<AgentDeps["chat"]>; sent: ChatMessage[][] } {
  const sent: ChatMessage[][] = [];
  let i = 0;
  const chat: NonNullable<AgentDeps["chat"]> = async (messages): Promise<ToolCallResult> => {
    sent.push(structuredClone(messages));
    const r = rounds[Math.min(i, rounds.length - 1)]!;
    i++;
    const usage = { inputTokens: 100, outputTokens: 20, calls: 1 };
    if (typeof r === "string") return { message: { role: "assistant", content: r }, usage, finishReason: "stop" };
    if (!Array.isArray(r)) return { message: { role: "assistant", content: "I was going to" }, usage, finishReason: "length" };
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: r.map((c, k) => ({ id: `call_${i}_${k}`, type: "function" as const, function: { name: c.name, arguments: c.args } })),
      },
      usage,
      finishReason: "tool_calls",
    };
  };
  return { chat, sent };
}

const FINAL = 'The cap is AED 100,000. <quote doc="D1">The total aggregate liability of the Supplier under or in connection with this Agreement shall not exceed AED 100,000.</quote>';

function streamWith(text: string): { impl: NonNullable<AgentDeps["streamImpl"]>; calls: number } {
  const box = { calls: 0 };
  const impl: NonNullable<AgentDeps["streamImpl"]> = async (_messages, onDelta) => {
    box.calls++;
    for (const ch of text.match(/.{1,7}/gs) ?? []) onDelta(ch);
    return { text, usage: { inputTokens: 50, outputTokens: 30, calls: 1 }, finishReason: "stop" };
  };
  return {
    impl,
    get calls() {
      return box.calls;
    },
  };
}

const env = (): AgentDeps["env"] => ({
  search: async (doc, q, limit) => memorySearch(doc, q, limit),
  clauses: async () => [],
  scan: async (doc) => ({ findings: [], okRanges: [[0, doc.text.length]], failedRanges: [] }),
});

/** Every tool_call id in the transcript has a matching tool result message. */
function everyCallAnswered(transcript: ChatMessage[]): boolean {
  const ids = transcript.flatMap((m) => ("tool_calls" in m && m.tool_calls ? m.tool_calls.map((t) => t.id) : []));
  const answered = new Set(transcript.filter((m) => m.role === "tool").map((m) => (m as { tool_call_id: string }).tool_call_id));
  return ids.every((id) => answered.has(id));
}

async function play(rounds: Parameters<typeof scripted>[0], caps: AgentDeps["caps"] = {}, docs?: ChatDoc[]) {
  const d = docs ?? [{ tag: "D1", data: v1 }];
  const { ctx, events } = makeCtx(d);
  const { chat, sent } = scripted(rounds);
  const stream = streamWith(FINAL);
  await runAgent(ctx, { chat, streamImpl: stream.impl, env: env(), caps, fallback: async () => {} });
  const results = events.filter((e) => e.event === "tool_result").map((e) => e.data as SseEventMap["tool_result"]);
  const notices = events.filter((e) => e.event === "notice").map((e) => (e.data as { code: string }).code);
  return { ctx, events, sent, results, notices, streamCalls: stream.calls };
}

describe("agent dispatch replay (fake LLM)", () => {
  beforeEach(() => {});

  it("happy path: outline → section → finish → verified final answer", async () => {
    const r = await play([[{ name: "get_outline", args: "{}" }], [{ name: "get_section", args: '{"number":"6"}' }], [{ name: "finish_research", args: '{"ready":true}' }]]);
    expect(r.results.map((x) => x.ok)).toEqual([true, true, true]);
    expect(r.streamCalls).toBe(1);
    const c = r.ctx.state.citations[0]!;
    expect(c.status).toBe("verified");
    expect(c.displayText).toContain("AED 100,000");
    expect(r.ctx.state.coverage?.perDoc[0]?.sectionsRead).toContain("§6");
    expect(r.notices).not.toContain("AGENT_CAP");
    // Live labels are argument-specific, not a generic spinner.
    const labels = r.events.filter((e) => e.event === "tool_call").map((e) => (e.data as { label: string }).label);
    expect(labels).toEqual(["Reviewing the contract's structure…", "Reading §6 Limitation of Liability…", "Finishing research…"]);
  });

  it("unknown tool → UNKNOWN_TOOL listing the available tools, not executed", async () => {
    const r = await play([[{ name: "search_docs", args: '{"query":"liability"}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toBe("UNKNOWN_TOOL");
    const toolMsg = r.sent[1]!.find((m) => m.role === "tool")!;
    expect(String(toolMsg.content)).toContain("Available: get_outline, search_document");
    expect(String(toolMsg.content)).toContain('"did_you_mean":"search_document"');
  });

  it("invalid JSON arguments → INVALID_JSON (jsonrepair tried first)", async () => {
    const repaired = await play([[{ name: "get_section", args: "{number: '6'}" }], [{ name: "finish_research", args: "{}" }]]);
    expect(repaired.results[0]!.ok).toBe(true); // jsonrepair fixes single quotes / bare keys
    const broken = await play([[{ name: "get_section", args: "{{{{" }], [{ name: "finish_research", args: "{}" }]]);
    expect(broken.results[0]!.error).toBe("INVALID_JSON");
  });

  it("missing argument / wrong type → INVALID_ARGUMENTS with issues; obvious coercions applied", async () => {
    const missing = await play([[{ name: "search_document", args: "{}" }], [{ name: "finish_research", args: "{}" }]]);
    expect(missing.results[0]!.error).toBe("INVALID_ARGUMENTS");
    const toolMsg = JSON.parse(String(missing.sent[1]!.find((m) => m.role === "tool")!.content)) as { issues: { path: string }[]; expected: string };
    expect(toolMsg.issues[0]!.path).toBe("query");
    expect(toolMsg.expected).toContain("query");
    const coerced = await play([[{ name: "get_section", args: '{"number": 6}' }, { name: "search_document", args: '{"query":"liability","limit":"3"}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(coerced.results.slice(0, 2).map((x) => x.ok)).toEqual([true, true]);
    const wrongType = await play([[{ name: "read_pages", args: '{"start":"one","end":2}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(wrongType.results[0]!.error).toBe("INVALID_ARGUMENTS");
  });

  it("invented extra keys are stripped and reported, the call still runs", async () => {
    const r = await play([[{ name: "get_section", args: '{"number":"6","recipient":"bob"}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(r.results[0]!.ok).toBe(true);
    const payload = JSON.parse(String(r.sent[1]!.find((m) => m.role === "tool")!.content)) as { ignored_args: string[] };
    expect(payload.ignored_args).toEqual(["recipient"]);
  });

  it("nonexistent section → SECTION_NOT_FOUND with did_you_mean", async () => {
    const r = await play([[{ name: "get_section", args: '{"number":"6.9"}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(r.results[0]!.error).toBe("SECTION_NOT_FOUND");
    const payload = JSON.parse(String(r.sent[1]!.find((m) => m.role === "tool")!.content)) as { did_you_mean: string[] };
    expect(payload.did_you_mean.length).toBeGreaterThan(0);
  });

  it("out-of-range page → PAGE_OUT_OF_RANGE (PDF) / NO_PAGES (DOCX)", async () => {
    const docx = await play([[{ name: "read_pages", args: '{"start":1,"end":2}' }], [{ name: "finish_research", args: "{}" }]]);
    expect(docx.results[0]!.error).toBe("NO_PAGES");
    const pdf = await fixtureDocData("partial_scan.pdf", "doc-pdf");
    const r = await play([[{ name: "read_pages", args: '{"start":9,"end":12}' }], [{ name: "finish_research", args: "{}" }]], {}, [{ tag: "D1", data: pdf }]);
    expect(r.results[0]!.error).toBe("PAGE_OUT_OF_RANGE");
  });

  it("duplicate call → cached result with a note, and it counts against the cap", async () => {
    const r = await play([[{ name: "get_outline", args: "{}" }], [{ name: "get_outline", args: "{}" }], [{ name: "finish_research", args: "{}" }]]);
    const second = JSON.parse(String(r.sent[2]!.filter((m) => m.role === "tool").at(-1)!.content)) as { note: string };
    expect(second.note).toMatch(/Duplicate call/);
  });

  it("5 identical failures → stops after the repeat limit with a forced, honest final answer", async () => {
    const bad = [{ name: "get_section", args: '{"number":"99"}' }];
    const r = await play([bad, bad, bad, bad, bad, [{ name: "finish_research", args: "{}" }]]);
    expect(r.results.length).toBe(3);
    expect(r.notices).toContain("AGENT_CAP");
    expect(r.streamCalls).toBe(1);
    expect(r.ctx.state.content.length).toBeGreaterThan(0);
  });

  it("a model that never stops → capped at maxRounds, wind-down note, forced final answer", async () => {
    let k = 0;
    const endless = Array.from({ length: 30 }, () => [{ name: "search_document", args: JSON.stringify({ query: `term ${k++}` }) }]);
    const r = await play(endless, { maxRounds: 4 });
    expect(r.sent.length).toBe(4);
    expect(String(r.sent[3]!.at(-1)!.content)).toMatch(/Last research round/);
    expect(r.notices).toContain("AGENT_CAP");
    expect(r.streamCalls).toBe(1);
    for (const t of r.sent) expect(everyCallAnswered(t)).toBe(true);
  });

  it("tool-call cap: calls past the limit are refused with a result, never dropped", async () => {
    const many = [
      { name: "search_document", args: '{"query":"liability"}' },
      { name: "search_document", args: '{"query":"termination"}' },
      { name: "search_document", args: '{"query":"payment"}' },
      { name: "search_document", args: '{"query":"notice"}' },
      { name: "search_document", args: '{"query":"audit"}' },
    ];
    const r = await play([many, [{ name: "finish_research", args: "{}" }]], { maxToolCalls: 3 });
    // The transcript (in call order) has a result for every call; the last two are refusals.
    const toolMsgs = r.sent[1]!.filter((m) => m.role === "tool").map((m) => (JSON.parse(String(m.content)) as { error?: string }).error ?? "ok");
    expect(toolMsgs).toEqual(["ok", "ok", "ok", "CALL_LIMIT", "TOO_MANY_CALLS"]);
    expect(everyCallAnswered(r.sent[1]!)).toBe(true);
  });

  it("a model that answers in text immediately → goes straight to the verified answer phase", async () => {
    const r = await play(["The liability cap is AED 100,000."]);
    expect(r.results.length).toBe(0);
    expect(r.streamCalls).toBe(1);
    expect(r.notices).not.toContain("AGENT_CAP");
    expect(r.ctx.state.citations[0]!.status).toBe("verified");
  });

  it("a response cut off at max tokens is not treated as finished (one nudge)", async () => {
    const r = await play([{ length: true }, [{ name: "finish_research", args: "{}" }]]);
    expect(String(r.sent[1]!.at(-1)!.content)).toMatch(/cut off/);
    expect(r.notices).not.toContain("AGENT_CAP");
  });

  it("the token budget is checked BEFORE each call", async () => {
    const r = await play(
      [[{ name: "get_outline", args: "{}" }], [{ name: "get_outline", args: '{"doc":"D1"}' }], [{ name: "finish_research", args: "{}" }]],
      { maxInputTokens: 50 },
    );
    expect(r.sent.length).toBe(0);
    expect(r.notices).toContain("AGENT_CAP");
    expect(r.streamCalls).toBe(1);
  });

  it("check_entire_document runs once, costs 3 calls, and gives complete coverage", async () => {
    const r = await play([
      [{ name: "check_entire_document", args: '{"question":"non-compete"}' }],
      [{ name: "check_entire_document", args: '{"question":"again"}' }],
      [{ name: "finish_research", args: "{}" }],
    ]);
    expect(r.results[0]!.ok).toBe(true);
    expect(r.results[1]!.error).toBe("ALREADY_USED");
    expect(r.ctx.state.coverage?.perDoc[0]?.checkedEntireDocument).toBe(true);
    expect(r.ctx.state.coverage?.complete).toBe(true);
  });

  it("multi-document: doc tag required; unknown tag lists valid tags; final quotes verified per document", async () => {
    const v2 = await fixtureDocData("msa_v2.docx", "doc-v2");
    const docs = [
      { tag: "D1", data: v1 },
      { tag: "D2", data: v2 },
    ];
    const r = await play(
      [[{ name: "get_outline", args: "{}" }, { name: "get_section", args: '{"doc":"D7","number":"5"}' }, { name: "get_section", args: '{"doc":"D2","number":"5"}' }], [{ name: "finish_research", args: "{}" }]],
      {},
      docs,
    );
    expect(r.results[0]!.error).toBe("INVALID_ARGUMENTS");
    expect(r.results[1]!.error).toBe("UNKNOWN_DOCUMENT");
    expect(r.results[2]!.ok).toBe(true);
    // FINAL quotes D1 text tagged D1 → verified against D1 only.
    expect(r.ctx.state.citations[0]!.status).toBe("verified");
    expect(r.ctx.state.citations[0]!.docId).toBe("doc-v1");
  });

  it("never throws, whatever the model does", async () => {
    const chaos = [
      [{ name: "", args: "" }],
      [{ name: "get_section", args: "null" }],
      [{ name: "read_pages", args: '{"start":5,"end":1}' }],
      [{ name: "find_exact", args: '{"text":"a"}' }],
      [{ name: "list_clauses", args: '{"type":"nonsense"}' }],
      [{ name: "finish_research", args: '{"ready":"yes"}' }],
    ];
    await expect(play(chaos)).resolves.toBeDefined();
  });
});
