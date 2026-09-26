import { describe, expect, it } from "vitest";
import { isExhaustive } from "@/lib/chat/engine";
import { isOverviewQuestion, specificityCheck } from "@/lib/chat/intent";

describe("overview / vague questions", () => {
  it.each([
    "tell me abou ti",
    "tell me about it",
    "Summarize this contract",
    "Give me an overview",
    "What is this document about?",
    "what are the key terms?",
    "explain this agreement",
    "hmm?",
    "and this?",
    "hightlight im[rtant stuff",
    "what are the important points?",
    "sumary please",
  ])("answers %j from the outline (no scan)", (q) => expect(isOverviewQuestion(q, (w) => /(liability|termination|supplier)/.test(w))).toBe(true));

  it.each([
    "What is the liability cap?",
    "Which law governs the agreement?",
    "Is there a non-compete clause?",
    "What does clause 12.3 say?",
    "termination notice period",
    "What does the contract say about unicorns?",
    "Summarize the termination clause",
    "indemnity",
  ])("treats %j as a specific question", (q) => expect(isOverviewQuestion(q)).toBe(false));

  it("a lone word that isn't in the document (a typo) is too vague to search", () => {
    const text = "The Supplier shall indemnify the Customer.";
    const inDoc = (w: string): boolean => new RegExp(`\\b${w}`, "i").test(text);
    expect(isOverviewQuestion("tell me abou ti", inDoc)).toBe(true);
    expect(isOverviewQuestion("abou ti?", inDoc)).toBe(true);
    expect(isOverviewQuestion("indemnify?", inDoc)).toBe(false);
  });

  it("exhaustive detection is unchanged", () => {
    expect(isExhaustive("Is there a non-compete clause?")).toBe(true);
    expect(isExhaustive("tell me about it")).toBe(false);
  });
});

describe("typo-aware specificity (as used by the chat engine)", () => {
  const text = "This Agreement is about the Services. The Supplier shall indemnify the Customer. Either party may terminate on notice. Important dates are listed in Schedule 1.";
  const isSpecific = specificityCheck([text]);

  it("typos of document words don't make a question specific", () => {
    expect(isOverviewQuestion("tell me abou ti", isSpecific)).toBe(true);
    expect(isOverviewQuestion("hightlight im[rtant stuff", isSpecific)).toBe(true);
  });

  it("a real topic the document lacks still searches (and can end in a full-document 'not found')", () => {
    expect(isOverviewQuestion("What does the contract say about unicorns?", isSpecific)).toBe(false);
    expect(isOverviewQuestion("arbitration", isSpecific)).toBe(false);
    expect(isOverviewQuestion("Is there a non-compete?", isSpecific)).toBe(false);
  });

  it("a word in the document is specific", () => {
    expect(isOverviewQuestion("indemnify", isSpecific)).toBe(false);
    expect(isOverviewQuestion("summarize the termination rights", specificityCheck(["termination rights apply"]))).toBe(false);
  });
});
