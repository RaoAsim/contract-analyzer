---
trigger: model_decision
description: Triggered when structuring the Next.js App Router, creating pages, components, or API routes. Enforces Next.js 16 architectural patterns and data flow for Contract Analyzer.
---

Version: Next.js 16.3 (App Router). Read the bundled docs in `node_modules/next/dist/docs/` before using an API you are unsure of; this version has breaking changes (e.g. `middleware` is now `proxy`).

Server Components Default: Default to React Server Components for layouts and static chrome. Use `"use client"` only where hooks or browser APIs are required (library table, upload queue, viewer, chat, comparison filters). Keep client components as leaves.

No Direct External Calls From The Browser: The browser never calls the LLM, Supabase Storage or the database. All of that happens in route handlers under `src/app/api/**`, which delegate to `src/lib/**`. No Server Actions are used; the client talks to our own REST + SSE API.

Data Fetching: Client components fetch our internal API with TanStack Query (polling document status, cache invalidation after mutations). Chat streams use `fetch` POST + `eventsource-parser`, not `EventSource`.

Caching: `cacheComponents` is OFF. Nearly all data is live (processing status, chat, comparisons), so every route handler exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Do not add `"use cache"`.

Thin Routes: A `route.ts` parses and validates input with zod, calls a function in `src/lib/**`, and shapes the response. Business logic lives in `src/lib/**` and must be unit-testable without Next.js. Handlers are wrapped in `withApiHandler` (`src/lib/api/handler.ts`), which owns the error envelope `{ error: { code, message } }`; throw `ApiError(status, code, message)` for expected failures.

Streaming Routes: SSE responses set `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`, send a `: ping` immediately and every 15 s, and always end with exactly one `done` event.

Background Work: The job worker starts from `src/instrumentation.ts` inside `register()` when `NEXT_RUNTIME === 'nodejs'` and `RUN_WORKER !== 'false'`. `register()` must return promptly (start the loop, do not await it) and guard against double start with a `globalThis` flag.

Error Boundaries: Use `error.tsx` segments for page-level failures with a human message and a Retry button; `loading.tsx` skeletons that match the final layout.

Native Packages: `pdfjs-dist` (and other Node-only parsers) are listed in `serverExternalPackages`. Deploy with `next start -p $PORT` (no `output: 'standalone'`).
