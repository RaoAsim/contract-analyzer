import "server-only";
import { processDocumentHandler } from "@/lib/ingest/pipeline";
import type { HandlerRegistry } from "./worker.types";

/**
 * Job handlers by type. The worker only claims job types that have a handler here.
 * - compare-documents is registered by Milestone 8.
 */
export const jobHandlers: HandlerRegistry = {
  "process-document": processDocumentHandler,
};
