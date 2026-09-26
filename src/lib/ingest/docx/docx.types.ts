export type Run = { text: string; b: boolean; i: boolean; u: boolean };

export type Paragraph = {
  kind: "p";
  styleId?: string;
  styleName?: string;
  headingLevel?: number;
  numId?: number;
  ilvl?: number;
  runs: Run[];
  /** Filled in by the numbering pass. */
  numLabel?: string;
  isBullet?: boolean;
  /** Paragraph style's run properties say bold. */
  styleBold?: boolean;
};

export type TableCell = { paragraphs: Paragraph[] };
export type TableRow = { cells: TableCell[] };
export type Table = { kind: "table"; rows: TableRow[] };

export type Block = Paragraph | Table;

export type StyleDef = {
  id: string;
  name?: string;
  basedOn?: string;
  outlineLvl?: number;
  numId?: number;
  ilvl?: number;
  bold?: boolean;
};

export type LevelDef = {
  start: number;
  numFmt: string;
  lvlText: string;
  isLgl: boolean;
};

export type NumberingDefs = {
  abstract: Map<number, Map<number, LevelDef>>;
  nums: Map<number, { abstractNumId: number; startOverrides: Map<number, number> }>;
};

/** A paragraph as laid out in the canonical text. */
export type ParagraphSpan = {
  start: number;
  end: number;
  /** Text including the number label. */
  text: string;
  numLabel?: string;
  isBullet: boolean;
  headingLevel?: number;
  /** First non-empty run is bold (or the paragraph style is bold). */
  leadingBold: boolean;
  /** Text of the leading bold run(s). */
  boldLead?: string;
  inTable: boolean;
};

export type DocxParseResult = {
  text: string;
  html: string;
  paragraphs: ParagraphSpan[];
  /** True when the mammoth fallback was used. */
  simplified: boolean;
};
