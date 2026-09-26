import type { Block, DocxParseResult, Paragraph, ParagraphSpan } from "./docx.types";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/**
 * Build the canonical text and the viewer HTML from ONE block model (invariant I1).
 * Every canonical character lives in exactly one `<span data-o="{canonStart}">`; bullets are
 * rendered but are not part of the canonical text.
 */
export function renderBlocks(blocks: Block[]): Omit<DocxParseResult, "simplified"> {
  let text = "";
  const html: string[] = [];
  const paragraphs: ParagraphSpan[] = [];

  const emit = (p: Paragraph, inTable: boolean): void => {
    const runsText = p.runs.map((r) => r.text).join("");
    const hasLabel = !!p.numLabel && !p.isBullet;
    if (runsText.trim().length === 0 && !hasLabel) {
      if (!inTable) html.push('<p class="docx-empty" aria-hidden="true"></p>');
      return;
    }
    if (text.length > 0) text += "\n";
    const start = text.length;
    const level = p.headingLevel;
    const tag = level ? `h${Math.min(Math.max(level, 1), 4)}` : "p";
    const parts: string[] = [];
    if (hasLabel) {
      const s = text.length;
      text += `${p.numLabel} `;
      parts.push(`<span class="num" data-o="${s}">${escapeHtml(`${p.numLabel} `)}</span>`);
    } else if (p.isBullet) {
      parts.push('<span aria-hidden="true" class="bullet">•</span>');
    }
    let leadingBold: boolean | undefined;
    let boldLead = "";
    let leadOpen = true;
    for (const r of p.runs) {
      const s = text.length;
      text += r.text;
      let inner = `<span data-o="${s}">${escapeHtml(r.text)}</span>`;
      if (r.u) inner = `<u>${inner}</u>`;
      if (r.i) inner = `<em>${inner}</em>`;
      if (r.b) inner = `<strong>${inner}</strong>`;
      parts.push(inner);
      const bold = r.b || !!p.styleBold;
      if (r.text.trim()) {
        if (leadingBold === undefined) leadingBold = bold;
        if (leadOpen && bold) boldLead += r.text;
        else leadOpen = false;
      } else if (leadOpen && boldLead) boldLead += r.text;
    }
    const cls = p.isBullet ? ' class="docx-bullet"' : "";
    html.push(`<${tag}${cls}>${parts.join("")}</${tag}>`);
    paragraphs.push({
      start,
      end: text.length,
      text: text.slice(start),
      numLabel: hasLabel ? p.numLabel : undefined,
      isBullet: !!p.isBullet,
      headingLevel: level,
      leadingBold: leadingBold ?? false,
      boldLead: boldLead.trim() || undefined,
      inTable,
    });
  };

  for (const b of blocks) {
    if (b.kind === "p") {
      emit(b, false);
      continue;
    }
    html.push('<table class="docx-table"><tbody>');
    for (const row of b.rows) {
      html.push("<tr>");
      for (const cell of row.cells) {
        html.push("<td>");
        for (const p of cell.paragraphs) emit(p, true);
        html.push("</td>");
      }
      html.push("</tr>");
    }
    html.push("</tbody></table>");
  }
  return { text, html: html.join("\n"), paragraphs };
}
