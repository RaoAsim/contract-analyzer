import type { Box } from "./citation";

export type ChangeType = "modified" | "added" | "removed" | "moved" | "unchanged";
export type Significance = "critical" | "major" | "minor" | "cosmetic";
export type ChangeCategory =
  | "liability"
  | "indemnity"
  | "payment"
  | "term"
  | "termination"
  | "ip"
  | "confidentiality"
  | "governing_law"
  | "obligations"
  | "scope"
  | "warranties"
  | "data_protection"
  | "other";

export type FactKind = "money" | "percent" | "duration" | "date" | "number" | "modality" | "negation" | "party" | "jurisdiction";

export type Fact = { kind: FactKind; before: string; after: string; ratio?: number };

export type Hunk = { op: "eq" | "ins" | "del"; text: string };

export type UnitRef = { number: string | null; title: string; start: number; end: number; pageStart?: number | null; boxes?: Box[] };

export type Change = {
  id: string;
  type: ChangeType;
  a?: UnitRef;
  b?: UnitRef;
  significance: Significance;
  category: ChangeCategory;
  summary: string;
  favours: string;
  facts: Fact[];
  hunks: Hunk[];
  classifiedBy: "llm" | "rules";
  /** Moved units whose wording also changed. */
  textChanged?: boolean;
};

export type ComparisonResult = {
  docA: { id: string; name: string; kind: "pdf" | "docx" };
  docB: { id: string; name: string; kind: "pdf" | "docx" };
  summary: { bullets: string[]; source: "llm" | "rules" };
  counts: { bySignificance: Record<Significance, number>; byType: Record<ChangeType, number>; units: { a: number; b: number } };
  changes: Change[];
  notes: string[];
};

export type ComparisonSummary = {
  id: string;
  status: "queued" | "processing" | "ready" | "failed";
  stage: string | null;
  progress: number;
  errorMessage: string | null;
  docA: { id: string; name: string } | null;
  docB: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  counts?: ComparisonResult["counts"];
};

export type ComparisonDetail = ComparisonSummary & { result: ComparisonResult | null };
