import type { PageItem } from "@/types/document";
import { ingestErrors } from "./errors";
import { loadPdfjs, pdfDocumentOptions } from "./pdfjs";
import type { PdfExtraction, PdfLine, PdfPage } from "./pdf.types";

type RawTextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL: boolean;
};

type Placed = {
  str: string;
  x: number;
  baseline: number;
  fontH: number;
  w: number;
  bbox: [x: number, y: number, w: number, h: number];
  hasEOL: boolean;
};

const WS = /\s/;
const LOW_TEXT_THRESHOLD = 20;

const yieldToEventLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

function isTextItem(v: unknown): v is RawTextItem {
  return typeof v === "object" && v !== null && typeof (v as { str?: unknown }).str === "string";
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Extract canonical text + item geometry from a PDF with pdf.js (§8.3).
 * Items keep content-stream order (no re-sorting); lines are joined with "\n", pages with "\n\n".
 */
export async function extractPdf(
  bytes: Uint8Array,
  onPage?: (pageNo: number, total: number) => Promise<void> | void,
): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(pdfDocumentOptions(bytes));
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err instanceof Error && err.name === "PasswordException") throw ingestErrors.password();
    throw ingestErrors.corrupted();
  }

  const imageOps = new Set<number>([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintInlineImageXObjectGroup,
  ]);

  const pages: PdfPage[] = [];
  let text = "";
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (p > 1) text += "\n\n";
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const vw = viewport.width;
      const vh = viewport.height;
      const content = await page.getTextContent();

      const placed: Placed[] = [];
      for (const raw of content.items) {
        if (!isTextItem(raw)) continue; // marked-content items have no `str`
        const tx = pdfjs.Util.transform(viewport.transform, raw.transform) as number[];
        const fontH = Math.hypot(tx[2]!, tx[3]!) || Math.hypot(tx[0]!, tx[1]!) || 1;
        const dLen = Math.hypot(tx[0]!, tx[1]!) || 1;
        const dx = tx[0]! / dLen;
        const dy = tx[1]! / dLen;
        const ux = tx[2]! / fontH;
        const uy = tx[3]! / fontH;
        const w = raw.width * viewport.scale;
        const ox = tx[4]!;
        const oy = tx[5]!;
        // Corners of the (possibly rotated) glyph run; store its axis-aligned bounding box.
        const xs = [ox, ox + dx * w, ox + ux * fontH, ox + dx * w + ux * fontH];
        const ys = [oy, oy + dy * w, oy + uy * fontH, oy + dy * w + uy * fontH];
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        placed.push({
          str: raw.str,
          x: ox,
          baseline: oy,
          fontH,
          w,
          bbox: [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY],
          hasEOL: raw.hasEOL,
        });
      }

      // Group into lines and build the page text with canonical offsets.
      const pageStart = text.length;
      const items: PageItem[] = [];
      const lines: PdfLine[] = [];
      let line: { start: number; baseline: number; top: number; bottom: number; lastX: number; lastW: number } | null =
        null;
      let pendingEOL = false;

      const closeLine = (): void => {
        if (!line) return;
        // Trim trailing whitespace of the line from its range.
        let end = text.length;
        while (end > line.start && WS.test(text[end - 1]!)) end--;
        if (end > line.start) lines.push({ start: line.start, end, top: line.top / vh, bottom: line.bottom / vh });
        line = null;
      };

      for (const it of placed) {
        if (it.str.length === 0) {
          if (it.hasEOL) pendingEOL = true;
          continue;
        }
        const newLine = !line || pendingEOL || Math.abs(it.baseline - line.baseline) > 0.5 * it.fontH;
        if (newLine) {
          if (line) {
            closeLine();
            text += "\n";
          }
          line = { start: text.length, baseline: it.baseline, top: it.bbox[1], bottom: it.bbox[1] + it.bbox[3], lastX: 0, lastW: 0 };
          pendingEOL = false;
        } else if (line) {
          const gap = it.x - (line.lastX + line.lastW);
          const prevChar = text[text.length - 1] ?? " ";
          if (gap > 0.15 * it.fontH && !WS.test(prevChar) && !WS.test(it.str[0]!)) text += " ";
        }
        const cur = line!;
        // Don't let whitespace-only items start a line or double up spaces.
        if (/^\s+$/.test(it.str)) {
          if (text.length > cur.start && !WS.test(text[text.length - 1]!)) text += " ";
        } else {
          const s = text.length;
          text += it.str.replace(/\n/g, " ");
          const [bx, by, bw, bh] = it.bbox;
          items.push([
            s,
            it.str.length,
            round4(clamp01(bx / vw)),
            round4(clamp01(by / vh)),
            round4(clamp01(bw / vw)),
            round4(clamp01(bh / vh)),
          ]);
        }
        cur.top = Math.min(cur.top, it.bbox[1]);
        cur.bottom = Math.max(cur.bottom, it.bbox[1] + it.bbox[3]);
        cur.lastX = it.x;
        cur.lastW = it.w;
        if (it.hasEOL) pendingEOL = true;
      }
      closeLine();

      // Trim trailing whitespace from the page.
      while (text.length > pageStart && WS.test(text[text.length - 1]!)) text = text.slice(0, -1);

      const pageText = text.slice(pageStart);
      const nonWs = pageText.replace(/\s+/g, "").length;
      // The quality ratio ignores dot leaders / rules (tables of contents, signature lines) and counts
      // "(cid:n)" runs and replacement / private-use glyphs as garbage.
      const scored = pageText.replace(/[.·…_\-–—=*•]{3,}/g, "").replace(/\(cid:\d+\)/g, "�");
      const scoredNonWs = scored.replace(/\s+/g, "").length;
      const alnum = (scored.match(/[\p{L}\p{N}]/gu) ?? []).length;
      const garbage = (scored.match(/[�\p{Co}\p{Cc}]/gu) ?? []).length;
      let hasImage = false;
      if (nonWs < LOW_TEXT_THRESHOLD) {
        const ops = await page.getOperatorList();
        hasImage = ops.fnArray.some((fn) => imageOps.has(fn));
      }

      pages.push({
        pageNo: p,
        charStart: pageStart,
        charEnd: text.length,
        width: round4(vw),
        height: round4(vh),
        items,
        lines,
        nonWs,
        alnumRatio: scoredNonWs === 0 ? 1 : alnum / scoredNonWs,
        garbageRatio: scoredNonWs === 0 ? 0 : garbage / scoredNonWs,
        hasImage,
      });
      page.cleanup();
      await onPage?.(p, doc.numPages);
      await yieldToEventLoop();
    }
  } finally {
    await task.destroy().catch(() => {});
  }
  return { text, pages };
}

/**
 * Scanned / garbled page detection (§8.4). A page is unreadable if its text is garbled
 * (letters+digits < 50% of non-whitespace, ignoring dot leaders; or > 20% replacement/private-use/cid
 * glyphs), or if it has almost no text AND paints an image
 * (a scanned page). A genuinely blank page is not "unreadable" — there is nothing on it to read.
 */
export function unreadablePages(pages: readonly PdfPage[]): number[] {
  const out: number[] = [];
  for (const p of pages) {
    const garbled = p.nonWs > 0 && (p.alnumRatio < 0.5 || p.garbageRatio > 0.2);
    const scanned = p.nonWs < LOW_TEXT_THRESHOLD && p.hasImage;
    if (garbled || scanned) out.push(p.pageNo);
  }
  return out;
}

/** Throws `no_text_layer` if the document has no usable text on any page. */
export function assertHasTextLayer(pages: readonly PdfPage[], unreadable: readonly number[]): void {
  const bad = new Set(unreadable);
  const readableChars = pages.filter((p) => !bad.has(p.pageNo)).reduce((n, p) => n + p.nonWs, 0);
  if (pages.length === 0 || bad.size === pages.length || readableChars < 50) throw ingestErrors.noTextLayer();
}
