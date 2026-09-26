import { distance as levenshtein } from "fastest-levenshtein";
import { jsonrepair } from "jsonrepair";
import type { AnyTool, RawToolCall, ToolEnv, ToolPayload, ToolResult } from "./agent.types";
import { TOOL_NAMES, TOOLS } from "./tools";

const byName = new Map(TOOLS.map((t) => [t.name, t]));

function simplify(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, "");
}

/** One case/underscore-insensitive suggestion (shared prefix or small edit distance). Never auto-executed. */
function didYouMean(name: string): string | undefined {
  const q = simplify(name);
  if (!q) return undefined;
  let best: { n: string; score: number } | undefined;
  for (const n of TOOL_NAMES) {
    const t = simplify(n);
    let prefix = 0;
    while (prefix < Math.min(q.length, t.length) && q[prefix] === t[prefix]) prefix++;
    const score = t.includes(q) || q.includes(t) ? 0 : prefix >= 5 ? 1 : levenshtein(q, t) <= Math.max(2, Math.floor(t.length * 0.3)) ? 2 : 99;
    if (score < 99 && (!best || score < best.score)) best = { n, score };
  }
  return best?.n;
}

/** Canonical JSON (sorted keys) for duplicate detection. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const src = raw.trim() === "" ? "{}" : raw;
  try {
    return { ok: true, value: JSON.parse(src) };
  } catch (e1) {
    try {
      return { ok: true, value: JSON.parse(jsonrepair(src)) };
    } catch {
      return { ok: false, message: e1 instanceof Error ? e1.message : "parse error" };
    }
  }
}

function coerce(tool: AnyTool, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const f of tool.numberFields ?? []) {
    const v = out[f];
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[f] = Number(v);
  }
  for (const f of tool.stringFields ?? []) {
    const v = out[f];
    if (typeof v === "number") out[f] = String(v);
  }
  if (typeof out.doc === "number") out.doc = `D${out.doc}`;
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new Error("__TOOL_TIMEOUT__")), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export type DispatchContext = {
  env: ToolEnv;
  /** name + canonical args → earlier result (duplicate calls). */
  cache: Map<string, ToolResult>;
  toolTimeoutMs: number;
  scanTimeoutMs: number;
};

/**
 * Validate and execute one tool call (§14.4). Never throws: every failure becomes a result the
 * model can read and recover from.
 */
export async function dispatch(call: RawToolCall, dc: DispatchContext): Promise<ToolResult & { args: unknown }> {
  // 1. Unknown tool → list the available ones; one "did you mean", never auto-executed.
  const tool = byName.get(call.name);
  if (!tool) {
    const guess = didYouMean(call.name);
    return {
      ok: false,
      errorCode: "UNKNOWN_TOOL",
      payload: { error: "UNKNOWN_TOOL", message: `No tool named '${call.name}'. Available: ${TOOL_NAMES.join(", ")}.`, did_you_mean: guess },
      summary: `Unknown tool "${call.name}"${guess ? ` — did you mean ${guess}?` : ""}`,
      args: call.arguments,
    };
  }

  // 2. Arguments that aren't valid JSON → jsonrepair → INVALID_JSON.
  const parsed = parseArgs(call.arguments);
  if (!parsed.ok) {
    return {
      ok: false,
      errorCode: "INVALID_JSON",
      payload: { error: "INVALID_JSON", message: `Arguments were not valid JSON: ${parsed.message}`, expected: tool.expected },
      summary: "Arguments were not valid JSON",
      args: call.arguments,
    };
  }
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
    return {
      ok: false,
      errorCode: "INVALID_ARGUMENTS",
      payload: { error: "INVALID_ARGUMENTS", issues: [{ path: "(root)", message: "Arguments must be a JSON object" }], expected: tool.expected },
      summary: "Arguments must be an object",
      args: parsed.value,
    };
  }

  // 3. Invented keys: strip and report, don't fail.
  const raw = parsed.value as Record<string, unknown>;
  const ignored = Object.keys(raw).filter((k) => !tool.keys.includes(k));
  const kept = Object.fromEntries(Object.entries(raw).filter(([k]) => tool.keys.includes(k)));

  // 4. Coerce obvious cases, then validate.
  const v = tool.schema.safeParse(coerce(tool, kept));
  if (!v.success) {
    const issues = v.error.issues.slice(0, 5).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
    return {
      ok: false,
      errorCode: "INVALID_ARGUMENTS",
      payload: { error: "INVALID_ARGUMENTS", issues, expected: tool.expected, ...(ignored.length ? { ignored_args: ignored } : {}) },
      summary: `Invalid arguments: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`.slice(0, 160),
      args: kept,
    };
  }
  const args = v.data;

  // 6. Duplicate call → cached result (still counts against the cap; the caller claimed it).
  const key = `${tool.name}:${canonicalJson(args)}`;
  const cached = dc.cache.get(key);
  if (cached) {
    return { ...cached, payload: { ...cached.payload, note: "Duplicate call — same result as before." }, summary: `${cached.summary} (duplicate call)`, args };
  }

  // 5 + 7. Semantic validation lives in the tool; execution is time-limited and never throws.
  const timeout = tool.pausesClock ? dc.scanTimeoutMs : dc.toolTimeoutMs;
  let result: ToolResult;
  try {
    const exec = (): Promise<ToolResult> => withTimeout(tool.run(args, dc.env), timeout);
    result = tool.pausesClock ? await dc.env.ledger.paused(exec) : await exec();
  } catch (e) {
    if (e instanceof Error && e.message === "__TOOL_TIMEOUT__") {
      result = { ok: false, errorCode: "TOOL_TIMEOUT", payload: { error: "TOOL_TIMEOUT", message: "The tool timed out. Nothing was searched." }, summary: "Timed out — nothing was searched" };
    } else {
      console.error(`[agent] tool ${tool.name} failed:`, e instanceof Error ? e.message : e);
      result = { ok: false, errorCode: "TOOL_FAILED", payload: { error: "TOOL_FAILED", message: "The tool failed unexpectedly. Try a different approach." }, summary: "Tool failed" };
    }
  }
  if (ignored.length) result = { ...result, payload: { ...result.payload, ignored_args: ignored } };
  if (result.ok || result.errorCode === "SECTION_NOT_FOUND" || result.errorCode === "PAGE_OUT_OF_RANGE") dc.cache.set(key, result);
  return { ...result, args };
}

/** Fit the WHOLE serialized envelope into `max` chars: trim lowest-ranked items first, mark truncation (§14.2). */
export function fitResult(payload: ToolPayload, max: number): string {
  let json = JSON.stringify(payload);
  if (json.length <= max) return json;
  const p: ToolPayload = structuredClone(payload);
  const available = json.length;
  const arrays = ["hits", "matches", "pages", "clauses", "findings", "sections"];
  for (let guard = 0; guard < 500 && json.length > max; guard++) {
    const arr = arrays.map((k) => [k, p[k]] as const).find(([, v]) => Array.isArray(v) && v.length > 1);
    if (arr) {
      (arr[1] as unknown[]).pop();
      p.truncated = true;
    } else if (typeof p.text === "string" && p.text.length > 200) {
      p.text = `${p.text.slice(0, Math.floor(p.text.length * 0.8))}…`;
      p.truncated = true;
    } else {
      // Shrink long strings inside the remaining single item.
      const single = arrays.map((k) => p[k]).find((v) => Array.isArray(v) && v.length === 1) as Record<string, unknown>[] | undefined;
      const item = single?.[0];
      const longKey = item && Object.keys(item).find((k) => typeof item[k] === "string" && (item[k] as string).length > 200);
      if (item && longKey) {
        item[longKey] = `${(item[longKey] as string).slice(0, Math.floor((item[longKey] as string).length * 0.7))}…`;
        p.truncated = true;
      } else break;
    }
    p.chars_available = available;
    json = JSON.stringify(p);
  }
  // Never send invalid JSON: fall back to a small envelope that says what happened.
  return json.length <= max
    ? json
    : JSON.stringify({ error: "RESULT_TOO_LARGE", truncated: true, chars_available: available, hint: "Ask for a narrower range (a smaller section, fewer pages or a more specific query)." });
}
