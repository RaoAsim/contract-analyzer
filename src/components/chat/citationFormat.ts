import type { Citation, Occurrence } from "@/types/citation";

/** "§12.3 · p. 41" / "§12.3 · pp. 41–42" */
export function locationLabel(o: Occurrence | undefined): string {
  if (!o) return "";
  const sec = o.sectionNumber ? `§${o.sectionNumber}` : o.sectionTitle && !/^(Preamble|Page \d+|Part \d+)$/.test(o.sectionTitle) ? o.sectionTitle : "";
  const page = o.pageStart ? (o.pageEnd && o.pageEnd !== o.pageStart ? `pp. ${o.pageStart}–${o.pageEnd}` : `p. ${o.pageStart}`) : "";
  return [sec, page].filter(Boolean).join(" · ");
}

export function isVerified(c: Citation): boolean {
  return c.status === "verified" || c.status === "verified_close";
}

/** Display numbers for verified citations, in order of first appearance in the content. */
export function citationNumbers(content: string, citations: Citation[]): Map<string, number> {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const out = new Map<string, number>();
  const byPassage = new Map<string, number>();
  let next = 1;
  for (const m of content.matchAll(/⟦(c\d+)⟧/g)) {
    const c = byId.get(m[1]!);
    if (!c || !isVerified(c) || out.has(c.id)) continue;
    // The same passage cited twice gets the same number (and one row under Sources).
    const o = c.occurrences[c.primary];
    const key = o ? `${c.docId}:${o.start}:${o.end}` : c.id;
    const n = byPassage.get(key) ?? next++;
    byPassage.set(key, n);
    out.set(c.id, n);
  }
  return out;
}

/** Plain-text copy: verified quotes inlined as the document's text, unverified ones marked. */
export function plainText(content: string, citations: Citation[]): string {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const nums = citationNumbers(content, citations);
  return content.replace(/⟦(c\d+)⟧/g, (_, id: string) => {
    const c = byId.get(id);
    if (!c) return "";
    if (isVerified(c)) return ` [${nums.get(id)}]`;
    return " [unverified]";
  });
}
