import type { MessageView } from "@/types/chat";
import type { SseStatus } from "@/types/sse";

export type LiveInfo = {
  phase: "pending" | "streaming" | "complete" | "stopped" | "error";
  status?: SseStatus;
  /** When the current status arrived (its hints rotate from here). */
  statusAt?: number;
  pending: string[];
  startedAt: number;
};

/** A message as rendered: persisted fields plus live streaming info while generating. */
export type UiMessage = MessageView & { live?: LiveInfo };

export type SendOptions = { thorough?: boolean; agent?: boolean };

export type CitationClick = { citationId: string; messageId: string; occurrence?: number };
