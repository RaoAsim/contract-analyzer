export type ClauseType =
  | "term_and_renewal"
  | "termination"
  | "payment"
  | "limitation_of_liability"
  | "indemnification"
  | "confidentiality"
  | "intellectual_property"
  | "warranties"
  | "governing_law"
  | "dispute_resolution"
  | "assignment"
  | "force_majeure"
  | "notices"
  | "non_compete_non_solicit"
  | "data_protection"
  | "entire_agreement";

export type ClauseDraft = { type: ClauseType; sectionOrd: number; start: number; end: number; confidence: number };
