import type { CoverageDoc, Notice } from "@/types/chat";
import { compressNumbers } from "@/lib/text/ranges";
import type { RunContext, StreamOutcome } from "./chat.types";
import { buildCoverage, coveragePercent, hasAbsenceClaim, isDocComplete } from "./coverage";

export function notice(ctx: RunContext, n: Notice): void {
  ctx.state.notices.push(n);
  ctx.emit("notice", n);
}

function stripTokens(s: string): string {
  return s.replace(/⟦c\d+⟧/g, "");
}

/** Coverage + server-side absence enforcement + quote notices, after every answer (§11.4, §11.6). */
export function finish(ctx: RunContext, perDoc: CoverageDoc[], outcome: StreamOutcome | null, serverWritten = false): void {
  const coverage = buildCoverage(ctx.state.mode, perDoc);
  ctx.state.coverage = coverage;
  ctx.emit("coverage", coverage);
  if (outcome?.stopped) return;

  const text = stripTokens(ctx.state.content);
  const incomplete = perDoc.filter((d) => !isDocComplete(d));
  if (incomplete.length > 0 && hasAbsenceClaim(text)) {
    const what = incomplete.map((d) => `${coveragePercent(d)} of ${d.name}`).join(", ");
    const text =
      ctx.state.mode === "scan"
        ? `Not every part of ${incomplete.map((d) => d.name).join(", ")} could be read (${what} read). Statements that something is absent may be wrong.`
        : ctx.state.mode === "agent"
          ? `The research read only part of the document (${what}). Statements that something is absent may be wrong.`
          : `This answer is based on excerpts (${what}). Statements that something is absent may be wrong.`;
    notice(ctx, {
      code: "ABSENCE_UNVERIFIED",
      text,
      action: ctx.state.mode === "retrieval" || ctx.state.mode === "agent" ? { kind: "thorough", label: "Ask again, reading the whole document" } : undefined,
    });
  }
  for (const d of perDoc) {
    if (d.unreadablePages?.length) {
      notice(ctx, {
        code: "UNREADABLE_PAGES",
        text: `${perDoc.length > 1 ? `${d.tag}: ` : ""}Pages ${compressNumbers(d.unreadablePages)} are scanned images and were not read.`,
      });
    }
  }
  if (serverWritten || outcome?.notFound) return;
  const verified = ctx.state.citations.filter((c) => c.status === "verified" || c.status === "verified_close");
  if (text.trim() && verified.length === 0) {
    notice(ctx, {
      code: "NO_VERIFIED_QUOTES",
      text:
        ctx.state.citations.length > 0
          ? "None of the quotes in this answer could be found in the document. Treat it as unsupported."
          : "This answer has no supporting quotes from the document. Treat it as unsupported.",
    });
  }
}

