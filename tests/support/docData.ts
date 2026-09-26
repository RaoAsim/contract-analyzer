import fs from "node:fs";
import { analyzeDocument } from "@/lib/ingest/analyze";
import type { DocData } from "@/lib/text/docData.types";
import { DocMatchIndex } from "@/lib/text/matchIndex";
import { rangesLength } from "@/lib/text/ranges";

/** Build the in-memory DocData the chat engine uses, straight from a fixture (no database). */
export async function fixtureDocData(file: string, id = file): Promise<DocData> {
  const kind = file.endsWith(".pdf") ? "pdf" : "docx";
  const a = await analyzeDocument(new Uint8Array(fs.readFileSync(`tests/fixtures/${file}`)), kind);
  const ids = new Map(a.sections.map((s) => [s.ord, `${id}-s${s.ord}`]));
  return {
    id,
    name: file,
    kind,
    text: a.text,
    furniture: a.furniture,
    unreadablePages: a.unreadablePages,
    pageCount: a.pageCount,
    tokenCount: a.tokenCount,
    pages: a.pages.map((p) => ({ pageNo: p.pageNo, start: p.charStart, end: p.charEnd, width: p.width, height: p.height, items: p.items })),
    sections: a.sections.map((s) => ({
      id: ids.get(s.ord)!,
      ord: s.ord,
      number: s.number,
      title: s.title,
      level: s.level,
      parentId: s.parentOrd !== null ? (ids.get(s.parentOrd) ?? null) : null,
      start: s.start,
      end: s.end,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
    })),
    index: new DocMatchIndex(a.text, a.furniture),
    contentChars: a.text.length - rangesLength(a.furniture),
    version: "test",
  };
}

/** Naive in-memory keyword search over sections (stands in for Postgres FTS in tests). */
export function memorySearch(doc: DocData, query: string, limit: number): { start: number; end: number }[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  return doc.sections
    .map((s) => {
      const body = doc.text.slice(s.start, s.end).toLowerCase();
      return { start: s.start, end: s.end, score: terms.reduce((n, t) => n + (body.includes(t) ? 1 : 0), 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
