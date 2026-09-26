import { describe, expect, it } from "vitest";
import { QuoteStreamParser } from "@/lib/chat/quoteStreamParser";
import type { ParserEvent } from "@/lib/chat/quoteStreamParser.types";

type Summary = { text: string; quotes: string[]; abandoned: string[]; notFound: boolean; opens: number };

function run(deltas: string[], reason: "complete" | "stopped" = "complete"): Summary {
  let n = 0;
  const events: ParserEvent[] = [];
  const p = new QuoteStreamParser({ defaultTag: "D1", nextId: () => `c${++n}`, onEvent: (e) => events.push(e) });
  for (const d of deltas) p.push(d);
  p.end(reason);
  let text = "";
  const quotes: string[] = [];
  const abandoned: string[] = [];
  let opens = 0;
  for (const e of events) {
    if (e.type === "text") text += e.text;
    if (e.type === "quote") {
      quotes.push(`${e.id}:${e.tag}:${e.text}`);
      text += `⟦${e.id}⟧`;
    }
    if (e.type === "quote_abandoned") abandoned.push(`${e.id}:${e.reason}`);
    if (e.type === "quote_open") opens++;
  }
  return { text, quotes, abandoned, notFound: events.some((e) => e.type === "not_found"), opens };
}

const FIXTURES: string[] = [
  'The cap is AED 100,000 <quote doc="D1">shall not exceed AED 100,000</quote>. Also notice <quote doc="D2">30 days\' written notice</quote>.',
  "[[NOT_FOUND]]\nI looked for a non-compete clause.",
  "No quotes here, just < and > characters and a <quotation> word.",
  'Unclosed <quote doc="D1">this quote never closes',
  "Stray </quote> closing tag and <b>html</b>.",
  'Tag that never closes <quote doc="D1" and then a lot of text that goes on and on and on and on and on and on and on and on without a >',
  "Nested <quote doc=\"D1\">outer <quote doc=\"D2\">inner</quote> tail</quote> end.",
  "Default tag <quote>no doc attribute here</quote> done.",
  "Single quotes <quote doc='D3'>single quoted attr</quote>.",
  "Uppercase <QUOTE DOC=\"d2\">shouting</QUOTE> ok.",
  "Starts like the sentinel [[NOT but is not it.",
  "",
];

describe("QuoteStreamParser", () => {
  it("produces identical output when every fixture is split at every character index", () => {
    for (const f of FIXTURES) {
      const whole = run([f]);
      for (let i = 0; i <= f.length; i++) {
        expect(run([f.slice(0, i), f.slice(i)]), `split at ${i} of ${JSON.stringify(f)}`).toEqual(whole);
      }
      // And one character per delta.
      expect(run([...f])).toEqual(whole);
    }
  });

  it("replaces quotes with citation tokens and never leaks raw tags", () => {
    const r = run([FIXTURES[0]!]);
    expect(r.text).toBe("The cap is AED 100,000 ⟦c1⟧. Also notice ⟦c2⟧.");
    expect(r.quotes).toEqual(["c1:D1:shall not exceed AED 100,000", "c2:D2:30 days' written notice"]);
    expect(r.text).not.toMatch(/<\/?quote/i);
  });

  it("detects and strips the [[NOT_FOUND]] sentinel", () => {
    const r = run([FIXTURES[1]!]);
    expect(r.notFound).toBe(true);
    expect(r.text).toBe("I looked for a non-compete clause.");
    expect(run(["Starts like the sentinel [[NOT but is not it."]).notFound).toBe(false);
  });

  it("leaves non-quote angle brackets and <quotation> alone", () => {
    expect(run([FIXTURES[2]!]).text).toBe(FIXTURES[2]);
  });

  it("an unclosed quote at the end is abandoned (truncated), its text never shown", () => {
    const r = run([FIXTURES[3]!]);
    expect(r.text).toBe("Unclosed ");
    expect(r.abandoned).toEqual(["c1:truncated"]);
    const stopped = run([FIXTURES[3]!], "stopped");
    expect(stopped.abandoned).toEqual(["c1:stopped"]);
  });

  it("drops stray closing tags", () => {
    expect(run([FIXTURES[4]!]).text).toBe("Stray  closing tag and <b>html</b>.");
  });

  it("an opening tag that doesn't close within 80 chars becomes plain text", () => {
    const r = run([FIXTURES[5]!]);
    expect(r.quotes).toEqual([]);
    expect(r.text).toContain("Tag that never closes <quote");
  });

  it("nested / garbled tags don't leak raw tags", () => {
    const r = run([FIXTURES[6]!]);
    expect(r.text).not.toMatch(/<\/?quote/i);
    expect(r.quotes.length).toBe(1);
  });

  it("defaults the doc tag, accepts single quotes and any case", () => {
    expect(run([FIXTURES[7]!]).quotes).toEqual(["c1:D1:no doc attribute here"]);
    expect(run([FIXTURES[8]!]).quotes).toEqual(["c1:D3:single quoted attr"]);
    expect(run([FIXTURES[9]!]).quotes).toEqual(["c1:D2:shouting"]);
  });

  it("abandons an over-long quote (1,500-char guard) and swallows the rest of it", () => {
    const long = `Before <quote doc="D1">${"x".repeat(2000)}</quote> after.`;
    const r = run([long]);
    expect(r.abandoned).toEqual(["c1:truncated"]);
    expect(r.text).toBe("Before  after.");
    const split = run(long.match(/.{1,37}/gs)!);
    expect(split).toEqual(r);
  });
});
