import type { ClauseDraft, ClauseType } from "./clauses.types";
import type { SectionDraft } from "./sections.types";

export const CLAUSE_TYPES = [
  "term_and_renewal",
  "termination",
  "payment",
  "limitation_of_liability",
  "indemnification",
  "confidentiality",
  "intellectual_property",
  "warranties",
  "governing_law",
  "dispute_resolution",
  "assignment",
  "force_majeure",
  "notices",
  "non_compete_non_solicit",
  "data_protection",
  "entire_agreement",
] as const satisfies readonly ClauseType[];

export const CLAUSE_LABELS: Record<ClauseType, string> = {
  term_and_renewal: "Term and renewal",
  termination: "Termination",
  payment: "Payment",
  limitation_of_liability: "Limitation of liability",
  indemnification: "Indemnification",
  confidentiality: "Confidentiality",
  intellectual_property: "Intellectual property",
  warranties: "Warranties",
  governing_law: "Governing law",
  dispute_resolution: "Dispute resolution",
  assignment: "Assignment",
  force_majeure: "Force majeure",
  notices: "Notices",
  non_compete_non_solicit: "Non-compete / non-solicit",
  data_protection: "Data protection",
  entire_agreement: "Entire agreement",
};

const RULES: [ClauseType, RegExp][] = [
  ["term_and_renewal", /\b(term of (the )?agreement|duration|renewal|renew|commencement and term|^term\b|initial term)/i],
  ["termination", /terminat|\bexpiry\b|\bexpiration\b/i],
  ["payment", /\b(payment|fees?|charges|invoic|price|pricing|remuneration|compensation)\b/i],
  ["limitation_of_liability", /limitation of liability|limits? (of|on) liability|liabilit(y|ies)\b|exclusion of (certain )?damages|consequential/i],
  ["indemnification", /indemn/i],
  ["confidentiality", /confidential|non-?disclosure/i],
  ["intellectual_property", /intellectual property|\bip rights\b|ownership of (work|deliverables)|licen[cs]e|proprietary rights/i],
  ["warranties", /warrant|representations/i],
  ["governing_law", /governing law|applicable law|choice of law/i],
  ["dispute_resolution", /dispute|arbitrat|jurisdiction|mediation|litigation/i],
  ["assignment", /\bassign(ment)?\b|subcontract|change of control/i],
  ["force_majeure", /force majeure|acts? of god/i],
  ["notices", /\bnotices?\b/i],
  ["non_compete_non_solicit", /non-?compet|non-?solicit|restrictive covenant|exclusivity/i],
  ["data_protection", /data protection|personal data|privacy|gdpr|data processing/i],
  ["entire_agreement", /entire agreement|whole agreement|integration clause/i],
];

/** Narrow body patterns for sections whose title matched nothing (first 200 characters only). */
const BODY_RULES: [ClauseType, RegExp][] = [
  ["limitation_of_liability", /(aggregate|total) liability|shall not be liable/i],
  ["indemnification", /indemnif/i],
  ["confidentiality", /confidential information/i],
  ["governing_law", /governed by (and construed in accordance with )?the laws? of/i],
  ["force_majeure", /force majeure/i],
  ["non_compete_non_solicit", /non-?compet|shall not (directly or indirectly )?(solicit|compete)/i],
  ["data_protection", /personal data|data protection/i],
  ["termination", /may terminate/i],
  ["entire_agreement", /entire agreement/i],
];

/**
 * Keyword clause index (§8.10): rules on section titles, falling back to the first 200 characters
 * of the body. No LLM call, so it is fast and cannot fail the job.
 */
export function detectClauses(text: string, sections: readonly SectionDraft[]): ClauseDraft[] {
  const out: ClauseDraft[] = [];
  for (const s of sections) {
    if (s.title === "Preamble" || /^Page \d+$|^Part \d+$/.test(s.title)) continue;
    const title = s.title;
    const bodyStart = text.slice(s.start, Math.min(s.end, s.start + 200));
    const seen = new Set<ClauseType>();
    for (const [type, re] of RULES) {
      if (re.test(title)) {
        seen.add(type);
        out.push({ type, sectionOrd: s.ord, start: s.start, end: s.end, confidence: 0.8 });
      }
    }
    if (seen.size === 0 && s.number !== null) {
      for (const [type, re] of BODY_RULES) {
        if (re.test(bodyStart)) out.push({ type, sectionOrd: s.ord, start: s.start, end: s.end, confidence: 0.4 });
      }
    }
  }
  return out;
}
