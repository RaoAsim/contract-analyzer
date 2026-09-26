---
trigger: always_on
---

# Contract Analyzer: Technical Specification

## 1. Project Identity

**Name:** Contract Analyzer

**Purpose:** A web app for analysing legal contracts. A user uploads a contract (PDF or DOCX) and asks questions about it in a chat. Every answer is backed by exact quotes from the document, and **the app checks each quote in code before showing it as verified**. Clicking a quote scrolls to that passage and highlights it.

The app also supports:

- questions across several documents at once;
- comparing two versions of a contract, with changes rated by significance;
- an agentic research mode, in which the model decides what to look up using document tools.

**Audience:** the assignment evaluators, who use it like real legal and commercial reviewers. There is a single user and no login.

**Built for:** a 3-day engineering assignment. Scope is exactly the assignment's Parts A, B and C (Option 2). Extras from the assignment's own list are built only once A–C work end to end.

## 2. Technology Stack

**Frontend:** Next.js (latest stable, App Router), React, TypeScript strict, Tailwind CSS, shadcn/ui (Radix), lucide-react, sonner (toasts), TanStack Query (server state), react-resizable-panels, react-markdown + remark-gfm, and `eventsource-parser` (to read streamed answers from `fetch` POST responses).

**Document viewing:**

- PDF: `react-pdf`, rendered page by page with virtualisation, plus a highlight overlay of our own.
- DOCX: HTML that our own parser generates on the server, highlighted with the CSS Custom Highlight API (falling back to `<mark>`).

**Document processing (server):**

- `pdfjs-dist` (legacy build, with cMaps and standard fonts) for PDF text and item geometry.
- `jszip` + `@xmldom/xmldom` for our own OOXML parser, including Word auto-numbering. `mammoth` is the fallback.

**Backend:** Next.js route handlers (`runtime = 'nodejs'`) on **Railway**, as one long-running Node process that also runs the background worker (started from `instrumentation.ts`).

**Database and files:** **Supabase**:

- **Postgres** with built-in full-text search (`tsvector` + GIN) and the pgvector extension (used only for the semantic-search extra). Accessed directly with **Drizzle ORM** + `postgres` (postgres-js) via the Session pooler connection string.
- **Storage** for the original files: a private bucket named `documents`, accessed with `@supabase/supabase-js` and the service-role key, server-side only.
- **Supabase Auth is not used.**

**Background jobs:** a `jobs` table in the same database. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, held by a 2-minute lease with a 30 s heartbeat, and retried with backoff. There is no queue service or queue library.

**AI:** the `openai` npm SDK against any OpenAI-compatible endpoint. `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` come from env, and the model is a cheap one. `zod` validates all structured output and tool arguments, `jsonrepair` handles tolerant parsing, and `gpt-tokenizer` handles budgeting. The Vercel AI SDK's tool loop is **not** used; the agent loop is hand-written.

**Text and diff utilities:** `diff` (jsdiff) and `fastest-levenshtein`. **Tests:** `vitest`. Fixtures are generated with `pdfkit` and `docx`.

## 3. Strict Development Constraints (The "Do Nots")

**NO client-side AI or secrets.**

- `LLM_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` never reach the browser, and never use the `NEXT_PUBLIC_` prefix.
- All model calls and all Supabase access happen server-side.
- `.env*` is gitignored; `.env.example` contains placeholders only.

**NO second copy of the document text.**

- Each document has exactly one canonical text, `documents.text`. Every offset (pages, sections, chunks, quote matches, highlight boxes) is a `[start, end)` range into it.
- Highlight geometry comes from the **same** extraction pass that produced the text. Never re-extract with another library for display.

**NO quote shown as verified without `verifyQuote()`.**

- Every `<quote doc="Dn">` the model writes is checked in code against the canonical text of **its own** document before the UI treats it as verified.
- The quote the user sees is the **document's own text**, sliced from the matched span, not the model's string.
- An unverified or misattributed quote is never styled like a verified one and is never clickable into the document.

**NO trusting model-reported positions.**

- We never ask the model for pages, offsets or line numbers.
- There are no page markers in the LLM context, and the prompts forbid citing page numbers.
- Every location comes from our own matching.

**NO naive quote matching.**

- Allowed normalisation: NFKC, curly quotes and dashes to plain ASCII, soft hyphens and zero-width characters dropped, words hyphenated across a line break joined, whitespace collapsed, and page headers/footers skipped. Every normalisation keeps an offset map back to the canonical text.
- The ladder: normalised exact → compact (letters and digits only) → elided (`...`) segments in order → fuzzy.
- **Fuzzy matching** (T4) runs only on quotes of at least 40 characters. It aligns the quote against a window of the document; whole-string similarity ratios are never used. It accepts at ≥ 0.95 similarity **plus** the numeric guard **plus** the protected-word check.
- **Numeric guard:** a quote with a different number (`15%` vs `1.5%`, `30` vs `60 days`) never verifies.
- **Protected words:** `shall`, `may`, `not`, `unless` and similar must match exactly.
- Keep **all** occurrences of a quote. Pick the primary one by overlap with the text the server actually sent to the model, never simply the first occurrence.

**NO absence claims from partial reading.**

- Every assistant message stores and shows a `coverage` object.
- The model may say "the document does not contain X" only when coverage is complete. The **server** enforces this: `[[NOT_FOUND]]` from excerpts escalates to a full-document scan, and absence wording on partial coverage gets a server notice.
- Unreadable (scanned) pages and failed scan windows are always disclosed.

**NO silent truncation.** Every cap (characters, chunks, rounds, pages) is reported to the model in its context and to the user in the coverage information or a notice.

**NO unstructured AI output driving logic.**

- JSON outputs (scan map, query variants, comparison classification) are parsed with `jsonrepair` and validated with zod, with one retry that includes the error.
- Never branch on raw model prose. The one exception is the `[[NOT_FOUND]]` sentinel, which the server strips.

**NO throwing tools, and no unbounded agent loops.**

- Agent tools return errors as results: `UNKNOWN_TOOL` (listing the available tools), `INVALID_JSON`, `INVALID_ARGUMENTS` (zod issues), `SECTION_NOT_FOUND` + `did_you_mean`, `PAGE_OUT_OF_RANGE`, `TOOL_TIMEOUT`.
- Invented argument keys are stripped and reported.
- Every tool call gets a result message.
- Caps: 8 rounds, 20 tool calls, 4 calls per round, 8k characters per result envelope, a 90 s wall clock. The token budget is checked **before** each call.
- Hitting a cap produces a forced final answer with tools disabled. The run never stops silently.

**NO broken streams.**

- Server-sent events: `meta`, `status`, `tool_call`, `tool_result`, `text`, `quote_pending`, `citation`, `coverage`, `notice`, `error`, `done`.
- Non-fatal problems are `notice`, never `error`.
- **Exactly one `done`, always last.**
- Raw `<quote>` tags never reach the client. The server parser holds text back while a tag is open, with a 1,500-character guard.

**NO losing partial answers.**

- Stop (`POST /api/messages/:id/stop`, client abort, or disconnect) keeps the text so far and the citations already verified, saved with `status = 'stopped'`.
- Assistant rows are created as `streaming` and flushed every 1.5 s. At boot, stale `streaming` rows become `interrupted`.

**NO empty "successful" documents.**

- A document becomes `ready` only with usable text. An all-scanned PDF fails with `no_text_layer` and a clear message.
- Partly scanned PDFs are ready, but carry a `partial_scan` warning, and those pages count as unread.

**NO retrying permanent failures.** `unsupported_type`, `legacy_doc`, `password_protected`, `corrupted_file`, `too_large`, `too_many_pages`, `no_text_layer` and `empty_document` fail immediately with a user-facing message. Only transient errors are retried, at most 3 attempts.

**NO trusting file extensions.** File types are detected from magic bytes (`%PDF-`; ZIP containing `word/document.xml`; OLE2 → legacy/protected `.doc`). Rejections happen synchronously at upload with a specific message.

**NO long DB transactions.** Never hold a transaction or connection across an LLM call, a Storage download or any other slow I/O. Progress writes are short, separate updates. Stage writes are conditional (`… WHERE status IN ('queued','processing') RETURNING id`), so a deleted document stops its job.

**NO open Supabase surface.**

- RLS is enabled on every table with **no policies**. The Data API stays closed, and our owner-role DB connection bypasses RLS.
- The Storage bucket is private. Files reach the viewer only through `GET /api/documents/:id/file`.
- The anon key is unused.

**NO scope creep.** No login, accounts, dark mode, rate limiting, duplicate detection, OCR, reconnectable streams, evaluation dashboards, or Part C Option 1. Extras come only from the assignment's list, one finished before the next is started.

**NO unclear states.**

- Every async surface has loading (a skeleton), empty, error (a human message plus retry), partial and success states.
- Processing shows a named stage and progress ("Extracting text: page 34 of 150").
- Chat shows a live phase line and a Stop button.
- Toasts are for confirmations. Errors that matter stay inline.

**NO claiming unfinished work.** Anything partial goes in the README's "Not finished" section. Nothing is described as working unless it has been run.

## 4. Core Application Workflows

**Workflow A: Upload and processing.**

- `POST /api/documents` (one file per request; the client uses XHR so it can show upload progress) does the following:
  1. checks the size (`MAX_UPLOAD_MB`, ≤ 50) and the magic bytes;
  2. quick-opens PDFs (password / damaged / `MAX_PAGES`);
  3. uploads the file to Storage at `{id}/original.{ext}`;
  4. inserts the `documents` row and its `jobs` row **in one transaction**.
- The worker's `process-document` job runs:
  1. extract text: pdf.js items become lines, then pages, then canonical text, storing per-item boxes normalised 0..1; DOCX goes through our OOXML parser with numbering labels to HTML with `data-o` offset spans;
  2. scanned/garbled page check;
  3. header and footer detection (repeated top/bottom lines, page numbers). These are kept in the text but excluded from matching, chunks and highlights;
  4. section detection (DOCX styles and numbering; PDF regexes for Article/Section/`12.3`/Schedule, with table-of-contents skip and monotonic numbering);
  5. section-aware chunks (400–700 tokens; overlap only within a section; `search_text` prefixed with `§number title`);
  6. keyword clause index.
- The library polls status every second while anything is still processing.

**Workflow B: Chat with verified quotes.**

- `POST /api/conversations/:id/messages` streams server-sent events. The mode is chosen by the server:
  - **FULL:** the documents fit in `CONTEXT_BUDGET_TOKENS` (default 20k, deliberately small so a 150-page contract always exercises the strategy).
  - **RETRIEVAL:** query variants, then Postgres full-text search with phrase boosts and exact
