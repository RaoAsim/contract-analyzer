export type ParserEvent =
  | { type: "text"; text: string }
  | { type: "quote_open"; id: string; tag: string }
  | { type: "quote"; id: string; tag: string; text: string }
  | { type: "quote_abandoned"; id: string; tag: string; text: string; reason: "truncated" | "stopped" }
  | { type: "not_found" };

export type ParserOptions = {
  defaultTag: string;
  /** Called synchronously, in order. */
  onEvent: (e: ParserEvent) => void;
  /** Allocates citation ids ("c1", "c2"…). */
  nextId: () => string;
};
