import { countTokens } from "@/lib/llm/tokens";
import { blankRanges, compressNumbers, overlapLength } from "@/lib/text/ranges";
import type { DocumentKind, DocumentWarning, Range } from "@/types/document";
import type { Analysis, ProgressFn } from "./analyze.types";
import { buildChunks } from "./chunk";
import { detectClauses } from "./clauses";
import { parseDocx } from "./docx";
import { ingestErrors } from "./errors";
import { detectFurniture } from "./furniture";
import { assertHasTextLayer, extractPdf, unreadablePages } from "./pdf";
import { detectSections } from "./sections";
import type { HeadingCandidate, PageSpan } from "./sections.types";

const noop: ProgressFn = async () => {};

function pagesLabel(pages: number[]): string {
  const s = compressNumbers(pages);
  return pages.length === 1 ? `Page ${s} has` : `Pages ${s} have`;
}

/**
 * The processing pipeline without I/O (§8.2–8.10): extract → quality → furniture → sections →
 * chunks → clauses. Throws PermanentIngestError for permanent failures.
 */
export async function analyzeDocument(bytes: Uint8Array, kind: DocumentKind, progress: ProgressFn = noop): Promise<Analysis> {
  const warnings: DocumentWarning[] = [];
  let text: string;
  let html: string | null = null;
  let pages: Analysis["pages"] = [];
  let furniture: Range[] = [];
  let unreadable: number[] = [];
  let candidates: HeadingCandidate[];

  if (kind === "pdf") {
    const extraction = await extractPdf(bytes, (n, total) =>
      progress(`Extracting text: page ${n} of ${total}`, 5 + Math.round((50 * n) / total)),
    );
    text = extraction.text;
    pages = extraction.pages;

    await progress("Checking text quality", 58, true);
    unreadable = unreadablePages(pages);
    assertHasTextLayer(pages, unreadable);
    if (unreadable.length > 0) {
      warnings.push({
        code: "partial_scan",
        message: `${pagesLabel(unreadable)} no readable text (likely scanned images) and cannot be searched or quoted.`,
      });
    }

    await progress("Detecting headers and footers", 60, true);
    furniture = detectFurniture(text, pages);
    const bad = new Set(unreadable);
    candidates = pages
      .filter((p) => !bad.has(p.pageNo))
      .flatMap((p) => p.lines)
      .filter((l) => overlapLength(l.start, l.end, furniture) === 0)
      .map((l) => ({ start: l.start, end: l.end, text: text.slice(l.start, l.end) }));
  } else {
    await progress("Extracting text", 20, true);
    const parsed = await parseDocx(bytes);
    text = parsed.text;
    html = parsed.html;
    if (parsed.simplified) {
      warnings.push({
        code: "simplified_docx_render",
        message: "This Word file was opened in simplified mode; automatic clause numbers may be missing.",
      });
    }
    if (text.replace(/\s+/g, "").length < 50) throw ingestErrors.emptyDocument();
    candidates = parsed.paragraphs.map((p) => ({
      start: p.start,
      end: p.end,
      text: p.text,
      headingLevel: p.headingLevel,
      numLabel: p.numLabel,
      leadingBold: p.leadingBold,
      boldLead: p.boldLead,
      inTable: p.inTable,
    }));
    await progress("Extracting text", 55, true);
  }

  await progress("Finding sections", 65, true);
  const pageSpans: PageSpan[] = pages.map((p) => ({ pageNo: p.pageNo, start: p.charStart, end: p.charEnd }));
  const { sections, structured } = detectSections(text, candidates, pageSpans, kind);
  if (!structured) {
    warnings.push({
      code: "no_structure_detected",
      message:
        kind === "pdf"
          ? "No numbered clauses were detected, so the outline is organised by page."
          : "No numbered clauses were detected, so the outline is organised in parts.",
    });
  }

  await progress("Preparing search index", 70, true);
  const chunks = buildChunks(text, sections, furniture, pageSpans);
  const clauses = detectClauses(text, sections);
  const tokenCount = countTokens(blankRanges(text, 0, furniture));

  return {
    kind,
    text,
    pages,
    html,
    furniture,
    unreadablePages: unreadable,
    warnings,
    sections,
    chunks,
    clauses,
    pageCount: kind === "pdf" ? pages.length : null,
    tokenCount,
  };
}
