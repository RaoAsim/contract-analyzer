import type { DocMatchIndex } from "./matchIndex";
import type { Range } from "@/types/document";
import type { VerifyResult } from "./verify.types";

export type AttributionDoc = { tag: string; docId: string; index: DocMatchIndex; contextRanges?: readonly Range[] };

export type AttributedResult = Omit<VerifyResult, "status"> & {
  status: VerifyResult["status"] | "misattributed";
  docId?: string;
  foundInDocId?: string;
};
