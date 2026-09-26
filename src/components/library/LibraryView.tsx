"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/useNow";
import { useUploads } from "@/hooks/useUploads";
import { apiFetch } from "@/lib/client/api";
import type { DocumentStatus, DocumentSummary } from "@/types/document";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { DocumentTable } from "./DocumentTable";
import type { UploadLimits } from "./library.types";
import { MultiChatList } from "./MultiChatList";
import { SelectionBar } from "./SelectionBar";
import { UploadDropzone } from "./UploadDropzone";

export function LibraryView({ limits }: { limits: UploadLimits }): React.ReactElement {
  const { uploads, addFiles, dismiss, handedOff } = useUploads(limits);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<DocumentSummary[]>([]);

  const query = useQuery({
    queryKey: ["documents"],
    queryFn: () => apiFetch<{ documents: DocumentSummary[] }>("/api/documents"),
    // Poll every second while anything is uploading or processing (§4 Workflow A).
    refetchInterval: (q) => {
      const docs = q.state.data?.documents ?? [];
      const busy = docs.some((d) => d.status === "queued" || d.status === "processing") || uploads.some((u) => u.state !== "error");
      return busy ? 1000 : false;
    },
  });
  const docs = useMemo(() => query.data?.documents ?? [], [query.data]);
  const busy = docs.some((d) => d.status === "queued" || d.status === "processing");
  const now = useNow(busy || uploads.length > 0);

  useEffect(() => handedOff(docs.map((d) => d.id)), [docs, handedOff]);

  // Background-event toasts when processing finishes (errors also stay inline on the row).
  const prev = useRef(new Map<string, DocumentStatus>());
  useEffect(() => {
    for (const d of docs) {
      const before = prev.current.get(d.id);
      if (before && before !== d.status) {
        if (d.status === "ready") toast.success(`“${d.name}” is ready`, { description: d.pageCount ? `${d.pageCount} pages processed.` : undefined });
        if (d.status === "failed") toast.error(`“${d.name}” couldn't be processed`, { description: d.errorMessage ?? undefined });
      }
      prev.current.set(d.id, d.status);
    }
  }, [docs]);

  if (query.isPending) return <LibrarySkeleton />;

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center">
        <AlertCircle className="size-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-red-900">Couldn&apos;t load your library.</p>
          <p className="text-red-800">{query.error.message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RotateCw aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }

  const empty = docs.length === 0 && uploads.length === 0;
  const selectedDocs = docs.filter((d) => selected.has(d.id));

  return (
    <div className="flex flex-col gap-4">
      <UploadDropzone limits={limits} compact={!empty} onFiles={addFiles} />
      {!empty && (
        <DocumentTable
          docs={docs}
          uploads={uploads}
          selected={selected}
          now={now}
          onToggle={(id) =>
            setSelected((s) => {
              const n = new Set(s);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
          onToggleAll={() => setSelected((s) => (docs.every((d) => s.has(d.id)) ? new Set() : new Set(docs.map((d) => d.id))))}
          onDelete={(d) => setToDelete([d])}
          onDismissUpload={dismiss}
        />
      )}
      <SelectionBar selected={selectedDocs} onClear={() => setSelected(new Set())} onDelete={() => setToDelete(selectedDocs)} />
      <MultiChatList />
      <DeleteDocumentDialog
        docs={toDelete}
        open={toDelete.length > 0}
        onOpenChange={(o) => !o && setToDelete([])}
        onDeleted={() => setSelected(new Set())}
      />
    </div>
  );
}

function LibrarySkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading documents">
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="rounded-lg border bg-white">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-10 md:block" />
            <Skeleton className="hidden h-4 w-14 md:block" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}
