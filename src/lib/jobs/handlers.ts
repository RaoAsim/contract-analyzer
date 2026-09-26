import "server-only";
import { compareDocumentsHandler } from "@/lib/compare/pipeline";
import { processDocumentHandler } from "@/lib/ingest/pipeline";
import type { HandlerRegistry } from "./worker.types";

/**
 * Job handlers by type. The worker only claims job types that have a handler here.
 */
export const jobHandlers: HandlerRegistry = {
  "process-document": processDocumentHandler,
  "compare-documents": compareDocumentsHandler,
};
