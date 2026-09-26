import type { ParserEvent, ParserOptions } from "./quoteStreamParser.types";

const OPEN = "<quote";
const CLOSE = "</quote>";
const CLOSE_RE = new RegExp("<\/quote>", "i");
const SENTINEL = "[[NOT_FOUND]]";
const SENTINEL_HOLD = 16;
const OPEN_TAG_MAX = 80;
const QUOTE_MAX = 1500;

/** Length of the longest suffix of `s` that is a (case-insensitive) proper prefix of `token`. */
function partialSuffix(s: string, token: string): number {
  const max = Math.min(s.length, token.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(s.length - k).toLowerCase() === token.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Sits between the LLM token stream and the SSE writer (§11.6). Emits plain text immediately,
 * holding back only a suffix that could begin a `<quote` tag, buffers quote bodies until
 * `</quote>`, and never lets raw quote tags reach the client. Output is identical however the
 * input is split into deltas.
 */
export class QuoteStreamParser {
  private readonly opts: ParserOptions;
  private buf = "";
  private state: "start" | "afterSentinel" | "text" | "tag" | "quote" | "abandoned" = "start";
  private quote: { id: string; tag: string; text: string } | null = null;
  private notFound = false;

  constructor(opts: ParserOptions) {
    this.opts = opts;
  }

  get sawNotFound(): boolean {
    return this.notFound;
  }

  private emit(e: ParserEvent): void {
    this.opts.onEvent(e);
  }

  private emitText(t: string): void {
    if (t) this.emit({ type: "text", text: t });
  }

  push(delta: string): void {
    this.buf += delta;
    this.drain(false);
  }

  /** Finish the stream. `reason` = "stopped" when the user stopped it, otherwise "complete". */
  end(reason: "complete" | "stopped" = "complete"): void {
    this.drain(true);
    if (this.state === "quote" && this.quote) {
      this.emit({ type: "quote_abandoned", ...this.quote, reason: reason === "stopped" ? "stopped" : "truncated" });
      this.quote = null;
    } else if (this.state === "tag") {
      // An opening tag that never closed: plain text.
      this.emitText(this.buf);
    } else if (this.state !== "abandoned") {
      this.emitText(this.buf);
    }
    this.buf = "";
    this.state = "text";
  }

  private drain(final: boolean): void {
    for (;;) {
      if (this.state === "start") {
        const lead = this.buf.trimStart();
        if (!final && lead.length < SENTINEL_HOLD && SENTINEL.startsWith(lead.slice(0, SENTINEL.length).toUpperCase()) && lead.length < SENTINEL.length) {
          return; // could still become the sentinel
        }
        if (lead.toUpperCase().startsWith(SENTINEL)) {
          this.notFound = true;
          this.emit({ type: "not_found" });
          this.buf = lead.slice(SENTINEL.length);
          this.state = "afterSentinel";
          continue;
        }
        this.state = "text";
        continue;
      }

      if (this.state === "afterSentinel") {
        // Strip the rest of the sentinel line's whitespace and one newline, whatever the split.
        this.buf = this.buf.replace(/^[ \t]+/, "");
        if (this.buf.length === 0 && !final) return;
        if (this.buf.startsWith("\r\n")) this.buf = this.buf.slice(2);
        else if (this.buf.startsWith("\n")) this.buf = this.buf.slice(1);
        else if (this.buf === "\r" && !final) return;
        this.state = "text";
        continue;
      }

      if (this.state === "text") {
        const i = this.buf.search(/<quote/i);
        if (i === -1) {
          // Drop stray closing tags, then hold back a possible partial "<quote" / "</quote>".
          this.buf = this.buf.replace(/<\/quote>/gi, "");
          const hold = final ? 0 : Math.max(partialSuffix(this.buf, OPEN), partialSuffix(this.buf, CLOSE));
          this.emitText(this.buf.slice(0, this.buf.length - hold));
          this.buf = this.buf.slice(this.buf.length - hold);
          return;
        }
        this.emitText(this.buf.slice(0, i).replace(/<\/quote>/gi, ""));
        this.buf = this.buf.slice(i);
        this.state = "tag";
        continue;
      }

      if (this.state === "tag") {
        const gt = this.buf.indexOf(">");
        const next = this.buf[OPEN.length];
        // "<quotes", "<quoted" etc. are not our tag.
        if (next !== undefined && !/[\s>]/.test(next)) {
          this.emitText(this.buf.slice(0, OPEN.length));
          this.buf = this.buf.slice(OPEN.length);
          this.state = "text";
          continue;
        }
        if (gt === -1 || gt > OPEN_TAG_MAX) {
          if (gt === -1 && this.buf.length <= OPEN_TAG_MAX && !final) return; // wait for more
          // Never closed within 80 chars: treat as plain text.
          this.emitText(this.buf.slice(0, OPEN.length));
          this.buf = this.buf.slice(OPEN.length);
          this.state = "text";
          continue;
        }
        const tagSrc = this.buf.slice(0, gt + 1);
        const m = /doc\s*=\s*["']?\s*([A-Za-z]?\d+)/i.exec(tagSrc);
        const tag = m ? (m[1]!.toUpperCase().startsWith("D") ? m[1]!.toUpperCase() : `D${m[1]}`) : this.opts.defaultTag;
        const id = this.opts.nextId();
        this.quote = { id, tag, text: "" };
        this.emit({ type: "quote_open", id, tag });
        this.buf = this.buf.slice(gt + 1);
        this.state = "quote";
        continue;
      }

      if (this.state === "quote") {
        const q = this.quote!;
        const i = this.buf.search(CLOSE_RE);
        if (i === -1) {
          const hold = final ? 0 : partialSuffix(this.buf, CLOSE);
          q.text += this.buf.slice(0, this.buf.length - hold);
          this.buf = this.buf.slice(this.buf.length - hold);
          if (q.text.length > QUOTE_MAX) {
            // Guard: stop buffering; the quote is unverified(truncated) and its text is dropped.
            this.emit({ type: "quote_abandoned", ...q, reason: "truncated" });
            this.quote = null;
            this.state = "abandoned";
            continue;
          }
          return;
        }
        q.text += this.buf.slice(0, i);
        this.buf = this.buf.slice(i + CLOSE.length);
        this.quote = null;
        if (q.text.length > QUOTE_MAX) this.emit({ type: "quote_abandoned", ...q, reason: "truncated" });
        else this.emit({ type: "quote", ...q });
        this.state = "text";
        continue;
      }

      if (this.state === "abandoned") {
        // Swallow the rest of an over-long quote until its closing tag.
        const i = this.buf.search(CLOSE_RE);
        if (i === -1) {
          const hold = final ? 0 : partialSuffix(this.buf, CLOSE);
          this.buf = this.buf.slice(this.buf.length - hold);
          return;
        }
        this.buf = this.buf.slice(i + CLOSE.length);
        this.state = "text";
        continue;
      }
      return;
    }
  }
}
