"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/client/api";
import type { DeletionImpact, DocumentDetail, DocumentSummary } from "@/types/document";

type Props = { docs: DocumentSummary[]; open: boolean; onOpenChange: (open: boolean) => void; onDeleted?: () => void };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function DeleteDocumentDialog({ docs, open, onOpenChange, onDeleted }: Props): React.ReactElement {
  const qc = useQueryClient();
  const single = docs.length === 1 ? docs[0] : undefined;
  const impact = useQuery({
    queryKey: ["document-impact", single?.id],
    queryFn: () => apiFetch<{ document: DocumentDetail; impact: DeletionImpact }>(`/api/documents/${single!.id}?impact=1`),
    enabled: open && !!single,
  });

  const del = useMutation({
    mutationFn: async () => {
      for (const d of docs) await apiFetch(`/api/documents/${d.id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success(docs.length === 1 ? `Deleted “${docs[0]!.name}”` : `Deleted ${docs.length} documents`);
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["comparisons"] });
      onOpenChange(false);
      onDeleted?.();
    },
  });

  const i = impact.data?.impact;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !del.isPending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{single ? `Delete “${single.name}”?` : `Delete ${docs.length} documents?`}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>This permanently removes the file, its extracted text and its search index.</p>
              {single && i && (i.singleChats > 0 || i.multiChats > 0 || i.comparisons > 0) && (
                <ul className="list-disc space-y-1 pl-5">
                  {i.singleChats > 0 && <li>{plural(i.singleChats, "chat about this document is", "chats about this document are")} deleted too.</li>}
                  {i.multiChats > 0 && (
                    <li>
                      {plural(i.multiChats, "multi-document chat keeps", "multi-document chats keep")} its messages, but this document will show as “(deleted document)”.
                    </li>
                  )}
                  {i.comparisons > 0 && <li>{plural(i.comparisons, "comparison that uses", "comparisons that use")} this document {i.comparisons === 1 ? "is" : "are"} deleted.</li>}
                </ul>
              )}
              {!single && <p>Their chats and comparisons are removed as well; multi-document chats keep their messages.</p>}
              {del.isError && <p className="text-red-700" role="alert">{del.error.message}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700"
            disabled={del.isPending}
            onClick={(e) => {
              e.preventDefault();
              del.mutate();
            }}
          >
            {del.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
