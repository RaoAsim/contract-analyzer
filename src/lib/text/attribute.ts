import type { AttributedResult, AttributionDoc } from "./attribute.types";
import { existsExactly, verifyQuote } from "./verify";

/**
 * Verify a quote ONLY against the document its tag names (§9.4). If it isn't there but exists
 * (T1–T3) in another document of the conversation, it is `misattributed` — still shown as unverified.
 */
export function verifyAttributed(docs: readonly AttributionDoc[], tag: string, quote: string): AttributedResult {
  const claimed = docs.find((d) => d.tag.toUpperCase() === tag.trim().toUpperCase());
  if (!claimed) return { status: "unverified", reason: "unknown_document", occurrences: [], primary: 0 };
  const r = verifyQuote(claimed.index, quote, { contextRanges: claimed.contextRanges });
  if (r.status !== "unverified") return { ...r, docId: claimed.docId };
  for (const other of docs) {
    if (other.docId === claimed.docId) continue;
    if (existsExactly(other.index, quote)) {
      return { status: "misattributed", reason: "not_found", occurrences: [], primary: 0, docId: claimed.docId, foundInDocId: other.docId };
    }
  }
  return { ...r, docId: claimed.docId };
}
