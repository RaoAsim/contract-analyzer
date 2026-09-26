"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileText, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/client/api";
import type { DocumentSummary } from "@/types/document";

export function LibraryView(): React.ReactElement {
  const query = useQuery({
    queryKey: ["documents"],
    queryFn: () => apiFetch<{ documents: DocumentSummary[] }>("/api/documents"),
  });

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

  const docs = query.data.documents;
  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-stone-300 bg-white px-6 py-16 text-center">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-primary">
          <FileText className="size-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-stone-900">Upload a contract to get started</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">PDF or Word (.docx), up to 50 MB.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-white">
      {docs.map((d) => (
        <li key={d.id} className="px-4 py-3 text-sm">
          {d.name}
        </li>
      ))}
    </ul>
  );
}

function LibrarySkeleton(): React.ReactElement {
  return (
    <div className="rounded-lg border bg-white" aria-busy="true" aria-label="Loading documents">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-16 sm:block" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
