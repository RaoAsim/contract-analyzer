import { distance } from "fastest-levenshtein";

/**
 * Question intent. An "overview" question ("tell me about this contract", "summarize it",
 * "highlight the important stuff", or something too vague to search for) is answered from the
 * outline and the opening of each section, never with a full scan that ends in a misleading
 * "not found".
 */

const OVERVIEW =
  /\b(summar(y|ise|ize)|overview|outline|gist|tl;?dr|highlights?|important|key (terms|points|provisions|clauses|things)|main (terms|points|provisions|things)|red flags|what (is|'s) (this|it|the (document|contract|agreement))( about)?|what does (this|it|the (document|contract|agreement)) (do|cover|say)( overall)?|tell me (abou?t?|more)|(who|what) (are|is) the parties|explain (this|it|the (document|contract|agreement)))\b/i;

/** Words that ask for an overview; matched with typo tolerance ("hightlight", "sumary"). */
const OVERVIEW_WORDS = ["summary", "summarize", "summarise", "overview", "highlight", "highlights", "important", "key", "main", "gist", "outline", "essentials", "basics", "parties"];

/** Words that carry no search meaning in a question. */
const FILLER = new Set(
  "the a an and or of to in for on by with is are was were be been this that these those what which who how does do did can could should would may might must shall will there it its as at from into about any all me my i you your we our us please tell give show explain describe know want need help hi hello hey thanks thank ok okay more some something anything thing things stuff document documents contract contracts agreement agreements doc file pdf word overall briefly quick quickly short points terms parts bits whats dont doesnt isnt lets".split(" "),
);

export function contentWords(question: string): string[] {
  // Join letters split by a stray character ("im[rtant" → "imrtant") so typos stay one word.
  const joined = question.toLowerCase().replace(/([a-z])[^a-z0-9\s]+([a-z])/g, "$1$2");
  return (joined.match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !FILLER.has(w));
}

function isOverviewWord(w: string): boolean {
  return OVERVIEW_WORDS.some((k) => w === k || (w.length >= 5 && distance(w, k) <= (k.length >= 8 ? 2 : 1)));
}

/**
 * @param isSpecific  whether a word can narrow a search (see specificityCheck). Typos such as "abou"
 *                    or "im[rtant" can't, so they don't make a question specific.
 */
export function isOverviewQuestion(question: string, isSpecific: (word: string) => boolean = () => true): boolean {
  if (/(clause|section|article|§)\s*\d/i.test(question)) return false;
  const words = contentWords(question);
  // Words that would actually narrow the search: in the document and not an overview word.
  const specific = words.filter((w) => !isOverviewWord(w) && isSpecific(w));
  if (words.length === 0) return true;
  // "summarize it", "hightlight im[rtant stuff" — but not "summarize the termination clause".
  if ((OVERVIEW.test(question) || words.some(isOverviewWord)) && specific.length === 0) return true;
  // A lone typo is too vague to search.
  return words.length === 1 && !isSpecific(words[0]!);
}

/**
 * Builds the `isSpecific(word)` check used above: a word narrows a search if it occurs in the
 * document, or if it's a real term the document lacks (no near-spelling in the document's vocabulary,
 * e.g. "arbitration"). A missing word that is one or two edits from a document word is a typo
 * ("abou" → "about") and doesn't narrow anything. Words under 4 letters count only if present.
 */
export function specificityCheck(texts: string[]): (word: string) => boolean {
  let vocab: Set<string> | undefined;
  const words = (): Set<string> => {
    vocab ??= new Set(texts.flatMap((t) => t.toLowerCase().match(/[a-z]{3,}/g) ?? []));
    return vocab;
  };
  return (w) => {
    const word = w.toLowerCase();
    if (words().has(word)) return true;
    if (word.length < 4) return false;
    const max = word.length >= 7 ? 2 : 1;
    for (const v of words()) if (Math.abs(v.length - word.length) <= max && distance(v, word) <= max) return false;
    return true;
  };
}
