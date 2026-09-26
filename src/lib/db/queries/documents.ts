import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { clauses, conversationDocuments, conversations, documentPages, documents, jobs, sections, type DocumentRow } from "@/lib/db/schema";
import type { DocumentDetail, DocumentSummary, OutlineSection } from "@/types/document";

const PERMANENT_CODES = new Set([
  "unsupported_type",
  "legacy_doc",
  "password_protected",
  "corrupted_file",
  "too_large",
  "too_many_pages",
  "no_text_layer",
  "empty_document",
]);

const summaryColumns = {
  id: documents.id,
  name: documents.name,
  kind: documents.kind,
  sizeBytes: documents.sizeBytes,
  status: documents.status,
  stage: documents.stage,
  progress: documents.progress,
  errorCode: documents.errorCode,
  errorMessage: documents.errorMessage,
  pageCount: documents.pageCount,
  charCount: documents.charCount,
  warnings: documents.warnings,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
  processedAt: documents.processedAt,
};

type SummaryRow = Pick<DocumentRow, keyof typeof summaryColumns>;
type JobInfo = { attempts: number; maxAttempts: number };

export function toSummary(row: SummaryRow, job?: JobInfo): DocumentSummary {
  return {
    ...row,
    retryable: row.status === "failed" && !!row.errorCode && !PERMANENT_CODES.has(row.errorCode),
    attempt: job?.attempts ?? null,
    maxAttempts: job?.maxAttempts ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

async function latestJobs(ids: string[]): Promise<Map<string, JobInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([jobs.targetId], { targetId: jobs.targetId, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(and(eq(jobs.type, "process-document"), inArray(jobs.targetId, ids)))
    .orderBy(jobs.targetId, desc(jobs.createdAt));
  return new Map(rows.map((r) => [r.targetId, { attempts: r.attempts, maxAttempts: r.maxAttempts }]));
}

/** Library listing: metadata only, never the canonical text. */
export async function listDocuments(ids?: string[]): Promise<DocumentSummary[]> {
  const db = getDb();
  const base = db.select(summaryColumns).from(documents);
  const rows =
    ids && ids.length > 0
      ? await base.where(inArray(documents.id, ids)).orderBy(desc(documents.createdAt))
      : await base.orderBy(desc(documents.createdAt));
  const jobInfo = await latestJobs(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, jobInfo.get(r.id)));
}

export async function getDocumentSummary(id: string): Promise<DocumentSummary | null> {
  const [row] = await getDb().select(summaryColumns).from(documents).where(eq(documents.id, id));
  if (!row) return null;
  const jobInfo = await latestJobs([id]);
  return toSummary(row, jobInfo.get(id));
}

/** Metadata + page sizes + outline + clause counts for the workspace. */
export async function getDocumentDetail(id: string): Promise<DocumentDetail | null> {
  const summary = await getDocumentSummary(id);
  if (!summary) return null;
  const db = getDb();
  const [pages, secs, clauseCounts] = await Promise.all([
    db
      .select({ pageNo: documentPages.pageNo, width: documentPages.width, height: documentPages.height })
      .from(documentPages)
      .where(eq(documentPages.documentId, id))
      .orderBy(asc(documentPages.pageNo)),
    db
      .select({
        id: sections.id,
        number: sections.number,
        title: sections.title,
        level: sections.level,
        charStart: sections.charStart,
        charEnd: sections.charEnd,
        pageStart: sections.pageStart,
        pageEnd: sections.pageEnd,
      })
      .from(sections)
      .where(eq(sections.documentId, id))
      .orderBy(asc(sections.ord)),
    db
      .select({ type: clauses.type, n: sql<number>`count(*)::int` })
      .from(clauses)
      .where(eq(clauses.documentId, id))
      .groupBy(clauses.type),
  ]);
  const outline: OutlineSection[] = secs;
  return { ...summary, pages, outline, clauseCounts: Object.fromEntries(clauseCounts.map((c) => [c.type, c.n])) };
}

/**
 * Delete a document (§7): single-document chats go with it; multi-document chats keep the link
 * row (document_id set to null → "(deleted document)"); pages/sections/chunks/clauses cascade.
 * Returns the storage path so the caller can remove the original file.
 */
export async function deleteDocumentRows(id: string): Promise<{ storagePath: string } | null> {
  return getDb().transaction(async (tx) => {
    const [doc] = await tx.select({ storagePath: documents.storagePath }).from(documents).where(eq(documents.id, id));
    if (!doc) return null;
    const singles = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(conversationDocuments, eq(conversationDocuments.conversationId, conversations.id))
      .where(and(eq(conversationDocuments.documentId, id), eq(conversations.kind, "single")));
    if (singles.length > 0) await tx.delete(conversations).where(inArray(conversations.id, singles.map((s) => s.id)));
    await tx.delete(jobs).where(and(eq(jobs.targetId, id), eq(jobs.status, "queued")));
    await tx.delete(documents).where(eq(documents.id, id));
    return { storagePath: doc.storagePath };
  });
}

/** Counts shown in the delete confirmation. */
export async function deletionImpact(id: string): Promise<{ singleChats: number; multiChats: number; comparisons: number }> {
  const db = getDb();
  const rows = await db.execute<{ single_chats: number; multi_chats: number; comparisons: number }>(sql`
    select
      (select count(*)::int from conversation_documents cd join conversations c on c.id = cd.conversation_id
         where cd.document_id = ${id} and c.kind = 'single') as single_chats,
      (select count(*)::int from conversation_documents cd join conversations c on c.id = cd.conversation_id
         where cd.document_id = ${id} and c.kind = 'multi') as multi_chats,
      (select count(*)::int from comparisons where doc_a_id = ${id} or doc_b_id = ${id}) as comparisons`);
  const r = rows[0];
  return { singleChats: r?.single_chats ?? 0, multiChats: r?.multi_chats ?? 0, comparisons: r?.comparisons ?? 0 };
}
