import { jsonrepair } from "jsonrepair";
import type { z } from "zod";

/** Tolerant JSON parse of model output: strips code fences / prose, then jsonrepair (§4). */
export function parseLooseJson(raw: string): unknown {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1]!.trim();
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first);
  const lastObj = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastObj >= 0 && lastObj < s.length - 1) s = s.slice(0, lastObj + 1);
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(jsonrepair(s));
  }
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse + validate. The error string is fed back to the model on the one retry. */
export function parseWithSchema<T>(raw: string, schema: z.ZodType<T>): ParseOutcome<T> {
  let data: unknown;
  try {
    data = parseLooseJson(raw);
  } catch (e) {
    return { ok: false, error: `Output was not valid JSON (${e instanceof Error ? e.message : "parse error"}).` };
  }
  const r = schema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `JSON did not match the required shape: ${issues.join("; ")}` };
}
