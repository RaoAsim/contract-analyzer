import "server-only";
import {
  ApiError,
  FinishReason as GeminiFinish,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { parseWithSchema } from "./json";
import { geminiJsonSchema } from "./jsonSchema";
import type {
  AssistantMessage,
  CallOptions,
  ChatMessage,
  FinishReason,
  LlmUsage,
  StreamResult,
  ToolCall,
  ToolCallResult,
  ToolDef,
} from "./llm.types";
import { countTokens } from "./tokens";

/**
 * Gemini via the official Google Gen AI SDK (@google/genai), stateless `generateContent` /
 * `generateContentStream`: the app owns conversation history, so every call sends the full context.
 */

let client: GoogleGenAI | undefined;
const GENERATED_ID = "gc_";

function ai(): GoogleGenAI {
  if (!client) {
    const cfg = getConfig();
    client = new GoogleGenAI({
      apiKey: cfg.GEMINI_API_KEY,
      httpOptions: {
        // Overall cap only; first-token, stall and per-call limits are enforced below (and retried).
        timeout: 600_000,
        // SDK retries off: we retry ourselves so the UI can show a "retrying" notice (§14.4).
        retryOptions: { attempts: 1 },
        ...(cfg.GEMINI_BASE_URL ? { baseUrl: cfg.GEMINI_BASE_URL } : {}),
      },
    });
  }
  return client;
}

export function modelName(): string {
  return getConfig().GEMINI_MODEL;
}

export class LlmUnavailableError extends Error {
  readonly status?: number;
  /** Raw provider message — server-side decisions and logs only, never shown to users. */
  readonly detail: string;
  constructor(message: string, status?: number, detail = "") {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = status;
    this.detail = detail;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /abort/i.test(err.message));
}

/** Time limits (ms). A streamed answer must start within FIRST_TOKEN and never stall longer than STALL. */
const FIRST_TOKEN_MS = 45_000;
const STALL_MS = 60_000;
const CALL_MS = 60_000;
const TIMEOUT_MESSAGE = "The AI provider didn't respond in time. Please try again.";

class LlmTimeoutError extends Error {
  constructor(what: string) {
    super(what);
    this.name = "LlmTimeoutError";
  }
}

/** A per-attempt signal: the caller's signal (Stop) plus our own timer, which can be re-armed. */
function attemptSignal(caller: AbortSignal | undefined, ms: number): { signal: AbortSignal; rearm: (ms: number) => void; timedOut: () => boolean; done: () => void } {
  const own = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rearm = (t: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      own.abort(new LlmTimeoutError(`no response for ${Math.round(t / 1000)} s`));
    }, t);
  };
  rearm(ms);
  return {
    signal: caller ? AbortSignal.any([caller, own.signal]) : own.signal,
    rearm,
    timedOut: () => fired,
    done: () => timer && clearTimeout(timer),
  };
}

function retryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 408 || err.status === 429 || err.status >= 500;
  return !isAbortError(err) && err instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|socket|timeout|network/i.test(err.message);
}

/** Gemini puts the suggested delay in the error body (RetryInfo.retryDelay, e.g. "12s"). */
function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.message);
  return m ? Math.min(30_000, Number(m[1]) * 1000) : null;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function providerMessage(err: ApiError): string {
  if (err.status === 400 && /api key/i.test(err.message)) return "The AI provider rejected the API key.";
  if (err.status === 401 || err.status === 403) return "The AI provider rejected the API key.";
  if (err.status === 404) return "The configured Gemini model was not found. Check GEMINI_MODEL.";
  if (err.status === 429) return "The AI provider is rate-limiting requests (quota reached). Please try again shortly.";
  if (err.status >= 500) return "The AI provider is having problems. Please try again shortly.";
  return "The AI provider returned an error.";
}

/** 408/429/5xx → retry 3 times with exponential backoff (1 s, 2 s, 4 s) + jitter, honouring retryDelay. */
export async function withRetry<T>(fn: () => Promise<T>, opts: Pick<CallOptions, "signal" | "onRetry">, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Only the caller's own signal (Stop, disconnect, escalation) means "stop". Our timeouts retry.
      if (opts.signal?.aborted) throw err;
      const timeout = err instanceof LlmTimeoutError || isAbortError(err);
      if (attempt >= attempts || !(timeout || retryable(err))) {
        if (timeout) throw new LlmUnavailableError(TIMEOUT_MESSAGE, 504, err instanceof Error ? err.message : "timeout");
        if (err instanceof ApiError) throw new LlmUnavailableError(providerMessage(err), err.status, err.message);
        throw err;
      }
      const delay = retryAfterMs(err) ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 400);
      const status = err instanceof ApiError ? err.status : undefined;
      const why = timeout ? "timeout" : (status ?? (err instanceof Error ? err.message.slice(0, 80) : "error"));
      console.warn(`[llm] retry ${attempt + 1}/${attempts} in ${delay} ms (${why})`);
      opts.onRetry?.({ attempt: attempt + 1, delayMs: delay, status });
      await sleep(delay, opts.signal);
    }
  }
}

export function isToolsRejection(err: unknown): boolean {
  const status = err instanceof ApiError ? err.status : err instanceof LlmUnavailableError ? err.status : undefined;
  const msg = err instanceof LlmUnavailableError ? err.detail : err instanceof Error ? err.message : "";
  return status === 400 && /function|tool/i.test(msg);
}

// ---------------------------------------------------------------------------------------------
// Message conversion

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { raw };
  }
}

function toolResponse(content: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(content);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { output: v };
  } catch {
    return { output: content };
  }
}

/**
 * Our messages → Gemini `systemInstruction` + `contents`. Assistant turns with tool calls replay the
 * model's original parts (thought signatures); tool results become `functionResponse` parts in the
 * following user turn; adjacent same-role turns are merged.
 */
export function toGemini(messages: ChatMessage[]): { systemInstruction?: string; contents: Content[] } {
  const system: string[] = [];
  const contents: Content[] = [];
  const callNames = new Map<string, string>();
  const push = (role: "user" | "model", parts: Part[]): void => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts = [...(last.parts ?? []), ...parts];
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    switch (m.role) {
      case "system":
        system.push(m.content);
        break;
      case "user":
        push("user", [{ text: m.content }]);
        break;
      case "assistant": {
        for (const c of m.tool_calls ?? []) callNames.set(c.id, c.function.name);
        if (m.providerParts?.length) {
          push("model", m.providerParts as Part[]);
          break;
        }
        const parts: Part[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.tool_calls ?? []) {
          parts.push({ functionCall: { name: c.function.name, args: parseArgs(c.function.arguments), ...(c.id.startsWith(GENERATED_ID) ? {} : { id: c.id }) } });
        }
        push("model", parts);
        break;
      }
      case "tool":
        push("user", [
          {
            functionResponse: {
              name: callNames.get(m.tool_call_id) ?? "unknown_tool",
              response: toolResponse(m.content),
              ...(m.tool_call_id.startsWith(GENERATED_ID) ? {} : { id: m.tool_call_id }),
            },
          },
        ]);
        break;
    }
  }
  return { systemInstruction: system.length ? system.join("\n\n") : undefined, contents };
}

function toolDeclarations(tools: ToolDef[]): NonNullable<GenerateContentConfig["tools"]> {
  return [
    {
      functionDeclarations: tools.map((t) => {
        // Parameters are already Gemini-clean (geminiJsonSchema strips $schema and unsupported keywords).
        return { name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters };
      }),
    },
  ];
}

function finishOf(r: GenerateContentResponse | undefined): FinishReason | null {
  const f = r?.candidates?.[0]?.finishReason;
  if (!f) return r?.promptFeedback?.blockReason ? "blocked" : null;
  if (f === GeminiFinish.STOP) return "stop";
  if (f === GeminiFinish.MAX_TOKENS) return "length";
  if (f === GeminiFinish.RECITATION) return "recitation";
  if (f === GeminiFinish.SAFETY || f === GeminiFinish.BLOCKLIST || f === GeminiFinish.PROHIBITED_CONTENT || f === GeminiFinish.SPII) return "blocked";
  return String(f).toLowerCase();
}

function visibleText(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}

function usageOf(r: GenerateContentResponse | undefined, fallbackIn: number, fallbackOut: number): LlmUsage {
  const u = r?.usageMetadata;
  if (!u) return { inputTokens: fallbackIn, outputTokens: fallbackOut, calls: 1 };
  // Thinking tokens are billed as output.
  return { inputTokens: u.promptTokenCount ?? fallbackIn, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), calls: 1 };
}

/**
 * Base generation config. Thinking tokens count against maxOutputTokens, so the visible budget gets
 * headroom added, and the thinking level is kept low (configurable) for cost and latency.
 */
function baseConfig(opts: CallOptions, visibleMax: number, defaultTemp: number): GenerateContentConfig {
  const cfg = getConfig();
  return {
    temperature: opts.temperature ?? defaultTemp,
    maxOutputTokens: (opts.maxTokens ?? visibleMax) + cfg.GEMINI_THINKING_HEADROOM_TOKENS,
    ...(cfg.GEMINI_THINKING_LEVEL !== "default" ? { thinkingConfig: { thinkingLevel: ThinkingLevel[cfg.GEMINI_THINKING_LEVEL] } } : {}),
    abortSignal: opts.signal,
  };
}

function logStart(label: string, estimatedInput: number): void {
  const cfg = getConfig();
  console.log(`[llm] ${label} start model=${modelName()} in≈${estimatedInput} thinking=${cfg.GEMINI_THINKING_LEVEL}`);
}

function logFailure(label: string, started: number, err: unknown): void {
  const status = err instanceof ApiError || err instanceof LlmUnavailableError ? ` status=${err.status}` : "";
  const detail = err instanceof LlmUnavailableError ? err.detail || err.message : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.warn(`[llm] ${label} FAILED after ${Date.now() - started}ms${status}: ${detail.slice(0, 240)}`);
}

/** Connectivity check for /api/health?llm=1: model metadata (no generation, no token cost). */
export async function pingModel(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await ai().models.get({ model: modelName(), config: { abortSignal: AbortSignal.timeout(15_000) } });
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.status}: ${providerMessage(err)}` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ok: false, ms: Date.now() - started, error: msg.slice(0, 200) };
  }
}

function logCall(label: string, usage: LlmUsage, ms: number, extra = ""): void {
  // Model, tokens and timing only — never prompts, document text or keys (§17).
  console.log(`[llm] ${label} model=${modelName()} in=${usage.inputTokens} out=${usage.outputTokens} ${ms}ms${extra}`);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += countTokens(m.content) + 4;
    if (m.role === "assistant") for (const t of m.tool_calls ?? []) n += countTokens(t.function.arguments) + 8;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Calls

/** Streamed completion. `onDelta` receives visible text (never thoughts) as it arrives. */
export async function streamChat(messages: ChatMessage[], onDelta: (t: string) => void, opts: CallOptions): Promise<StreamResult> {
  const started = Date.now();
  const { systemInstruction, contents } = toGemini(messages);
  let text = "";
  let last: GenerateContentResponse | undefined;
  let usageChunk: GenerateContentResponse | undefined;
  let chunks = 0;
  let firstAt = 0;
  logStart(opts.label, estimateMessagesTokens(messages));
  let guard = attemptSignal(opts.signal, FIRST_TOKEN_MS);
  let stream: AsyncGenerator<GenerateContentResponse>;
  try {
    stream = await withRetry(async () => {
      guard.done();
      guard = attemptSignal(opts.signal, FIRST_TOKEN_MS); // fresh timer for each attempt
      try {
        return await ai().models.generateContentStream({
          model: modelName(),
          contents,
          config: { ...baseConfig(opts, 1800, 0.1), systemInstruction, abortSignal: guard.signal },
        });
      } catch (err) {
        throw guard.timedOut() ? new LlmTimeoutError(`no response headers within ${FIRST_TOKEN_MS / 1000} s`) : err;
      }
    }, opts);
  } catch (err) {
    guard.done();
    if (!opts.signal?.aborted) logFailure(opts.label, started, err);
    throw err;
  }
  try {
    for await (const chunk of stream) {
      // Any chunk (thoughts included) proves the model is alive: re-arm the stall timer.
      guard.rearm(STALL_MS);
      chunks++;
      if (!firstAt) firstAt = Date.now() - started;
      const delta = visibleText(chunk.candidates?.[0]?.content?.parts);
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (chunk.candidates?.[0]?.finishReason || chunk.promptFeedback?.blockReason) last = chunk;
      if (chunk.usageMetadata) usageChunk = chunk;
    }
  } catch (err) {
    const stalled = guard.timedOut() && !opts.signal?.aborted;
    if (opts.signal?.aborted) console.log(`[llm] ${opts.label} cancelled after ${Date.now() - started}ms (${chunks} chunks)`);
    else logFailure(opts.label, started, stalled ? new LlmTimeoutError(`stream stalled for ${STALL_MS / 1000} s after ${chunks} chunks`) : err);
    if (stalled) throw new LlmUnavailableError(TIMEOUT_MESSAGE, 504, "stream stalled");
    if (err instanceof ApiError) throw new LlmUnavailableError(providerMessage(err), err.status, err.message);
    throw err;
  } finally {
    guard.done();
  }
  const u = usageOf(usageChunk, estimateMessagesTokens(messages), countTokens(text));
  logCall(opts.label, u, Date.now() - started, ` first=${firstAt}ms chunks=${chunks} finish=${finishOf(last) ?? "none"}${opts.signal?.aborted ? " (stopped)" : ""}`);
  if (chunks === 0 || (!text && finishOf(last) !== "stop")) {
    console.warn(`[llm] ${opts.label} returned no text (chunks=${chunks}, finish=${finishOf(last) ?? "none"}, block=${last?.promptFeedback?.blockReason ?? "-"})`);
  }
  return { text, usage: u, finishReason: finishOf(last) };
}

/** Non-streaming JSON output constrained by the zod schema (responseJsonSchema), validated; one retry with the error. */
export async function chatJson<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: CallOptions): Promise<{ value: T; usage: LlmUsage }> {
  const total: LlmUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const jsonSchema = geminiJsonSchema(schema);
  let convo = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    const { systemInstruction, contents } = toGemini(convo);
    const resp = await withRetry(() => {
      const g = attemptSignal(opts.signal, CALL_MS);
      return ai()
        .models.generateContent({
          model: modelName(),
          contents,
          config: { ...baseConfig(opts, 1200, 0), systemInstruction, responseMimeType: "application/json", responseJsonSchema: jsonSchema, abortSignal: g.signal },
        })
        .catch((err: unknown) => {
          throw g.timedOut() ? new LlmTimeoutError(`no response within ${CALL_MS / 1000} s`) : err;
        })
        .finally(g.done);
    }, opts).catch((err: unknown) => {
      logFailure(opts.label, started, err);
      throw err;
    });
    const content = visibleText(resp.candidates?.[0]?.content?.parts);
    const u = usageOf(resp, estimateMessagesTokens(convo), countTokens(content));
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.calls += 1;
    logCall(opts.label, u, Date.now() - started, attempt > 0 ? " (retry)" : "");
    const parsed = parseWithSchema(content, schema);
    if (parsed.ok) return { value: parsed.value, usage: total };
    if (attempt === 0) {
      convo = [
        ...messages,
        { role: "assistant", content },
        { role: "user", content: `${parsed.error} Reply again with ONLY the corrected JSON object.` },
      ];
      continue;
    }
    throw new Error(`Invalid JSON from model: ${parsed.error}`);
  }
  throw new Error("unreachable");
}

/** Non-streaming call with function declarations (agent research rounds, §14.3). */
export async function chatWithTools(messages: ChatMessage[], tools: ToolDef[], opts: CallOptions): Promise<ToolCallResult> {
  const started = Date.now();
  const { systemInstruction, contents } = toGemini(messages);
  const resp = await withRetry(() => {
    const g = attemptSignal(opts.signal, CALL_MS);
    return ai()
      .models.generateContent({
        model: modelName(),
        contents,
        config: {
          ...baseConfig(opts, 1200, 0.1),
          systemInstruction,
          tools: toolDeclarations(tools),
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
          abortSignal: g.signal,
        },
      })
      .catch((err: unknown) => {
        throw g.timedOut() ? new LlmTimeoutError(`no response within ${CALL_MS / 1000} s`) : err;
      })
      .finally(g.done);
  }, opts).catch((err: unknown) => {
    logFailure(opts.label, started, err);
    throw err;
  });
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  let n = 0;
  const tool_calls: ToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({
      id: p.functionCall!.id ?? `${GENERATED_ID}${Date.now().toString(36)}_${n++}`,
      type: "function" as const,
      function: { name: p.functionCall!.name!, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
    }));
  const message: AssistantMessage = {
    role: "assistant",
    content: visibleText(parts) || null,
    ...(tool_calls.length ? { tool_calls } : {}),
    providerParts: parts,
  };
  const usage = usageOf(resp, estimateMessagesTokens(messages), countTokens(message.content ?? ""));
  logCall(opts.label, usage, Date.now() - started, ` tools=${tool_calls.length}`);
  return { message, usage, finishReason: tool_calls.length ? "tool_calls" : finishOf(resp) };
}
