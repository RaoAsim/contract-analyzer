# Contract Analyzer: technical overview

This document explains what was built, how each hard requirement is met, and where the code lives. See the [README](../README.md) for setup and deployment, and the [test plan](TEST_PLAN.md) for manual test cases with expected answers.

## 1. Assignment coverage

| Requirement | Status | How / where |
|---|---|---|
| **A1** Accept PDF/DOCX, reject others clearly | Done | The file type is detected from its bytes (magic numbers), never from the extension. Specific messages for `.txt`, legacy `.doc`, spreadsheets, and password-protected or damaged files. `src/lib/ingest/validate.ts` |
| Processing status | Done | A background job reports named stages ("Extracting text: page 83 of 149", "Preparing search index"…), a progress bar and elapsed time. The library polls every second. `src/lib/ingest/pipeline.ts`, `src/components/library/*` |
| Scanned PDF reported, not saved as empty | Done | Per-page text-quality check. An all-image PDF fails with a clear message; a partly scanned one is accepted with "Pages 3–4 are scanned images" shown everywhere. `src/lib/ingest/pdf.ts` |
| Library: list, open, delete | Done | Each row has Chat and Delete buttons. Multi-select lets you ask across documents or compare two. |
| **A2** Streaming answers, Stop keeps partial | Done | Server-sent events over a POST request. Stop keeps the text so far and its verified quotes. `src/lib/chat/run.ts`, `src/hooks/useChatStream.ts` |
| History per document, reopenable | Done | Chats are saved per document; the History menu reopens them. |
| **A3** Every quote verified in code before display | Done | See §3. `src/lib/text/verify.ts` |
| Unverified quotes never look genuine | Done | Shown as an amber "unverified" tag with the model's text struck through, and never as a numbered source. |
| Don't trust the model's positions | Done | Quotes are located by our own search. Page numbers written by the model are ignored, and the prompt tells it not to give them. |
| Whitespace tolerance | Done | Offset-mapped normalisation (§3). |
| Say so when the answer isn't in the document | Done | The model replies with a "not found" marker. When the whole document was read, the server itself writes "I read the entire document… and found nothing". |
| **A4** 150-page contract works; never claim absence after partial reading | Done | See §4. Tested on a 149-page fixture. |
| **B5** Click a quote to scroll to and highlight it (multi-line, page break, repeated) | Done | See §5. |
| **B6** Multi-document questions, each quote verified against its own document | Done | Documents are tagged D1–D5. A quote found in a *different* document is shown as unverified ("found in D2"). `src/lib/text/attribute.ts` |
| **B7** Clause-level comparison, plain-language summary, significance filter/sort | Done | See §6. |
| **C** Option 2: agentic research | Done | See §7. |
| API key, base URL and model from env vars | Done | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` (optional). No keys in the repo. |
| Extra: background processing (survives a restart) | Done | A job table with leases; an interrupted job is picked up again after a restart. Covered by the end-to-end harness. |
| Extra: clause extraction | Partial, not claimed | A keyword clause index is built for every document and used by the agent's `list_clauses` tool, but there's no clause-list screen. |
| Other extras (anonymise, semantic search, export, Arabic, voice) | Not built | Deliberately skipped: the assignment says an unfinished extra doesn't help. |

## 2. Architecture

- **One Node.js process** (Next.js App Router on Railway). It serves the UI, the API routes and the background worker, and streams long answers.
  - Why not serverless: 50 MB uploads, multi-minute scans and a worker that must keep running don't fit serverless function limits.
- **Supabase Postgres** is accessed directly through Drizzle over the Session pooler, which gives full-text search, a `FOR UPDATE SKIP LOCKED` job queue and bulk inserts.
  - RLS is on for every table, with no policies, and the Data API roles have no access.
- **Supabase Storage** holds the original files in a private bucket, reached only by the server with the secret key.
- **Gemini** is used through `@google/genai`, with stateless `generateContent` / `generateContentStream` calls.

```
upload → validate (bytes, password, page limit) → Storage + job row (one transaction)
worker → extract (pdf.js / OOXML) → quality check → headers/footers → sections → chunks
       → keyword clause index → ready
chat   → full text | excerpts + outline | full scan | overview | agent
       → streaming quote parser → verifier → citations with highlight geometry → UI
```

## 3. Quote verification (the core)

1. **One canonical text per document.** Every PDF text item and every DOCX run keeps its character offset in that text. Running headers, footers and page numbers are detected and kept as separate "furniture" ranges.
2. **Normalisation with an offset map.** The document and the quote are both normalised:
   - Unicode NFKC; curly/straight quote, dash and space variants unified; soft hyphens and zero-width characters dropped;
   - words split across a line or page break joined again ("termi-/nation");
   - furniture skipped, so a quote that runs across a page footer still matches.

   Every normalised character maps back to an exact position in the original.
3. **Matching tries four tiers in order:**
   1. exact match after normalisation;
   2. "compact" match on letters and digits only, with a check that all numbers are identical;
   3. elided quotes ("A … B"): every part must match, in order, close together;
   4. near-exact match at 95% or better. It only tolerates a one-character typo in a long word, and never a change to a number or to words like *shall/may/not/any*.
4. **Every occurrence** is found (up to 25). The one shown first is the occurrence that overlaps the text the model was actually given.
5. **The displayed quote is the document's own text**, taken from the found position, never the model's version of it.
6. **Streaming.** A parser reads quote tags out of the token stream as it arrives, even when a tag is split across chunks (tested by splitting at every character index). Each quote is verified before its marker is sent, and raw tags never reach the browser.
7. **Where it can fail:**
   - PDFs whose fonts extract to the wrong characters;
   - multi-column reading order;
   - quotes spanning unusual table layouts;
   - near-identical boilerplate, where every occurrence is offered;
   - the deliberate one-typo tolerance.

## 4. Large documents: honest coverage

- **The context budget is deliberately small** (20k tokens), so a 150-page contract always goes through the large-document strategy, even though Gemini's context window could hold it.
- **Choosing a strategy for each question:**
  - **Full text** when the document fits the budget.
  - **Overview** for general or vague questions ("summarize", "tell me about it", or a typo like "abou"): the outline plus the opening of the document and of each section. It never scans and never answers "not found".
  - **Excerpts** for specific questions. Keyword search with query variants, phrase and section-number boosts and rank fusion (RRF), and generic contract words ("agreement", "party"…) don't swamp the ranking. The whole outline is always included.
  - **Full scan** for "is there / any / list" questions, for the **Whole document** mode, or automatically when the excerpts don't contain the answer. Every part of the document is read in parallel, each finding is verified as it arrives, and the results are merged into one answer.
- **Coverage on every answer.** The answer header says what it's based on: "Based on 19% of the document · §3, §40 · pp. 3, 142". Failed scan windows and scanned pages are always disclosed.
- **Absence is enforced by the server, not only by the prompt.** If an answer says something is missing but coverage is incomplete, a warning appears with a button to ask again reading the whole document.

## 5. Citation highlighting

- **PDF.** pdf.js item geometry is stored at ingestion. Highlight rectangles are computed once, when the quote is verified: furniture is skipped, rectangles are merged per line, and a quote can span several pages. The viewer is virtualised, only rendering pages near the visible area, with every page reserved at its real size, so scrolling to page 142 is exact. Highlights are positioned in percentages, so zooming keeps them aligned.
- **DOCX.** Our own HTML carries each character's offset, and highlights use the CSS Custom Highlight API (with a `<mark>` fallback).
- **Repeated text** shows "occurrence 1 of N" with previous/next arrows. Each document in a multi-document chat has its own viewer tab, and clicking a quote switches to the right tab.

## 6. Comparison

- **Units** are the leaf clauses (or paragraphs, when a document has no structure). Clause numbers are ignored, so renumbering alone isn't a change.
- **Alignment:** an exact-match pass (which also detects moved clauses), then an order-preserving similarity alignment, move detection, and finally added/removed. It checks that every clause lands in exactly one bucket.
- **For each change:**
  - a word-level redline;
  - deterministic "facts": amounts with their ratio, percentages, periods, dates, *shall ↔ may*, negations, defined terms, governing law;
  - **significance floors** the AI can raise but never lower. An amount change of 5× or more, or a change of governing law, is always critical; periods and *shall ↔ may* changes are at least major.
- **The AI** then writes a plain-English summary and a category for each change, in batches of 8, plus an executive summary that links to the changes it mentions. A punctuation-only change skips the AI and is marked cosmetic.
- **The results page** filters by significance (cosmetic changes hidden by default) and by type, sorts, searches, and opens a side-by-side view.

## 7. Part C: agentic research (Option 2)

- **Tools:**
  - `get_outline`, `search_document`, `get_section`, `read_pages`, `find_exact`, `list_clauses`;
  - `check_entire_document`: a full scan, allowed once per answer and counted as three calls;
  - `finish_research`.
- **Hardening:**
  - unknown tool → a list of the available tools plus one "did you mean";
  - arguments that aren't valid JSON are repaired, or returned as an `INVALID_JSON` error the model can read;
  - invented keys are removed and reported;
  - arguments are validated against a schema, with obvious fixes applied (a number sent as text);
  - duplicate calls return the earlier result;
  - timeouts; every tool call always gets a result.
- **Hard caps**, checked before each call: rounds, total calls, calls per round, tokens and wall-clock time. There's a warning on the last round, and the same failure repeated three times stops the loop.
- **The final answer is always produced.** It's written with tools disabled, goes through the same verifier, and states what was read. Absence is only claimed after `check_entire_document` reports complete coverage.
- **Gemini specifics:**
  - tool schemas are generated in the JSON Schema form Gemini accepts;
  - the model's function-call turns are sent back exactly as received, keeping their thought signatures;
  - thinking tokens count against the output limit, so every call gets headroom.
- **The UI** shows a live timeline of each step ("Searching for 'termination for convenience'…"), which collapses into a summary afterwards.

## 8. Reliability and UX details

- **Jobs:** a 2-minute lease renewed by a heartbeat; failed jobs retry with backoff; permanent and temporary failures are handled differently; the document can be retried from the library.
- **Answers:** a question and its answer are created before the AI call and saved every 1.5 s while streaming. An answer cut off by a server restart is marked *interrupted*.
- **Send and Stop:**
  - Send reacts instantly: the question appears and Send becomes Stop, even while the chat is still being created;
  - a double submit is ignored, and a double-click can't hit Stop;
  - only one answer per chat can run at a time.
- **Responsive layout:**
  - desktop has a resizable split between viewer and chat;
  - on phones the chat is full-screen, and tapping a source opens the document in a sheet with the passage highlighted;
  - details open on tap.

## 9. Tests

- **Unit tests (vitest)** cover:
  - normalisation and verification, including every must-verify and must-reject case;
  - the streaming parser split at every character index;
  - the 149-page PDF: headers and footers, table-of-contents skip, facts on pages 3/71/142, and the clause across a page break;
  - DOCX numbering, highlight geometry and coverage maths;
  - agent replay tests, where a fake model sends unknown tools, broken JSON, invented arguments and loops forever;
  - the comparison invariants and significance floors;
  - Gemini message conversion and question intent.
- **Integration tests** run the job queue against real Postgres.
- **End-to-end harness** (`npm run e2e`): real Postgres (PGlite), stand-ins for Storage and Gemini, and the production build. It runs HTTP checks, a restart-recovery test and browser checks in Chrome.
- **`npm run llm:smoke` / `npm run storage:smoke`** check the live Gemini and Supabase setup.

## 10. Known limitations

- Multi-column PDFs can interleave columns.
- PDF highlight rectangles inside a text item are approximate.
- DOCX headers, footers and footnotes aren't indexed.
- No OCR.
- A clause that is split in two, or two clauses merged, shows as modified plus added.
- Token counts are estimates for Gemini.
- One app instance only (answer runs are tracked in memory).
