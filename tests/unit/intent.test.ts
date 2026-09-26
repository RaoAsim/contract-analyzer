import { describe, expect, it } from "vitest";
import { isExhaustive } from "@/lib/chat/engine";
import { isOverviewQuestion } from "@/lib/chat/intent";

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
