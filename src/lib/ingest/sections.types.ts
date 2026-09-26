/** A candidate line/paragraph for heading detection. Offsets are canonical. */
export type HeadingCandidate = {
  start: number;
  end: number;
  text: string;
  /** DOCX hints */
  headingLevel?: number;
  numLabel?: string;
  leadingBold?: boolean;
  boldLead?: string;
  inTable?: boolean;
};

export type SectionDraft = {
  ord: number;
  number: string | null;
  title: string;
  level: number;
  start: number;
  end: number;
  parentOrd: number | null;
  pageStart: number | null;
  pageEnd: number | null;
};

export type PageSpan = { pageNo: number; start: number; end: number };

export type SectionResult = { sections: SectionDraft[]; structured: boolean };
