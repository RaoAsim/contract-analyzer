import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { conversationDocuments, conversations, documents, messages } from "@/lib/db/schema";
import type { ConversationDetail, ConversationDoc, ConversationSummary, MessageView } from "@/types/chat";

const TAGS = ["D1", "D2", "D3", "D4", "D5"];

export async function createConversation(documentIds: string[]): Promise<ConversationSummary> {
  const ids = [...new Set(documentIds)];
  if (ids.length < 1 || ids.length > 5) throw new ApiError(400, "invalid_request", "Choose between 1 and 5 documents.");
  const db = getDb();
  const docs = await db.select({ id: documents.id, name: documents.name, status: documents.status, kind: documents.kind }).from(documents).where(inArray(documents.id, ids));
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) throw new ApiError(404, "not_found", "One of the selected documents no longer exists.");
    if (d.status !== "ready") throw new ApiError(409, "not_ready", `“${d.name}” is still processing. Wait until it is ready.`);
  }
  const id = await db.transaction(async (tx) => {
    const [c] = await tx.insert(conversations).values({ title: "", kind: ids.length === 1 ? "single" : "multi" }).returning({ id: conversations.id });
    await tx.insert(conversationDocuments).values(ids.map((documentId, i) => ({ conversationId: c!.id, documentId, tag: TAGS[i]!, documentName: byId.get(documentId)!.name })));
    return c!.id;
  });
  const [summary] = await summaries([id]);
  return summary!;
}

async function summaries(ids: string[]): Promise<ConversationSummary[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const [convs, links, counts] = await Promise.all([
    db.select().from(conversations).where(inArray(conversations.id, ids)),
    db
      .select({ conversationId: conversationDocuments.conversationId, tag: conversationDocuments.tag, documentId: conversationDocuments.documentId, name: conversationDocuments.documentName, kind: documents.kind })
      .from(conversationDocuments)
      .leftJoin(documents, eq(documents.id, conversationDocuments.documentId))
      .where(inArray(conversationDocuments.conversationId, ids))
      .orderBy(asc(conversationDocuments.tag)),
    db
      .select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .groupBy(messages.conversationId),
  ]);
  const countBy = new Map(counts.map((c) => [c.conversationId, c.n]));
  const order = new Map(ids.map((id, i) => [id, i]));
  return convs
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((c) => ({
      id: c.id,
      title: c.title || "New chat",
      kind: c.kind,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: countBy.get(c.id) ?? 0,
      documents: links
        .filter((l) => l.conversationId === c.id)
        .map((l): ConversationDoc => ({ tag: l.tag, documentId: l.documentId, name: l.name, kind: l.kind ?? undefined })),
    }));
}

export async function listConversations(filter: { documentId?: string; kind?: "single" | "multi" }): Promise<ConversationSummary[]> {
  const db = getDb();
  let ids: string[];
  if (filter.documentId) {
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(conversationDocuments, eq(conversationDocuments.conversationId, conversations.id))
      .where(and(eq(conversationDocuments.documentId, filter.documentId), eq(conversations.kind, "single")))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    ids = rows.map((r) => r.id);
  } else {
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.kind, filter.kind ?? "multi"))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    ids = rows.map((r) => r.id);
  }
  // Hide empty threads (created but never asked) except the most recent one per document.
  const list = await summaries(ids);
  return list.filter((c, i) => c.messageCount > 0 || i === 0);
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
  const [summary] = await summaries([id]);
  if (!summary) return null;
  const rows = await getDb().select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.createdAt), desc(messages.role)); // same instant: "user" before "assistant"
  const views: MessageView[] = rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations,
    coverage: m.coverage ?? null,
    trace: m.trace,
    notices: m.notices,
    mode: m.mode ?? null,
    status: m.status,
    error: m.error ?? null,
    usage: m.usage ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
  return { conversation: summary, messages: views };
}

export async function deleteConversation(id: string): Promise<boolean> {
  const rows = await getDb().delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
  return rows.length > 0;
}

/** The documents a run can use: tag → document id, only for documents that still exist. */
export async function conversationDocs(id: string): Promise<{ tag: string; documentId: string; name: string }[]> {
  const rows = await getDb()
    .select({ tag: conversationDocuments.tag, documentId: conversationDocuments.documentId, name: conversationDocuments.documentName })
    .from(conversationDocuments)
    .where(and(eq(conversationDocuments.conversationId, id), isNotNull(conversationDocuments.documentId)))
    .orderBy(asc(conversationDocuments.tag));
  return rows.map((r) => ({ tag: r.tag, documentId: r.documentId!, name: r.name }));
}
