"use client";

import { useQuery } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { DocTag } from "@/components/chat/DocTag";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import type { ConversationSummary } from "@/types/chat";

/** Reopen multi-document conversations from the library. */
export function MultiChatList(): React.ReactElement | null {
  const q = useQuery({
    queryKey: ["conversations", "multi"],
    queryFn: () => apiFetch<{ conversations: ConversationSummary[] }>("/api/conversations?kind=multi"),
  });
  const list = q.data?.conversations ?? [];
  if (q.isPending || q.isError || list.length === 0) return null;
  return (
    <section aria-labelledby="multi-chats" className="mt-4">
      <h2 id="multi-chats" className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
        <MessagesSquare className="size-4 text-muted-foreground" aria-hidden="true" /> Multi-document chats
      </h2>
      <ul className="divide-y rounded-lg border bg-white">
        {list.map((c) => (
          <li key={c.id}>
            <Link href={`/chat/${c.id}`} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900">{c.title}</span>
              <span className="flex flex-wrap gap-1">
                {c.documents.map((d) => (
                  <DocTag key={d.tag} tag={d.tag} name={d.documentId ? d.name : `${d.name} (deleted document)`} deleted={!d.documentId} compact />
                ))}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
