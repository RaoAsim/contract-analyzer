import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Citation } from "@/types/citation";
import type {
  AnswerMode,
  Coverage,
  MessageError,
  MessageRole,
  MessageStatus,
  Notice,
  TraceStep,
  Usage,
} from "@/types/chat";
import type {
  DocumentKind,
  DocumentStatus,
  DocumentWarning,
  PageItem,
  Range,
  SearchMode,
} from "@/types/document";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status").$type<DocumentStatus>().notNull().default("queued"),
    stage: text("stage"),
    progress: integer("progress").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    pageCount: integer("page_count"),
    charCount: integer("char_count").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),
    text: text("text"),
    furniture: jsonb("furniture").$type<Range[]>().notNull().default([]),
    unreadablePages: integer("unreadable_pages").array().notNull().default(sql`'{}'::int[]`),
    warnings: jsonb("warnings").$type<DocumentWarning[]>().notNull().default([]),
    searchMode: text("search_mode").$type<SearchMode>().notNull().default("keyword"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("documents_created_at_idx").on(t.createdAt)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    items: jsonb("items").$type<PageItem[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.pageNo] })],
);

export const documentHtml = pgTable("document_html", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  html: text("html").notNull(),
});

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    number: text("number"),
    title: text("title").notNull(),
    level: integer("level").notNull(),
    parentId: uuid("parent_id"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
  },
  (t) => [index("sections_document_ord_idx").on(t.documentId, t.ord)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ord: integer("ord").notNull(),
    sectionId: uuid("section_id"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    text: text("text").notNull(),
    searchText: text("search_text").notNull(),
    tokenCount: integer("token_count").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', search_text)`),
  },
  (t) => [
    index("chunks_document_ord_idx").on(t.documentId, t.ord),
    index("chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const clauses = pgTable(
  "clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    sectionId: uuid("section_id"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source").$type<"llm" | "keyword">().notNull(),
  },
  (t) => [index("clauses_document_idx").on(t.documentId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").$type<"single" | "multi">().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const conversationDocuments = pgTable(
  "conversation_documents",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** Null once the document is deleted: multi-document chats then show "(deleted document)" (§7). */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    tag: text("tag").notNull(),
    documentName: text("document_name").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.tag] }),
    index("conversation_documents_document_idx").on(t.documentId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull().default(""),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    coverage: jsonb("coverage").$type<Coverage>(),
    trace: jsonb("trace").$type<TraceStep[]>().notNull().default([]),
    notices: jsonb("notices").$type<Notice[]>().notNull().default([]),
    mode: text("mode").$type<AnswerMode>(),
    status: text("status").$type<MessageStatus>().notNull().default("complete"),
    error: jsonb("error").$type<MessageError>(),
    usage: jsonb("usage").$type<Usage>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_status_idx").on(t.status),
  ],
);

export const comparisons = pgTable("comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  docAId: uuid("doc_a_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  docBId: uuid("doc_b_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  status: text("status").$type<"queued" | "processing" | "ready" | "failed">().notNull().default("queued"),
  stage: text("stage"),
  progress: integer("progress").notNull().default(0),
  result: jsonb("result").$type<unknown>(),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type JobType = "process-document" | "compare-documents";
export type JobStatus = "queued" | "running" | "done" | "failed";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<JobType>().notNull(),
    targetId: uuid("target_id").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("jobs_active_target_uidx")
      .on(t.type, t.targetId)
      .where(sql`status in ('queued', 'running')`),
    index("jobs_claim_idx").on(t.status, t.runAfter),
    index("jobs_target_idx").on(t.targetId),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
