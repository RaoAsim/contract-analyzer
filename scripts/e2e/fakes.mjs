// Local stand-ins for Supabase Storage and the Gemini API, for the end-to-end harness only.
// The "LLM" is scripted: it picks sentences by keyword overlap, so answers are placeholder text.
import http from "node:http";
import { geminiLog, handleGemini } from "./gemini-fake.mjs";

const PORT = Number(process.env.FAKES_PORT ?? 5544);
const objects = new Map(); // "bucket/path" -> { body: Buffer, type }
process.on("SIGTERM", () => process.exit(0));
const buckets = new Map([["documents", { id: "documents", name: "documents", public: false }]]);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const STOP = new Set("the a an and or of to in for on by with is are was were be this that what which who how does do can could should would may might must shall will there their it its as at from into about any all each every under than then also not no if but so such me tell please agreement contract document have has say says said about clause clauses".split(" "));
const words = (s) => [...new Set((s.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
const stem = (w) => w.replace(/(es|s)$/, "").slice(0, 5);

function sentences(text) {
  return text
    // PDF text wraps mid-sentence: join single line breaks unless the next line starts a clause/heading.
    // A sentence that continues after a page break (blank lines, then lowercase) is one sentence.
    .replace(/([^.;:\n])\s*\n\s*\n\s*(?=[a-z])/g, "$1 ")
    .replace(/([^\n])\n(?!\n|──|\d+(\.\d+)*\s)/g, "$1 ")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.;])\s+(?=[A-Z“"(])/))
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6 && !s.startsWith("──") && !/^(OUTLINE|EXCERPTS)/.test(s) && !/\.{4,}/.test(s));
}

function best(text, question, n = 2) {
  const q = words(question).map(stem);
  if (q.length === 0) return [];
  return sentences(text)
    .map((s) => ({ s, score: new Set(words(s).map(stem).filter((w) => q.includes(w))).size }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.length - a.s.length)
    .slice(0, n)
    .map((x) => x.s.replace(/^\s*\d+(\.\d+)*\s+/, "").slice(0, 400));
}

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return String(messages[i].content ?? "");
  return "";
}

function jsonReply(messages) {
  const p = lastUser(messages);
  if (p.includes("Rewrite a question about a contract into search queries")) {
    const q = /Question: (.*)$/s.exec(p)?.[1] ?? "";
    const w = words(q);
    return { queries: [w.join(" "), ...w.slice(0, 2)].filter(Boolean).slice(0, 3), sections: [], topic: w.slice(0, 4).join(" ") || "this question" };
  }
  if (p.includes("You are reading one part of a contract")) {
    const q = /Question: (.*?)\nText \(part/s.exec(p)?.[1] ?? "";
    const t = /<text>([\s\S]*)<\/text>/.exec(p)?.[1] ?? "";
    const hits = best(t, q, 2).filter((s) => s.split(/\s+/).length >= 8);
    return { relevant: hits.length > 0, findings: hits.map((quote) => ({ quote, why: "mentions the topic" })) };
  }
  if (p.includes("Name what this question about a contract is looking for")) {
    return { topic: words(/Question: (.*)$/s.exec(p)?.[1] ?? "").slice(0, 4).join(" ") || "this" };
  }
  if (p.includes("You compare two versions of a contract")) {
    const blocks = p.split(/\n### /).slice(1);
    return {
      changes: blocks.map((b) => {
        const id = /^(C\d+)/.exec(b)?.[1] ?? "C0";
        const facts = /Extracted facts: (.*)$/m.exec(b)?.[1] ?? "none";
        const sig = /money|jurisdiction/.test(facts) ? "critical" : /duration|modality|negation/.test(facts) ? "major" : /\(added\)|\(removed\)/.test(b) ? "minor" : "cosmetic";
        return { id, significance: sig, category: "other", summary: facts === "none" ? "The wording was rephrased without changing its meaning." : `Changed: ${facts}.`, favours: "unclear" };
      }),
    };
  }
  if (p.includes("Write an executive summary")) {
    const ids = [...p.matchAll(/^(C\d+) \| (\w+) \| \w+ \| (.*?) \|/gm)].slice(0, 5);
    return { bullets: ids.map((m) => `${m[3]} [${m[1]}]`) };
  }
  return {};
}

/** Scripted agent: outline → search (+ one invented tool) → section → finish. */
function agentReply(messages) {
  const toolMsgs = messages.filter((m) => m.role === "tool");
  // The current question: the last user message that isn't a budget/wind-down note.
  const q = String([...messages].reverse().find((m) => m.role === "user" && !/^(\(Budget|Last research round|This call keeps|Your last response)/.test(String(m.content)))?.content ?? "");
  const call = (name, args) => ({ id: `call_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  // Research rounds in THIS run = assistant messages with tool calls after the last plain user question.
  const rounds = messages.filter((m) => m.role === "assistant" && m.tool_calls?.length).length;
  if (rounds === 0) return [call("get_outline", {})];
  if (rounds === 1) return [call("search_document", { query: words(q).join(" ") || q.slice(0, 50), limit: 3 }), call("search_docs", { query: "x" })];
  if (rounds === 2) {
    const last = toolMsgs.map((m) => { try { return JSON.parse(m.content); } catch { return {}; } }).find((r) => Array.isArray(r.hits));
    const sec = last?.hits?.[0]?.section?.split(" ")[0];
    if (sec) return [call("get_section", { number: sec })];
  }
  return [call("finish_research", { ready: true })];
}

function answerText(messages) {
  const all = messages.map((m) => String(m.content ?? "")).join("\n");
  const q = /Question: (.*)$/s.exec(lastUser(messages))?.[1]?.trim() ?? "";
  const docs = [...all.matchAll(/<document tag="(D\d)" name="([^"]*)" coverage="([^"]*)">([\s\S]*?)<\/document>/g)];
  if (all.includes("THIS IS A GENERAL QUESTION ABOUT THE CONTRACT")) {
    // Overview: quote a few substantive sentences from the opening of each document.
    const bullets = docs.flatMap(([, tag, , , body]) =>
      sentences(body.split("OPENING OF THE DOCUMENT")[1] ?? body)
        .filter((x) => /shall|means|may/.test(x))
        .slice(0, 3)
        .map((x) => `- <quote doc="${tag}">${x.replace(/^\s*\d+(\.\d+)*\s+/, "").slice(0, 300)}</quote>`),
    );
    return `Overview of the contract:\n\n${bullets.join("\n")}\n\nAsk about any clause to go deeper.`;
  }
  const parts = [];
  for (const [, tag, name, , body] of docs) {
    const hits = best(body, q, 1);
    if (hits.length) parts.push(`- **${name}**: <quote doc="${tag}">${hits[0]}</quote>`);
  }
  if (parts.length === 0) return `[[NOT_FOUND]]\nI looked for anything about "${words(q).join(" ")}".`;
  let out = `Here is what the ${docs.length > 1 ? "documents say" : "document says"}:\n\n${parts.join("\n")}`;
  if (/test unverified/i.test(q)) out += `\n- A paraphrase for testing: <quote doc="D1">The parties agree that the supplier is liable for everything without limit.</quote>`;
  return out;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ---- Supabase Storage ----
  if (p.startsWith("/storage/v1/")) {
    const rest = p.slice("/storage/v1/".length);
    if (rest.startsWith("bucket")) {
      const id = rest.split("/")[1];
      if (req.method === "GET" && id) return buckets.has(id) ? send(res, 200, buckets.get(id)) : send(res, 404, { statusCode: "404", error: "not_found", message: "Bucket not found" });
      if (req.method === "POST") {
        const b = JSON.parse(raw.toString() || "{}");
        buckets.set(b.name ?? b.id, { id: b.id ?? b.name, name: b.name ?? b.id, public: !!b.public });
        return send(res, 200, { name: b.name });
      }
    }
    if (rest.startsWith("object/")) {
      const key = decodeURIComponent(rest.slice("object/".length));
      if (req.method === "POST" || req.method === "PUT") {
        let body = raw;
        const ct = req.headers["content-type"] ?? "";
        if (ct.startsWith("multipart/form-data")) {
          const boundary = /boundary=(.*)$/.exec(ct)?.[1];
          const s = raw.toString("latin1");
          const start = s.indexOf("\r\n\r\n") + 4;
          const end = s.lastIndexOf(`\r\n--${boundary}`);
          body = Buffer.from(s.slice(start, end), "latin1");
        }
        objects.set(key, { body, type: ct });
        log("storage PUT", key, body.length);
        return send(res, 200, { Key: key, Id: key });
      }
      if (req.method === "GET") {
        const o = objects.get(key);
        if (!o) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        return send(res, 200, o.body, "application/octet-stream");
      }
      if (req.method === "DELETE") {
        const bucket = key.split("/")[0];
        const { prefixes = [] } = JSON.parse(raw.toString() || "{}");
        for (const pre of prefixes) objects.delete(`${bucket}/${pre}`);
        return send(res, 200, prefixes.map((name) => ({ name })));
      }
    }
    log("storage ??", req.method, p);
    return send(res, 404, { message: "unknown storage route" });
  }

  if (await handleGemini(req, res, raw, p, { agentReply, jsonReply, answerText, log, send })) return;

  if (p === "/_gemini_log") return send(res, 200, geminiLog.slice(-50));
  log("?? route", req.method, p);
  send(res, 404, { error: "not found" });
});
server.listen(PORT, "127.0.0.1", () => log(`fakes listening on :${PORT}`));
process.on("message", () => {});
