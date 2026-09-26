import mammoth from "mammoth";
import { parseHTML } from "linkedom";
import type { DocxParseResult, ParagraphSpan } from "./docx.types";
import { escapeHtml } from "./render";

const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH", "PRE", "BLOCKQUOTE"]);

type DomNode = { nodeType: number; nodeName: string; childNodes: ArrayLike<DomNode>; textContent: string | null };

/**
 * Fallback when the custom OOXML parser throws (§8.6): mammoth's HTML, re-rendered with the same
 * `data-o` offset spans so highlighting still works. Numbering labels may be missing.
 */
export async function parseDocxWithMammoth(bytes: Uint8Array): Promise<DocxParseResult> {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const { document } = parseHTML(`<!doctype html><html><body>${value}</body></html>`);

  let text = "";
  const paragraphs: ParagraphSpan[] = [];
  const out: string[] = [];

  const renderInline = (n: DomNode): string => {
    if (n.nodeType === 3) {
      const t = n.textContent ?? "";
      if (!t) return "";
      const s = text.length;
      text += t;
      return `<span data-o="${s}">${escapeHtml(t)}</span>`;
    }
    const tag = n.nodeName.toLowerCase();
    const inner = Array.from(n.childNodes).map(renderInline).join("");
    if (tag === "strong" || tag === "b") return `<strong>${inner}</strong>`;
    if (tag === "em" || tag === "i") return `<em>${inner}</em>`;
    if (tag === "u") return `<u>${inner}</u>`;
    if (tag === "br") {
      text += "\n";
      return "<br>";
    }
    return inner;
  };

  const renderBlock = (n: DomNode, inTable: boolean): void => {
    if (n.nodeType !== 1) return;
    const name = n.nodeName;
    if (name === "TABLE" || name === "TBODY" || name === "THEAD" || name === "TR" || name === "UL" || name === "OL") {
      const wrapper = name === "TABLE" ? "table" : name === "TR" ? "tr" : null;
      if (wrapper) out.push(wrapper === "table" ? '<table class="docx-table"><tbody>' : "<tr>");
      for (const c of Array.from(n.childNodes)) renderBlock(c, inTable || name === "TABLE");
      if (wrapper) out.push(wrapper === "table" ? "</tbody></table>" : "</tr>");
      return;
    }
    if (!BLOCK_TAGS.has(name)) {
      for (const c of Array.from(n.childNodes)) renderBlock(c, inTable);
      return;
    }
    if (!(n.textContent ?? "").trim()) return;
    if (text.length > 0) text += "\n";
    const start = text.length;
    const inner = Array.from(n.childNodes).map(renderInline).join("");
    const tag = /^H[1-4]$/.test(name) ? name.toLowerCase() : name === "TD" || name === "TH" ? "td" : "p";
    out.push(tag === "td" ? `<td><p>${inner}</p></td>` : `<${tag}>${inner}</${tag}>`);
    const heading = /^H(\d)$/.exec(name);
    paragraphs.push({
      start,
      end: text.length,
      text: text.slice(start),
      isBullet: name === "LI",
      headingLevel: heading ? Number(heading[1]) : undefined,
      leadingBold: false,
      inTable,
    });
  };

  for (const c of Array.from((document.body as unknown as DomNode).childNodes)) renderBlock(c, false);
  return { text, html: out.join("\n"), paragraphs, simplified: true };
}
