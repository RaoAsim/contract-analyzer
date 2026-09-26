/** Deterministic legal-sounding filler text (seeded), so fixtures are reproducible. */
export class LegalText {
  private s: number;

  constructor(seed: number) {
    this.s = seed;
  }

  private rand(): number {
    this.s = (this.s * 1103515245 + 12345) & 0x7fffffff;
    return this.s / 0x7fffffff;
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rand() * arr.length)]!;
  }

  sentence(): string {
    const subj = ["The Supplier", "The Customer", "Each party", "Neither party", "The Service Provider", "The parties"];
    const modal = ["shall", "will", "must", "may"];
    const verb = [
      "maintain accurate records of",
      "use reasonable endeavours to procure",
      "comply with all applicable requirements relating to",
      "promptly notify the other party of",
      "keep under review",
      "provide reasonable assistance in relation to",
      "co-operate in good faith regarding",
      "document and report on",
    ];
    const obj = [
      "the performance of the Services",
      "any change to the Service Levels",
      "the security of the Customer Data",
      "the personnel assigned to the Services",
      "the deliverables described in the relevant Statement of Work",
      "the governance procedures set out in this Agreement",
      "any audit reasonably requested by the other party",
      "the transition plan agreed between the parties",
    ];
    const tail = [
      "in accordance with Good Industry Practice",
      "within a reasonable period",
      "at its own cost",
      "as described in the Service Description",
      "subject to the Change Control Procedure",
      "during the Term",
      "on the terms of this Agreement",
    ];
    return `${this.pick(subj)} ${this.pick(modal)} ${this.pick(verb)} ${this.pick(obj)} ${this.pick(tail)}.`;
  }

  paragraph(sentences: number): string {
    return Array.from({ length: sentences }, () => this.sentence()).join(" ");
  }
}

export const ARTICLE_TITLES = [
  "Definitions and Interpretation", "Commencement and Term", "Services", "Service Levels", "Customer Obligations",
  "Personnel", "Governance", "Change Control", "Charges", "Payment",
  "Invoicing and Taxes", "Audit", "Intellectual Property", "Licences", "Confidentiality",
  "Data Protection", "Security", "Warranties", "Indemnities", "Limitation of Liability",
  "Insurance", "Business Continuity", "Force Majeure", "Suspension", "Termination for Cause",
  "Termination for Convenience", "Consequences of Termination", "Exit Management", "Assignment", "Subcontracting",
  "Non-Solicitation of Staff", "Anti-Bribery", "Compliance with Laws", "Notices", "Dispute Resolution",
  "Variation", "Waiver", "Severance", "Entire Agreement", "Governing Law and Jurisdiction",
] as const;
