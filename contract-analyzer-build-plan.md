# Contract Analyzer: Build Plan and Technical Spec (Next.js / TypeScript)

> **Who this is for:** an AI coding agent building this app from scratch in a new repository. You have no access to any other codebase. Everything you need is in this document.
>
> **"MUST"** marks a requirement the evaluators will test by hand, on their own contracts, on the deployed app.
>
> **Where the design ideas come from:** a production legal-AI system. §24 lists the pitfalls that system hit, so you can avoid them.

---

## 0. How to use this plan

1. Read §1–§3 completely before writing any code. **§2 (Invariants) overrides everything else.**
2. Build in the milestone order in §19. Each milestone has acceptance checks. Don't start the next milestone until they pass.
3. **Never stub a feature and present it as working.** The assignment counts "claiming something works when it does not" against us. List anything unfinished in the README's "Not finished" section.
4. If a library API detail here conflicts with that library's current docs, follow the docs and keep the design intent.
5. Keep route handlers thin. Business logic goes in `src/lib/**`, which must be unit-testable without Next.js.
6. **Stay in scope.** Build exactly what the assignment asks for (§1, checklist in §23). Do not add features the assignment doesn't mention (§17 lists what we deliberately don't build). Build optional extras only from the assignment's own extras list (§20), and only after Parts A, B and C work end to end.

---

## 1. What we are building

A single-user web app for analysing legal contracts. There is no login.

| Area | Summary |
|---|---|
| Upload | PDF and DOCX only. Clear rejection for anything else. Live processing status. A scanned (image-only) PDF is **reported as unreadable, not saved as an empty "ready" document**. |
| Library | List, open and delete documents. Multi-select to "Ask across documents" or "Compare". |
| Chat | Per-document chat with streamed answers, a Stop button that keeps the partial answer, and history saved per document. |
| Verified quotes | Every answer is backed by quotes. **Our code confirms each quote exists in the document text before it is shown as verified.** Invented or paraphrased quotes are clearly marked unverified. We never trust positions or pages reported by the model. |
| Large documents | 150+ pages work. The app always knows and shows how much of the document it read, and **never claims a clause is absent unless it read the whole document**. |
| Citation highlighting | Clicking a quote scrolls the viewer to the exact passage and highlights it. This must work for quotes that span lines, cross page breaks, or occur more than once. |
| Multi-document Q&A | One question across several documents. The answer compares them. Each quote is tagged with its document and verified against that document only. |
| Comparison | Two versions of a contract compared at clause/paragraph level, each change summarised in plain language and rated for significance, with filter and sort by significance. |
| Part C | **Option 2, agentic document research.** A real multi-round tool loop with live progress, hard caps, robust handling of bad tool calls, and verified quotes in the final answer. |

### 1.1 Part C choice and rationale (reuse this wording in the README note)

We picked **Option 2 (agentic research)** over Option 1 (tracked-change redlining) because:

1. **It builds on the core.** The agent's tools (`get_outline`, `search_document`, `get_section`, `read_pages`, `find_exact`, `list_clauses`) are thin wrappers over indexes we already build for Parts A and B: sections, full-text search, and page and character offsets. Its final answer goes through the same quote verifier. It also gives large documents a second strategy: the model decides what to read instead of us guessing.
2. **Its correctness can be tested.** Round caps, malformed tool calls and forced final answers can all be covered by deterministic replay tests (§18).
3. **Option 1 is mostly an OOXML engineering problem with no JS library to lean on.** Writing correct `w:ins`/`w:del` revisions across split runs, without disturbing numbering, styles or tables, is a deep rabbit hole. The assignment itself warns that regenerate-and-diff doesn't count. With Parts A and B also required in three days, a half-working redliner was the bigger risk.

### 1.2 Out of scope (state this in the README)

- Authentication and multi-user. The assignment says to assume a single user.
- **OCR** of scanned PDFs. The assignment only asks us to tell the user, and OCR isn't on its extras list.
- Legacy `.doc` files. We reject them with a message telling the user to save as `.docx`.
- Option 1 redlining (we chose Option 2).
- The optional extras (§20) are built only after Parts A–C are complete.
- See §17 for everything else we deliberately leave out.

---

## 2. Invariants (non-negotiable)

- **I1. One canonical text per document.** Each document has exactly one canonical string, `documents.text`.
  - Every offset in the system is a `[start, end)` range into that string: pages, sections, chunks, quote matches and highlight geometry.
  - The viewer's highlight data is derived from the **same extraction pass** that produced the canonical text. Never re-extract with a different library for display.
- **I2. Verify before display, and display the document's own words.**
  - A quote is shown as verified only after `verifyQuote()` has located it in the canonical text of **the document it is attributed to**.
  - The quote text shown to the user is the document's own text, sliced from the matched span, not the model's string.
  - Model-reported pages, offsets and positions are never used; we never ask the model for them.
- **I3. Coverage honesty.**
  - Every assistant message stores and displays a `coverage` object: what fraction of each document the model saw, and which pages or sections.
  - **The server enforces the absence rule.** An answer may say something is not in the document only if coverage is complete. Otherwise the app escalates to a full scan, or states precisely what was not read.
- **I4. No silent truncation.** Any cap on characters, chunks, rounds or pages is reported, both to the model (in its context) and to the UI (coverage or notice).
- **I5. Stop keeps the partial answer.** A stopped answer is persisted with the text generated so far and every quote verified so far, with `status = 'stopped'`. **Every stream ends with exactly one `done` event.**
- **I6. No empty successes.** A document becomes `ready` only if it has usable text. Permanent failures (unsupported, password-protected, corrupted, no text layer) produce a specific user-facing message and are **not** retried. Transient failures are retried.
- **I7. Secrets stay server-side.** The API key, base URL and model name come from environment variables. `.env*` is in `.gitignore`, and `.env.example` holds only placeholders. The browser never calls the LLM directly.
- **I8. Short DB transactions.** Never hold a DB transaction or connection across an LLM call or other slow I/O. Read, release, call the LLM, then write in a new short transaction.

---

## 3. Architecture

```
Browser (Next.js App Router, React)
  │   REST (JSON) + streaming responses (text/event-stream over fetch POST)
  ▼
Next.js server: ONE Node.js process (runtime = 'nodejs')
  ├─ Route handlers /api/*        thin: parse → call lib service → respond
  ├─ Chat engine                  standard (full | retrieval | scan) and agent modes
  │     └─ LLM client             OpenAI-compatible SDK (any provider via env)
  ├─ Quote verifier               in-memory match indexes (LRU cache per document)
  └─ Background worker            polls the `jobs` table; started from instrumentation.ts
        ├─ job: process-document  (validate → extract → structure → chunk → index → clauses)
        └─ job: compare-documents
  ▼
Supabase
  ├─ Postgres (with the pgvector extension enabled; full-text search is built in)
  │    documents, document_pages, sections, chunks (tsvector [+ vector for the extra]),
  │    clauses, conversations, conversation_documents, messages, comparisons, jobs
  └─ Storage (private bucket "documents"): the original uploaded PDF/DOCX files
```

**Supabase is the database and file store.** Supabase *is* hosted Postgres, so everything that needs Postgres works on it unchanged: full-text search, the pgvector extension, and `FOR UPDATE SKIP LOCKED` for the job queue. We don't run a separate Postgres anywhere.
- The server talks to the database **directly** through the Supabase connection string (Drizzle ORM). The full-text search, vector and job-claim queries are awkward to express through Supabase's REST client.
- The server uses `@supabase/supabase-js` **only for Storage**, with the service-role key, server-side only.
- **Supabase Auth is not used**; the assignment has no login.

**App hosting: Railway** (Render and Fly.io work the same way). Supabase has no long-running Node server of its own, so the Next.js app and its background worker run on Railway as one process.

**Why not Vercel for the app:**
- Serverless request bodies are capped at about 4.5 MB.
- Function time limits cut off full-document scans and agent loops.
- There is no always-on process for the background worker.

A single long-running Node process on Railway avoids all three.

---

## 4. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (latest stable, App Router) + TypeScript strict** | `output: 'standalone'`. Route handlers use `export const runtime = 'nodejs'`. |
| UI | Tailwind CSS + **shadcn/ui** (Radix) + lucide-react + sonner (toasts) | `react-resizable-panels` for the split view. |
| Data fetching | TanStack Query | Polling document status; cache invalidation. |
| Markdown | `react-markdown` + `remark-gfm` | Custom renderer for citation chips (§11.7). |
| SSE parsing (client) | `eventsource-parser` | Chat uses `fetch` POST streams, not `EventSource`. |
| PDF (server) | **`pdfjs-dist`** (legacy build) | Text items plus geometry. Add to `serverExternalPackages`. Ship `cmaps/` and `standard_fonts/`. |
| PDF (client) | **`react-pdf`** | Canvas rendering plus text layer for selection. Pin a pdf.js major version compatible with the server's. |
| DOCX | **`jszip` + `@xmldom/xmldom`** (custom OOXML parser) | Fallback: `mammoth` (raw text + HTML) if the custom parser throws. |
| DB | **Supabase Postgres**, accessed with **Drizzle ORM** + drizzle-kit migrations and the `postgres` (postgres-js) driver | `tsvector` generated column plus GIN index. pgvector is enabled in Supabase; an HNSW index is only needed for the semantic-search extra. |
| File storage | **Supabase Storage** via `@supabase/supabase-js` (server-side, service-role key) | Private bucket `documents`, path `{documentId}/original.{pdf\|docx}`. |
| Jobs | A **`jobs` table** in the same database, claimed with `FOR UPDATE SKIP LOCKED` (§8.12) | About 100 lines. A lease timeout gives retries and recovery after a restart. No extra service or library. |
| LLM | **`openai` npm SDK** against any OpenAI-compatible endpoint | OpenAI, OpenRouter, Gemini's OpenAI-compatible endpoint, Ollama, etc. |
| Validation | `zod` (+ `zod-to-json-schema`) and `jsonrepair` | Tool-argument validation; tolerant parsing of LLM JSON. |
| Tokens | `gpt-tokenizer` | Budgeting (approximate across providers; keep a safety margin). |
| Diff / fuzzy | `diff` (jsdiff), `fastest-levenshtein` | Comparison redlines; fuzzy checks. |
| Export (extra) | `docx` | Export an answer with its verified quotes. |
| Tests | `vitest` | Fixture generation with `pdfkit` and `docx`. |

**Do not use** the Vercel AI SDK's automatic tool loop. We need full control of dispatch, caps, error handling and event emission; the evaluators are specifically checking this. Plain `openai` SDK calls are enough.

---

## 5. Repository layout

```
.
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx, globals.css
│  │  ├─ page.tsx                         # Library
│  │  ├─ documents/[id]/page.tsx          # Single-document workspace (viewer + chat + clauses)
│  │  ├─ chat/[conversationId]/page.tsx   # Multi-document workspace
│  │  ├─ compare/page.tsx                 # Pick two documents
│  │  ├─ compare/[id]/page.tsx            # Comparison results
│  │  └─ api/ … (see §16)
│  ├─ components/
│  │  ├─ ui/ (shadcn)  library/  viewer/ (PdfViewer, DocxViewer, HighlightLayer)
│  │  ├─ chat/ (Thread, Message, CitationChip, SourcesList, CoverageBadge, ResearchTimeline, Composer)
│  │  └─ compare/ (ChangeList, ChangeCard, InlineDiff, SignificanceFilter)
│  ├─ lib/
│  │  ├─ config.ts                        # zod-validated env
│  │  ├─ db/ schema.ts, client.ts, queries/*.ts
│  │  ├─ storage/ supabase.ts              # upload / download / remove original files
│  │  ├─ llm/ client.ts, json.ts, tokens.ts, usage.ts
│  │  ├─ ingest/ validate.ts, pdf.ts, furniture.ts, docx/{parse.ts,numbering.ts,render.ts},
│  │  │          sections.ts, chunk.ts, embed.ts, clauses.ts, pipeline.ts, errors.ts
│  │  ├─ text/ normalize.ts, matchIndex.ts, verify.ts, highlight.ts, cache.ts
│  │  ├─ retrieval/ search.ts, rrf.ts, context.ts
│  │  ├─ chat/ prompts.ts, engine.ts, standard.ts, scan.ts, quoteStreamParser.ts, sse.ts,
│  │  │        runRegistry.ts, persist.ts, coverage.ts, history.ts
│  │  ├─ agent/ tools.ts, dispatch.ts, loop.ts, ledger.ts, labels.ts, prompts.ts
│  │  ├─ compare/ units.ts, align.ts, diff.ts, facts.ts, classify.ts, pipeline.ts
│  │  └─ jobs/ queue.ts (enqueue/claim/heartbeat/complete/fail), worker.ts
│  └─ instrumentation.ts                  # starts the worker in the Node runtime
├─ drizzle/                               # migrations (run against the Supabase database)
├─ scripts/ generate-fixtures.ts, migrate.ts
├─ tests/ unit/**, fixtures/**
├─ .env.example, README.md
```

---

## 6. Configuration (`.env.example`)

```bash
# Supabase (server-side only — never expose these to the browser, never prefix with NEXT_PUBLIC_)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<session-pooler-host>:5432/postgres
                                               # Supabase dashboard → Connect → "Session pooler" string
                                               # (IPv4-friendly; supports prepared statements)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-me           # used only for Storage calls
SUPABASE_STORAGE_BUCKET=documents

# Chat LLM (any OpenAI-compatible endpoint). Must support tool calling + JSON output.
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=replace-me
LLM_MODEL=replace-with-a-cheap-model           # a "mini"/"flash"-tier model is fine

# Embeddings: only for the optional "Semantic search" extra (§20). If unset, search is keyword-only.
EMBEDDING_BASE_URL=                            # defaults to LLM_BASE_URL
EMBEDDING_API_KEY=                             # defaults to LLM_API_KEY
EMBEDDING_MODEL=
EMBEDDING_DIMENSIONS=1536

# Behaviour / budgets
CONTEXT_BUDGET_TOKENS=20000     # max document tokens sent in one answer call (forces the large-doc strategy)
SCAN_WINDOW_TOKENS=8000         # window size for the full-document scan
SCAN_CONCURRENCY=4
AGENT_MAX_ROUNDS=8
AGENT_MAX_TOOL_CALLS=20
MAX_UPLOAD_MB=50               # Supabase's free plan caps a Storage upload at 50 MB; keep this ≤ your plan's limit
MAX_PAGES=500
RUN_WORKER=true
```

`src/lib/config.ts` parses these with zod at startup and fails fast with a readable error if a required variable is missing.

---

## 7. Data model (Drizzle; snake_case columns; all tables live in the Supabase database)

**Supabase setup (one time, in the first migration or the Supabase SQL editor):**
- `create extension if not exists vector with schema extensions;` Only needed for the semantic-search extra, but enabling it early is harmless.
- **Enable Row Level Security on every table and add no policies.**
  - Supabase automatically exposes the `public` schema through its REST Data API. RLS with no policies keeps that API closed.
  - Our server connects with the database connection string as the owner role, which bypasses RLS, so the app is unaffected.
- Create a **private** Storage bucket named `documents`.
- Never send the anon key or the service-role key to the browser.

```ts
documents {
  id uuid pk, name text, kind 'pdf'|'docx', size_bytes int,
  storage_path text /* "{id}/original.pdf" in the Supabase Storage bucket */,
  status 'queued'|'processing'|'ready'|'failed', stage text, progress int /*0-100*/,
  error_code text null, error_message text null,
  page_count int null, char_count int, token_count int,
  text text,                                   // canonical text (I1)
  furniture jsonb /* [[start,end],...] header/footer/page-number ranges */,
  unreadable_pages int[] /* pages with no/garbled text layer */,
  warnings jsonb /* [{code, message}] e.g. partial_scan, keyword_only_search */,
  search_mode 'keyword'|'semantic_and_keyword' /* the latter only with the semantic-search extra */,
  created_at, updated_at, processed_at
}
document_pages {                                                                   // PDF only
  document_id fk cascade, page_no int, char_start int, char_end int,
  width real, height real /* viewport @ scale 1, rotation applied */,
  items jsonb /* [[canonStart, length, x, y, w, h], ...] normalised 0..1, top-left origin */,
  pk(document_id, page_no)
}
document_html { document_id pk fk cascade, html text }                            // DOCX render (spans carry data-o offsets)
sections {
  id uuid pk, document_id fk cascade, ord int, number text null /* "12.3", "Schedule 2" */,
  title text, level int, parent_id uuid null, char_start int, char_end int,
  page_start int null, page_end int null
}
chunks {
  id uuid pk, document_id fk cascade, ord int, section_id uuid null,
  char_start int, char_end int, page_start int null, page_end int null,
  text text /* furniture removed */, search_text text /* "§12.3 Limitation of Liability — " + text */,
  token_count int,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,   // GIN index
  embedding vector(EMBEDDING_DIMENSIONS) null            // semantic-search extra only (HNSW cosine index)
}
clauses { id uuid pk, document_id fk cascade, type text, section_id uuid null,
          char_start int, char_end int, confidence real, source 'llm'|'keyword' }
conversations { id uuid pk, title text, kind 'single'|'multi', created_at, updated_at }
conversation_documents { conversation_id fk cascade, document_id fk cascade, tag text /* D1..D5 */,
                         pk(conversation_id, document_id) }
messages {
  id uuid pk, conversation_id fk cascade, role 'user'|'assistant',
  content text /* markdown; citations as ⟦c1⟧ tokens */,
  citations jsonb /* Citation[] (§9.6) */, coverage jsonb /* Coverage (§11.4) */,
  trace jsonb /* agent steps (§14.5) */, mode 'full'|'retrieval'|'scan'|'agent' null,
  status 'streaming'|'complete'|'stopped'|'interrupted'|'error', error jsonb null,
  usage jsonb /* {inputTokens, outputTokens, calls} */, created_at, completed_at null
}
comparisons { id uuid pk, doc_a_id fk, doc_b_id fk, status, stage, progress int,
              result jsonb /* §13.8 */, error_message text null, created_at, updated_at }
jobs {                                                   // background queue (§8.12)
  id uuid pk, type 'process-document'|'compare-documents', target_id uuid /* document or comparison id */,
  status 'queued'|'running'|'done'|'failed', attempts int default 0, max_attempts int default 3,
  run_after timestamptz default now(), locked_until timestamptz null, last_error text null,
  created_at, updated_at
  // partial unique index on (type, target_id) WHERE status IN ('queued','running')  → no duplicate jobs
}
```

**Deletion behaviour:**
- Deleting a document cascades to its pages, sections, chunks and clauses. The server then removes the original file from Supabase Storage. If that removal fails, log it; it doesn't block the delete.
- A single-document conversation is deleted with its document.
- A multi-document conversation loses the link for that document, and its UI shows "(deleted document)". The confirmation dialog says this.
- A running job for a deleted document must exit quietly. Every stage write is a conditional `UPDATE … WHERE id = $1 RETURNING id`; if no row comes back, abort (§8.12).

---

## 8. Ingestion

### 8.1 Upload and synchronous validation (`POST /api/documents`)

The client uploads **one file per request** with `XMLHttpRequest`, so it can show upload progress; `fetch` has no upload progress. Several files are uploaded in parallel, up to 3 at a time.

Server steps, in order:
1. **Size check.** Reject over `MAX_UPLOAD_MB` with HTTP 413: "`X.pdf` is 72 MB. The limit is 50 MB."
2. **Sniff magic bytes. Never trust the extension or MIME type alone.**
   - Starts with `%PDF-` (within the first 1 KB) → `pdf`.
   - Starts with `PK\x03\x04` → open with JSZip. The archive must contain `[Content_Types].xml` **and** `word/document.xml` → `docx`. `xl/…` or `ppt/…` → reject as "a spreadsheet/presentation".
   - Starts with `D0 CF 11 E0` (OLE2) → reject: "This looks like a legacy Word .doc file or a password-protected Word document. Save it as .docx (unprotected) and upload again."
   - Anything else → **HTTP 415:** "`notes.txt` isn't a PDF or Word (.docx) file. Only PDF and DOCX contracts are supported."
3. **Quick PDF open** (pdf.js `getDocument`, under a second).
   - `PasswordException` → reject with "password-protected".
   - A parse failure → reject with "file is damaged".
   - More than `MAX_PAGES` pages → reject.
   - Rejecting here means the user gets the error immediately.
4. **Store the file.** Generate the document id, then upload the bytes to Supabase Storage at `{id}/original.{ext}` with the correct `contentType`.
5. In **one transaction**, insert the `documents` row (`queued`, stage "Waiting to start") **and** its `jobs` row (`process-document`). Putting both in one transaction means a document can never exist without a job.
   - If the transaction fails, delete the uploaded object and return an error.
   - Return 201 with the document.

Every rejection returns `{ error: { code, message } }`, where `message` is written for end users. The UI shows it inline on the upload item, never only as a console error.

### 8.2 Processing job stages and progress

Handler `process-document(documentId)`. Each stage updates `stage` and `progress`, at most every 500 ms, in its own short transaction.

| Stage (shown to user) | Progress | Work |
|---|---|---|
| Reading file | 5 | Download bytes from Supabase Storage; re-validate. |
| Extracting text: page *n* of *N* | 5 → 55 | §8.3 (PDF) or §8.6 (DOCX). Yield to the event loop between pages (`await setImmediate`). |
| Checking text quality | 58 | §8.4. **May fail the job permanently** (no text layer). |
| Detecting headers and footers | 60 | §8.5 (PDF). |
| Finding sections | 65 | §8.7. |
| Preparing search index | 70 → 90 | §8.8 chunks, then bulk insert. Full-text search is indexed automatically by the generated `tsv` column. |
| Indexing for semantic search: *n*/*N* | 90 → 95 | §8.9. **Extra only**, and skipped when no embedding config is set. |
| Identifying clauses | 97 | §8.10 (keyword rules; non-fatal on failure). |
| Ready | 100 | Set `ready`, `processed_at`. |

**Idempotency:** at job start, delete any existing pages, sections, chunks, clauses and HTML for the document in one transaction, so a retried job starts clean. Chunk ids are regenerated each run; nothing else references them.

### 8.3 PDF extraction → canonical text + item geometry

Use pdfjs-dist in Node:
- Options: `cMapUrl` + `cMapPacked: true`, `standardFontDataUrl`, `isEvalSupported: false`, `useSystemFonts: false`.
- Without cMaps, CID fonts extract as garbage.

For each page:

1. `page.getViewport({ scale: 1 })` gives `vw, vh` (rotation applied). `page.getTextContent()` gives the items. Drop marked-content items (no `str`).

2. **Group items into lines.**
   - Compute each item's viewport transform: `tx = Util.transform(viewport.transform, item.transform)`. Then `fontH = Math.hypot(tx[2], tx[3])`, `x = tx[4]`, `yTop = tx[5] - fontH`, `w = item.width * viewport.scale`.
   - Start a new line when the previous item had `hasEOL`, or when `|baselineY − currentLineBaselineY| > 0.5 × fontH`.

3. **Join items within a line.** Insert a single space between consecutive items when the horizontal gap is greater than `0.15 × fontH` and neither side already has whitespace. Otherwise concatenate directly (pdf.js often splits words into several items).

4. **Join lines** with `\n`. **Join pages** with `\n\n`.

5. For every non-empty item, record `[canonStart, str.length, x/vw, yTop/vh, w/vw, fontH/vh]`.
   - For rotated text (`|atan2(tx[1], tx[0])| > 0.01`), store the axis-aligned bounding box of the rotated rectangle instead.
   - The stored boxes are normalised (0..1 of page width/height, top-left origin), so the client can render them at any zoom.

6. Save `document_pages` (`char_start`/`char_end` of each page within the canonical text, `width`, `height`, `items`).

Do not re-sort items; keep content-stream order. Multi-column layouts may interleave. This is a known limitation to state in the README.

### 8.4 Scanned and garbled page detection

For each page, count non-whitespace characters `n`, and letters or digits `a`.
- A page is **unreadable** if `n < 20` **or** `a / n < 0.5`. The second test catches `(cid:12)` output, private-use glyphs and U+FFFD runs.
- If **every page is unreadable**: fail the job with `error_code = 'no_text_layer'` (permanent, no retry). Message: *"This PDF has no selectable text — it looks like a scanned image. Scanned documents can't be analysed yet (OCR isn't supported). Please upload a text-based PDF or the original Word file."* **Do not mark it ready.**
- If **some pages are unreadable**: continue. Store `unreadable_pages` and add a warning `{code: 'partial_scan', message: 'Pages 12–14 have no readable text (likely scanned images) and cannot be searched or quoted.'}`. These pages count as *unread* in every coverage calculation (§11.4). The UI shows the warning on the library row and in the workspace.
- A DOCX with less than 50 non-whitespace characters fails with `empty_document`.

### 8.5 Page furniture (running headers, footers, page numbers)

**Why this matters:** a quote that crosses a page break usually has the footer ("Page 12 of 150"), the header ("CONFIDENTIAL — MSA") or both between its two halves in the extracted text. Without removing them, genuine cross-page quotes fail verification.

Algorithm (PDF only):
1. For each page, take lines whose top edge is in the top 8% or bottom 8% of the page.
2. Normalise each such line: lowercase, digits → `#`, collapse whitespace.
3. A normalised line that appears on at least 40% of pages (minimum 3 pages) is furniture on every page where it appears.
4. Also furniture, anywhere in the top or bottom band: lines matching `^\s*(page\s*)?#+(\s*(of|/)\s*#+)?\s*$`, `^\s*[-–]\s*#+\s*[-–]\s*$`, or a lone roman numeral.
5. Store the canonical ranges in `documents.furniture`.

Furniture **stays in the canonical text**, so geometry remains consistent. It is **excluded from**:
- the verifier's match index (§9.2);
- chunk text sent to the LLM (§8.8);
- highlight rectangles (§10.1);
- the displayed quote text.

### 8.6 DOCX parsing (custom OOXML) → blocks, numbering labels, HTML

**Why custom:** Word auto-numbering ("12.3") lives in `numbering.xml`, **not** in the paragraph text. Plain-text extractors drop it, which breaks section lookup ("clause 12.3"), comparison alignment and quotes that include the clause number. We also need the rendered HTML and the canonical text to come from one model (I1).

Parse with JSZip + xmldom:
- **Files:** `word/document.xml`, `word/styles.xml`, `word/numbering.xml`. Ignore headers, footers, footnotes and comments (state this in the README).
- **Block model:** a sequence of `Paragraph | Table`.
  - `Paragraph = { styleId, headingLevel?, numLabel?, runs: [{ text, b, i, u }] }`
  - `Table = rows → cells → Paragraph[]`
- **Runs:**
  - `w:t` gives text; `w:tab` gives `\t`; `w:br` and `w:cr` give `\n`.
  - Include text inside `w:hyperlink`, `w:sdt/w:sdtContent`, `w:smartTag` and `w:ins`.
  - **Skip** `w:del`/`w:delText`, so we render the final view of any existing tracked changes.
  - Fields: skip `w:instrText`; keep the result runs between `fldChar separate` and `end`.
- **Formatting:** bold, italic and underline come from `w:rPr`. Paragraph `w:pStyle` is resolved through `styles.xml`. A style named "heading N" or an `outlineLvl` gives the heading level; follow the `basedOn` chain up to 5 levels.
- **Numbering engine** (approximate Word behaviour, good enough for contracts):
  - `numPr` (`numId`, `ilvl`) comes from the paragraph or its style chain. `numId = 0` means not numbered.
  - `w:num[numId]` gives `abstractNumId` and optional `lvlOverride/startOverride`.
  - `abstractNum.lvl[ilvl]` gives `start`, `numFmt`, `lvlText` (e.g. `"%1.%2"`) and `isLgl`.
  - **Counters are keyed by `abstractNumId`.** A `num` with a `startOverride` resets that level on first use.
  - When a level increments, reset all deeper levels. A missing ancestor level uses its `start` value.
  - Format each `%k` by that level's `numFmt`: `decimal`, `decimalZero`, `lowerLetter`, `upperLetter`, `lowerRoman`, `upperRoman`, `bullet` (label = `•`), `none`. `isLgl` forces decimal.
  - **Bullets are rendered but not added to the canonical text.** Numeric and letter labels **are** added, as `label + " "`.
- **Canonical text:** paragraph texts joined with `\n`. Table cells are paragraphs, joined with `\n`, with `\n` between rows.
- **HTML render:**
  - Semantic `<h1-4>`, `<p>` and `<table>`.
  - Every text fragment goes in `<span data-o="{canonStart}">…</span>`, HTML-escaped.
  - Number labels go in `<span class="num" data-o=…>`.
  - Bullets go in `<span aria-hidden="true" class="bullet">•</span>` with no `data-o`.
  - Store the result in `document_html`.
- **Fallback:** if the custom parser throws, use `mammoth.convertToHtml` and run the same span/offset pass over mammoth's HTML using `linkedom`. Add warning `simplified_docx_render`.

DOCX has no pages. Citations show the section instead (e.g. "§12.3"), and coverage is reported in sections and percent.

### 8.7 Section detection

Output: an ordered list of sections, each with `number`, `title`, `level`, `char_start` and `char_end` (up to the start of the next section at the same or a higher level), plus parent links and pages.

- **DOCX:**
  - A paragraph is a heading if it has a heading style, **or** a numbering label whose paragraph is short (12 words or fewer) or starts with a bold run.
  - The title is the bold leading run, or the text up to the first period (at most 10 words).
  - The level comes from the numbering depth (`12` → 1, `12.3` → 2) or the heading level.
- **PDF:** use regexes on canonical *lines*, excluding furniture:
  - `^(ARTICLE|Article)\s+([IVXLC]+|\d+)\b[.:\s-]*(.*)$` → level 1
  - `^(SECTION|Section|Clause)\s+(\d+(\.\d+)*)\b[.:\s-]*(.*)$`
  - `^(\d{1,3}(\.\d{1,3}){0,3})\.?\s+([A-Z][^\n]{0,120})$` → level = number of number parts
  - `^(SCHEDULE|Schedule|EXHIBIT|Exhibit|ANNEX|Annex|APPENDIX|Appendix)\s+([A-Z0-9]+)\b(.*)$` → level 1
  - An ALL-CAPS line of 10 words or fewer with no trailing period → heading candidate
- **False-positive guards:**
  - Top-level numbers must be non-decreasing, stepping by 1 or 2; they may restart after a Schedule, Exhibit or Annex.
  - **Detect a table of contents:** lines ending in dot leaders or page numbers (`\.{3,}\s*\d+$`), or a heading sequence that repeats later in the document. Skip the first occurrence.
  - `(a)`, `(i)` and similar sub-items are never sections.
- **Fallback:** if fewer than 3 sections are found, create one pseudo-section per page ("Page 7"), or per 2,000 characters for DOCX. The tools and the outline then still work, and we add warning `no_structure_detected`.

### 8.8 Chunking (section-aware)

- Walk sections in order. A section's body runs from its `char_start` to the next section's start.
- Target **400–700 tokens** per chunk.
  - Merge consecutive small sections (under 120 tokens) that share a parent, until the target is reached.
  - Split large sections at paragraph boundaries (`\n`), then at sentence boundaries (`Intl.Segmenter` with a legal abbreviation guard list: `No.`, `Sec.`, `Art.`, `Inc.`, `Ltd.`, `Co.`, `e.g.`, `i.e.`, `U.S.`).
  - Overlap about 60 tokens **only within the same section**.
- `chunk.text` is the canonical slice with furniture ranges removed (replaced by a single space).
- `chunk.search_text` is `"§{number} {title} — " + text`. This improves keyword search on section references like "12.3". The offsets still refer to the canonical text.
- Store `page_start` and `page_end`, looked up by binary search over the page character ranges.

### 8.9 Embeddings (the optional "Semantic search" extra; build it in the extras phase, §20)

The core app works entirely on Postgres full-text search plus the full-document scan (§11). Add embeddings only after Parts A–C are done.
- Embed only if `EMBEDDING_MODEL` is set. Batch 64 chunk texts (`search_text`) per request and pass `dimensions` if the provider supports it.
- Retry transient failures up to 3 times with exponential backoff.
- If embedding still fails, the document **still becomes ready**, with `search_mode = 'keyword'` and warning `keyword_only_search`. Semantic search is an enhancement, never a single point of failure.
- Keep metadata such as UUIDs and file names out of the embedded text.

### 8.10 Clause index (feeds the Part C tool `list_clauses`)

- **Taxonomy:** `term_and_renewal`, `termination`, `payment`, `limitation_of_liability`, `indemnification`, `confidentiality`, `intellectual_property`, `warranties`, `governing_law`, `dispute_resolution`, `assignment`, `force_majeure`, `notices`, `non_compete_non_solicit`, `data_protection`, `entire_agreement`.
- **Core: keyword rules** on section titles, falling back to the first 200 characters of the body. Examples: `/terminat/` → termination, `/limitation of liability|liabilit(y|ies)\b/` → limitation_of_liability, `/governing law|applicable law/` → governing_law, and so on. No LLM call, so it is fast and can't fail the job.
- **"Clause extraction" extra only (§20):** add one LLM call over the outline (number + title + first 200 characters of each section, batched at 12k tokens). It returns JSON `{ "sections": [{ "number": "...", "types": ["termination"], "confidence": 0.0-1.0 }] }`. Validate with zod and keep only numbers that exist in our sections table. **Discard invented numbers.** If the call fails, keep the keyword results.

### 8.11 Failure taxonomy (`lib/ingest/errors.ts`)

| Code | Permanent? | User message (short form) |
|---|---|---|
| `unsupported_type` | yes | Only PDF and Word (.docx) files are supported. |
| `legacy_doc` | yes | Legacy .doc or protected Word file. Save it as .docx. |
| `password_protected` | yes | This PDF is password-protected. Remove the password and upload again. |
| `corrupted_file` | yes | This file appears to be damaged and can't be read. |
| `too_large` / `too_many_pages` | yes | Over the size or page limit (state the limits). |
| `no_text_layer` | yes | Scanned PDF with no selectable text (see §8.4). |
| `empty_document` | yes | The document contains no text. |
| `llm_unavailable`, `db_error`, `timeout`, `unknown` | **no** (retry) | Processing failed. Retrying… / Retry button after the final attempt. |

**Rules:**
- **Permanent errors:** throw a `PermanentIngestError`. The worker marks the document `failed` with its code and message, and marks the job `failed` **without scheduling a retry**.
- **Transient errors:** the worker re-queues the job with backoff (§8.12), up to `max_attempts = 3`. The UI shows "Retrying (attempt 2 of 3)…".
- **Unknown errors default to transient.**
- A failed document offers **Retry** (only when the code is transient) and **Remove**.

### 8.12 Job queue and recovery after a restart

This is needed anyway so a 150-page document can process in the background while the UI shows progress. It also covers the "Background processing" extra at no extra cost.

**Worker loop.** It starts in `instrumentation.ts` and runs up to 2 jobs at a time, polling every second:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.RUN_WORKER !== 'false') {
    const { startWorker } = await import('./lib/jobs/worker');
    await startWorker();                       // guard with a globalThis flag against double start in dev
  }
}
```

**Claim a job** atomically, using a lease:

```sql
UPDATE jobs SET status = 'running', attempts = attempts + 1,
                locked_until = now() + interval '2 minutes', updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE (status = 'queued' AND run_after <= now())
     OR (status = 'running' AND locked_until < now())      -- lease expired: previous worker died
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING *;
```

**While a job runs:**
- **Heartbeat:** every 30 s, push `locked_until` forward by 2 minutes.
- **Success:** `status = 'done'`.
- **Permanent error:** `status = 'failed'`, and mark the document failed.
- **Transient error:**
  - if `attempts < max_attempts`, set `status = 'queued'` and `run_after = now() + 10s × 2^attempts`;
  - otherwise set `failed`, and the document shows a Retry button.
- **Restart recovery:** if the server dies mid-job, the heartbeat stops and the lease expires within 2 minutes. The next claim picks the job up again and re-runs it from the start, which is safe because each run starts clean (§8.2).

**At boot:** mark messages still `streaming` whose `updated_at` is more than 3 minutes old as `interrupted`, keeping their partial content.

**Conditional stage writes:** `UPDATE documents SET … WHERE id=$1 AND status IN ('queued','processing') RETURNING id`. If no row comes back, the document was deleted or finished, so stop the job.

**Test it:** start a 150-page upload, kill the server during "Preparing search index", restart it, and confirm the document still reaches `ready`. Put this in the demo video.

---

## 9. Quote verification engine (the most important requirement)

Files: `lib/text/normalize.ts`, `matchIndex.ts`, `verify.ts`. They are pure functions with no DB access and exhaustive unit tests.

### 9.1 Design principles

1. **Map every normalisation back to the source.** Each normalised form keeps an `Int32Array` map from each normalised character to its canonical offset. We can always convert a match back to an exact canonical `[start, end)` span for highlighting and display.
2. **Try strict matching first, then loosen.** The ladder in §9.3 goes from strict to tolerant. Record which rung matched.
3. **Search for the quote inside the text.** For fuzzy matching, align the quote as a needle against a local window of the document. **Never use a whole-string similarity ratio** such as WRatio, token-set ratio or plain ratio of quote against page: a 200-character quote inside a 3,000-character page can never score well, so genuine quotes get rejected. Also require the window to be at least as long as the quote.
4. **Keep all occurrences, not just the first**, and choose the primary one using server-side knowledge (§9.5).
5. **Fail closed.** Anything uncertain is `unverified`. An unverified quote is never styled like a verified one.

### 9.2 Normalisation

`buildIndex(canon, mode, skipRanges) → { text: string, map: Int32Array }`. It iterates code points.

1. **Skip furniture.** Characters inside a skip range are treated as one whitespace boundary.
2. **De-hyphenate at line breaks.** Drop a `-` (or U+00AD) followed by optional spaces, `\n`, optional spaces, and then a lowercase letter, together with that whitespace. This joins "termi-\nnation" into "termination".
3. **Apply NFKC to each character.** It may expand (`ﬁ` → `fi`); every output character maps to the same canonical offset.
4. **Map character variants.**
   - U+2018 U+2019 U+201A U+201B U+2032 U+0060 U+00B4 → `'`
   - U+201C U+201D U+201E U+201F U+2033 U+00AB U+00BB → `"`
   - U+2010–U+2015 U+2212 U+FE58 U+FE63 U+FF0D → `-`
   - U+00A0 U+2000–U+200A U+202F U+205F U+3000 → space
5. **Drop** U+00AD, U+200B–U+200D, U+2060 and U+FEFF.
6. **Lowercase.**
7. **Apply the mode:**
   - `spaced`: collapse each whitespace run to one space. Punctuation is kept.
   - `compact`: remove all whitespace and all characters except `\p{L}`, `\p{N}` and `% $ € £ ¥ §`.

The quote goes through the same normalisation, with no skip ranges.

**Quote pre-clean**, before normalising:
- trim;
- strip wrapping quotation marks;
- strip leading and trailing ellipses;
- strip bracketed page artefacts `\[p\.?\s*\d+\]`;
- collapse internal newlines.

### 9.3 The matching ladder

```
T1  spaced   exact   : indexOf(normQuote) in spacedIndex (all occurrences)          → method 'normalized'
T2  compact  exact   : indexOf(compactQuote) in compactIndex (all occurrences)      → method 'compact'
    └─ numeric guard  : numbers in the quote must equal numbers in the matched span
T3  elided           : quote contains '...', '…' or '[...]' → split; each segment (≥ 3 words)
                       must match via T1/T2 in order, each starting after the previous end,
                       gap ≤ 2000 canonical chars                                    → method 'elided'
T4  fuzzy (≥ 40 compact chars only):
      anchors  = 4 slices of 16 chars at compact offsets 0, L/3, 2L/3, L-16
      cands    = every occurrence of each anchor (cap 50 per anchor) → implied start = pos − anchorOffset
                 (dedupe starts within 8 chars)
      for each cand: semi-global edit distance of quote vs compact[start−16 … start+L+16]
                 (free leading/trailing gaps in the window) → best (distance, span)
      accept if similarity = 1 − dist/L ≥ 0.95
                 AND numeric guard passes
                 AND token check passes (below)                                     → status 'verified_close'
else → 'unverified' (or 'misattributed', §9.4)
```

**Numeric guard.** Extract `/\d+(?:[.,]\d+)*/g` from the *spaced* quote and from the *spaced* canonical span, then remove `,` from each. The two sequences must be identical. This stops T2 and T4 from accepting "1.5%" for "15%", or "30 days" for "60 days".

**Token check (T4 only).** Run `diffWords` between the spaced quote and the spaced matched span. Every changed token pair must be:
- within edit distance 1 of each other;
- at least 4 characters long;
- not in `PROTECTED = {shall, may, must, will, should, not, no, never, without, except, unless, and, or, nor, including, excluding, only, any, all, none, each}`;
- not a number.

At most 1 changed pair is allowed per 25 tokens. Anything else is a paraphrase and is rejected.

**Length rules:**
- A quote with fewer than 3 words or fewer than 12 compact characters is `unverified` with reason `too_short`, unless it matches exactly (T1) exactly once.
- A quote longer than 1,500 compact characters is split into sentences and each sentence is verified. All must pass.

**Display text:** take `canon.slice(start, end)` with furniture ranges removed and whitespace collapsed. **This is what the UI shows as the quote.** When the status is `verified_close`, the UI also offers "Show differences from AI's wording" (a word diff).

### 9.4 Multi-document attribution

- Verify **only** against the document named by the quote's `doc` tag.
- If the quote is not found there but *is* found (T1–T3) in another document in the conversation, set status `misattributed` with `foundInDocId`.
  - It is still displayed as **unverified**: "Not found in *MSA_v2.pdf*. A matching passage exists in *MSA_v1.pdf*."
  - It is never shown as a verified quote from the claimed document.
- An unknown tag (e.g. `D7`) → `unverified`, reason `unknown_document`.

### 9.5 Multiple occurrences

- Collect every T1/T2 occurrence, up to 25.
- **Choosing the primary occurrence:** prefer the first occurrence that overlaps a chunk or tool result **the server actually sent to the model** for this answer. The server knows exactly which ranges were in context, so this uses no model-reported positions. Otherwise use the first occurrence in document order.
- The UI shows "Appears 3 times", with ‹ › to cycle occurrences in the viewer.

### 9.6 Citation object (stored in `messages.citations`, sent in the `citation` SSE event)

```ts
type Box = { page: number; rects: [x: number, y: number, w: number, h: number][] }; // normalised 0..1
type Occurrence = { start: number; end: number; pageStart?: number; pageEnd?: number;
                    sectionNumber?: string; sectionTitle?: string; boxes?: Box[] };
type Citation = {
  id: string;                         // "c1", "c2"… per message
  docId: string; docTag: string;      // "D1"
  status: 'verified' | 'verified_close' | 'unverified' | 'misattributed';
  method?: 'normalized' | 'compact' | 'elided' | 'fuzzy';
  score?: number;                     // T4 similarity
  reason?: 'not_found' | 'too_short' | 'unknown_document' | 'truncated' | 'stopped';
  modelText: string;                  // what the model wrote (UI shows it ONLY in the unverified style)
  displayText?: string;               // the document's own text (verified only)
  occurrences: Occurrence[];          // empty for unverified
  primary: number;
  segments?: Occurrence[];            // elided quotes: one per segment (all highlighted)
  foundInDocId?: string;              // misattributed
};
```

### 9.7 Performance

- Build `spaced` and `compact` indexes lazily per document and keep them in an LRU cache (about 12 documents).
- 150 pages is roughly 500k characters, which takes tens of milliseconds to index.
- A T1 or T2 lookup is `indexOf`. T4 costs O(L × window) per candidate, with at most about 200 candidates; that is fine for L ≤ 1,500.
- Verification runs inline in the stream (§11.6) and must add under 20 ms per quote.

### 9.8 Required unit tests (table-driven)

- Line break inside a quote (`"the Supplier shall\nindemnify"`).
- Hyphenation at a line end (`"termi-\nnation"`).
- Curly vs straight quotes; en/em dashes vs `-`; NBSP; the `ﬁ` ligature; soft hyphen.
- A word split by extraction (`"liab ility"`) → matches via T2.
- A quote across a page break with a footer and header in between (furniture skip).
- **Must reject:** a paraphrase (one word changed, "shall" → "may"), a changed number (`AED 100,000` vs `AED 1,000,000`), a merged pair of non-adjacent sentences, an invented sentence.
- Elided quote with `...` → verified with 2 segments; the same quote with segments in the wrong order → unverified.
- Repeated boilerplate → all occurrences returned, and the primary follows the context-overlap rule.
- Multi-document: the quote is in D2 but tagged D1 → `misattributed`.
- Short quote ("the Company") with 40 occurrences → `unverified(too_short)`.
- OCR-like typo in a long quote (one character) → `verified_close`.

---

## 10. Citation highlighting

### 10.1 PDF

**Server** (`lib/text/highlight.ts`): `boxesForSpan(docId, start, end)`.
1. Find the pages overlapping `[start, end)` by binary search over the page ranges.
2. For each overlapping item on those pages, skipping items inside furniture:
   - `s = max(start, itemStart) − itemStart` and `e = min(end, itemEnd) − itemStart`;
   - the rectangle is `[x + w·s/len, y, w·(e−s)/len, h]` (proportional character widths).
3. **Merge rectangles** on the same visual line (`|Δy| < 0.3h`, gap less than `0.6h`). Pad each by 1–2% of its height.
4. Return `Box[]`. It can cover several pages, and several lines per page.

These are computed once at verification time and stored in the citation, so the client does no text matching.

**Client** (`PdfViewer`):
- `react-pdf` renders pages with `renderTextLayer` on (so text can be selected) and the annotation layer off.
- **Virtualise:** render only pages within ±2 of the viewport, using IntersectionObserver. Placeholders are sized from the stored page `width`/`height`, so scroll offsets are correct before a page renders. This is essential for 150 pages.
- `HighlightLayer` draws absolutely positioned divs over each page, sized in **percentages** of the page box, so zoom has no effect: `left: x*100%`, `top: y*100%`, and so on.
- **Clicking a citation:**
  1. Open the viewer if it is closed (on mobile it becomes a sheet), and switch to the right document tab in multi-document mode.
  2. Smooth-scroll so the first rectangle sits about 120 px below the viewer top.
  3. Draw every box: across lines, across pages, and every segment of an elided quote.
  4. Play a short "flash" (600 ms pulse). The highlight then stays until the next citation click, or until the user presses Esc or clicks "Clear highlight".
- **Other occurrences** of the same quote are drawn faintly, with an "Occurrence 2 of 3 ‹ ›" pill in the viewer toolbar.

### 10.2 DOCX

- The client renders the stored HTML (ours, already escaped) in a document-styled container with serif typography and generous line height.
- After mount, it builds a sorted index of `[canonStart, textNode]` from every `[data-o]` span.
- To highlight `[start, end)`:
  1. Find the first and last spans by binary search.
  2. Build a DOM `Range` from `(firstTextNode, start − spanStart)` to `(lastTextNode, end − lastSpanStart)`.
  3. Register it with the **CSS Custom Highlight API** (`CSS.highlights.set('citation', new Highlight(range))`) and style it with `::highlight(citation)`.
  4. If `CSS.highlights` is undefined, fall back to wrapping the range in `<mark>` elements, one per text node, and unwrap on clear.
- Scroll with `range.getBoundingClientRect()` relative to the scroll container. Flash the same way as PDF.

### 10.3 Acceptance checks

- Build a PDF fixture (§18.1) with a quote wrapped over 3 lines → 3 rectangles on 1 page.
- A quote crossing pages 12→13 → rectangles on both pages, and **none over the footer or header**.
- A repeated clause → cycling works.
- A DOCX quote spanning a bold run and a normal run → one continuous highlight.
- The 150-page PDF scrolls to page 140 in under 1 second.

---

## 11. Chat (single document) and the large-document strategy

### 11.1 Answer modes

```
chooseMode(question, docs, userOptions):
  if userOptions.agent                            → AGENT  (§14)
  if totalDocTokens(docs) ≤ CONTEXT_BUDGET_TOKENS → FULL       (entire text in context; coverage 100%)
  if userOptions.thorough || isExhaustive(q)      → SCAN       (map over every window, then reduce)
  else                                            → RETRIEVAL  (search top-k excerpts + outline)
RETRIEVAL result == NOT_FOUND → auto-escalate to SCAN (status: "Not in the retrieved sections — reading the whole document…")
```

- `CONTEXT_BUDGET_TOKENS` defaults to 20k, **on purpose**. A 150-page contract (about 80–120k tokens) then always exercises the strategy, even on a model with a large context window. It is configurable; document this in the README.
- **`isExhaustive(q)`** is a heuristic regex for questions whose true answer may be "no", or that need every instance: `/\b(is there|are there|does (it|the \w+) (contain|include|have|mention|say anything)|any\b|all\b|every|each|list|how many|whether|anywhere|at all)\b/i`.
- The composer has a **"Read entire document"** toggle (Thorough) and an **"Research agent"** toggle (Part C). They are mutually exclusive.

### 11.2 RETRIEVAL context building (`lib/retrieval/`)

1. **Query variants.** One quick JSON call returns `{ "queries": [3 short keyword queries incl. legal synonyms], "sections": ["12.3"]? }`. For example: termination → "terminate", "termination for convenience", "expiry", "notice of termination". Skip it if the call takes over 2.5 s.
2. **Keyword search** per variant: `websearch_to_tsquery('english', q)` with `ts_rank_cd`, top 20. Add a **phrase boost** for quoted phrases and capitalised defined terms ("Force Majeure", "Confidential Information") via `search_text ILIKE`. Add **exact section lookup** when the question names a section ("clause 12.3" → chunks of that section and its children).
3. **Vector search**, only once the semantic-search extra is built and embeddings exist: cosine similarity, top 20.
4. **Fuse** with Reciprocal Rank Fusion (`k = 60`) across all lists. Without embeddings, fuse only the keyword lists.
5. **Fill the budget.** Take chunks in fused order until `CONTEXT_BUDGET_TOKENS − overhead` is used. Then add neighbours (±1 chunk) of the top 3 if room remains.
6. **Reorder the chosen chunks by document position.** Merge adjacent ones. Separate non-contiguous excerpts with `[…]`.
7. **Always include the outline:** every section's number and title as a compact list, capped at 1.5k tokens. The model then knows the whole structure even when it sees only excerpts.
8. Record `readRanges` (the canonical ranges of the chunks sent) for coverage and for choosing primary occurrences.

The context has **no page markers**. We never want the model to cite positions (I2). Each excerpt gets a heading taken from document text: `── §12 Limitation of Liability ──`.

### 11.3 SCAN (full-document map → reduce)

1. Split the furniture-free text into windows of `SCAN_WINDOW_TOKENS` (default 8k), aligned to chunk boundaries, with one chunk of overlap. A 150-page contract gives about 12–15 windows.
2. **Map**, with `SCAN_CONCURRENCY` (4) calls in parallel, JSON mode. Prompt: §11.9 `SCAN_MAP`. Output: `{ "relevant": boolean, "findings": [{ "quote": "...", "why": "..." }] }`, at most 6 findings.
   - Stream progress: `status {text: "Reading pages 31–45 (3 of 12)…", progress: {done, total}}`.
   - For DOCX, report "sections 8–14" instead of pages.
3. **Verify every finding immediately** against the document (§9). **Discard unverified findings**; count them for logs.
4. **Retries:** each window gets 2 attempts (`jsonrepair` + zod; on a parse failure, retry once with the error message). A window that still fails is recorded in `failedRanges` with its pages.
5. **Reduce:** one streaming call. Context = outline + verified findings, shown as numbered excerpts of the *document's* text with ±300 characters of surrounding context + question. Prompt: §11.9 `ANSWER` with the coverage statement "You were given the relevant passages found by reading the ENTIRE document…". The final quotes are verified again, as usual.
6. **No findings:**
   - Coverage complete → the answer is written by the server, not the model: *"I read the entire document (150 pages) and found no provision addressing {topic}."* `{topic}` comes from the query-variants call or a quick one-line LLM rephrase.
   - Coverage incomplete → *"I couldn't find anything about {topic} in the pages I could read (1–45, 61–150). Pages 46–60 couldn't be analysed, so I can't rule it out."*

### 11.4 Coverage (`lib/chat/coverage.ts`)

```ts
type Coverage = {
  mode: 'full' | 'retrieval' | 'scan' | 'agent';
  complete: boolean;                         // true ONLY if every doc fraction === 1 and no failures/unreadable pages
  perDoc: Array<{
    docId: string; tag: string; name: string;
    totalChars: number;                      // excluding furniture
    readRanges: [number, number][];          // canonical ranges the model actually saw (merged)
    fraction: number;                        // read chars / totalChars
    pagesRead?: string;                      // "3–5, 41–44, 88" (compressed)  (PDF)
    sectionsRead?: string;                   // "§3, §12–14"                   (DOCX / agent)
    unreadablePages?: number[];              // from ingestion (§8.4)
    failedRanges?: { pageStart: number; pageEnd: number; reason: string }[];
  }>;
};
```

**Server-side absence enforcement** (I3), applied after every answer:
- A model answer that begins with `[[NOT_FOUND]]` in RETRIEVAL mode triggers escalation to SCAN. The sentinel is never shown.
- As a backstop, if the final answer text matches the **absence-claim regex** `/\b(does not|doesn't|do not) (contain|include|mention|address|specify|provide)|\bno (provision|clause|mention|reference)\b|\bis silent\b|\bnot (addressed|specified|mentioned|covered)\b/i` **and** `coverage.complete === false`:
  - append a server `notice`: *"This answer is based on excerpts (12% of the document). Statements that something is absent may be wrong."*;
  - add a **[Check the entire document]** button, which re-asks with Thorough on.
- Unreadable pages always produce a coverage note: "Pages 12–14 are scanned images and were not read".

**UI coverage badge** on every answer:
- green "Read entire document";
- blue "Read 9 of 64 sections · pp. 3–5, 41–44";
- green "Scanned all 150 pages";
- amber "Scanned 135 of 150 pages · pp. 46–60 failed".

Tooltip: the full breakdown.

### 11.5 Streaming protocol (SSE over `fetch` POST)

`POST /api/conversations/:id/messages` with body `{ content, options: { thorough?, agent? } }`. The response is `text/event-stream`.

Headers: `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

**Check in the production build that tokens really stream.** If they arrive in bursts, disable Next.js response compression (`compress: false`) for this route or globally.

Send a `: ping` comment line immediately, then every 15 s.

| event | data | notes |
|---|---|---|
| `meta` | `{ messageId, userMessageId, conversationId, mode, docs:[{tag,id,name}] }` | first event |
| `status` | `{ text, progress?: {done,total} }` | human-readable phase ("Finding relevant sections…", "Reading pages 31–45 (3/12)…"). Never ends the stream. |
| `tool_call` | `{ callId, name, label, args }` | agent only (§14) |
| `tool_result` | `{ callId, ok, summary, ms }` | agent only |
| `text` | `{ delta }` | answer markdown. Contains `⟦cN⟧` tokens where citations sit. Never contains raw `<quote>` tags. |
| `quote_pending` | `{ id }` | a quote has opened; the UI shows a "verifying…" chip |
| `citation` | `Citation` (§9.6) | sent **before** the `text` delta containing its `⟦cN⟧` token |
| `coverage` | `Coverage` | sent before `done` (and on escalation) |
| `notice` | `{ code, text, action? }` | non-fatal: `ESCALATING`, `ABSENCE_UNVERIFIED`, `NO_VERIFIED_QUOTES`, `RETRYING`, `AGENT_CAP`, `QUOTE_TRUNCATED` |
| `error` | `{ code, message, retryable }` | fatal only; always followed by `done` |
| `done` | `{ status: 'complete'\|'stopped'\|'error', messageId }` | **exactly once, always last** |

Each event carries an incrementing `id:`.

The client parses with `eventsource-parser` and keeps a message state machine: `pending → streaming → complete | stopped | error`.

### 11.6 Quote stream parser (`lib/chat/quoteStreamParser.ts`)

The model writes quotes inline as `<quote doc="D1">verbatim text</quote>`; most models handle XML-like tags well.

The server parser sits between the LLM token stream and the SSE writer:
- **TEXT state:**
  - Forward text immediately, **except** a trailing suffix that could be the start of `<quote`. Hold back up to 6 characters, e.g. if the buffer ends in `<`, `<q` or `<quo`.
  - Also hold the first 16 characters of the whole answer, to detect and strip the `[[NOT_FOUND]]` sentinel.
- **On a complete opening tag:**
  - Parse `doc` (default `D1` in single-document chats).
  - Allocate `cN` and emit `quote_pending {id}`.
  - Enter QUOTE state.
  - If the tag hasn't closed within 80 characters, treat the text as plain text.
- **QUOTE state:** buffer until `</quote>`.
  - Guard: if the buffer exceeds 1,500 characters, stop buffering and mark the quote `unverified(truncated)`.
- **On close:**
  1. `verifyQuote(docId, text, contextRanges)`;
  2. emit `citation`;
  3. emit `text {delta: "⟦cN⟧"}`.
- **At stream end or on stop:**
  - A quote still open → `citation {status: 'unverified', reason: 'stopped' | 'truncated'}`. Its **text is never shown as a quote**.
  - Flush any held-back text.
- **After a complete answer:**
  - If the answer had quotes and **none** verified → `notice NO_VERIFIED_QUOTES` ("None of the quotes in this answer could be found in the document. Treat it as unsupported.").
  - If the answer had no quotes at all and is not a not-found answer → the same notice.

Tests: split every fixture answer at **every** character index across two deltas, and assert identical output. Include tags split across deltas, a tag that never closes, and nested or garbled tags.

### 11.7 Rendering answers (client)

- Store the content with `⟦cN⟧` tokens. Before handing it to `react-markdown`, replace each token with a link `[N](#cite-cN)`. A custom `a` renderer draws `CitationChip` for `#cite-` links.
- **`CitationChip`:**
  - **Verified:** a small numbered pill in the document's colour. Hover shows a preview card with the document's quote text, "§12.3 · p. 41", and "✓ Verified in document". Click highlights the passage in the viewer (§10).
  - **Pending:** a grey pill with a spinner.
  - **Unverified:** a small amber "unverified" tag, not numbered like a real source. Hover: "This text could not be found in {doc}. It may be paraphrased or invented." It is not clickable into the document.
- **`SourcesList`** below the answer: one card per verified citation (document chip, section, page, quote in serif, "Open in document"). Then a collapsed **"Unverified (2)"** group showing `modelText` struck through, labelled "Not found in document".
- **Footer:** the coverage badge, "3 of 3 quotes verified", mode label, and copy / export (extra) / regenerate.
- **While generating:** a status line (spinner + phase text + elapsed seconds), and the composer's Send button becomes **Stop**. Esc also stops.
- **After a stop:** a grey "Stopped" tag. The partial text and its verified citations remain.

### 11.8 Stop, persistence and history

- **Run registry** (`runRegistry.ts`, in memory, one process): `Map<messageId, AbortController>`, and at most one active run per conversation (a second send returns 409, "An answer is still being generated").
- **Stop paths:**
  1. The client calls `POST /api/messages/:id/stop`, which calls `controller.abort()`.
  2. The client also aborts its own fetch.
  3. `request.signal`'s `abort` (client disconnect) aborts with reason `disconnect`.
  4. The ReadableStream's `cancel()` callback aborts too.

  Pass `signal` to the OpenAI SDK call so the upstream stream is cancelled.
- **Persistence:**
  1. Insert the user message.
  2. Insert the assistant message with `status 'streaming'` before calling the LLM.
  3. Flush `content` and `citations` every 1.5 s (short update).
  4. In `finally`:
     - finalise the parser;
     - write the final content, citations, coverage, trace and usage;
     - set `status` to `complete`, `stopped` (user stop or disconnect) or `error`;
     - emit `done` if the connection is still open.

  **Record usage even for stopped runs.**
- **History sent to the model:** the last user/assistant turns, newest first, within 3k tokens. Quote tags are rendered as plain quoted text; stopped answers get the suffix "[answer interrupted]". Report `historyIncluded` in `meta` if older turns were dropped.
- **Per-document history:**
  - `GET /api/conversations?documentId=` lists threads (title = first question, truncated to 60 characters).
  - The workspace has a "History" dropdown with a "New chat" button.
  - Reopening a thread shows the messages with fully interactive citations, because the boxes are stored.

### 11.9 Prompts (`lib/chat/prompts.ts`; draft wording, tune as needed)

**`ANSWER` system prompt** (standard modes; `{…}` are filled in by code):

```
You are a contract analysis assistant. You answer questions using ONLY the contract text provided
between <documents> tags. Do not use outside knowledge of law or of typical contracts to fill gaps.

EVIDENCE RULES
- Support every factual statement with at least one verbatim quote, written as
  <quote doc="D1">exact words from the document</quote>, placed right after the statement it supports.
- Copy quotes character-for-character. Do not fix typos, change capitalisation, paraphrase, or join
  text from different places. Prefer a single sentence or clause (8–60 words).
- To skip words inside a quote, use "..." only between two verbatim parts of the same passage.
- The doc attribute must be the tag of the document the words come from.
- Do not mention page numbers or character positions. The app locates quotes itself.

COVERAGE
{COVERAGE_STATEMENT}
  full:      "You have been given the ENTIRE text of each document."
  retrieval: "You have been given EXCERPTS only (sections {list}), about {pct}% of the document.
              You have NOT seen the rest. Never state that the document lacks something."
  scan:      "You have been given the relevant passages found by reading the ENTIRE document."

IF THE ANSWER IS NOT IN THE TEXT
- Reply with exactly [[NOT_FOUND]] on the first line, then one sentence saying what you looked for.
  Do not guess and do not answer from general knowledge.

STYLE
- Lead with the direct answer in one or two sentences, then details as short bullets.
- Mention clause numbers and headings when they appear in the text. Plain English. No disclaimers.
```

**Multi-document additions** (§12): see §12.2.

**`SCAN_MAP`** (JSON mode):

```
You are reading one part of a contract to find passages relevant to a question.
Return JSON: {"relevant": boolean, "findings": [{"quote": string, "why": string}]}
- "quote" must be copied verbatim from the text below (one sentence or clause, 8–60 words).
- Include every passage that helps answer the question, including passages that show the
  answer is "no" or that limit or qualify it. At most 6 findings.
- If nothing in this part is relevant, return {"relevant": false, "findings": []}.
Question: {question}
Text (part {i} of {n}):
<text>{window}</text>
```

**`QUERY_VARIANTS`** (JSON): `{"queries": [...3 short keyword queries...], "sections": [...section numbers explicitly mentioned...], "topic": "3-6 word noun phrase"}`.

---

## 12. Multi-document questions

### 12.1 Flow

- In the library, select 2–5 **ready** documents and click **Ask across documents**. This creates a conversation of kind `multi`, with tags D1…Dn in selection order and fixed colours per tag (D1 indigo, D2 teal, D3 amber, D4 rose, D5 violet).
- The workspace at `/chat/[conversationId]` shows a document-tab viewer on the left and the chat on the right.
- **Context budget:** `CONTEXT_BUDGET_TOKENS` is split evenly per document. Each document's section is built independently in FULL or RETRIEVAL mode, so every document is always represented and one long document can't crowd out the others.
- **SCAN** runs per document (the windows of all documents share the concurrency pool). Coverage is reported per document.
- The escalation and absence rules apply **per document**. "D2 does not address X" is allowed only if D2's coverage is complete. Otherwise the server notice names the document.

### 12.2 Prompt layout

```
<documents>
<document tag="D1" name="MSA_Acme_2023.pdf" coverage="full">
…text or excerpts…
</document>
<document tag="D2" name="MSA_Acme_2024.pdf" coverage="excerpts: §3, §12–14 (about 15%)">
…
</document>
</documents>
```

Extra rules:

```
COMPARISON RULES (more than one document)
- Organise the answer by issue, not by document. For each issue: state how each document treats it
  with a quote from THAT document, then a "Difference:" line and a "Why it matters:" line.
- Finish with a two-to-four sentence synthesis of the material differences. Do not write
  separate per-document summaries.
- Every quote's doc attribute must be the tag of the document it comes from; it will be checked
  against that document only.
- If a document's text you were given does not address an issue, say "D2 (name): not addressed in
  the text provided" — never infer what it says.
- File names mentioned inside a document are references, not documents you were given.
```

### 12.3 UI

- Each citation chip and source card shows the document's colour and short name.
- Clicking a citation switches the viewer tab to that document, then highlights.
- The coverage badge expands to one line per document.

---

## 13. Document comparison (clause-level, significance-rated)

Job `compare-documents(comparisonId)`. Page: `/compare/[id]`. Status and progress are shown the same way as ingestion ("Aligning clauses…", "Classifying changes 12/40…").

### 13.1 Units

- **Units are leaf-level sections**, taken from both documents' `sections` tables. A leaf is a section with no child sections; if a parent has body text before its first child, that text becomes its own unit.
- Very long units (over 1,500 tokens) are split into paragraphs.
- If a document has fewer than 5 real sections, units are paragraphs instead.
- **Filter non-substantive units:** signature blocks (`By:`, `Name:`, `Title:`, `IN WITNESS WHEREOF`), tables of contents, and empty headings.
- Each unit: `{ id, docId, number, title, text, compact /* §9.2 compact norm */, start, end }`.

### 13.2 Alignment (order-aware, handles renumbering and moves)

1. **Exact pass.** Match units whose `compact` hashes are identical → `unchanged`. This works across renumbering and moves: if the positions differ, it is `moved` with no text change.
2. **Similarity** for the remaining units:
   `sim(a, b) = max(jaccard(word 3-shingles), cosine(embeddings) if available) + 0.05·[same number] + 0.05·[title similarity ≥ 0.8]`.
3. **Monotone alignment:** Needleman–Wunsch-style dynamic programming over the two remaining sequences. Match score = `sim` if `sim ≥ 0.35`, otherwise not allowed; gap penalty 0. Matched pairs become `modified`, or `unchanged` if the texts are equal after spaced normalisation.
4. **Move detection:** among units still unmatched, pair `(a, b)` where `sim ≥ 0.5`, best-first → `moved` (+`modified` if the text differs).
5. Whatever remains in A is `removed`; whatever remains in B is `added`.
6. **Invariant (assert it in code and tests):** every unit of A and B ends up in exactly one bucket. Nothing is silently dropped.

Known limitation (README): a clause split in two, or two clauses merged, shows as modified + added (or removed).

### 13.3 Diff per pair

- Use `diffWordsWithSpace` from jsdiff on the spaced forms (keeping the original text for display). Then consolidate: merge change hunks separated by an unchanged run of 3 words or fewer, so the redline reads as phrases rather than confetti.
- **Cosmetic short-circuit:** if the two texts' `compact` forms are equal, only whitespace, punctuation or case changed → `significance = 'cosmetic'`, no LLM call.

### 13.4 Deterministic "facts changed" (`lib/compare/facts.ts`)

Run the extractors on the old and new text of each changed unit:

- **money:** `/(AED|USD|EUR|GBP|SAR|INR|\$|€|£)\s?\d[\d,]*(\.\d+)?(\s?(million|m|thousand|k|bn|billion))?/gi` plus spelled-out forms such as "one hundred thousand dirhams".
- **percentages**, **durations** (`/\b(\d+|[a-z-]+)\s*\(?\d*\)?\s*(business\s+)?(days?|weeks?|months?|years?)\b/i`), **dates**, and **plain numbers**.
- **modality:** `shall`, `must`, `will`, `may`, `is entitled to`, `at its sole discretion`, `reasonable efforts`, `best efforts`.
- **negation / exceptions:** `not`, `no`, `never`, `without`, `except`, `unless`, `notwithstanding`.
- **defined terms and parties:** capitalised terms defined in the document (`"X" means` / `("X")`).
- **jurisdiction:** `laws of <X>`, `courts of <X>`, arbitration seats.

Emit `facts: [{ kind: 'money'|'percent'|'duration'|'date'|'modality'|'negation'|'party'|'jurisdiction', before, after }]`. Examples: `{kind:'money', before:'AED 100,000', after:'AED 1,000,000', ratio: 10}` and `{kind:'modality', before:'shall', after:'may'}`.

### 13.5 LLM classification (batched, JSON)

Send 8 changed units per call: the unit ids, number and title, the old and new text (each trimmed to 1,200 tokens around the hunks), the diff hunks, and the extracted facts.

```
For each change, return:
{"id": string, "significance": "critical"|"major"|"minor"|"cosmetic",
 "category": "liability"|"indemnity"|"payment"|"term"|"termination"|"ip"|"confidentiality"|
             "governing_law"|"obligations"|"scope"|"warranties"|"data_protection"|"other",
 "summary": "one plain-English sentence stating what changed in substance, naming concrete
             before → after values (amounts, periods, parties) when present",
 "favours": "party name or 'neutral' or 'unclear'"}
Rubric:
- critical: shifts major risk or money — liability caps, indemnities, payment amounts, termination
  rights, exclusivity, IP ownership, governing law or forum.
- major: changes obligations, deadlines, notice periods, conditions, scope, warranties, remedies.
- minor: small substantive change with limited practical effect (addresses, clarifications that
  narrow ambiguity slightly).
- cosmetic: wording, formatting, typos, renumbering — rights and obligations are unchanged.
Be conservative: if a rewording could change meaning, it is at least minor.
```

**Deterministic floors.** The LLM can raise significance above a floor, never lower it:
- a money or percent change → at least `major`; a money ratio ≥ 5× or ≤ 0.2× → `critical`;
- a duration change → at least `major`;
- a modality flip (shall/must ↔ may) or a negation added or removed → at least `major`;
- a jurisdiction change → `critical`;
- an `added` or `removed` whole clause → at least `minor`, and at least `major` if its title matches the liability, indemnity, termination, payment, IP or governing-law patterns.

If the LLM fails for a batch, apply the floors and the text "Changed; classification unavailable". **Never drop the change.**

### 13.6 Executive summary

One call over the critical and major changes (id, category, summary, facts). It produces 3–6 bullets, each referencing changes as `[C12]`, which the UI links. The summary has no free-form quotes; all document text shown on this page comes from the diff itself.

### 13.7 UI (`/compare/[id]`)

- **Header:** "Original: *MSA_v1.docx* → Revised: *MSA_v2.docx*", counts per significance, counts per change type.
- **Executive summary card.**
- **Toolbar:**
  - significance filter chips (Critical / Major / Minor / Cosmetic; cosmetic **off by default**);
  - type filter (Modified / Added / Removed / Moved);
  - sort (Significance | Document order);
  - a search box.
- **Change card:**
  - significance badge and category;
  - "§12.3 → §13.3 Limitation of Liability";
  - the plain-English summary;
  - a **facts table** (e.g. "Liability cap: AED 100,000 → **AED 1,000,000**");
  - an expandable inline redline (insertions green and underlined, deletions red and struck through);
  - "View in original" / "View in revised" buttons that open a side-by-side viewer and highlight the unit in both documents.
- **Empty state:** "No differences found. The documents are identical in substance." **Error state:** retry.

### 13.8 Result shape (`comparisons.result`)

```ts
{ summary: { bullets: string[] }, counts: {...},
  changes: Array<{ id: 'C1', type: 'modified'|'added'|'removed'|'moved'|'unchanged',
    a?: { number, title, start, end }, b?: { number, title, start, end },
    significance, category, summary, favours, facts, hunks: Array<{op:'eq'|'ins'|'del', text}>,
    classifiedBy: 'llm'|'rules' }> }
```

Unchanged units are stored (for counts), but the UI hides them unless the user chooses "Show unchanged".

---

## 14. Part C: agentic document research

**Enabled with the "Research agent" toggle** in the composer. It works in single- and multi-document chats. The standard pipeline remains the default.

### 14.1 Tools (`lib/agent/tools.ts`)

- All tools take `doc` (a document tag, required in multi-document chats, default `D1`).
- Every tool returns JSON. **A failure is returned as a result, never thrown.**
- Every tool that returns document text records the canonical ranges it returned, for coverage and primary-occurrence choice, and assigns `evidenceId`s.

| Tool | Args (zod) | Returns |
|---|---|---|
| `get_outline` | `{doc}` | `{sections:[{number,title,level,pages:"41–44"}], total_sections, total_pages}`. If there are more than 150 sections, returns levels 1–2 with a `hint`. |
| `search_document` | `{doc, query: string(2..200), limit?: int(1..8)=5}` | `{searched: true, query, total_hits, hits:[{evidenceId, section:"12.3 Limitation of Liability", pages:"41", text≤900 chars, truncated}] }`. If search itself fails: `{searched:false, reason}`, which is distinct from zero hits. |
| `get_section` | `{doc, number: string, offset?: int=0}` | `{section:{number,title,pages}, evidenceId, text≤6000 chars, total_chars, next_offset?, subsections:[…]}`. Not found → `{error:"SECTION_NOT_FOUND", did_you_mean:["12.2","12.4"], hint:"call get_outline"}`. |
| `read_pages` | `{doc, start: int, end: int}` (at most 3 pages) | `{pages:[{page, evidenceId, text}], total_pages}`. Out of range → `{error:"PAGE_OUT_OF_RANGE", valid:"1–150"}`. DOCX → `{error:"NO_PAGES", hint:"use get_section"}`. |
| `find_exact` | `{doc, text: string(3..200)}` | `{match_count, matches_shown≤15, matches:[{evidenceId, section, pages, context≤300}]}`. Uses the §9 T1 index; good for defined terms. |
| `list_clauses` | `{doc, type?: enum(taxonomy §8.10)}` | `{clauses:[{type, section, title, pages, snippet≤240}], source:"keyword"}` (`"llm"` once the clause-extraction extra exists). If nothing matches → `{clauses:[], hint:"No section titles matched; try search_document"}`. |
| `check_entire_document` | `{doc, question: string}` | Runs the §11.3 SCAN map step. `{coverage:"complete"\|"partial", findings:[{evidenceId, section, pages, quote}], failed_pages?}`. **At most once per run.** It counts as 3 tool calls against the ledger. This is the only way the agent can claim something is absent. |
| `finish_research` | `{ready: boolean, note?: string}` | Ends the research phase. |

**Status labels** are functions of the arguments, never a generic spinner:

| Tool | Label |
|---|---|
| `search_document` | `Searching for "termination for convenience"…` |
| `get_section` | `Reading §12.3 Limitation of Liability…` (title looked up; `Reading section 12.3…` if unknown) |
| `read_pages` | `Reading pages 41–43…` |
| `find_exact` | `Finding every mention of "Force Majeure"…` |
| `list_clauses` | `Listing indemnification clauses…` |
| `get_outline` | `Reviewing the contract's structure…` |
| `check_entire_document` | `Reading the entire document (this takes a moment)…` |

In multi-document chats, labels are prefixed with the document's short name.

### 14.2 Ledger and caps (`lib/agent/ledger.ts`)

```ts
const CAPS = {
  maxRounds: env.AGENT_MAX_ROUNDS ?? 8,
  maxToolCalls: env.AGENT_MAX_TOOL_CALLS ?? 20,
  maxCallsPerRound: 4,              // extra calls in one round → refused with a message
  maxInputTokens: 150_000,          // cumulative across the run; checked BEFORE each model call
  maxOutputTokens: 12_000,
  wallClockMs: 90_000,
  toolTimeoutMs: 15_000,
  maxToolResultChars: 8_000,        // applied to the WHOLE serialized result envelope
  windDownRounds: 1,
  repeatFailureLimit: 3,
};
```

- **Check before calling, not after.** `ledger.canAfford(estimateTokens(messages))` runs before every model call, so the budget can't be overshot by one expensive round.
- `ledger.claimToolCall()` runs before each execution. Past the cap, the call gets a refusal result: "Tool-call limit reached; call finish_research."
- **Fit the whole result** to `maxToolResultChars`: trim the lowest-ranked items first, mark `truncated: true`, and report `chars_available` and `next_offset`. The model always knows it didn't see everything (I4).
- **Show token usage, not money.** The model sees remaining rounds and calls in its system prompt and in the wind-down note. It never sees cost.

### 14.3 Loop (`lib/agent/loop.ts`)

Research rounds are **non-streaming** calls, which makes tool calls easier to parse. The final answer is a **separate streaming call with tools disabled**. This gives one clean streaming and verification path (reusing §11.6), and it is also the forced-final path when a cap is hit.

```ts
async function runAgent(ctx: RunCtx) {                 // ctx: docs, question, emit, signal, ledger, evidence
  const msgs = [system(agentPrompt(ctx, CAPS)), ...history(ctx), user(ctx.question)];
  let outcome: 'finished' | 'cap' | 'repeat_failures' | 'model_text' | 'timeout' = 'cap';
  const repeat = new RepeatGuard(CAPS.repeatFailureLimit);
  const cache = new Map<string, ToolResult>();         // key = name + canonical JSON args

  for (let round = 1; round <= CAPS.maxRounds; round++) {
    if (ctx.signal.aborted) throw new StoppedError();
    if (ctx.elapsed() > CAPS.wallClockMs) { outcome = 'timeout'; break; }
    const lastRound = round === CAPS.maxRounds;
    if (lastRound) msgs.push(user(WIND_DOWN_NOTE));    // "Last research round. Gather only what is essential, then call finish_research."
    if (!ctx.ledger.canAfford(estimateTokens(msgs))) { outcome = 'cap'; break; }

    ctx.emit('status', { text: round === 1 ? 'Planning research…' : 'Deciding what to read next…' });
    const resp = await withRetry(() => llm.chat({ messages: msgs, tools: TOOL_SCHEMAS,
                  tool_choice: 'auto', signal: ctx.signal }), { attempts: 3, onRetry: () => ctx.emit('notice', RETRYING) });
    ctx.ledger.add(resp.usage);
    msgs.push(resp.message);                            // assistant message incl. tool_calls

    const calls = resp.message.tool_calls ?? [];
    if (calls.length === 0) { outcome = 'model_text'; break; }   // model answered in text → go to answer phase

    const results = await Promise.all(calls.map((c, i) =>
      i < CAPS.maxCallsPerRound ? dispatch(c, ctx, cache) : refused(c, 'Too many calls in one round.')));
    calls.forEach((c, i) => msgs.push(toolMessage(c.id, results[i])));  // EVERY call gets a result (API requirement)

    if (results.some(r => r.finish)) { outcome = 'finished'; break; }
    const rg = repeat.update(calls, results);
    if (rg === 'nudge') msgs.push(user(REPEAT_NUDGE)); // "This call keeps failing with the same error. Try a different approach or call finish_research."
    if (rg === 'stop') { outcome = 'repeat_failures'; break; }
  }

  if (outcome !== 'finished' && outcome !== 'model_text') ctx.emit('notice', { code: 'AGENT_CAP',
      text: `Research limit reached (${describe(outcome)}). Answering from what was found.` });

  // ANSWER PHASE: streaming, tools disabled, quote parser + verifier as in §11.6
  msgs.push(user(FINAL_ANSWER_INSTRUCTION(ctx.coverage(), outcome)));
  return streamAnswer(msgs, ctx, { tools: undefined });   // or tool_choice: 'none' if the provider requires tools present
}
```

### 14.4 Dispatch robustness (`lib/agent/dispatch.ts`)

For each tool call, in this order:

1. **Unknown name** → `{error:"UNKNOWN_TOOL", message:"No tool named 'search_docs'. Available: get_outline, search_document, …"}`. Make one case-insensitive, underscore-insensitive "did you mean" attempt, **but do not auto-execute** it.
2. **Arguments that aren't valid JSON** → try `jsonrepair`. If that still fails → `{error:"INVALID_JSON", message:"Arguments were not valid JSON: <parser message>"}`.
3. **Unknown keys** → strip them and report `ignored_args: ["recipient"]` in the result. Tolerate invented keys; don't fail on them.
4. **Schema validation** (zod `safeParse`) → `{error:"INVALID_ARGUMENTS", issues:[{path, message}] (max 5), expected: <short schema>}`. Coerce obvious cases first: `"5"` → `5`, `12.3` → `"12.3"`.
5. **Semantic validation** inside the tool:
   - an unknown `doc` tag → `valid: ["D1","D2"]`;
   - a nonexistent section → `did_you_mean`;
   - a page range that is out of range or reversed → `valid` range;
   - an empty query → error;
   - a second `check_entire_document` → `{error:"ALREADY_USED"}`.
6. **Duplicate call** (same name + canonical args as earlier in the run) → return the cached result with `note:"Duplicate call — same result as before."`. It counts against the call cap.
7. **Execution:** `withTimeout(tool.run(args), toolTimeoutMs)`. A timeout → `{error:"TOOL_TIMEOUT", message:"Nothing was searched."}`. Any exception → `{error:"TOOL_FAILED", message}`, logged server-side. **The request never crashes because of a tool.**
8. Emit `tool_call` before execution and `tool_result` after it, with a summary (`"5 passages in §12, §14, §27"`, `"Section 12.9 not found — suggested 12.8"`) and the duration in ms.

**Provider-level failures:**
- 429 or 5xx → retry 3 times with exponential backoff (1 s, 2 s, 4 s) plus jitter, honouring `retry-after`.
- A provider that rejects `tools` (400 mentioning tools) → `notice` "This model doesn't support tool use; answered with standard mode instead." Then run the standard engine.
- A response truncated at the max-tokens limit with no tool calls → **not** treated as finished. Push "Your last response was cut off; continue with a tool call or finish_research", once.

**Also:** if the model writes pretend tool calls as text (e.g. JSON in the content), ignore them and treat the turn as `model_text`.

### 14.5 Trace and UI

- `messages.trace = [{ round, callId, name, label, args, ok, summary, ms, error? }]`, persisted live (with the 1.5 s flushes).
- The **`ResearchTimeline`** component inside the assistant message shows a vertical list of steps:
  - each step has an icon (spinner → check, or warning for errors) and its label ("Searching for 'termination for convenience'…", "Reading §14.2 Termination…");
  - the result summary appears in muted text;
  - errors appear in amber ("Section 12.9 not found — suggested 12.8").

  The timeline is expanded while running and collapses to a summary afterwards ("Researched in 5 steps · 4 sections read"), expandable.
- The coverage badge for agent mode shows the union of text actually returned by tools, e.g. "Read 6% of the document · §3, §12–14, pp. 41–44". If `check_entire_document` ran with complete coverage, it shows "Checked entire document".

### 14.6 Agent prompt (`lib/agent/prompts.ts`, draft)

```
You are a contract research assistant. You cannot see the documents directly; use the tools to
look things up, then you will be asked to write the final answer.
Documents: {D1: "MSA_Acme.pdf" (150 pages, 64 sections)} …
Strategy:
- Start with get_outline or search_document. Use list_clauses to find standard clauses quickly.
- Read the relevant section with get_section before relying on it. Follow cross-references
  ("subject to Clause 14.2") and read the defined terms that matter (find_exact).
- Never guess section numbers — take them from get_outline or search results.
- You may only conclude that something is ABSENT after check_entire_document reports complete
  coverage. Otherwise say which sections you checked.
- Stop as soon as you have enough evidence: call finish_research.
Budget: at most {maxRounds} rounds and {maxToolCalls} tool calls. You are told when one round remains.
```

`FINAL_ANSWER_INSTRUCTION`:
- the §11.9 ANSWER evidence rules (quotes must be copied from tool results);
- a coverage statement generated from the ledger ("You read §3, §12–14; about 6% of the document");
- the rule: "If the answer is not in what you read, say exactly which sections you checked and that the rest was not read — unless check_entire_document reported complete coverage".

The server-side absence rule (§11.4) also applies to agent answers.

---

## 15. UI / UX specification

The app must look finished: considered layout and typography, and clear loading, empty and error states.

### 15.1 Design tokens

- **Fonts:** Inter (UI), Source Serif 4 (document body and quote text), JetBrains Mono (rare, e.g. ids).
- **Colours:**
  - neutral stone/slate greys;
  - one accent (deep teal `#0F766E` or indigo `#4F46E5`);
  - verified green `emerald-600`; unverified `amber-600`; destructive `red-600`;
  - highlights: yellow at 40% opacity with a 1.5 px amber outline for the active occurrence;
  - document tag palette as in §12.1.
- **Shape:** `rounded-lg`, 1 px borders, subtle shadows. **Spacing:** a 4/8 px scale.
- Light theme only. A dark theme isn't asked for, so don't build one.
- **Motion:** 150–200 ms transitions; a 600 ms highlight flash; respect `prefers-reduced-motion`.

### 15.2 Screens

1. **Library (`/`)**
   - Top bar: app name, primary **Upload** button, and **Compare** in the navigation.
   - A large **drop zone** when the library is empty. The empty state reads "Upload a contract to get started" with accepted types and limits. With documents present, it becomes a compact drop area.
   - **Document table:** checkbox, type icon, name, pages, size, uploaded (relative time), **status**, and a row menu (Open, Delete).
     - Processing: a progress bar, the stage text ("Extracting text: page 34 of 150") and elapsed time.
     - Ready: a green dot, with any warnings shown as an amber icon plus tooltip.
     - Failed: a red message with the reason, plus Retry or Remove.
   - Uploads in flight appear as rows too, with upload percentage, then switch to processing states. **The user must never be left wondering.**
   - A sticky **selection bar** appears when rows are selected: "3 selected · Ask across documents · Compare (enabled at exactly 2) · Delete".
   - A small "Multi-document chats" list, so those conversations can be reopened too.
   - Delete asks for confirmation and explains what else is removed.
2. **Document workspace (`/documents/[id]`)**
   - A resizable split: viewer 60% | panel 40%. On mobile the panel is full-screen and the viewer opens as a sheet when a citation is tapped.
   - **Viewer toolbar:** name, page indicator "12 / 150" with an input, zoom −/+/fit, "Clear highlight", occurrence pager.
   - **Panel:** **Chat**, with document warnings (e.g. partially scanned pages) shown as a banner above it. A **Clauses** tab is added only with the clause-extraction extra (§20).
   - **Chat:**
     - a thread header with a "History" dropdown (past threads with dates) and "New chat";
     - an empty state with 4 suggested questions ("What is the term and how does it renew?", "What are the termination rights?", "Is there a cap on liability?", "Which law governs the agreement?");
     - the composer: autosize textarea, a mode control (Standard / **Read entire document** / **Research agent**), Send ↔ Stop.
   - If the document is still processing, the chat is disabled with a clear inline explanation and live progress; the viewer already works.
3. **Multi-document workspace (`/chat/[id]`):** the same layout; the viewer has document tabs coloured by tag, and the header shows the document chips.
4. **Compare picker (`/compare`):** two selects (Original, Revised), limited to ready documents, with a swap button and **Compare**. Past comparisons are listed below.
5. **Compare results (`/compare/[id]`):** §13.7.

### 15.3 States checklist (every async surface)

Every async surface needs: loading (a skeleton that matches the layout), empty (explanation + next action), error (a human message + retry), partial (e.g. keyword-only search, partial scan), and success.

Toasts are for transient confirmations only. Errors that matter stay inline.

### 15.4 Accessibility and keyboard

- Visible focus rings. Streaming status in `aria-live="polite"`.
- Citation chips are buttons with `aria-label` "Source 2: verified quote from MSA, section 12.3".
- Keys: Enter sends; Shift+Enter inserts a newline; Esc stops generation, or clears the highlight when idle.

---

## 16. API reference (route handlers, all `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`)

| Method & path | Purpose |
|---|---|
| `POST /api/documents` | Upload one file (multipart). §8.1. Returns 201 / 413 / 415 / 422 with `{error:{code,message}}`. |
| `GET /api/documents` | List documents (no text/bytes). Supports `?ids=`. |
| `GET /api/documents/:id` | Metadata, warnings, page sizes, outline (sections), clause summary. |
| `DELETE /api/documents/:id` | Delete (cascade, §7). |
| `POST /api/documents/:id/retry` | Re-enqueue a transient failure. |
| `GET /api/documents/:id/file` | Streams the original file from Supabase Storage through our server, with the correct `Content-Type` and `Cache-Control: private, max-age=3600`. Proxying avoids CORS and signed-URL handling in the viewer. |
| `GET /api/documents/:id/html` | DOCX render. |
| `GET /api/documents/:id/clauses` | (Extra: clause extraction) Clause list, grouped by type. |
| `GET /api/conversations?documentId=` | Threads for a document (or `?kind=multi`). |
| `POST /api/conversations` | `{documentIds: string[]}` → new conversation with tags. |
| `GET /api/conversations/:id` | Conversation, documents with tags, messages. |
| `DELETE /api/conversations/:id` | Delete a thread. |
| `POST /api/conversations/:id/messages` | Ask. **SSE response** (§11.5). |
| `POST /api/messages/:id/stop` | Stop generation (§11.8). |
| `GET /api/messages/:id/export?format=docx` | (Extra) Export an answer with its verified quotes. |
| `POST /api/comparisons` / `GET /api/comparisons` / `GET /api/comparisons/:id` | Comparison jobs. |
| `GET /api/health` | Database reachable + worker running (for Railway's health check). Never echo secrets. |

---

## 17. Scope guard: what we deliberately do NOT build

The assignment doesn't ask for these, so they stay out. They cost time and add places for bugs.

- Login, user accounts, Supabase Auth, or any per-user logic.
- Duplicate-upload detection.
- Rate limiting, spend dashboards or daily budgets. The only limits are the upload size and page limits needed for validation (§8.1), plus the agent caps Part C requires.
- Dark mode, themes or settings pages.
- Reconnecting to an answer after a page refresh. A refresh during generation leaves the partial answer saved as `interrupted`, which is enough.
- OCR, and any extra not on the assignment's extras list (§20).
- A separate evaluation harness or dashboard. Unit tests (§18) are enough.
- Option 1 (tracked-change redlining).

Keep one habit: log LLM calls (model, tokens, mode) to stdout, **never** document text or API keys.

---

## 18. Testing and evaluation

### 18.1 Fixtures (`scripts/generate-fixtures.ts`, committed outputs under `tests/fixtures/`)

- **`long_msa.pdf`** (about 150 pages, built with `pdfkit`):
  - numbered articles and clauses (1–40, with sub-clauses 1.1…);
  - running header "MASTER SERVICES AGREEMENT — CONFIDENTIAL" and footer "Page n of N";
  - a clause that deliberately **spans a page break**;
  - a manually hyphenated line break;
  - repeated boilerplate;
  - curly quotes and em dashes;
  - key facts placed on pages 3, 71 and **142**: liability cap "AED 100,000", 30-day termination notice, governing law "the laws of the Emirate of Dubai".
- **`msa_v1.docx` / `msa_v2.docx`** (built with the `docx` npm package, using **real auto-numbering**, bold headings and a table). v2 changes:
  - the liability cap AED 100,000 → AED 1,000,000;
  - notice 30 → 60 days;
  - "shall" → "may" in one obligation;
  - one purely reworded sentence (cosmetic);
  - one clause moved;
  - one clause added (non-compete);
  - one removed;
  - governing law changed.
- **`scanned.pdf`**: an image-only PDF (a PNG embedded with `pdf-lib`). **`partial_scan.pdf`**: text pages plus 2 image-only pages.
- **`encrypted.pdf`**, **`corrupted.pdf`** (truncated bytes), **`notes.txt`**, **`legacy.doc`** (OLE2 header bytes).
- For manual testing, also download 2–3 long public contracts (e.g. material-contract exhibits from SEC EDGAR, 100+ pages). Don't commit them if their licensing is unclear.

### 18.2 Unit tests (vitest; these run in CI)

- `normalize` / `verify`: the full §9.8 table.
- `quoteStreamParser`: split at every index (§11.6).
- PDF builder: fixture → furniture ranges found on ≥ 95% of pages; the cross-page clause verifies; boxes on both pages exclude the footer.
- DOCX numbering: v1 labels match the expected `1.`, `1.1`, `(a)`… sequence.
- Sections and TOC skip; the chunker never crosses a section boundary with overlap.
- Coverage math and the absence enforcement regex.
- **Agent dispatch replay tests** (a fake LLM plays scripted responses):
  - an unknown tool, invalid JSON, a missing arg, a wrong type, an invented extra key, a nonexistent section, an out-of-range page, a duplicate call, 5 identical failures, a model that never stops, and a model that answers in text immediately;
  - assert no exception, **exactly one `done`**, a tool result for every call, rounds ≤ cap, and a final answer produced (`AGENT_CAP` notice when capped).
- Comparison: the bucket invariant; significance floors (the AED change must be `critical`); the cosmetic short-circuit for the reworded sentence.

### 18.3 Manual test pass (before recording the demo, on the deployed app)

Run these by hand against the fixtures:
- "What is the liability cap?" → quotes `AED 100,000`, verified, and clicking it highlights the passage.
- "What law governs the agreement?" → finds the page-142 clause.
- "Is there a non-compete?" on v1 → a **full-scan** not-found ("I read the entire document…"), never an excerpt-based "no".
- Stop mid-answer → the partial text is kept, and still there after reopening.
- Every row of §23.

---

## 19. Build order and acceptance checks

**Milestone 1: foundation**
- Scaffold (Next.js, Tailwind, shadcn), config.
- A Supabase project: enable RLS, create the private `documents` bucket, enable the vector extension.
- Drizzle schema and migrations run against Supabase; the jobs-table worker via instrumentation; the health route.
- ✅ `npm run db:migrate` + `npm run dev` gives a working library page with an empty state, and a test file round-trips through Supabase Storage.

**Milestone 2: ingestion and library**
- Upload with validation (§8.1), process-document pipeline (§8.2–8.8, 8.11–8.12), library UI with live status, delete, the file route, and a PDF and DOCX viewer (no highlights yet).
- ✅ `long_msa.pdf` reaches ready with per-page progress.
- ✅ `scanned.pdf` fails with the scanned message.
- ✅ `notes.txt`, `legacy.doc` and `encrypted.pdf` are rejected with specific messages.
- ✅ Killing the server mid-job, then restarting, still ends in ready.

**Milestone 3: verifier (pure library)**
- §9 with all tests green. Build this before chat. It is the core of the assignment.

**Milestone 4: chat core**
- FULL mode, SSE protocol, quote stream parser, citations UI, stop and persistence, history per document.
- ✅ A small DOCX answer streams, chips verify, and stop keeps partial text.
- ✅ Reopening a thread restores everything.

**Milestone 5: highlighting**
- §10 for PDF and DOCX, including the cross-page, multi-line and repeated cases.
- ✅ All §10.3 checks.

**Milestone 6: large documents**
- Chunks, full-text search (no embeddings yet; they are an extra), RETRIEVAL + SCAN + escalation, coverage badge, absence enforcement.
- ✅ The page-142 fact is found.
- ✅ The non-compete question produces a full-scan not-found.
- ✅ Coverage is shown on every answer.

**Milestone 7: multi-document**
- ✅ Tagged, per-document-verified quotes; a comparison-style answer; a misattributed quote is shown as unverified.

**Milestone 8: comparison**
- ✅ The v1/v2 fixture gives the expected change list, and the AED change is critical with a correct summary. Filters and sort work.

**Milestone 9: Part C agent**
- ✅ Replay tests green; the live timeline shows labelled steps; the cap produces a forced final answer; the final answer's quotes are verified.

**Milestone 10: polish, deploy, docs**
- UI states pass (§15.3), Railway deploy, the manual test pass (§18.3) on the live URL, README with screenshots, the note, the demo video.

**Milestone 11 (optional): extras (§20)**
- Only if every earlier milestone passes. Redeploy and re-run §18.3 after each extra.

---

## 20. Extras (only from the assignment's own list, and only after Parts A–C work end to end)

The assignment says an unfinished extra doesn't help. Finish one completely before starting the next, in this order:

1. **Background processing** (recovers if the server restarts mid-job). Already delivered by §8.12. Just demonstrate it in the video and list it in the README.
2. **Clause extraction.**
   - Add the LLM step in §8.10.
   - Add a **Clauses** tab: clauses grouped by type, each clickable to highlight the section, with an "Ask about this clause" shortcut.
3. **Export.** `GET /api/messages/:id/export?format=docx`, using the `docx` package. The file contains:
   - the question, and the answer (markdown → paragraphs);
   - a numbered list of verified quotes (document, section, page, quote);
   - the coverage line and a timestamp;
   - unverified quotes listed separately, clearly labelled.
4. **Semantic search.**
   - Add embeddings (§8.9) and the vector leg of retrieval (§11.2 step 3).
   - Show "Semantic + keyword search" on the document when it's active.
5. **Voice input.** A microphone button using the Web Speech API (`webkitSpeechRecognition`). Hide it in browsers without support.
6. **Anonymise** (only if time remains):
   - regexes for emails and phone numbers, plus one LLM call for person and company names;
   - a consistent `[PERSON_1]`/`[COMPANY_1]` mapping stored per document;
   - a reversible "anonymised view" toggle.

   It must not break verification: verify against the original text and apply the substitution only for display.
7. **Arabic/RTL:** skip, and say so in the README.

---

## 21. Deployment (Supabase for data + Railway for the app)

- **Supabase** (free plan is fine):
  1. Create a project.
  2. Run the migrations (`npm run db:migrate` with `DATABASE_URL` set to the **Session pooler** connection string).
  3. Confirm RLS is on for every table.
  4. Create the private `documents` bucket.
  5. Enable the vector extension.
- **Railway:**
  1. Create a service from the GitHub repo, using the default Node builder (no Dockerfile needed).
  2. Build command: `npm run build`. Start command: `npm run start`; the start script runs `next start -p $PORT`.
  3. Run migrations from your machine or as a Railway pre-deploy command.
  4. Set the env vars from §6 in Railway. **Never commit `.env`.** Health check path: `/api/health`.
- **pdf.js assets:** the server needs `node_modules/pdfjs-dist/cmaps` and `standard_fonts` at runtime. They are present with the default `next start` setup. If you switch to `output: 'standalone'`, copy them explicitly.
- After deploying, run the manual test pass (§18.3) with the 150-page fixture **on the deployed app**, not only locally.

---

## 22. README, note and demo video

### 22.1 README outline

1. What it does (5 bullets) + the live link + the video link.
2. Screenshots:
   - the library with processing states;
   - chat with verified quotes (showing an unverified one too);
   - citation highlighting across a page break;
   - multi-document answer;
   - comparison with filters;
   - the agent timeline.
3. Architecture diagram (from §3) + key decisions (why Supabase + Railway, why these libraries, why Option 2).
4. Running locally:
   1. Create a free Supabase project, or run a local one with the Supabase CLI (`supabase start`).
   2. Create the private `documents` bucket.
   3. `cp .env.example .env` and fill in the Supabase and LLM values.
   4. `npm i`, `npm run db:migrate`, `npm run dev`.

   Fixtures: `npm run fixtures`. Tests: `npm test`.
5. Configuration table (env vars, defaults, what `CONTEXT_BUDGET_TOKENS` does).
6. **What's finished / what's not / known limitations**, all honest. For example:
   - multi-column PDFs may interleave;
   - proportional-width highlight approximation;
   - DOCX headers, footers and footnotes are not indexed;
   - no OCR;
   - numbering approximations;
   - split/merged clauses in comparison;
   - single-instance run registry.

### 22.2 Half-page note (template)

- **Quote verification:**
  - how it works: canonical text; offset-mapped normalisation; the T1–T4 ladder; numeric and protected-word guards; per-document attribution; display of the document's own text;
  - where it can fail:
    - PDFs whose fonts extract to wrong characters;
    - multi-column order;
    - quotes spanning table cells in unusual layouts;
    - furniture misdetected on short documents;
    - boilerplate repeated with tiny variations, which could match the wrong occurrence;
    - fuzzy acceptance of a one-character typo;
    - text in DOCX headers and footers.
- **Large documents:** a deliberate budget → retrieval with an outline → automatic full-document scan for not-found or exhaustive questions; coverage tracked per answer; absence claims enforced server-side; unreadable and failed pages always disclosed.
- **Part C:** why Option 2 (§1.1); how far we got; the hardest part (likely: keeping cheap models from looping or guessing section numbers, and making the forced-final answer honest about coverage).
- **Next steps:** OCR, Option 1 redlining on top of the DOCX run model, reconnectable streams (resume by event id), clause-split/merge detection, an evaluation dashboard.

### 22.3 Demo video (3–5 minutes)

1. Upload the 150-page PDF and a `.txt` file (rejected), plus `scanned.pdf` (unreadable message). Show live progress.
2. Ask about a fact on page 142. Show the coverage badge, verified chips, and the click that scrolls and highlights across a page break.
3. Show an unverified quote. To force one on camera, use the dev-only toggle `?debugInjectFakeQuote=1`, which appends one invented quote; name this honestly in the video. Show the not-found path escalating to a full scan.
4. Stop mid-answer; the partial answer is kept. Reopen the history.
5. Multi-document question across v1 and v2.
6. Comparison: the AED 100,000 → 1,000,000 change rated critical; the filters.
7. Agent mode: the live timeline; mention caps and robustness, and show a replay test run in the terminal.
8. Kill and restart the server during processing; the document recovers.
9. Name what doesn't work yet.

---

## 23. Requirement traceability (tick every row before submitting)

| Requirement | Where | How to demonstrate |
|---|---|---|
| Accept PDF and DOCX; reject others clearly | §8.1 | Upload a .txt or .doc |
| Extract and store text | §8.3, §8.6 | Library row shows page count; viewer and chat work on the text |
| Processing status shown | §8.2, §15.2 | Progress stages |
| Scanned PDF reported, not saved empty | §8.4 | `scanned.pdf` |
| Library: list, open, delete | §15.2 | Library |
| Chat with streaming answers | §11.5 | Tokens stream |
| Stop keeps partial | §11.8 | Stop button |
| History per document, reopenable | §11.8 | History dropdown |
| Quotes verified in code before display | §9, §11.6 | Verified chips, pending → verified |
| Unverified quotes removed or clearly marked | §11.7 | Amber tag, struck-through list |
| Model positions never trusted | §2 I2, §9 | Design: no positions requested |
| Whitespace tolerance | §9.2 | Unit tests |
| "Not in document" handled | §11.3–11.4 | Not-found path |
| 150-page documents work | §8, §11 | Page-142 fact |
| No "absent" claim from partial reading | §11.4 | Escalation + notice |
| Click a quote → scroll + highlight | §10 | Demo |
| Multi-line / cross-page / repeated quotes | §10.3 | Fixture |
| Multi-document questions, per-document verification | §12, §9.4 | Misattribution test |
| Comparison at clause level + plain summary + significance filter | §13 | v1/v2 fixture |
| Part C agent: loop, live progress, caps, bad-call handling, verified final | §14 | Timeline + replay tests |
| API key, base URL, model from env; no committed keys | §6, I7 | `.env.example` |
| Deployed, README, screenshots, note, video | §21–22 | Submission |

---

## 24. Appendix: lessons from a production legal-AI system (pitfalls to avoid)

These patterns come from studying a mature legal-AI backend. Each item names the problem it hit and the fix we adopt.

1. **A different text source for verification than for rendering causes highlight drift.** Their provision highlighter matched plain-text extraction against HTML produced by a different converter; NBSP, tabs and auto-numbering differences broke it. → **I1**: one extraction pass feeds both.
2. **Whole-string fuzzy ratios reject genuine quotes.** A score like WRatio, comparing a paragraph against a long provision (or a quote against a page), mathematically can't reach high thresholds once the length ratio is large. → Needle-in-window alignment (§9.3 T4), with a `haystack ≥ needle` guard.
3. **The first occurrence is not the right occurrence.** Their anchor locator used `find()` (first hit), so two provisions with identical openings collapsed into one. → Keep all occurrences; choose the primary using context overlap (§9.5).
4. **Normalisation gaps.** En and em dashes, the soft hyphen and ellipses survived their normaliser and caused false rejections. → The explicit character tables in §9.2 and ellipsis segments (T3).
5. **LLM quotes stored without any check.** Several of their features stored "verbatim" quotes from the model without checking them. The only fully trustworthy quotes were chunks the **server** supplied. → Always verify, and always display the document's text.
6. **Silent truncation was their biggest large-document risk.** Features read the first N thousand characters, or showed 600-character snippets, and never told anyone. → I4, coverage objects, and tool results with `total`, `truncated` and `next_offset`.
7. **"Nothing found" and "nothing searched" look the same unless separated.** → `searched: false` vs zero hits (§14.1).
8. **Rebuilding full text from overlapping chunks duplicates text, and row order ≠ document order.** → The canonical text is stored once; chunks carry offsets and an explicit `ord`.
9. **Semantic-only retrieval misses exact legal phrases, defined terms and "Section 12.3".** → Postgres full-text search with phrase boosts and exact section lookup in the core (§11.2). Vectors are added on top only as the semantic-search extra.
10. **DOCX auto-numbering isn't in the text.** → Our own numbering engine (§8.6).
11. **Every error was treated as retryable, so broken files retried for hours.** → A permanent vs transient taxonomy; permanent errors complete the job with a clear message (§8.11).
12. **Stranded jobs and long transactions.** → Conditional stage writes, lease-based job recovery (§8.12), short transactions (I8), and progress writes each in their own short transaction.
13. **Agent loops that stop silently at the cap leave no answer.** → The wind-down note, then a forced final answer with tools disabled and an honest coverage statement (§14.3).
14. **Budget checked after the call overshoots.** → Check the ledger before each model call.
15. **Tool results sent as a Python-style repr, or with no size cap, flood the context.** → JSON only; fit the whole envelope to a character budget; trim the lowest-ranked items first and mark them.
16. **A bad tool call must never crash the run.** → Unknown tool → list available tools; strip invented args and report them; validation issues go back to the model as data; a repeat-failure guard; **every call gets a result message**.
17. **Non-fatal problems sent as `error` events make clients tear down the stream.** → Use `notice` for non-fatal issues, `error` only for fatal ones, and **exactly one `done`**.
18. **Stop discarded the partial answer, and stopped turns weren't billed.** → Keep and persist partial text and verified quotes; record usage even for stopped runs (I5).
19. **Streaming citations:** hold back text while a citation marker is open, with a length guard; send citation metadata before its inline marker; send keep-alive pings early, because slow first tokens kill idle connections.
20. **Comparison pitfalls:**
    - The last section swallows signature blocks and exhibits unless you cut at end-of-substance markers.
    - Batch failures silently dropped provisions. → A reconciliation invariant: every unit ends up in exactly one bucket.
    - Force-matching weak candidates is worse than "no match". → A similarity floor.
21. **Materiality needs deterministic signals.** Money, percentages, durations, modality (shall ↔ may), negation and jurisdiction extractors set floors that the LLM may raise but never lower. "When in doubt, it is at least minor."
22. **Evaluation discipline:** deterministic answer keys (`must` / `must_not` regex), never skip a failing check, change one thing at a time, and use replay harnesses for every agent termination path.
