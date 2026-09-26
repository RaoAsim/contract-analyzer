import type { SseEventMap, SseEventName } from "@/types/sse";

const PING_MS = 15_000;

export type Emit = <K extends SseEventName>(event: K, data: SseEventMap[K]) => void;

/**
 * SSE over a fetch POST response (§11.5). Guarantees: a `: ping` comment immediately and every
 * 15 s, an incrementing `id:` per event, and EXACTLY ONE `done` event, always last.
 */
export class SseWriter {
  readonly stream: ReadableStream<Uint8Array>;
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private seq = 0;
  private closed = false;
  private doneSent = false;
  private ping: ReturnType<typeof setInterval> | undefined;
  private readonly onCancel: () => void;

  constructor(onCancel: () => void) {
    this.onCancel = onCancel;
    this.stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
        this.write(": ping\n\n");
        this.ping = setInterval(() => this.write(": ping\n\n"), PING_MS);
      },
      cancel: () => {
        // The client went away (disconnect / aborted fetch).
        this.closed = true;
        this.clearPing();
        this.onCancel();
      },
    });
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get hasSentDone(): boolean {
    return this.doneSent;
  }

  private clearPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = undefined;
  }

  private write(chunk: string): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(this.encoder.encode(chunk));
    } catch {
      this.closed = true;
      this.clearPing();
    }
  }

  readonly send: Emit = (event, data) => {
    if (this.doneSent) return; // nothing may follow `done`
    if (event === "done") this.doneSent = true;
    this.seq++;
    this.write(`id: ${this.seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (event === "done") this.close();
  };

  close(): void {
    this.clearPing();
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // already closed by the client
    }
  }
}

export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
