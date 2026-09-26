import { diffWordsWithSpace } from "diff";
import type { Hunk } from "@/types/compare";

/**
 * Word-level redline (§13.3): diffWordsWithSpace, then consolidate change hunks separated by an
 * unchanged run of ≤ 3 words, so the redline reads as phrases rather than confetti.
 */
export function redline(before: string, after: string): Hunk[] {
  const raw: Hunk[] = diffWordsWithSpace(before, after).map((c) => ({ op: c.added ? "ins" : c.removed ? "del" : "eq", text: c.value }));
  // Consolidate: del/ins … short eq … del/ins → one del + one ins around it.
  const out: Hunk[] = [];
  let i = 0;
  while (i < raw.length) {
    const h = raw[i]!;
    if (h.op === "eq") {
      out.push(h);
      i++;
      continue;
    }
    let del = "";
    let ins = "";
    let j = i;
    for (;;) {
      while (j < raw.length && raw[j]!.op !== "eq") {
        if (raw[j]!.op === "del") del += raw[j]!.text;
        else ins += raw[j]!.text;
        j++;
      }
      const eq = raw[j];
      const next = raw[j + 1];
      if (eq && next && next.op !== "eq" && eq.text.trim().split(/\s+/).filter(Boolean).length <= 3) {
        del += eq.text;
        ins += eq.text;
        j++;
        continue;
      }
      break;
    }
    if (del) out.push({ op: "del", text: del });
    if (ins) out.push({ op: "ins", text: ins });
    i = j;
  }
  return out;
}

/** Changed text around the hunks, for LLM context (trimmed around changes). */
export function changedSnippet(hunks: Hunk[], side: "before" | "after", maxChars: number): string {
  const parts = hunks.filter((h) => h.op === "eq" || (side === "before" ? h.op === "del" : h.op === "ins")).map((h) => (h.op === "eq" ? h.text : `[[${h.text}]]`));
  const full = parts.join("");
  if (full.length <= maxChars) return full;
  const first = full.indexOf("[[");
  const start = Math.max(0, first - Math.floor(maxChars / 3));
  return `${start > 0 ? "…" : ""}${full.slice(start, start + maxChars)}…`;
}
