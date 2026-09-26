import "dotenv/config";
import { z } from "zod";
import { chatJson, chatWithTools, modelName, streamChat } from "@/lib/llm/client";
import type { ChatMessage, ToolDef } from "@/lib/llm/llm.types";
import { geminiJsonSchema } from "@/lib/llm/jsonSchema";

/**
 * Live check of the Gemini integration with the app's own client: JSON output, streaming, and a
 * two-round function call (the model turn is replayed with its thought signature). Costs a few
 * hundred tokens.
 */
async function main(): Promise<void> {
  console.log(`model: ${modelName()}`);

  const json = await chatJson(
    [{ role: "user", content: 'Return JSON {"answer": number, "unit": string} for: how many days are in a leap year?' }],
    z.object({ answer: z.number(), unit: z.string() }),
    { label: "smoke-json" },
  );
  console.log(`JSON ok: ${JSON.stringify(json.value)} (in=${json.usage.inputTokens} out=${json.usage.outputTokens})`);

  let streamed = "";
  let deltas = 0;
  const s = await streamChat(
    [
      { role: "system", content: "Answer in one short sentence." },
      { role: "user", content: 'Quote this exactly inside <quote doc="D1"></quote> tags: "The Supplier shall not exceed AED 100,000."' },
    ],
    (d) => {
      streamed += d;
      deltas++;
    },
    { label: "smoke-stream" },
  );
  console.log(`Stream ok: ${deltas} deltas, finish=${s.finishReason}: ${JSON.stringify(streamed.slice(0, 160))}`);

  const tools: ToolDef[] = [
    {
      type: "function",
      function: {
        name: "get_section",
        description: "Read a contract section by its number.",
        parameters: geminiJsonSchema(z.object({ number: z.string().min(1).max(20) })),
      },
    },
  ];
  const msgs: ChatMessage[] = [
    { role: "system", content: "You research contracts using tools. Call get_section before answering." },
    { role: "user", content: "What does section 12.3 say?" },
  ];
  const r1 = await chatWithTools(msgs, tools, { label: "smoke-tools-1" });
  const call = r1.message.tool_calls?.[0];
  console.log(`Tools round 1: ${call ? `${call.function.name}(${call.function.arguments})` : `no call: ${r1.message.content}`}`);
  if (!call) throw new Error("the model did not call the tool");
  msgs.push(r1.message);
  msgs.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ text: "12.3 The total liability of the Supplier shall not exceed AED 100,000." }) });
  const r2 = await chatWithTools(msgs, tools, { label: "smoke-tools-2" });
  console.log(`Tools round 2 (replayed turn accepted): ${JSON.stringify((r2.message.content ?? "").slice(0, 160))}`);
  console.log("\nGemini integration OK");
}

main().catch((err: unknown) => {
  console.error("Gemini smoke test FAILED:", err instanceof Error ? `${err.message}${"detail" in err ? ` — ${String((err as { detail: string }).detail).slice(0, 300)}` : ""}` : err);
  process.exit(1);
});
