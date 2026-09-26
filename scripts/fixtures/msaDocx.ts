import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

type Clause = { title: string; subs: (string | { text: string; items: string[] })[]; table?: string[][] };

const DEFINITIONS: Clause = {
  title: "Definitions",
  subs: [
    "“Agreement” means this master services agreement, including its schedules.",
    "“Services” means the managed IT services described in Schedule 1.",
    "“Business Day” means a day other than a Friday, Saturday or public holiday in the United Arab Emirates.",
  ],
};

const TERM: Clause = {
  title: "Term",
  subs: [
    "This Agreement commences on the Effective Date and continues for an initial term of three (3) years.",
    "This Agreement renews automatically for successive periods of one (1) year unless either party gives notice of non-renewal.",
  ],
};

const servicesClause = (v2: boolean): Clause => ({
  title: "Services",
  subs: [
    {
      text: "The Supplier shall provide the Services:",
      items: ["with reasonable skill and care;", "in accordance with the Service Levels; and", "in compliance with all applicable laws."],
    },
    v2
      ? "The Supplier may deliver a written performance report to the Customer each month."
      : "The Supplier shall deliver a written performance report to the Customer each month.",
    v2
      ? "The Supplier will make sure that all staff assigned to the Services are appropriately qualified."
      : "The Supplier will ensure that all personnel assigned to the Services are suitably qualified.",
  ],
});

const FEES: Clause = {
  title: "Fees and Payment",
  subs: [
    "The Customer shall pay the Fees set out in the table below.",
    "The Customer shall pay each undisputed invoice within thirty (30) days of receipt.",
  ],
  table: [
    ["Service", "Monthly Fee"],
    ["Service desk", "AED 25,000"],
    ["Infrastructure management", "AED 40,000"],
  ],
};

const CONFIDENTIALITY: Clause = {
  title: "Confidentiality",
  subs: [
    "Each party shall keep the other party’s Confidential Information confidential and shall not disclose it except as permitted by this Agreement.",
    "This clause 5 does not apply to information that is or becomes public other than through a breach of this Agreement.",
  ],
};

const liability = (v2: boolean): Clause => ({
  title: "Limitation of Liability",
  subs: [
    `The total aggregate liability of the Supplier under or in connection with this Agreement shall not exceed ${v2 ? "AED 1,000,000" : "AED 100,000"}.`,
    "Neither party shall be liable for any indirect or consequential loss.",
  ],
});

const termination = (v2: boolean): Clause => ({
  title: "Termination",
  subs: [
    `Either party may terminate this Agreement for convenience by giving not less than ${v2 ? "sixty (60)" : "thirty (30)"} days’ written notice to the other party.`,
    "Either party may terminate this Agreement immediately if the other party commits a material breach that is not remedied within fourteen (14) days of notice.",
  ],
});

const DATA_PROTECTION: Clause = {
  title: "Data Protection",
  subs: ["The Supplier shall process Customer Personal Data only on the documented instructions of the Customer."],
};

const AUDIT: Clause = {
  title: "Audit Rights",
  subs: ["The Customer may audit the Supplier’s compliance with this Agreement once in each Contract Year on reasonable notice."],
};

const NON_COMPETE: Clause = {
  title: "Non-Compete",
  subs: [
    "During the term and for twelve (12) months after it ends, the Supplier shall not provide services that compete with the Services to any competitor of the Customer in the United Arab Emirates.",
  ],
};

const governingLaw = (v2: boolean): Clause => ({
  title: "Governing Law",
  subs: [
    v2
      ? "This Agreement is governed by the laws of England and Wales, and the courts of London have exclusive jurisdiction."
      : "This Agreement is governed by the laws of the Emirate of Dubai, and the courts of Dubai have exclusive jurisdiction.",
  ],
});

/**
 * v1 → v2 changes (§18.1): liability cap AED 100,000 → 1,000,000; notice 30 → 60 days; shall → may;
 * one purely reworded sentence (3.3); Confidentiality moved; Non-Compete added; Audit Rights removed;
 * governing law changed.
 */
function clausesFor(v2: boolean): Clause[] {
  return v2
    ? [DEFINITIONS, TERM, servicesClause(true), FEES, liability(true), termination(true), DATA_PROTECTION, CONFIDENTIALITY, NON_COMPETE, governingLaw(true)]
    : [DEFINITIONS, TERM, servicesClause(false), FEES, CONFIDENTIALITY, liability(false), termination(false), DATA_PROTECTION, AUDIT, governingLaw(false)];
}

export function buildMsaDocx(v2: boolean): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MASTER SERVICES AGREEMENT", bold: true, size: 32 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun(`Version ${v2 ? "2" : "1"} — between Acme Holdings LLC (the “Customer”) and Northwind Services FZ-LLC (the “Supplier”)`)],
    }),
    new Paragraph({ children: [] }),
  ];

  for (const c of clausesFor(v2)) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, numbering: { reference: "msa", level: 0 }, children: [new TextRun({ text: c.title, bold: true })] }),
    );
    for (const s of c.subs) {
      if (typeof s === "string") {
        children.push(new Paragraph({ numbering: { reference: "msa", level: 1 }, children: [new TextRun(s)] }));
      } else {
        children.push(new Paragraph({ numbering: { reference: "msa", level: 1 }, children: [new TextRun(s.text)] }));
        for (const item of s.items) children.push(new Paragraph({ numbering: { reference: "msa", level: 2 }, children: [new TextRun(item)] }));
      }
    }
    if (c.table) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: c.table.map(
            (row, ri) =>
              new TableRow({
                children: row.map(
                  (cell) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cell, bold: ri === 0 })] })] }),
                ),
              }),
          ),
        }),
      );
    }
  }

  const doc = new Document({
    creator: "Contract Analyzer fixtures",
    title: `MSA v${v2 ? 2 : 1}`,
    numbering: {
      config: [
        {
          reference: "msa",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360, hanging: 360 } } } },
            { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 540 } } } },
            { level: 2, format: LevelFormat.LOWER_LETTER, text: "(%3)", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
