---
trigger: always_on
---

Strict Typing: TypeScript `strict` everywhere. Never use `any`; use `unknown` for dynamic data (LLM output, request bodies, JSON columns) and narrow it with zod before use.

File Separation for Types: Interfaces and types live in separate `.ts` files, not inside `.tsx` components or logic files.

Scoping & Placement Rules:

Global Types: Types shared across domains (e.g. `Citation`, `Coverage`, `SseEvent`, `DocumentSummary`, `ComparisonResult`) live in `src/types/`. Both server (`src/lib/**`) and client code import from there.

Local Types: Types specific to one component or module live next to it (e.g. `CitationChip.types.ts` beside `CitationChip.tsx`, `matchIndex.types.ts` beside `matchIndex.ts`).

Naming: Plain PascalCase names (`Citation`, not `ICitation`).

Explicit Returns: Explicitly type the return of every exported function in `src/lib/**`, every route handler, and every non-trivial React component.

Pure Core: `src/lib/text/**`, `src/lib/chat/quoteStreamParser.ts`, `src/lib/compare/**` (except the LLM step) and `src/lib/agent/dispatch.ts` are pure or dependency-injected so they can be tested with vitest without a database or network.
