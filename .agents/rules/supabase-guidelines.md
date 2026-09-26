---
trigger: model_decision
description: Triggered when interacting with the Supabase database or Storage, writing queries or migrations. Enforces secure, server-side database operations for Contract Analyzer.
---

Server-Side Only: The browser never talks to Supabase. The database is accessed only from server code via Drizzle ORM + `postgres` (postgres-js) using `DATABASE_URL` (the Session pooler connection string). `@supabase/supabase-js` is used only for Storage, with the service-role key, in `src/lib/storage/supabase.ts`.

No Supabase Auth: There is no login. Do not use `@supabase/ssr`, the anon key, or auth helpers.

Migrations: Schema lives in `src/lib/db/schema.ts`. Generate SQL with `npm run db:generate` (drizzle-kit) and apply with `npm run db:migrate` against the Supabase database. Hand-written SQL (RLS, extensions, generated `tsvector` columns, partial indexes) goes in custom drizzle migrations so every environment is reproducible. Types come from the Drizzle schema; no separate type generation.

RLS: Every table has Row Level Security enabled with **no policies**, so the auto-exposed Data API stays closed. Our owner-role connection bypasses RLS.

Storage: One private bucket (`SUPABASE_STORAGE_BUCKET`, default `documents`). Files reach the browser only through `GET /api/documents/:id/file`. No signed or public URLs.

Short Transactions: Never hold a transaction or connection across an LLM call, a Storage transfer, or other slow I/O. Read, release, do the slow work, then write in a new short transaction. Job-stage writes are conditional (`UPDATE … WHERE id = $1 AND status IN (...) RETURNING id`); no returned row means the target was deleted, so stop.

Aggregate In SQL: Count and group in SQL, never by fetching rows and reading `.length`.
