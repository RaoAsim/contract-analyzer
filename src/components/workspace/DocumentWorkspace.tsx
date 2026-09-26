"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ChatNotReady, ChatPanel } from "@/components/chat/ChatPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewerPane } from "@/components/viewer/ViewerPane";
import { useCitationHighlight } from "@/hooks/useCitationHighlight";
import { apiFetch } from "@/lib/client/api";
import type { Citation } from "@/types/citation";
import type { DocumentDetail } from "@/types/document";
import { WorkspaceLayout } from "./WorkspaceLayout";

/** Single-document workspace (§15.2): viewer + chat, live processing state, citation highlighting. */
export function DocumentWorkspace({ id, initialConversationId }: { id: string; initialConversationId: string | null }): React.ReactElement {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { highlight, show, cycle, clear } = useCitationHighlight();

  const q = useQuery({
    queryKey: ["document", id],
    queryFn: () => apiFetch<{ document: DocumentDetail }>(`/api/documents/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.document.status;
      return s === "queued" || s === "processing" ? 1000 : false;
    },
  });

  const changeConversation = useCallback(
    (cid: string | null) => {
      setConversationId(cid);
      router.replace(cid ? `/documents/${id}?c=${cid}` : `/documents/${id}`, { scroll: false });
    },
    [id, router],
  );

  const openCitation = useCallback(
    (c: Citation) => {
      show(c);
      setSheetOpen(true);
    },
    [show],
  );

  if (q.isPending) return <WorkspaceSkeleton />;
  if (q.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div role="alert" className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {q.error.message}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
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

  const doc = q.data.document;
  if (doc.status === "failed") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div role="alert" className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">“{doc.name}” couldn&apos;t be processed.</p>
          <p>{doc.errorMessage}</p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/">
              <ArrowLeft aria-hidden="true" /> Back to library
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  const ready = doc.status === "ready";
  const viewerDoc = { id: doc.id, name: doc.name, kind: doc.kind, pages: doc.pages, tag: "D1" };

  return (
    <WorkspaceLayout
      title={doc.name}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
      viewer={
        ready ? (
          <ViewerPane docs={[viewerDoc]} activeDocId={doc.id} onActiveDocChange={() => {}} highlight={highlight} onClearHighlight={clear} onOccurrence={cycle} />
        ) : (
          <div className="flex h-full items-center justify-center bg-stone-100 p-6 text-center text-sm text-muted-foreground">
            The viewer opens when text extraction finishes.
          </div>
        )
      }
      chat={
        <ChatPanel
          kind="single"
          documentId={doc.id}
          conversationId={conversationId}
          onConversationChange={changeConversation}
          docs={[{ tag: "D1", documentId: doc.id, name: doc.name, kind: doc.kind }]}
          ready={ready}
          notReady={<ChatNotReady stage={doc.stage} progress={doc.progress} />}
          warnings={doc.warnings.filter((w) => w.code === "partial_scan" || w.code === "simplified_docx_render")}
          onOpenCitation={openCitation}
        />
      }
    />
  );
}

export function WorkspaceSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-1 gap-2 p-2" aria-busy="true" aria-label="Loading workspace">
      <Skeleton className="hidden h-full flex-[3] rounded-lg md:block" />
      <div className="flex flex-[2] flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="w-full flex-1 rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
