import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documentPages, documents, sections } from "@/lib/db/schema";
import type { DocData } from "./docData.types";
import { DocMatchIndex } from "./matchIndex";
import { rangesLength } from "./ranges";

const MAX_DOCS = 12;
const RECHECK_MS = 60_000;

// On globalThis so the cache (and its prebuilt match indexes) survives dev-server module reloads,
// the same way the DB pool does. Without it every question re-downloaded the whole document.
type CacheGlobal = { __caDocCache?: Map<string, DocData>; __caDocChecked?: Map<string, number> };
const g = globalThis as unknown as CacheGlobal;
const cache = (g.__caDocCache ??= new Map<string, DocData>());
const checkedAt = (g.__caDocChecked ??= new Map<string, number>());

/** Load a READY document with pages, sections and a lazily-built match index (LRU of ~12, §9.7). */
export async function loadDocData(id: string): Promise<DocData | null> {
  // Confirmed ready very recently: skip the round trip. Deletion evicts explicitly.
  const recent = cache.get(id);
  if (recent && Date.now() - (checkedAt.get(id) ?? 0) < RECHECK_MS) return recent;
  const db = getDb();
  const [meta] = await db
    .select({ processedAt: documents.processedAt, status: documents.status })
    .from(documents)
    .where(eq(documents.id, id));
  if (!meta || meta.status !== "ready") {
    cache.delete(id);
    return null;
  }
  const version = meta.processedAt?.toISOString() ?? "";
  const hit = cache.get(id);
  if (hit && hit.version === version) {
    cache.delete(id);
    cache.set(id, hit); // refresh LRU position
    checkedAt.set(id, Date.now());
    return hit;
  }

  const [doc] = await db
    .select({
      id: documents.id,
      name: documents.name,
      kind: documents.kind,
      text: documents.text,
      furniture: documents.furniture,
      unreadablePages: documents.unreadablePages,
      pageCount: documents.pageCount,
      tokenCount: documents.tokenCount,
    })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.status, "ready")));
  if (!doc || doc.text === null) return null;
  const [pages, secs] = await Promise.all([
    db
      .select({
        pageNo: documentPages.pageNo,
        start: documentPages.charStart,
        end: documentPages.charEnd,
        width: documentPages.width,
        height: documentPages.height,
        items: documentPages.items,
      })
      .from(documentPages)
      .where(eq(documentPages.documentId, id))
      .orderBy(asc(documentPages.pageNo)),
    db
      .select({
        id: sections.id,
        ord: sections.ord,
        number: sections.number,
        title: sections.title,
        level: sections.level,
        parentId: sections.parentId,
        start: sections.charStart,
        end: sections.charEnd,
        pageStart: sections.pageStart,
        pageEnd: sections.pageEnd,
      })
      .from(sections)
      .where(eq(sections.documentId, id))
      .orderBy(asc(sections.ord)),
  ]);

  const data: DocData = {
    ...doc,
    text: doc.text,
    pages,
    sections: secs,
    index: new DocMatchIndex(doc.text, doc.furniture),
    contentChars: doc.text.length - rangesLength(doc.furniture),
    version,
  };
  cache.set(id, data);
  checkedAt.set(id, Date.now());
  while (cache.size > MAX_DOCS) cache.delete(cache.keys().next().value!);
  return data;
}

export function evictDocData(id: string): void {
  cache.delete(id);
  checkedAt.delete(id);
}
