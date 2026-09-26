import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { ApiError, notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { getDb } from "@/lib/db/client";
import { getDocumentSummary } from "@/lib/db/queries/documents";
import { documents } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import type { DocumentSummary } from "@/types/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-enqueue a document that failed for a transient reason. Permanent failures are not retried. */
export const POST = withApiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse<{ document: DocumentSummary }>> => {
  const id = await idParam(ctx, "The document");
  const current = await getDocumentSummary(id);
  if (!current) throw notFound("The document");
  if (current.status !== "failed" || !current.retryable) {
    throw new ApiError(409, "not_retryable", current.status === "failed" ? "This file can't be processed; retrying won't help. Remove it and upload a different file." : "This document isn't in a failed state.");
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ status: "queued", stage: "Waiting to start", progress: 0, errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.status, "failed")));
    await enqueueJob(tx, "process-document", id);
  });
  const document = await getDocumentSummary(id);
  return NextResponse.json({ document: document! });
});
