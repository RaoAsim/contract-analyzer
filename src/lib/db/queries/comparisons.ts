import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { desc, eq, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { comparisons, documents } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import type { ComparisonDetail, ComparisonResult, ComparisonSummary } from "@/types/compare";

const docA = alias(documents, "doc_a");
const docB = alias(documents, "doc_b");

function select() {
  return getDb()
    .select({
      id: comparisons.id,
      status: comparisons.status,
      stage: comparisons.stage,
      progress: comparisons.progress,
      errorMessage: comparisons.errorMessage,
      result: comparisons.result,
      createdAt: comparisons.createdAt,
      updatedAt: comparisons.updatedAt,
      aId: docA.id,
      aName: docA.name,
      bId: docB.id,
      bName: docB.name,
    })
    .from(comparisons)
    .leftJoin(docA, eq(docA.id, comparisons.docAId))
    .leftJoin(docB, eq(docB.id, comparisons.docBId));
}

type Row = Awaited<ReturnType<ReturnType<typeof select>["where"]>>[number];

function toSummary(r: Row): ComparisonSummary {
  const result = r.result as ComparisonResult | null;
  return {
    id: r.id,
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    errorMessage: r.errorMessage,
    docA: r.aId ? { id: r.aId, name: r.aName! } : null,
    docB: r.bId ? { id: r.bId, name: r.bName! } : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    counts: result?.counts,
  };
}

export async function createComparison(docAId: string, docBId: string): Promise<ComparisonSummary> {
  if (docAId === docBId) throw new ApiError(400, "invalid_request", "Choose two different documents to compare.");
  const db = getDb();
  const docs = await db.select({ id: documents.id, name: documents.name, status: documents.status }).from(documents).where(inArray(documents.id, [docAId, docBId]));
  for (const id of [docAId, docBId]) {
    const d = docs.find((x) => x.id === id);
    if (!d) throw new ApiError(404, "not_found", "One of the selected documents no longer exists.");
    if (d.status !== "ready") throw new ApiError(409, "not_ready", `“${d.name}” is still processing. Wait until it is ready.`);
  }
  const id = await db.transaction(async (tx) => {
    const [c] = await tx.insert(comparisons).values({ docAId, docBId, status: "queued", stage: "Waiting to start" }).returning({ id: comparisons.id });
    await enqueueJob(tx, "compare-documents", c!.id);
    return c!.id;
  });
  return (await getComparisonSummary(id))!;
}

export async function listComparisons(): Promise<ComparisonSummary[]> {
  const rows = await select().orderBy(desc(comparisons.createdAt)).limit(50);
  return rows.map(toSummary);
}

export async function getComparisonSummary(id: string): Promise<ComparisonSummary | null> {
  const [r] = await select().where(eq(comparisons.id, id));
  return r ? toSummary(r) : null;
}

export async function getComparison(id: string): Promise<ComparisonDetail | null> {
  const [r] = await select().where(eq(comparisons.id, id));
  return r ? { ...toSummary(r), result: (r.result as ComparisonResult | null) ?? null } : null;
}

export async function retryComparison(id: string): Promise<ComparisonSummary> {
  const current = await getComparisonSummary(id);
  if (!current) throw new ApiError(404, "not_found", "This comparison was not found.");
  if (current.status !== "failed") throw new ApiError(409, "not_retryable", "This comparison isn't in a failed state.");
  await getDb().transaction(async (tx) => {
    await tx.update(comparisons).set({ status: "queued", stage: "Waiting to start", progress: 0, errorMessage: null, updatedAt: new Date() }).where(eq(comparisons.id, id));
    await enqueueJob(tx, "compare-documents", id);
  });
  return (await getComparisonSummary(id))!;
}

export async function deleteComparison(id: string): Promise<boolean> {
  const rows = await getDb().delete(comparisons).where(eq(comparisons.id, id)).returning({ id: comparisons.id });
  return rows.length > 0;
}
