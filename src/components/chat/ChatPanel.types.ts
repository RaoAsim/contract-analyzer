import type { ConversationDoc } from "@/types/chat";
import type { Citation } from "@/types/citation";
import type { DocumentWarning } from "@/types/document";

export type ChatPanelProps = {
  kind: "single" | "multi";
  /** Single-document chats: the document (threads are created lazily on the first question). */
  documentId?: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  docs: ConversationDoc[];
  ready: boolean;
  notReady?: React.ReactNode;
  warnings?: DocumentWarning[];
  onOpenCitation: (c: Citation) => void;
};
