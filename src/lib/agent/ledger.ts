import { mergeRanges } from "@/lib/text/ranges";
import type { Range } from "@/types/document";

export type Caps = {
  maxRounds: number;
  maxToolCalls: number;
  maxCallsPerRound: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  wallClockMs: number;
  toolTimeoutMs: number;
  scanTimeoutMs: number;
  maxToolResultChars: number;
  repeatFailureLimit: number;
};

export function defaultCaps(overrides: Partial<Caps> = {}): Caps {
  return {
    maxRounds: 8,
    maxToolCalls: 20,
    maxCallsPerRound: 4,
    maxInputTokens: 150_000,
    maxOutputTokens: 12_000,
    wallClockMs: 90_000,
    toolTimeoutMs: 15_000,
    // check_entire_document runs a full scan (many LLM calls); it gets its own timeout and pauses
    // the wall clock (deviation from the plan's single 15 s tool timeout, which a scan can't meet).
    scanTimeoutMs: 150_000,
    maxToolResultChars: 8_000,
    repeatFailureLimit: 3,
    ...overrides,
  };
}

export type Evidence = { id: string; docId: string; tag: string; start: number; end: number };

/** Budget + what was read, checked BEFORE every model call and tool execution (§14.2). */
export class Ledger {
  readonly caps: Caps;
  rounds = 0;
  toolCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  private readonly startedAt: number;
  private pausedMs = 0;
  private readonly reads = new Map<string, Range[]>();
  readonly checkedComplete = new Set<string>();
  readonly failedByDoc = new Map<string, { pageStart: number; pageEnd: number; reason: string; label?: string }[]>();
  readonly evidence: Evidence[] = [];
  scanUsed = false;

  constructor(caps: Caps, now: () => number = Date.now) {
    this.caps = caps;
    this.now = now;
    this.startedAt = now();
  }

  private readonly now: () => number;

  elapsed(): number {
    return this.now() - this.startedAt - this.pausedMs;
  }

  async paused<T>(fn: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    try {
      return await fn();
    } finally {
      this.pausedMs += this.now() - t0;
    }
  }

  canAfford(estimatedInput: number): boolean {
    return this.inputTokens + estimatedInput <= this.caps.maxInputTokens && this.outputTokens < this.caps.maxOutputTokens;
  }

  add(usage: { inputTokens: number; outputTokens: number }): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
  }

  /** Reserve tool calls; false past the cap. */
  claimToolCall(cost = 1): boolean {
    if (this.toolCalls + cost > this.caps.maxToolCalls) return false;
    this.toolCalls += cost;
    return true;
  }

  remainingCalls(): number {
    return Math.max(0, this.caps.maxToolCalls - this.toolCalls);
  }

  /** Record text returned to the model; returns an evidence id. */
  recordRead(docId: string, tag: string, start: number, end: number): string {
    if (end > start) this.reads.set(docId, [...(this.reads.get(docId) ?? []), [start, end]]);
    const id = `E${this.evidence.length + 1}`;
    this.evidence.push({ id, docId, tag, start, end });
    return id;
  }

  readRanges(docId: string): Range[] {
    return mergeRanges(this.reads.get(docId) ?? []);
  }
}
