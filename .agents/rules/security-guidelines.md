---
trigger: model_decision
description: Triggered when handling data inputs, environment variables, API payloads, file uploads, or database security. Enforces application security and data integrity for Contract Analyzer.
---

External services: Supabase (Postgres + Storage) and one OpenAI-compatible LLM endpoint. Nothing else. There is no login, no user accounts, and no rate limiting (single-user app by assignment design).

**Payload Validation.** Validate every request body, query string and route param with zod before use. Give every free-text field an explicit `.max()` (chat questions ≤ 4,000 chars, names ≤ 255). Document ids are validated as UUIDs.

**Uploads.** Never trust the file extension or MIME type. Detect type from magic bytes (`%PDF-`, ZIP containing `word/document.xml`, OLE2 → reject). Enforce `MAX_UPLOAD_MB` and `MAX_PAGES` server-side. Storage paths are built from our own generated UUIDs only (`{id}/original.{ext}`), never from the uploaded file name.

**Environment Variable Safety.** `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `LLM_API_KEY` are read only in server code via `src/lib/config.ts`. Never use the `NEXT_PUBLIC_` prefix for them, never import `config.ts` from a client component, and never return them from any API (including `/api/health`). `.env*` is gitignored; `.env.example` holds placeholders only.

**Output Encoding.** The DOCX HTML we render is produced by our own parser, which HTML-escapes every text fragment at write time; it is the only HTML ever passed to `dangerouslySetInnerHTML`. Model output is rendered as Markdown through `react-markdown` with raw HTML disabled. Quote text shown to users is sliced from the document, not taken from the model.

**LLM Prompt Hygiene.** Document text is placed inside delimited blocks (`<documents>`, `<text>`); instructions inside documents are data, not instructions. Model output never drives logic unless parsed with `jsonrepair` + zod (the only prose exception is the `[[NOT_FOUND]]` sentinel).

**Error Masking.** Never leak raw database errors, stack traces or provider error bodies to the client. Log server-side and return `{ error: { code, message } }` with a user-facing message.

**Logging.** Log LLM calls (model, mode, token counts, duration). Never log document text, quotes, prompts, or keys.
