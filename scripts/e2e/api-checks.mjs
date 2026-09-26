// End-to-end smoke test against the running app (http://127.0.0.1:3100). Prints PASS/FAIL per check.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3100";
const FIX = path.resolve("tests/fixtures");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(FIX, file))]), file);
  const r = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  return { status: r.status, body: await r.json() };
}

async function json(p, init) {
  const r = await fetch(`${BASE}${p}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}

const post = (p, body) => json(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** POST a question and parse the SSE stream into events. `stopAfterMs` calls the stop endpoint. */
async function ask(conversationId, content, options = {}, stopAfterMs) {
  const r = await fetch(`${BASE}/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, options }),
  });
  if (!r.ok) return { status: r.status, body: await r.json(), events: [] };
  const events = [];
  let buf = "";
  const dec = new TextDecoder();
  const reader = r.body.getReader();
  let stopTimer;
  const started = Date.now();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (ev && data) {
        const d = JSON.parse(data);
        events.push({ event: ev, data: d, t: Date.now() - started });
        if (ev === "meta" && stopAfterMs !== undefined) stopTimer = setTimeout(() => void fetch(`${BASE}/api/messages/${d.messageId}/stop`, { method: "POST" }), stopAfterMs);
      }
    }
  }
  clearTimeout(stopTimer);
  const text = events.filter((e) => e.event === "text").map((e) => e.data.delta).join("");
  const citations = events.filter((e) => e.event === "citation").map((e) => e.data);
  const done = events.filter((e) => e.event === "done");
  const meta = events.find((e) => e.event === "meta")?.data;
  const coverage = events.find((e) => e.event === "coverage")?.data;
  const notices = events.filter((e) => e.event === "notice").map((e) => e.data.code);
  return { status: r.status, events, text, citations, done, meta, coverage, notices };
}

function streamShape(name, a) {
  check(`${name}: exactly one done, last`, a.done.length === 1 && a.events.at(-1)?.event === "done", `${a.done.length} done`);
  check(`${name}: meta is the first event`, a.events[0]?.event === "meta");
  check(`${name}: no raw <quote> tags reach the client`, !/<\/?quote/i.test(a.text));
  const firstText = a.events.findIndex((e) => e.event === "text");
  const lastText = a.events.findLastIndex((e) => e.event === "text");
  check(`${name}: tokens stream (many text events over time)`, a.events.filter((e) => e.event === "text").length > 5 && a.events[lastText].t - a.events[firstText].t > 50);
}

async function main() {
  // ---- Upload validation ----
  const txt = await upload("notes.txt");
  check("notes.txt rejected 415 with a clear message", txt.status === 415 && /isn't a PDF or Word/.test(txt.body.error.message), txt.body.error?.message);
  const doc = await upload("legacy.doc");
  check("legacy.doc rejected with save-as-docx message", doc.status === 415 && /\.docx/.test(doc.body.error.message), doc.body.error?.message);
  const enc = await upload("encrypted.pdf");
  check("encrypted.pdf rejected as password-protected", enc.status === 422 && enc.body.error.code === "password_protected", enc.body.error?.message);
  const cor = await upload("corrupted.pdf");
  check("corrupted.pdf rejected as damaged", cor.status === 422 && cor.body.error.code === "corrupted_file", cor.body.error?.message);

  const ids = {};
  for (const f of ["long_msa.pdf", "msa_v1.docx", "msa_v2.docx", "scanned.pdf", "partial_scan.pdf"]) {
    const u = await upload(f);
    check(`${f} accepted (201)`, u.status === 201 && u.body.document.status === "queued", `stage=${u.body.document?.stage}`);
    ids[f] = u.body.document?.id;
  }

  // ---- Processing with live stages ----
  const stages = new Set();
  const t0 = Date.now();
  let list = [];
  for (;;) {
    list = (await json("/api/documents")).body.documents;
    for (const d of list) if (d.stage) stages.add(`${d.name}: ${d.stage}`);
    if (list.every((d) => d.status === "ready" || d.status === "failed") || Date.now() - t0 > 300_000) break;
    await sleep(300);
  }
  const byName = Object.fromEntries(list.map((d) => [d.name, d]));
  check("processing shows named stages with page progress", [...stages].some((s) => /Extracting text: page \d+ of \d+/.test(s)), [...stages].filter((s) => s.startsWith("long_msa")).slice(0, 4).join(" | "));
  check("long_msa.pdf reaches ready with 149 pages", byName["long_msa.pdf"]?.status === "ready" && byName["long_msa.pdf"]?.pageCount >= 145, `${byName["long_msa.pdf"]?.status} ${byName["long_msa.pdf"]?.pageCount} pages in ${Math.round((Date.now() - t0) / 1000)}s`);
  check("msa_v1.docx and msa_v2.docx ready", byName["msa_v1.docx"]?.status === "ready" && byName["msa_v2.docx"]?.status === "ready");
  check("scanned.pdf fails with the scanned message (not an empty ready doc)", byName["scanned.pdf"]?.status === "failed" && byName["scanned.pdf"]?.errorCode === "no_text_layer" && !byName["scanned.pdf"]?.retryable, byName["scanned.pdf"]?.errorMessage);
  check("partial_scan.pdf ready with partial_scan warning", byName["partial_scan.pdf"]?.status === "ready" && byName["partial_scan.pdf"]?.warnings.some((w) => w.code === "partial_scan"), byName["partial_scan.pdf"]?.warnings.map((w) => w.message).join(" "));

  const detail = (await json(`/api/documents/${ids["long_msa.pdf"]}`)).body.document;
  check("document detail has page sizes and outline", detail.pages.length >= 145 && detail.outline.length > 40, `${detail.outline.length} sections`);
  const file = await fetch(`${BASE}/api/documents/${ids["long_msa.pdf"]}/file`);
  const bytes = Buffer.from(await file.arrayBuffer());
  check("file route streams the original PDF", file.headers.get("content-type") === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-" && file.headers.get("cache-control")?.includes("private"));
  const html = (await json(`/api/documents/${ids["msa_v1.docx"]}/html`)).body;
  check("DOCX html route returns data-o spans", /data-o="\d+"/.test(html?.html ?? ""));

  // ---- Single-document chat (FULL) ----
  const conv1 = (await post("/api/conversations", { documentIds: [ids["msa_v1.docx"]] })).body.conversation;
  const a1 = await ask(conv1.id, "What is the liability cap?");
  streamShape("v1 liability", a1);
  check("v1 liability: FULL mode with complete coverage", a1.coverage?.mode === "full" && a1.coverage?.complete === true);
  check("v1 liability: quote verified and shows AED 100,000 from the document", a1.citations.some((c) => c.status === "verified" && /AED 100,000/.test(c.displayText)), a1.citations.map((c) => `${c.status}:${c.displayText ?? c.modelText}`).join(" | "));
  check("v1 liability: citation event arrives before its token", (() => {
    const ci = a1.events.findIndex((e) => e.event === "citation");
    const ti = a1.events.findIndex((e) => e.event === "text" && /⟦c1⟧/.test(e.data.delta));
    return ci >= 0 && ti > ci;
  })());

  const busy = await Promise.all([ask(conv1.id, "What is the term? slow"), (async () => { await sleep(300); return ask(conv1.id, "Second question while busy"); })()]);
  check("second send while generating → 409", busy[1].status === 409 && /still being generated/.test(busy[1].body?.error?.message ?? ""), busy[1].body?.error?.message);

  const nf = await ask(conv1.id, "Does it have a non-compete?");
  check("v1 non-compete (FULL): server states absence only with complete coverage", /read the entire document/i.test(nf.text) && nf.coverage?.complete === true, nf.text.slice(0, 120));

  const unv = await ask(conv1.id, "What is the liability cap? (test unverified)");
  check("invented/paraphrased quote → unverified, never verified", unv.citations.some((c) => c.status === "unverified") && unv.citations.some((c) => c.status === "verified"), unv.citations.map((c) => c.status).join(","));

  const dbg = await ask(conv1.id, "What is the liability cap?", { debugInjectFakeQuote: true });
  check("debug fake quote toggle → unverified citation", dbg.citations.some((c) => c.status === "unverified" && /unlimited free support/.test(c.modelText)));

  // ---- Large document: retrieval + scan ----
  const conv2 = (await post("/api/conversations", { documentIds: [ids["long_msa.pdf"]] })).body.conversation;
  const law = await ask(conv2.id, "Which law governs the agreement?");
  streamShape("long_msa law", law);
  const lawCite = law.citations.find((c) => c.status === "verified");
  check("page-142 governing-law fact found and verified", !!lawCite && /Emirate of Dubai/.test(lawCite.displayText) && lawCite.occurrences[lawCite.primary]?.pageStart === 142, lawCite ? `${lawCite.displayText.slice(0, 80)} p.${lawCite.occurrences[lawCite.primary]?.pageStart}` : law.text.slice(0, 120));
  check("retrieval coverage is partial and says so", law.coverage?.mode === "retrieval" && law.coverage?.complete === false && law.coverage.perDoc[0].fraction < 0.5, `${Math.round((law.coverage?.perDoc[0].fraction ?? 0) * 100)}% ${law.coverage?.perDoc[0].sectionsRead}`);
  check("PDF citation has highlight boxes on page 142", lawCite?.occurrences[lawCite.primary]?.boxes?.[0]?.page === 142);

  const cap = await ask(conv2.id, "What is the Liability Cap amount?");
  const capCite = cap.citations.find((c) => c.status === "verified" && /100,000/.test(c.displayText));
  check("page-3 liability cap found", !!capCite, cap.citations.map((c) => c.displayText?.slice(0, 60)).join(" | ") || cap.text.slice(0, 100));

  const nc = await ask(conv2.id, "Is there a non-compete clause?");
  check("exhaustive question on 150 pages → full-document scan", nc.coverage?.mode === "scan" && nc.coverage.complete === true, `mode=${nc.coverage?.mode} complete=${nc.coverage?.complete}`);
  check("scan reports progress while reading", nc.events.some((e) => e.event === "status" && /\(\d+ of \d+\)/.test(e.data.text)));

  const esc = await ask(conv2.id, "What does the contract say about unicorns?");
  check("NOT_FOUND in excerpts escalates to a full scan (no excerpt-based 'no')", esc.notices.includes("ESCALATING") && esc.coverage?.mode === "scan", `notices=${esc.notices.join(",")} text=${esc.text.slice(0, 120)}`);
  check("escalated not-found answer is written by the server with complete coverage", /read the entire document/i.test(esc.text) && esc.coverage?.complete === true, esc.text.slice(0, 140));

  const th = await ask(conv2.id, "What are the payment terms?", { thorough: true });
  check("'Read entire document' toggle forces a scan", th.coverage?.mode === "scan");

  // ---- Stop keeps partial ----
  const stopped = await ask(conv1.id, "Explain the termination and liability provisions slow", {}, 400);
  check("stop: done has status stopped", stopped.done[0]?.data.status === "stopped", JSON.stringify(stopped.done[0]?.data));
  await sleep(500);
  const reopened = (await json(`/api/conversations/${conv1.id}`)).body;
  const last = reopened.messages.at(-1);
  check("stop: partial answer persisted with status stopped", last.status === "stopped" && last.content.length > 0 && last.content.length <= stopped.text.length + 5, `${last.status}, ${last.content.length} chars`);
  check("reopening a thread restores citations with geometry", reopened.messages.some((m) => m.citations.some((c) => c.status === "verified")));
  const threads = (await json(`/api/conversations?documentId=${ids["msa_v1.docx"]}`)).body.conversations;
  check("history lists threads per document (title = first question)", threads.some((t) => t.id === conv1.id && t.title.startsWith("What is the liability cap")));

  // ---- Partial scan coverage ----
  const conv3 = (await post("/api/conversations", { documentIds: [ids["partial_scan.pdf"]] })).body.conversation;
  const ps = await ask(conv3.id, "What does clause 5 say?");
  check("partially scanned doc: coverage never complete, unreadable pages disclosed", ps.coverage?.complete === false && ps.notices.includes("UNREADABLE_PAGES"), ps.notices.join(","));

  // ---- Multi-document ----
  const multi = (await post("/api/conversations", { documentIds: [ids["msa_v1.docx"], ids["msa_v2.docx"]] })).body.conversation;
  check("multi conversation gets D1/D2 tags", multi.kind === "multi" && multi.documents.map((d) => d.tag).join(",") === "D1,D2");
  const m1 = await ask(multi.id, "Compare the liability cap");
  const tags = m1.citations.filter((c) => c.status === "verified").map((c) => `${c.docTag}:${c.displayText.match(/AED [\d,]+/)?.[0]}`);
  check("multi-doc: each quote verified against its own document", tags.includes("D1:AED 100,000") && tags.includes("D2:AED 1,000,000"), tags.join(" | "));

  // ---- Agent ----
  const ag = await ask(conv1.id, "What are the termination rights?", { agent: true });
  streamShape("agent", ag);
  const calls = ag.events.filter((e) => e.event === "tool_call").map((e) => e.data);
  const tres = ag.events.filter((e) => e.event === "tool_result").map((e) => e.data);
  check("agent: multi-round tool loop with labelled steps", calls.length >= 3 && calls.some((c) => /Searching for/.test(c.label)) && new Set(calls.map((c) => c.round)).size >= 3, calls.map((c) => c.label).join(" → "));
  check("agent: invented tool handled without crashing", tres.some((r) => r.error === "UNKNOWN_TOOL") && ag.done[0]?.data.status === "complete");
  check("agent: every tool call has a result", calls.every((c) => tres.some((r) => r.callId === c.callId)));
  check("agent: final answer quotes verified", ag.citations.some((c) => c.status === "verified"), ag.citations.map((c) => c.status).join(","));
  check("agent: coverage reports what the tools read", ag.coverage?.mode === "agent" && ag.coverage.perDoc[0].fraction > 0);

  // ---- Comparison ----
  const cmp = (await post("/api/comparisons", { docAId: ids["msa_v1.docx"], docBId: ids["msa_v2.docx"] })).body.comparison;
  let cd;
  for (let i = 0; i < 120; i++) {
    cd = (await json(`/api/comparisons/${cmp.id}`)).body.comparison;
    if (cd.status === "ready" || cd.status === "failed") break;
    await sleep(500);
  }
  check("comparison job completes", cd.status === "ready", `${cd.status} ${cd.errorMessage ?? ""}`);
  const aed = cd.result?.changes.find((c) => c.facts.some((f) => f.kind === "money"));
  check("comparison: AED 100,000 → 1,000,000 is critical", aed?.significance === "critical", aed?.summary);
  check("comparison: executive summary bullets reference changes", (cd.result?.summary.bullets.length ?? 0) > 0 && cd.result.summary.bullets.some((b) => /\[C\d+/.test(b)), cd.result?.summary.bullets[0]);
  check("comparison: counts per significance", cd.result?.counts.bySignificance.critical >= 2, JSON.stringify(cd.result?.counts.bySignificance));

  // ---- Delete ----
  const del = await json(`/api/documents/${ids["scanned.pdf"]}`, { method: "DELETE" });
  check("delete a document", del.status === 200 && !(await json("/api/documents")).body.documents.some((d) => d.id === ids["scanned.pdf"]));
  const delV2 = await json(`/api/documents/${ids["msa_v2.docx"]}`, { method: "DELETE" });
  const mAfter = (await json(`/api/conversations/${multi.id}`)).body;
  check("deleting a document keeps the multi-doc chat and marks it deleted", delV2.status === 200 && mAfter.conversation.documents.some((d) => d.tag === "D2" && d.documentId === null) && mAfter.messages.length > 0);

  const health = (await json("/api/health")).body;
  check("health ok", health.ok && health.worker === "running");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
