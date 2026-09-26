import "server-only";
import { desc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents, type DocumentRow } from "@/lib/db/schema";
import type { DocumentSummary } from "@/types/document";

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

export function toSummary(row: SummaryRow): DocumentSummary {
  return {
    ...row,
    retryable: false,
    attempt: null,
    maxAttempts: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

/** Library listing: metadata only, never the canonical text. */
export async function listDocuments(ids?: string[]): Promise<DocumentSummary[]> {
  const db = getDb();
  const base = db.select(summaryColumns).from(documents);
  const rows = ids && ids.length > 0
    ? await base.where(inArray(documents.id, ids)).orderBy(desc(documents.createdAt))
    : await base.orderBy(desc(documents.createdAt));
  return rows.map(toSummary);
}
