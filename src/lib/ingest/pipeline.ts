import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chunks, clauses, documentHtml, documentPages, documents, sections } from "@/lib/db/schema";
import { JobAbortedError } from "@/lib/jobs/errors";
import type { JobContext, JobHandler } from "@/lib/jobs/worker.types";
import { downloadObject } from "@/lib/storage/supabase";
import type { DocumentKind } from "@/types/document";
import { analyzeDocument } from "./analyze";
import type { Analysis, ProgressFn } from "./analyze.types";
import { PermanentIngestError, TRANSIENT_FAILURE_MESSAGE } from "./errors";
import { sniffFileType } from "./validate";

const ACTIVE = ["queued", "processing"] as const;
const PROGRESS_INTERVAL_MS = 500;

/** Conditional stage write: no row back means the document was deleted or finished → stop the job. */
async function setStage(documentId: string, stage: string, progress: number): Promise<void> {
  const rows = await getDb()
    .update(documents)
    .set({ status: "processing", stage, progress, updatedAt: new Date() })
    .where(and(eq(documents.id, documentId), inArray(documents.status, [...ACTIVE])))
    .returning({ id: documents.id });
  if (rows.length === 0) throw new JobAbortedError("document deleted or no longer processing");
}

function progressReporter(documentId: string, signal: AbortSignal): ProgressFn {
  let last = 0;
  return async (stage, progress, force = false) => {
    if (signal.aborted) throw new JobAbortedError("aborted");
    const now = Date.now();
    if (!force && now - last < PROGRESS_INTERVAL_MS) return;
    last = now;
    await setStage(documentId, stage, progress);
  };
}

async function clearDerivedData(documentId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    await tx.delete(clauses).where(eq(clauses.documentId, documentId));
    await tx.delete(sections).where(eq(sections.documentId, documentId));
    await tx.delete(documentPages).where(eq(documentPages.documentId, documentId));
    await tx.delete(documentHtml).where(eq(documentHtml.documentId, documentId));
  });
}

async function inBatches<T>(rows: T[], size: number, insert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

async function documentExists(documentId: string): Promise<boolean> {
  const rows = await getDb().select({ id: documents.id }).from(documents).where(eq(documents.id, documentId));
  return rows.length > 0;
}

/** Bulk-insert derived rows. Each insert is its own short statement (I8). */
async function persistAnalysis(documentId: string, a: Analysis, progress: ProgressFn): Promise<void> {
  const db = getDb();
  const sectionIds = new Map(a.sections.map((s) => [s.ord, randomUUID()]));

  await inBatches(a.sections, 500, (batch) =>
    db.insert(sections).values(
      batch.map((s) => ({
        id: sectionIds.get(s.ord)!,
        documentId,
        ord: s.ord,
        number: s.number,
        title: s.title.slice(0, 300),
        level: s.level,
        parentId: s.parentOrd !== null ? (sectionIds.get(s.parentOrd) ?? null) : null,
        charStart: s.start,
        charEnd: s.end,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
      })),
    ),
  );
  await progress("Preparing search index", 75, true);

  await inBatches(a.pages, 20, (batch) =>
    db.insert(documentPages).values(
      batch.map((p) => ({
        documentId,
        pageNo: p.pageNo,
        charStart: p.charStart,
        charEnd: p.charEnd,
        width: p.width,
        height: p.height,
        items: p.items,
      })),
    ),
  );
  await progress("Preparing search index", 80, true);

  let done = 0;
  await inBatches(a.chunks, 100, async (batch) => {
    await db.insert(chunks).values(
      batch.map((c) => ({
        documentId,
        ord: c.ord,
        sectionId: sectionIds.get(c.sectionOrd) ?? null,
        charStart: c.start,
        charEnd: c.end,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        text: c.text,
        searchText: c.searchText,
        tokenCount: c.tokenCount,
      })),
    );
    done += batch.length;
    await progress("Preparing search index", 80 + Math.round((10 * done) / Math.max(1, a.chunks.length)));
  });

  await progress("Identifying clauses", 97, true);
  await inBatches(a.clauses, 500, (batch) =>
    db.insert(clauses).values(
      batch.map((c) => ({
        documentId,
        type: c.type,
        sectionId: sectionIds.get(c.sectionOrd) ?? null,
        charStart: c.start,
        charEnd: c.end,
        confidence: c.confidence,
        source: "keyword" as const,
      })),
    ),
  );

  if (a.html !== null) await db.insert(documentHtml).values({ documentId, html: a.html });
}

async function runProcessDocument(ctx: JobContext): Promise<void> {
  const documentId = ctx.job.targetId;
  const progress = progressReporter(documentId, ctx.signal);

  await setStage(documentId, "Reading file", 5);
  const [doc] = await getDb()
    .select({ storagePath: documents.storagePath, kind: documents.kind, name: documents.name })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!doc) throw new JobAbortedError("document deleted");

  // Slow I/O outside any transaction (I8).
  const bytes = await downloadObject(doc.storagePath);
  const sniffed = await sniffFileType(bytes, doc.name);
  const kind: DocumentKind = sniffed.kind;

  // A retried job starts clean (§8.2 idempotency).
  await clearDerivedData(documentId);

  try {
    const analysis = await analyzeDocument(bytes, kind, progress);
    await persistAnalysis(documentId, analysis, progress);

    const rows = await getDb()
      .update(documents)
      .set({
        kind,
        text: analysis.text,
        charCount: analysis.text.length,
        tokenCount: analysis.tokenCount,
        pageCount: analysis.pageCount,
        furniture: analysis.furniture,
        unreadablePages: analysis.unreadablePages,
        warnings: analysis.warnings,
        searchMode: "keyword",
        status: "ready",
        stage: "Ready",
        progress: 100,
        errorCode: null,
        errorMessage: null,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), inArray(documents.status, [...ACTIVE])))
      .returning({ id: documents.id });
    if (rows.length === 0) throw new JobAbortedError("document deleted before it finished");
  } catch (err) {
    // Inserts fail with an FK violation if the document was deleted mid-job: exit quietly.
    if (!(err instanceof JobAbortedError) && !(err instanceof PermanentIngestError) && !(await documentExists(documentId))) {
      throw new JobAbortedError("document deleted");
    }
    throw err;
  }
}

async function onProcessFailure(
  ctx: JobContext,
  info: { permanent: boolean; outcome: "retrying" | "failed"; error: unknown },
): Promise<void> {
  const documentId = ctx.job.targetId;
  const db = getDb();
  const where = and(eq(documents.id, documentId), inArray(documents.status, [...ACTIVE]));
  if (info.permanent && info.error instanceof PermanentIngestError) {
    await db
      .update(documents)
      .set({ status: "failed", stage: null, errorCode: info.error.code, errorMessage: info.error.message, updatedAt: new Date() })
      .where(where);
    await clearDerivedData(documentId).catch(() => {});
    return;
  }
  if (info.outcome === "retrying") {
    await db
      .update(documents)
      .set({
        status: "queued",
        stage: `Temporary problem — retrying (attempt ${ctx.job.attempts + 1} of ${ctx.job.maxAttempts})…`,
        updatedAt: new Date(),
      })
      .where(where);
    return;
  }
  const timeout = info.error instanceof Error && /timeout|timed out/i.test(info.error.message);
  await db
    .update(documents)
    .set({
      status: "failed",
      stage: null,
      errorCode: timeout ? "timeout" : "unknown",
      errorMessage: `${TRANSIENT_FAILURE_MESSAGE} It was tried ${ctx.job.maxAttempts} times. You can retry.`,
      updatedAt: new Date(),
    })
    .where(where);
  await clearDerivedData(documentId).catch(() => {});
}

export const processDocumentHandler: JobHandler = { run: runProcessDocument, onFailure: onProcessFailure };
