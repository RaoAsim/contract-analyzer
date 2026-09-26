import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { getDocumentSummary } from "@/lib/db/queries/documents";
import { documents } from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import { CONTENT_TYPES, removeObjects, storagePathFor, uploadObject } from "@/lib/storage/supabase";
import type { DocumentSummary } from "@/types/document";
import { ingestErrors } from "./errors";
import { cleanFileName, quickOpenPdf, sniffFileType } from "./validate";

/**
 * Synchronous upload validation + storage + enqueue (§8.1). Permanent problems throw a
 * PermanentIngestError (with an HTTP status) before anything is stored.
 */
export async function createDocumentFromUpload(rawName: string, bytes: Uint8Array): Promise<DocumentSummary> {
  const cfg = getConfig();
  const name = cleanFileName(rawName);
  const sizeMb = bytes.length / (1024 * 1024);
  if (sizeMb > cfg.MAX_UPLOAD_MB) throw ingestErrors.tooLarge(name, sizeMb, cfg.MAX_UPLOAD_MB);

  const { kind } = await sniffFileType(bytes, name);
  if (kind === "pdf") await quickOpenPdf(bytes, cfg.MAX_PAGES);

  const id = randomUUID();
  const storagePath = storagePathFor(id, kind);
  await uploadObject(storagePath, bytes, CONTENT_TYPES[kind]);

  try {
    // Document + job in ONE transaction: a document can never exist without its job.
    await getDb().transaction(async (tx) => {
      await tx.insert(documents).values({
        id,
        name,
        kind,
        sizeBytes: bytes.length,
        storagePath,
        status: "queued",
        stage: "Waiting to start",
        progress: 0,
      });
      await enqueueJob(tx, "process-document", id);
    });
  } catch (err) {
    await removeObjects([storagePath]).catch((e: unknown) => console.error("[upload] could not remove orphaned object:", e));
    throw err;
  }
  const summary = await getDocumentSummary(id);
  if (!summary) throw new Error("document vanished after insert");
  return summary;
}
