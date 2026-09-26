import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolSchemas } from "@/lib/agent/tools";
import { toGemini } from "@/lib/llm/client";
import { geminiJsonSchema } from "@/lib/llm/jsonSchema";
import type { ChatMessage } from "@/lib/llm/llm.types";

describe("toGemini (message conversion)", () => {
  it("system messages become systemInstruction; assistant → model", () => {
    const r = toGemini([
      { role: "system", content: "rules A" },
      { role: "system", content: "rules B" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
    expect(r.systemInstruction).toBe("rules A\n\nrules B");
    expect(r.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(r.contents[1]!.parts).toEqual([{ text: "a1" }]);
  });

  it("replays the model's raw parts (thought signatures) and groups tool results into one user turn", () => {
    const raw = [
      { functionCall: { name: "get_outline", args: {} }, thoughtSignature: "SIG-1" },
      { functionCall: { name: "search_document", args: { query: "cap" } } },
    ];
    const msgs: ChatMessage[] = [
      { role: "user", content: "What is the cap?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "gc_a_0", type: "function", function: { name: "get_outline", arguments: "{}" } },
          { id: "gc_a_1", type: "function", function: { name: "search_document", arguments: '{"query":"cap"}' } },
        ],
        providerParts: raw,
      },
      { role: "tool", tool_call_id: "gc_a_0", content: '{"sections":[]}' },
      { role: "tool", tool_call_id: "gc_a_1", content: "not json" },
      { role: "user", content: "(Budget: 3 rounds left.)" },
    ];
    const r = toGemini(msgs);
    expect(r.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(r.contents[1]!.parts).toBe(raw);
    expect(r.contents[1]!.parts![0]!.thoughtSignature).toBe("SIG-1");
    const resp = r.contents[2]!.parts!;
    expect(resp[0]!.functionResponse).toEqual({ name: "get_outline", response: { sections: [] } });
    expect(resp[1]!.functionResponse).toEqual({ name: "search_document", response: { output: "not json" } });
    expect(resp[2]!.text).toBe("(Budget: 3 rounds left.)");
  });

  it("keeps provider call ids on function responses", () => {
    const r = toGemini([
      { role: "user", content: "q" },
      { role: "assistant", content: null, tool_calls: [{ id: "abc123", type: "function", function: { name: "get_outline", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "abc123", content: "{}" },
    ]);
    expect(r.contents[1]!.parts![0]!.functionCall).toEqual({ name: "get_outline", args: {}, id: "abc123" });
    expect(r.contents[2]!.parts![0]!.functionResponse!.id).toBe("abc123");
  });
});

describe("geminiJsonSchema", () => {
  it("keeps only keywords Gemini supports", () => {
    const s = geminiJsonSchema(
      z.object({
        quote: z.string().max(2000),
        why: z.string().max(500).default(""),
        n: z.number().int().min(1).max(8),
        kind: z.enum(["a", "b"]),
        list: z.array(z.string()).max(6),
      }),
    );
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"\$schema"|"maxLength"|"default"|"exclusiveMinimum"/);
    expect(s.required).toEqual(["quote", "n", "kind", "list"]);
    expect((s.properties as Record<string, { enum?: string[]; maxItems?: number }>).kind!.enum).toEqual(["a", "b"]);
    expect((s.properties as Record<string, { maxItems?: number }>).list!.maxItems).toBe(6);
  });

  it("every agent tool schema is Gemini-compatible", () => {
    for (const t of toolSchemas()) {
      expect(JSON.stringify(t.function.parameters)).not.toMatch(/"maxLength"|"minLength"|"default"|"pattern"/);
      expect(t.function.parameters.type).toBe("object");
    }
  });
});
