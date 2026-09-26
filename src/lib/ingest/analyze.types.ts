import type { DocumentKind, DocumentWarning, Range } from "@/types/document";
import type { ChunkDraft } from "./chunk.types";
import type { ClauseDraft } from "./clauses.types";
import type { PdfPage } from "./pdf.types";
import type { SectionDraft } from "./sections.types";

export type Analysis = {
  kind: DocumentKind;
  text: string;
  pages: PdfPage[];
  html: string | null;
  furniture: Range[];
  unreadablePages: number[];
  warnings: DocumentWarning[];
  sections: SectionDraft[];
  chunks: ChunkDraft[];
  clauses: ClauseDraft[];
  pageCount: number | null;
  tokenCount: number;
};

export type ProgressFn = (stage: string, progress: number, force?: boolean) => Promise<void>;
