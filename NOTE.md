# Short note

**How quote verification works, and where it could fail.**
- When a contract is uploaded, we extract its text once and keep it as the single "true" copy.
- The AI must put every quote in a special tag. As the answer streams in, our code takes each quote and searches for it in that copy.
- Before comparing, both sides are cleaned the same way: extra spaces, line breaks, curly vs straight quotes, dashes, words split with a hyphen at the end of a line, and page headers and footers no longer get in the way. Each cleaned character still points back to its original position, which lets us highlight the exact spot.
- We try an exact match first, then a letters-and-digits-only match (numbers must still be identical), then quotes with "…" in the middle, and finally a very close match that allows only a one-letter typo. A close match is never allowed to change a number or words like "shall", "may" or "not".
- If the quote is found, we show the document's own text, not the AI's version, and it becomes a clickable source. If not, it is clearly marked "unverified" and never shown as a source.
- We never use page numbers or positions from the AI.
- It can fail on:
  - PDFs whose fonts produce garbled text;
  - two-column layouts, where lines can come out in the wrong order;
  - quotes spread across unusual tables;
  - near-identical boilerplate, where we may highlight the wrong copy (we show all copies);
  - the one-typo allowance, which in rare cases could accept a quote that isn't word-for-word.

**How we handled large documents.**
- We deliberately send at most about 20k tokens per question, so a 150-page contract always uses the long-document path.
- For a specific question we search the document (keywords, section numbers, and short query rewrites from the AI) and send the best passages plus the full table of contents.
- For "is there / any / list" questions, or when the passages don't contain the answer, the app reads the whole document in parallel parts, checks every finding, and then answers.
- Every answer shows how much of the document it was based on.
- The server only allows "the contract doesn't say X" when the whole document was actually read. Otherwise it shows a warning with a button to ask again, reading everything.

**Part C.**
- We chose **Option 2, agentic research**. It builds on what we already had (sections, search, page positions and the quote checker), and it can be tested properly: we have replay tests with a fake AI that sends broken tool calls. Option 1 (real tracked changes in Word) is mostly a deep Word-file-format problem, and a half-working version was a bigger risk in three days.
- How far we got: it's complete. The AI has eight tools, shows each step live, runs under hard limits on rounds, tool calls, tokens and time, handles unknown tools and bad arguments without crashing, and its final answer goes through the same quote checker.
- The hardest part was making the final answer honest when the research stopped early: saying which sections were actually read, and not letting the AI claim something is missing without a full check. Stopping it from guessing section numbers was the other hard part.

**What we would build next.**
- OCR for scanned pages.
- Option 1 redlining on top of the Word parser we already have.
- A clause list screen.
- Answers that reconnect after a page refresh.
- Detection of clauses that were split or merged between versions.
- A test set of real long contracts, to measure answer quality over time.
