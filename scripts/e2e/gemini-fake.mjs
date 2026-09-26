// Minimal Gemini REST double: models/{model}:generateContent and :streamGenerateContent?alt=sse.
// Converts the Gemini request into OpenAI-shaped messages so the scripted replies can be reused.
export const geminiLog = [];

const ROUTE = /^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/;

function toMessages(body) {
  const messages = [];
  const sys = (body.systemInstruction?.parts ?? []).map((x) => x.text).join("\n");
  if (sys) messages.push({ role: "system", content: sys });
  for (const c of body.contents ?? []) {
    const texts = (c.parts ?? []).filter((x) => typeof x.text === "string").map((x) => x.text).join("");
    if (c.role === "model") {
      const calls = (c.parts ?? [])
        .filter((x) => x.functionCall)
        .map((x, i) => ({ id: x.functionCall.id ?? `g${i}`, type: "function", function: { name: x.functionCall.name, arguments: JSON.stringify(x.functionCall.args ?? {}) } }));
      messages.push({ role: "assistant", content: texts || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const x of c.parts ?? []) if (x.functionResponse) messages.push({ role: "tool", content: JSON.stringify(x.functionResponse.response) });
      if (texts) messages.push({ role: "user", content: texts });
    }
  }
  return messages;
}

export async function handleGemini(req, res, raw, path, { agentReply, jsonReply, answerText, log, send }) {
  const m = ROUTE.exec(path);
  if (!m) return false;
  if (!req.headers["x-goog-api-key"]) {
    send(res, 403, { error: { code: 403, message: "API key missing", status: "PERMISSION_DENIED" } });
    return true;
  }
  const body = JSON.parse(raw.toString());
  geminiLog.push(body);
  const messages = toMessages(body);
  const usageMetadata = { promptTokenCount: Math.ceil(raw.length / 4), candidatesTokenCount: 60, thoughtsTokenCount: 12, totalTokenCount: Math.ceil(raw.length / 4) + 72 };
  const cand = (parts, finishReason = "STOP") => ({ candidates: [{ content: { role: "model", parts }, finishReason, index: 0 }], usageMetadata, modelVersion: m[1] });

  if (body.tools) {
    // Real Gemini 3 needs model turns replayed with their thought signatures: enforce that here.
    const replayed = (body.contents ?? []).filter((c) => c.role === "model" && c.parts?.some((x) => x.functionCall));
    if (replayed.some((c) => !c.parts.some((x) => x.thoughtSignature))) {
      send(res, 400, { error: { code: 400, message: "Function call is missing a thought_signature in functionCall parts.", status: "INVALID_ARGUMENT" } });
      return true;
    }
    const calls = agentReply(messages);
    log("gemini agent round →", calls.map((c) => c.function.name).join(","));
    send(res, 200, cand(calls.map((c, i) => ({ functionCall: { name: c.function.name, args: JSON.parse(c.function.arguments) }, ...(i === 0 ? { thoughtSignature: "c2lnLTE=" } : {}) }))));
    return true;
  }

  if (m[2] === "generateContent") {
    const gc = body.generationConfig ?? {};
    if (gc.responseMimeType !== "application/json" || !gc.responseJsonSchema) log("WARN json call without responseJsonSchema");
    send(res, 200, cand([{ text: JSON.stringify(jsonReply(messages)) }]));
    return true;
  }

  const text = answerText(messages);
  log("gemini stream", text.slice(0, 80).replace(/\n/g, " "));
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let closed = false;
  res.on("close", () => (closed = true));
  const pieces = text.match(/.{1,6}/gs) ?? [];
  const slow = /slow/i.test(JSON.stringify(body.contents?.at(-1) ?? ""));
  for (const [i, piece] of pieces.entries()) {
    if (closed) return true;
    const lastPiece = i === pieces.length - 1;
    const chunk = {
      candidates: [{ content: { role: "model", parts: [{ text: piece }] }, index: 0, ...(lastPiece ? { finishReason: "STOP" } : {}) }],
      ...(lastPiece ? { usageMetadata } : {}),
    };
    res.write(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
    await new Promise((r) => setTimeout(r, slow ? 120 : 15));
  }
  res.end();
  return true;
}
