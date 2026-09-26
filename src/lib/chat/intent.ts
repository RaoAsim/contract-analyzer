/**
 * Question intent. An "overview" question ("tell me about this contract", "summarize it", or a
 * question too vague to search for) is answered from the outline and the opening of each section,
 * never with a full scan that ends in a misleading "not found".
 */

const OVERVIEW =
  /\b(summar(y|ise|ize)|overview|outline|gist|tl;?dr|key (terms|points|provisions|clauses)|main (terms|points|provisions)|what (is|'s) (this|it|the (document|contract|agreement))( about)?|what does (this|it|the (document|contract|agreement)) (do|cover|say)( overall)?|tell me (abou?t?|more)|explain (this|it|the (document|contract|agreement)))\b/i;

/** Words that carry no search meaning in a question. */
const FILLER = new Set(
  "the a an and or of to in for on by with is are was were be been this that these those what which who how does do did can could should would may might must shall will there it its as at from into about any all me my i you your we our us please tell give show explain describe know want need help hi hello hey thanks thank ok okay more some something anything thing things stuff document documents contract contracts agreement agreements doc file pdf word overall briefly quick quickly short".split(" "),
);

export function contentWords(question: string): string[] {
  return (question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !FILLER.has(w));
}

/**
 * @param inDocument  whether a word occurs in the document(s) — a lone word that doesn't (a typo such
 *                    as "abou") makes the question too vague to search.
 */
export function isOverviewQuestion(question: string, inDocument: (word: string) => boolean = () => true): boolean {
  if (/(clause|section|article|§)\s*\d/i.test(question)) return false;
  const m = OVERVIEW.exec(question);
  if (m) {
    // "summarize the termination clause" is about termination, not an overview.
    const rest = question.slice(0, m.index) + " " + question.slice(m.index + m[0].length);
    if (contentWords(rest).length === 0) return true;
  }
  const words = contentWords(question);
  if (words.length === 0) return true;
  return words.length === 1 && !inDocument(words[0]!);
}
