import "server-only";
import type { HandlerRegistry } from "./worker.types";

/**
 * Job handlers by type. The worker only claims job types that have a handler here, so jobs of a
 * type added in a later milestone simply wait in the queue until their handler exists.
 * - process-document: Milestone 2
 * - compare-documents: Milestone 8
 */
export const jobHandlers: HandlerRegistry = {};
