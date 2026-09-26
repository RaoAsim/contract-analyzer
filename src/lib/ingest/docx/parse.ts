import JSZip from "jszip";
import type { Block, Paragraph, Run, StyleDef, Table } from "./docx.types";
import { NumberingEngine, parseNumbering } from "./numbering";
import { attr, child, childElements, intAttr, isOn, parseXml, type XmlElement } from "./xml";

type Styles = Map<string, StyleDef>;

function parseStyles(xml: string | null): Styles {
  const styles: Styles = new Map();
  if (!xml) return styles;
  const root = parseXml(xml);
  if (!root) return styles;
  for (const s of childElements(root)) {
    if (s.localName !== "style") continue;
    const id = attr(s, "styleId");
    if (!id) continue;
    const pPr = child(s, "pPr");
    const numPr = pPr ? child(pPr, "numPr") : undefined;
    const rPr = child(s, "rPr");
    styles.set(id, {
      id,
      name: attr(child(s, "name"), "val"),
      basedOn: attr(child(s, "basedOn"), "val"),
      outlineLvl: intAttr(pPr ? child(pPr, "outlineLvl") : undefined, "val"),
      numId: intAttr(numPr ? child(numPr, "numId") : undefined, "val"),
      ilvl: intAttr(numPr ? child(numPr, "ilvl") : undefined, "val"),
      bold: rPr ? isOn(child(rPr, "b")) : undefined,
    });
  }
  return styles;
}

/** Walk the basedOn chain (up to 5 levels) and return the first defined value. */
function resolveStyle<T>(styles: Styles, id: string | undefined, pick: (s: StyleDef) => T | undefined): T | undefined {
  let cur = id ? styles.get(id) : undefined;
  for (let depth = 0; cur && depth < 6; depth++) {
    const v = pick(cur);
    if (v !== undefined) return v;
    cur = cur.basedOn ? styles.get(cur.basedOn) : undefined;
  }
  return undefined;
}

function headingLevelFor(styles: Styles, styleId: string | undefined, outlineLvl: number | undefined): number | undefined {
  if (outlineLvl !== undefined && outlineLvl >= 0 && outlineLvl < 9) return outlineLvl + 1;
  const byName = resolveStyle(styles, styleId, (s) => {
    const m = s.name?.match(/^heading\s*(\d)$/i);
    return m ? Number(m[1]) : undefined;
  });
  if (byName !== undefined) return byName;
  const lvl = resolveStyle(styles, styleId, (s) => s.outlineLvl);
  return lvl !== undefined && lvl < 9 ? lvl + 1 : undefined;
}

type FieldState = { mode: "instr" | "result" }[];

/** Collect runs of a paragraph in document order (§8.6 run rules). */
function collectRuns(el: XmlElement, out: Run[], fields: FieldState): void {
  for (const c of childElements(el)) {
    switch (c.localName) {
      case "r":
        readRun(c, out, fields);
        break;
      case "hyperlink":
      case "smartTag":
      case "ins":
      case "moveTo":
      case "customXml":
      case "fldSimple":
      case "bdo":
      case "dir":
        collectRuns(c, out, fields);
        break;
      case "sdt": {
        const content = child(c, "sdtContent");
        if (content) collectRuns(content, out, fields);
        break;
      }
      // del, moveFrom: deleted text in the final view — skip. pPr, bookmarks, proofErr: no text.
      default:
        break;
    }
  }
}

function readRun(r: XmlElement, out: Run[], fields: FieldState): void {
  const rPr = child(r, "rPr");
  const b = rPr ? isOn(child(rPr, "b")) : false;
  const i = rPr ? isOn(child(rPr, "i")) : false;
  const uEl = rPr ? child(rPr, "u") : undefined;
  const u = uEl ? attr(uEl, "val") !== "none" : false;
  let text = "";
  for (const c of childElements(r)) {
    const inInstr = fields.length > 0 && fields[fields.length - 1]!.mode === "instr";
    switch (c.localName) {
      case "fldChar": {
        const type = attr(c, "fldCharType");
        if (type === "begin") fields.push({ mode: "instr" });
        else if (type === "separate" && fields.length > 0) fields[fields.length - 1]!.mode = "result";
        else if (type === "end") fields.pop();
        break;
      }
      case "t":
        if (!inInstr) text += c.textContent ?? "";
        break;
      case "tab":
        if (!inInstr) text += "\t";
        break;
      case "br":
      case "cr":
        if (!inInstr) text += "\n";
        break;
      case "noBreakHyphen":
        if (!inInstr) text += "-";
        break;
      // instrText, delText, softHyphen, sym, drawing…: no canonical text
      default:
        break;
    }
  }
  if (text) out.push({ text, b, i, u });
}

function readParagraph(p: XmlElement, styles: Styles): Paragraph {
  const pPr = child(p, "pPr");
  const styleId = attr(pPr ? child(pPr, "pStyle") : undefined, "val");
  const numPr = pPr ? child(pPr, "numPr") : undefined;
  const outlineLvl = intAttr(pPr ? child(pPr, "outlineLvl") : undefined, "val");
  let numId = intAttr(numPr ? child(numPr, "numId") : undefined, "val");
  let ilvl = intAttr(numPr ? child(numPr, "ilvl") : undefined, "val");
  if (numId === undefined) {
    numId = resolveStyle(styles, styleId, (s) => s.numId);
    if (numId !== undefined && ilvl === undefined) ilvl = resolveStyle(styles, styleId, (s) => s.ilvl);
  }
  const runs: Run[] = [];
  collectRuns(p, runs, []);
  return {
    kind: "p",
    styleId,
    styleName: resolveStyle(styles, styleId, (s) => s.name),
    headingLevel: headingLevelFor(styles, styleId, outlineLvl),
    numId,
    ilvl,
    runs,
    styleBold: resolveStyle(styles, styleId, (s) => s.bold) ?? false,
  };
}

function readTable(tbl: XmlElement, styles: Styles): Table {
  const rows = childElements(tbl)
    .filter((c) => c.localName === "tr")
    .map((tr) => ({
      cells: childElements(tr)
        .filter((c) => c.localName === "tc" || c.localName === "sdt")
        .flatMap((tc) => (tc.localName === "sdt" ? childElements(child(tc, "sdtContent") ?? tc).filter((x) => x.localName === "tc") : [tc]))
        .map((tc) => ({ paragraphs: readBlocks(tc, styles).flatMap((b) => (b.kind === "p" ? [b] : flattenTable(b))) })),
    }));
  return { kind: "table", rows };
}

/** Nested tables are flattened into their cell paragraphs. */
function flattenTable(t: Table): Paragraph[] {
  return t.rows.flatMap((r) => r.cells.flatMap((c) => c.paragraphs));
}

function readBlocks(container: XmlElement, styles: Styles): Block[] {
  const out: Block[] = [];
  for (const c of childElements(container)) {
    if (c.localName === "p") out.push(readParagraph(c, styles));
    else if (c.localName === "tbl") out.push(readTable(c, styles));
    else if (c.localName === "sdt") {
      const content = child(c, "sdtContent");
      if (content) out.push(...readBlocks(content, styles));
    } else if (c.localName === "customXml") out.push(...readBlocks(c, styles));
  }
  return out;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? f.async("string") : null;
}

/**
 * Parse word/document.xml into blocks with numbering labels applied (§8.6).
 * Headers, footers, footnotes and comments are ignored.
 */
export async function parseDocxBlocks(bytes: Uint8Array): Promise<Block[]> {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await readZipText(zip, "word/document.xml");
  if (!docXml) throw new Error("word/document.xml missing");
  const [stylesXml, numberingXml] = await Promise.all([
    readZipText(zip, "word/styles.xml"),
    readZipText(zip, "word/numbering.xml"),
  ]);
  const styles = parseStyles(stylesXml);
  const engine = new NumberingEngine(parseNumbering(numberingXml));
  const root = parseXml(docXml);
  const body = root ? child(root, "body") : undefined;
  if (!body) throw new Error("document body missing");
  const blocks = readBlocks(body, styles);

  const label = (p: Paragraph): void => {
    // Word numbers empty list paragraphs too, so always advance the counters.
    const l = engine.next(p.numId, p.ilvl);
    if (l) {
      p.numLabel = l.label;
      p.isBullet = l.isBullet;
    }
  };
  for (const b of blocks) {
    if (b.kind === "p") label(b);
    else for (const r of b.rows) for (const c of r.cells) for (const p of c.paragraphs) label(p);
  }
  return blocks;
}
