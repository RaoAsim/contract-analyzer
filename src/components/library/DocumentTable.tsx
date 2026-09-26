"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, FileType2, Loader2, MessageSquare, RotateCw, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/client/api";
import { formatBytes, formatRelative } from "@/lib/client/format";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/types/document";
import { DocumentStatus } from "./DocumentStatus";
import type { UploadItem } from "./library.types";

type Props = {
  docs: DocumentSummary[];
  uploads: UploadItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDelete: (doc: DocumentSummary) => void;
  onDismissUpload: (localId: string) => void;
  now: number;
};

function KindIcon({ kind }: { kind: "pdf" | "docx" }): React.ReactElement {
  return kind === "pdf" ? (
    <FileText className="size-4 shrink-0 text-red-600" aria-label="PDF" />
  ) : (
    <FileType2 className="size-4 shrink-0 text-blue-600" aria-label="Word document" />
  );
}

function RetryButton({ doc }: { doc: DocumentSummary }): React.ReactElement {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => apiFetch(`/api/documents/${doc.id}/retry`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["documents"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Button variant="outline" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
      {retry.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
      Retry
    </Button>
  );
}

export function DocumentTable({ docs, uploads, selected, onToggle, onToggleAll, onDelete, onDismissUpload, now }: Props): React.ReactElement {
  const allSelected = docs.length > 0 && docs.every((d) => selected.has(d.id));
  const someSelected = docs.some((d) => selected.has(d.id));

  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
      <div className="hidden grid-cols-[2rem_minmax(0,1fr)_4rem_5rem_7rem_minmax(12rem,18rem)_7.5rem] items-center gap-3 border-b bg-stone-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
          aria-label="Select all documents"
        />
        <span>Name</span>
        <span className="text-right">Pages</span>
        <span className="text-right">Size</span>
        <span>Uploaded</span>
        <span>Status</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="divide-y">
        {uploads.map((u) => (
          <li key={u.localId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[2rem_minmax(0,1fr)_4rem_5rem_7rem_minmax(12rem,18rem)_7.5rem]">
            <span className="hidden md:block" />
            <div className="flex min-w-0 items-center gap-2">
              <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate text-sm font-medium text-stone-900">{u.name}</span>
            </div>
            <span className="hidden text-right text-sm text-muted-foreground md:block">—</span>
            <span className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">{formatBytes(u.size)}</span>
            <span className="hidden text-sm text-muted-foreground md:block">Now</span>
            <div className="col-span-2 min-w-0 md:col-span-1">
              {u.state === "error" ? (
                <p className="text-sm text-red-700" role="alert">
                  {u.error}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                  <div className="flex items-center gap-2 text-sm text-stone-700">
                    <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                    {u.state === "waiting" ? "Waiting to upload" : u.state === "uploading" ? `Uploading ${Math.round(u.progress * 100)}%` : "Uploaded — starting processing"}
                  </div>
                  <Progress value={Math.round(u.progress * 100)} className="h-1.5" aria-label="Upload progress" />
                </div>
              )}
            </div>
            <div className="row-start-1 flex justify-end md:row-auto">
              {u.state === "error" && (
                <Button variant="ghost" size="icon" className="size-8" onClick={() => onDismissUpload(u.localId)} aria-label={`Dismiss ${u.name}`}>
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
          </li>
        ))}
        {docs.map((d) => {
          const ready = d.status === "ready";
          return (
            <li
              key={d.id}
              className={cn(
                "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-stone-50 md:grid-cols-[2rem_minmax(0,1fr)_4rem_5rem_7rem_minmax(12rem,18rem)_7.5rem]",
                selected.has(d.id) && "bg-accent/60 hover:bg-accent",
              )}
            >
              <Checkbox checked={selected.has(d.id)} onCheckedChange={() => onToggle(d.id)} aria-label={`Select ${d.name}`} />
              <div className="flex min-w-0 items-center gap-2">
                <KindIcon kind={d.kind} />
                {d.status === "failed" ? (
                  <span className="truncate text-sm font-medium text-stone-900" title={d.name}>
                    {d.name}
                  </span>
                ) : (
                  <Link href={`/documents/${d.id}`} className="truncate rounded text-sm font-medium text-stone-900 hover:text-primary hover:underline" title={d.name}>
                    {d.name}
                  </Link>
                )}
              </div>
              <span className="hidden text-right text-sm tabular-nums text-stone-600 md:block">{d.pageCount ?? (d.kind === "docx" && ready ? "—" : "")}</span>
              <span className="hidden text-right text-sm tabular-nums text-stone-600 md:block">{formatBytes(d.sizeBytes)}</span>
              <span className="hidden text-sm text-stone-600 md:block" title={new Date(d.createdAt).toLocaleString("en-GB")}>
                {formatRelative(d.createdAt, now)}
              </span>
              <div className="col-span-3 col-start-2 flex min-w-0 flex-col gap-2 md:col-span-1 md:col-start-auto">
                <DocumentStatus doc={d} now={now} />
                {d.status === "failed" && (
                  <div className="flex gap-2">
                    {d.retryable && <RetryButton doc={d} />}
                    <Button variant="outline" size="sm" onClick={() => onDelete(d)}>
                      <Trash2 aria-hidden="true" /> Remove
                    </Button>
                  </div>
                )}
              </div>
              <div className="col-start-3 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-auto">
                {d.status !== "failed" && (
                  <Button size="sm" variant="outline" asChild className="h-8">
                    <Link href={`/documents/${d.id}`} aria-label={`Chat about ${d.name}`}>
                      <MessageSquare aria-hidden="true" />
                      <span className="hidden sm:inline">Chat</span>
                    </Link>
                  </Button>
                )}
                {d.status !== "failed" && (
                  <Button size="icon" variant="ghost" className="size-8 text-stone-500 hover:bg-red-50 hover:text-red-700" onClick={() => onDelete(d)} aria-label={`Delete ${d.name}`} title="Delete">
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
