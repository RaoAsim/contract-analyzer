---
trigger: model_decision
description: Triggered when modifying or creating .tsx components, layouts, and overall application UI. Enforces styling consistency, responsiveness, accessibility, and user experience best practices for Contract Analyzer.
---

Tailwind CSS & Mobile-First: Tailwind CSS v4 + shadcn/ui for all styling. Build mobile-first with `sm:`/`md:`/`lg:` for larger screens. Use relative widths (`w-full`, `max-w-*`, percentages) for layout, not fixed pixel widths. On mobile, the workspace shows the chat full-screen and the viewer opens as a sheet.

Design Tokens: Inter (UI), Source Serif 4 (document body and quote text), JetBrains Mono (ids). Neutral stone/slate greys, one accent (deep teal `#0F766E`), verified `emerald-600`, unverified `amber-600`, destructive `red-600`. Document tag colours D1 indigo, D2 teal, D3 amber, D4 rose, D5 violet. `rounded-lg`, 1 px borders, subtle shadows, 4/8 px spacing. Light theme only.

Every Async Surface Has Five States: loading (skeleton matching the final layout), empty (explanation + next action), error (human message + Retry), partial (e.g. partially scanned document, partial coverage), and success. The user is never left wondering whether something is happening: processing shows a named stage and progress ("Extracting text: page 34 of 150"); chat shows a live phase line and a Stop button.

Toasts vs Inline: Toasts (sonner) are for transient confirmations and background events ("MSA.pdf is ready", "Document deleted"). Errors that matter stay inline next to what failed (an upload row, a message, a comparison).

Verified vs Unverified: A verified quote and an unverified one must never look alike. Verified: numbered chip in the document colour, clickable into the viewer. Unverified: amber "unverified" tag, not numbered, not clickable, model text struck through in the sources list.

Accessibility (a11y): Semantic HTML (`<button>`, `<nav>`, `<dialog>`), `aria-label` on icon-only buttons and citation chips ("Source 2: verified quote from MSA, section 12.3"), labels on all form controls, visible focus rings, streaming status in `aria-live="polite"`, WCAG AA contrast. Keys: Enter sends, Shift+Enter newline, Esc stops generation or clears the highlight.

Microinteractions & Motion: Immediate feedback on actions (`hover:`, `active:scale-[0.98]`, `disabled:opacity-50`). 150–200 ms transitions, a 600 ms highlight flash, and respect `prefers-reduced-motion`.
