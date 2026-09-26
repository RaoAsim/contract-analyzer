"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { Button } from "@/components/ui/button";
import { ViewerPane } from "@/components/viewer/ViewerPane";
import type { ViewerDoc } from "@/components/viewer/viewer.types";
import { useCitationHighlight } from "@/hooks/useCitationHighlight";
import { apiFetch } from "@/lib/client/api";
import type { ConversationDetail } from "@/types/chat";
import type { Citation } from "@/types/citation";
import type { DocumentDetail } from "@/types/document";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceSkeleton } from "./DocumentWorkspace";

/** Multi-document workspace (§12.3): viewer tabs coloured by tag; clicking a citation switches tab then highlights. */
export function MultiWorkspace({ conversationId }: { conversationId: string }): React.ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const { highlight, show, cycle, clear } = useCitationHighlight();

  const convo = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => apiFetch<ConversationDetail>(`/api/conversations/${conversationId}`),
  });
  const links = convo.data?.conversation.documents ?? [];
  const details = useQueries({
    queries: links
      .filter((l) => l.documentId)
      .map((l) => ({ queryKey: ["document", l.documentId], queryFn: () => apiFetch<{ document: DocumentDetail }>(`/api/documents/${l.documentId}`) })),
  });

  const openCitation = useCallback(
    (c: Citation) => {
      setActiveDoc(c.docId);
      show(c);
      setSheetOpen(true);
    },
    [show],
  );

  if (convo.isPending || details.some((d) => d.isPending)) return <WorkspaceSkeleton />;
  if (convo.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div role="alert" className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {convo.error.message}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void convo.refetch()}>
              <RotateCw aria-hidden="true" /> Retry
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link href="/">
                <ArrowLeft aria-hidden="true" /> Back to library
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const viewerDocs: ViewerDoc[] = links
    .map((l): ViewerDoc | null => {
      const d = details.find((x) => x.data?.document.id === l.documentId)?.data?.document;
      return d ? { id: d.id, name: d.name, kind: d.kind, pages: d.pages, tag: l.tag } : null;
    })
    .filter((d): d is ViewerDoc => d !== null);
  const active = activeDoc && viewerDocs.some((d) => d.id === activeDoc) ? activeDoc : viewerDocs[0]?.id;

  return (
    <WorkspaceLayout
      title={convo.data.conversation.title || "Multi-document chat"}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
      viewer={
        viewerDocs.length > 0 && active ? (
          <ViewerPane docs={viewerDocs} activeDocId={active} onActiveDocChange={setActiveDoc} highlight={highlight} onClearHighlight={clear} onOccurrence={cycle} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">All documents in this chat were deleted.</div>
        )
      }
      chat={
        <ChatPanel
          kind="multi"
          conversationId={conversationId}
          onConversationChange={() => {}}
          docs={links}
          ready
          onOpenCitation={openCitation}
        />
      }
    />
  );
}
