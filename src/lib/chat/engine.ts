import "server-only";
import { z } from "zod";
import { runAgent } from "@/lib/agent/loop";
import { getConfig } from "@/lib/config";
import { chatJson } from "@/lib/llm/client";
import type { ChatMessage } from "@/lib/llm/llm.types";
import { fullContext, overviewContext, retrievalContext, topSectionsList } from "@/lib/retrieval/context";
import { planQueries } from "@/lib/retrieval/search";
import type { QueryPlan } from "@/lib/retrieval/search.types";
import { compressNumbers } from "@/lib/text/ranges";
import type { DocContext, RunContext, StreamOutcome } from "./chat.types";
import type { CitationDoc } from "./citations";
import { docCoverage, isDocComplete } from "./coverage";
import { finish, notice } from "./finish";
import { isOverviewQuestion } from "./intent";
import { answerSystemPrompt, COVERAGE_FULL, COVERAGE_SCAN, coverageRetrieval, documentsBlock, TOPIC_PROMPT } from "./prompts";
import { failedPagesLabel, findingsContext, scanDocuments } from "./scan";
import { streamAnswer } from "./stream";

/** Questions whose true answer may be "no", or that need every instance (§11.1). */
export const EXHAUSTIVE =
  /\b(is there|are there|does (it|the \w+) (contain|include|have|mention|say anything)|any\b|all\b|every|each|list|how many|whether|anywhere|at all)\b/i;

export function isExhaustive(q: string): boolean {
  return EXHAUSTIVE.test(q);
}

function userTurn(question: string, docsBlock: string): ChatMessage {
  return { role: "user", content: `${docsBlock}\n\nQuestion: ${question}` };
}

async function topicFor(ctx: RunContext, plan: QueryPlan): Promise<string> {
  if (plan.topic) return plan.topic;
  try {
    const { value } = await chatJson([{ role: "user", content: TOPIC_PROMPT(ctx.question) }], z.object({ topic: z.string().max(120) }), {
      signal: ctx.signal,
      label: "topic",
      maxTokens: 60,
    });
    return value.topic;
  } catch {
    return "this question";
  }
}

/** Stream an answer over prepared document contexts (FULL / RETRIEVAL / SCAN-reduce). */
async function answer(
  ctx: RunContext,
  contexts: DocContext[],
  coverageText: string,
  opts: { escalate: boolean; notFoundPrefix: string; overview?: boolean },
): Promise<StreamOutcome> {
  const system: ChatMessage = { role: "system", content: answerSystemPrompt(coverageText, contexts.length > 1, opts.overview) };
  const block = documentsBlock(contexts.map((c) => ({ tag: c.tag, name: c.doc.name, coverageAttr: c.coverageAttr, body: c.body })));
  const citationDocs: CitationDoc[] = contexts.map((c) => ({ tag: c.tag, data: c.doc, contextRanges: c.contextRanges }));
  ctx.emit("status", { text: "Writing the answer…" });
  return streamAnswer(ctx, [system, ...ctx.history, userTurn(ctx.question, block)], citationDocs, {
    escalateOnNotFound: opts.escalate,
    notFoundPrefix: opts.notFoundPrefix,
    label: `answer-${ctx.state.mode}`,
  });
}

function writeServerText(ctx: RunContext, text: string): void {
  ctx.state.content += text;
  ctx.emit("text", { delta: text });
  ctx.flush();
}

function pagesPhrase(n: number | null, kind: "pdf" | "docx"): string {
  return kind === "pdf" && n ? ` (${n} pages)` : "";
}

/** SCAN mode: map over every window, verify findings, then reduce — or answer "not found" ourselves (§11.3). */
async function runScan(ctx: RunContext, plan: QueryPlan, fitting: DocContext[], scanDocs: { tag: string; data: RunContext["docs"][number]["data"] }[]): Promise<void> {
  ctx.state.mode = "scan";
  const results = await scanDocuments(ctx, scanDocs.map((d) => ({ tag: d.tag, doc: d.data })), ctx.question);
  const scanCoverage = results.map((r) => docCoverage(r.doc, r.tag, r.okRanges, { failedRanges: r.failedRanges }));
  const fullCoverage = fitting.map((c) => docCoverage(c.doc, c.tag, c.readRanges));
  const perDoc = [...fullCoverage, ...scanCoverage].sort((a, b) => a.tag.localeCompare(b.tag));
  if (ctx.signal.aborted) {
    finish(ctx, perDoc, { notFound: false, stopped: true, text: "", finishReason: "stopped" });
    return;
  }

  const totalFindings = results.reduce((n, r) => n + r.findings.length, 0);
  if (totalFindings === 0 && fitting.length === 0) {
    const topic = await topicFor(ctx, plan);
    const lines = results.map((r, i) => {
      const cov = scanCoverage[i]!;
      const name = results.length > 1 ? `${r.tag} (${r.doc.name}): ` : "";
      if (isDocComplete(cov)) return `${name}I read the entire document${pagesPhrase(r.doc.pageCount, r.doc.kind)} and found no provision addressing ${topic}.`;
      const failed = failedPagesLabel(r.failedRanges) || r.failedRanges.map((f) => f.label).filter(Boolean).join(", ");
      const unreadable = r.doc.unreadablePages.length ? compressNumbers(r.doc.unreadablePages) : "";
      const gaps = [failed && `${failed} couldn't be analysed`, unreadable && `pages ${unreadable} are scanned images`].filter(Boolean).join(" and ");
      return `${name}I couldn't find anything about ${topic} in the parts I could read${cov.pagesRead ? ` (pages ${cov.pagesRead})` : ""}. ${gaps ? `${gaps.charAt(0).toUpperCase()}${gaps.slice(1)}, so I can't rule it out.` : "Some parts couldn't be read, so I can't rule it out."}`;
    });
    writeServerText(ctx, lines.join("\n\n"));
    finish(ctx, perDoc, null, true);
    return;
  }

  const budget = Math.floor(getConfig().CONTEXT_BUDGET_TOKENS / Math.max(1, results.length + fitting.length));
  const reduceContexts: DocContext[] = [
    ...fitting,
    ...results.map((r): DocContext => {
      const f = findingsContext(r, budget);
      return {
        tag: r.tag,
        doc: r.doc,
        mode: "scan",
        body: f.body || "(No relevant passages were found anywhere in this document.)",
        coverageAttr: r.failedRanges.length ? `entire document read except ${failedPagesLabel(r.failedRanges) || "some parts"}; relevant passages shown` : "entire document read; relevant passages shown",
        readRanges: r.okRanges,
        contextRanges: f.ranges,
      };
    }),
  ].sort((a, b) => a.tag.localeCompare(b.tag));
  const failures = results.filter((r) => r.failedRanges.length > 0);
  const coverageText =
    (fitting.length > 0 ? `${COVERAGE_FULL} (for ${fitting.map((f) => f.tag).join(", ")})\n` : "") +
    COVERAGE_SCAN +
    (failures.length ? `\nHowever, these parts could NOT be analysed, so never claim something is absent from them: ${failures.map((r) => `${r.tag} ${failedPagesLabel(r.failedRanges) || "some parts"}`).join("; ")}.` : "");
  const allComplete = perDoc.every(isDocComplete);
  const outcome = await answer(ctx, reduceContexts, coverageText, {
    escalate: false,
    notFoundPrefix: allComplete ? "I read the entire document and found nothing that answers this. " : "I couldn't find this in the parts I could read, so I can't rule it out. ",
  });
  finish(ctx, perDoc, outcome);
}

/** The standard pipeline: FULL / RETRIEVAL / SCAN with escalation (§11.1). */
export async function runStandard(ctx: RunContext): Promise<void> {
  const cfg = getConfig();
  const perDocBudget = Math.floor(cfg.CONTEXT_BUDGET_TOKENS / ctx.docs.length);
  const fits = ctx.docs.filter((d) => d.data.tokenCount <= perDocBudget);
  const large = ctx.docs.filter((d) => d.data.tokenCount > perDocBudget);
  const fitting = fits.map((d) => fullContext(d.tag, d.data));

  // General / vague questions: overview from the outline + section openings. No planner, no scan.
  const inDocument = (w: string): boolean => ctx.docs.some((d) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, "")}`, "i").test(d.data.text));
  if (!ctx.options.thorough && isOverviewQuestion(ctx.question, inDocument)) {
    const contexts: DocContext[] = [...fitting, ...large.map((d) => overviewContext(d.tag, d.data, perDocBudget))].sort((a, b) => a.tag.localeCompare(b.tag));
    ctx.state.mode = large.length === 0 ? "full" : "retrieval";
    const coverageText =
      large.length === 0
        ? COVERAGE_FULL
        : coverageRetrieval(contexts.filter((c) => c.mode === "retrieval").map((c) => ({ tag: c.tag, sections: c.noteForModel ?? "", pct: Math.max(1, Math.round(docCoverage(c.doc, c.tag, c.readRanges).fraction * 100)) })));
    const outcome = await answer(ctx, contexts, coverageText, { escalate: false, notFoundPrefix: "", overview: true });
    finish(ctx, contexts.map((c) => docCoverage(c.doc, c.tag, c.readRanges)), outcome);
    return;
  }

  let plan: QueryPlan = { queries: [], sections: [], topic: null };
  if (large.length > 0) {
    ctx.emit("status", { text: "Finding relevant sections…" });
    const p = await planQueries(ctx.question, topSectionsList(large[0]!.data), ctx.signal);
    plan = p.plan;
    if (p.usage) {
      ctx.state.usage.inputTokens += p.usage.inputTokens;
      ctx.state.usage.outputTokens += p.usage.outputTokens;
      ctx.state.usage.calls += p.usage.calls;
    }
  }

  if (large.length > 0 && (ctx.options.thorough || isExhaustive(ctx.question))) {
    await runScan(ctx, plan, fitting, large);
    return;
  }

  const contexts: DocContext[] = [...fitting];
  for (const d of large) contexts.push(await retrievalContext(d.tag, d.data, ctx.question, plan, perDocBudget));
  contexts.sort((a, b) => a.tag.localeCompare(b.tag));
  ctx.state.mode = large.length === 0 ? "full" : "retrieval";

  const coverageText =
    large.length === 0
      ? COVERAGE_FULL
      : [
          fitting.length ? `${COVERAGE_FULL.replace("each document", fitting.map((f) => f.tag).join(", "))}` : "",
          coverageRetrieval(
            contexts
              .filter((c) => c.mode === "retrieval")
              .map((c) => ({ tag: c.tag, sections: c.noteForModel ?? "", pct: Math.max(1, Math.round(docCoverage(c.doc, c.tag, c.readRanges).fraction * 100)) })),
          ),
        ]
          .filter(Boolean)
          .join("\n");

  const outcome = await answer(ctx, contexts, coverageText, {
    escalate: ctx.state.mode === "retrieval",
    notFoundPrefix: ctx.docs.length > 1 ? "I read the entire documents and found nothing that answers this. " : "I read the entire document and found nothing that answers this. ",
  });

  if (outcome.notFound && ctx.state.mode === "retrieval" && !outcome.stopped && !ctx.signal.aborted) {
    notice(ctx, { code: "ESCALATING", text: "Not in the retrieved sections — reading the whole document…" });
    ctx.emit("status", { text: "Not in the retrieved sections — reading the whole document…" });
    await runScan(ctx, plan, fitting, large);
    return;
  }
  finish(
    ctx,
    contexts.map((c) => docCoverage(c.doc, c.tag, c.readRanges)),
    outcome,
  );
}

/** Entry point: agent mode (Part C) or the standard pipeline. */
export async function runChat(ctx: RunContext): Promise<void> {
  if (ctx.options.agent) {
    ctx.state.mode = "agent";
    await runAgent(ctx, { fallback: runStandard });
    return;
  }
  await runStandard(ctx);
}
