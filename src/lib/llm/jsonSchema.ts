import { z } from "zod";

/**
 * JSON Schema keywords Gemini accepts in `responseJsonSchema` / `parametersJsonSchema`
 * (per @google/genai GenerationConfig docs). Everything else (maxLength, pattern, default, $schema,
 * exclusiveMinimum…) is removed — zod still validates the output on our side.
 */
const ALLOWED = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items",
  "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties",
  "additionalProperties", "required", "propertyOrdering",
]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue;
    if (k === "properties" || k === "$defs") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, clean(pv)]));
    } else if (k === "enum") {
      // Gemini supports enum for strings and numbers only.
      out[k] = (v as unknown[]).filter((x) => typeof x === "string" || typeof x === "number");
    } else if (k === "additionalProperties" && typeof v !== "boolean") {
      out[k] = clean(v);
    } else {
      out[k] = typeof v === "object" ? clean(v) : v;
    }
  }
  return out;
}

/** zod → Gemini-compatible JSON Schema. `io: "input"` makes defaulted fields optional for the model. */
export function geminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as Record<string, unknown>;
}
