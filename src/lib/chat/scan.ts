import "server-only";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { chatJson, isAbortError } from "@/lib/llm/client";
import { countTokens } from "@/lib/llm/tokens";
import { allChunks } from "@/lib/retrieval/search";
import { cleanSlice } from "@/lib/retrieval/context";
import type { DocData } from "@/lib/text/docData.types";
import { compressNumbers, mergeRanges } from "@/lib/text/ranges";
import { verifyQuote } from "@/lib/text/verify";
import type { CoverageDoc } from "@/types/chat";
import type { Range } from "@/types/document";
import type { RunContext } from "./chat.types";
import { sectionAt } from "./citations";
import { SCAN_MAP } from "./prompts";

export type ScanWindow = { index: number; start: number; end: number; pageStart: number | null; pageEnd: number | null; label: string };
export type ScanFinding = { start: number; end: number; why: string; windowIndex: number };
export type DocScanResult = {
  doc: DocData;
  tag: string;
  findings: ScanFinding[];
  okRanges: Range[];
  failedRanges: NonNullable<CoverageDoc["failedRanges"]>;
  discarded: number;
  windows: number;
};

const mapSchema = z.object({
  relevant: z.boolean().default(false),
  findings: z
    .array(z.object({ quote: z.string().max(2000), why: z.string().max(500).default("") }))
    .max(12)
    .default([]),
});

/** Windows of ~SCAN_WINDOW_TOKENS aligned to chunk boundaries, one chunk of overlap (§11.3). */
export async function buildWindows(doc: DocData): Promise<ScanWindow[]> {
  const size = getConfig().SCAN_WINDOW_TOKENS;
  const chunks = await allChunks(doc.id);
  const windows: ScanWindow[] = [];
  let i = 0;
  while (i < chunks.length) {
    let j = i;
    let tokens = 0;
    while (j < chunks.length && (j === i || tokens + chunks[j]!.tokenCount <= size)) {
      tokens += chunks[j]!.tokenCount;
      j++;
    }
    const first = chunks[i]!;
    const last = chunks[j - 1]!;
    windows.push({
      index: windows.length,
      start: i === 0 ? 0 : first.start,
      end: j >= chunks.length ? doc.text.length : last.end,
      pageStart: first.pageStart,
      pageEnd: last.pageEnd,
      label: "",
    });
    if (j >= chunks.length) break;
    i = Math.max(i + 1, j - 1); // one chunk of overlap
  }
  // Label: "pages 31–45" (PDF) or "sections 8–14" (DOCX).
  for (const w of windows) {
    if (doc.kind === "pdf" && w.pageStart && w.pageEnd) w.label = w.pageStart === w.pageEnd ? `page ${w.pageStart}` : `pages ${w.pageStart}–${w.pageEnd}`;
    else {
      const a = sectionAt(doc, w.start).number;
      const b = sectionAt(doc, Math.max(w.start, w.end - 1)).number;
      w.label = a && b ? (a === b ? `section ${a}` : `sections ${a}–${b}`) : `part ${w.index + 1}`;
    }
  }
  return windows;
}

async function pool<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>, signal: AbortSignal): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Map step over every window of every document (shared concurrency pool). Each finding is verified
 * immediately; unverified findings are discarded. Failed windows are recorded (never silent).
 */
export async function scanDocuments(ctx: RunContext, docs: { tag: string; doc: DocData }[], question: string): Promise<DocScanResult[]> {
  const cfg = getConfig();
  const results: DocScanResult[] = [];
  const jobs: { r: DocScanResult; w: ScanWindow; n: number }[] = [];
  for (const { tag, doc } of docs) {
    const windows = await buildWindows(doc);
    const r: DocScanResult = { doc, tag, findings: [], okRanges: [], failedRanges: [], discarded: 0, windows: windows.length };
    results.push(r);
    for (const w of windows) jobs.push({ r, w, n: windows.length });
  }
  let done = 0;
  const total = jobs.length;
  const multi = docs.length > 1;
  ctx.emit("status", { text: `Reading the entire document${multi ? "s" : ""} (${total} parts)…`, progress: { done: 0, total } });

  await pool(
    jobs,
    cfg.SCAN_CONCURRENCY,
    async ({ r, w, n }) => {
      const text = cleanSlice(r.doc, w.start, w.end);
      try {
        const { value, usage } = await chatJson(
          [{ role: "user", content: SCAN_MAP(question, w.index + 1, n, text) }],
          mapSchema,
          {
            signal: ctx.signal,
            label: "scan-map",
            maxTokens: 900,
            onRetry: () => ctx.emit("notice", { code: "RETRYING", text: "The AI provider is busy — retrying part of the scan…" }),
          },
        );
        ctx.state.usage.inputTokens += usage.inputTokens;
        ctx.state.usage.outputTokens += usage.outputTokens;
        ctx.state.usage.calls += usage.calls;
        r.okRanges.push([w.start, w.end]);
        for (const f of value.findings.slice(0, 6)) {
          const v = verifyQuote(r.doc.index, f.quote, { contextRanges: [[w.start, w.end]] });
          if (v.status === "unverified") {
            r.discarded++;
            continue;
          }
          const occ = v.segments ? { start: v.segments[0]!.start, end: v.segments.at(-1)!.end } : v.occurrences[v.primary]!;
          r.findings.push({ start: occ.start, end: occ.end, why: f.why, windowIndex: w.index });
        }
      } catch (err) {
        if (ctx.signal.aborted || isAbortError(err)) return;
        console.warn(`[scan] window ${w.index + 1}/${n} of ${r.doc.id} failed:`, err instanceof Error ? err.message : err);
        r.failedRanges.push({ pageStart: w.pageStart ?? 0, pageEnd: w.pageEnd ?? 0, reason: "analysis_failed", label: w.label });
      } finally {
        done++;
        const prefix = multi ? `${r.tag}: ` : "";
        ctx.emit("status", { text: `Reading ${prefix}${w.label} (${done} of ${total})…`, progress: { done, total } });
      }
    },
    ctx.signal,
  );

  for (const r of results) {
    // Dedupe findings from overlapping windows; keep document order.
    const seen = new Set<string>();
    r.findings = r.findings
      .sort((a, b) => a.start - b.start)
      .filter((f) => {
        const k = `${f.start}:${f.end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    if (r.discarded > 0) console.log(`[scan] ${r.doc.id}: discarded ${r.discarded} unverified finding(s)`);
  }
  return results;
}

/** Numbered excerpts of the DOCUMENT's text (±300 chars around each finding) for the reduce step. */
export function findingsContext(r: DocScanResult, budgetTokens: number): { body: string; ranges: Range[] } {
  const PAD = 300;
  const ranges = mergeRanges(r.findings.map((f): Range => [Math.max(0, f.start - PAD), Math.min(r.doc.text.length, f.end + PAD)]));
  const parts: string[] = [];
  const kept: Range[] = [];
  let used = 0;
  for (const [s, e] of ranges) {
    const sec = sectionAt(r.doc, s);
    const head = sec.number ? `── §${sec.number} ${sec.title ?? ""} ──` : `── ${sec.title ?? "Passage"} ──`;
    const piece = `${head}\n${cleanSlice(r.doc, s, e)}`;
    const t = countTokens(piece);
    if (used + t > budgetTokens) break;
    parts.push(`[${parts.length + 1}] ${piece}`);
    kept.push([s, e]);
    used += t;
  }
  const dropped = ranges.length - kept.length;
  const note = dropped > 0 ? `\n(${dropped} further relevant passage(s) were found but not included because of the size limit.)` : "";
  return { body: parts.join("\n\n") + note, ranges: kept };
}

export function failedPagesLabel(failed: DocScanResult["failedRanges"]): string {
  const pages: number[] = [];
  for (const f of failed) for (let p = f.pageStart; p <= f.pageEnd && p > 0; p++) pages.push(p);
  return pages.length ? compressNumbers(pages) : "";
}
