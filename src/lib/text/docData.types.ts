import type { DocumentKind, PageItem, Range } from "@/types/document";
import type { DocMatchIndex } from "./matchIndex";

export type DocPage = { pageNo: number; start: number; end: number; width: number; height: number; items: PageItem[] };

export type DocSection = {
  id: string;
  ord: number;
  number: string | null;
  title: string;
  level: number;
  parentId: string | null;
  start: number;
  end: number;
  pageStart: number | null;
  pageEnd: number | null;
};

/** Everything the chat engine needs about one ready document, cached in memory. */
export type DocData = {
  id: string;
  name: string;
  kind: DocumentKind;
  text: string;
  furniture: Range[];
  unreadablePages: number[];
  pageCount: number | null;
  tokenCount: number;
  pages: DocPage[];
  sections: DocSection[];
  index: DocMatchIndex;
  /** Characters excluding furniture (coverage denominator). */
  contentChars: number;
  version: string;
};
