"use client";

import { useMutation } from "@tanstack/react-query";
import { GitCompareArrows, Loader2, MessagesSquare, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/client/api";
import type { DocumentSummary } from "@/types/document";

type Props = { selected: DocumentSummary[]; onClear: () => void; onDelete: () => void };

export function SelectionBar({ selected, onClear, onDelete }: Props): React.ReactElement | null {
  const router = useRouter();
  const ready = selected.filter((d) => d.status === "ready");
  const allReady = ready.length === selected.length;
  const canAsk = allReady && selected.length >= 2 && selected.length <= 5;
  const canCompare = allReady && selected.length === 2;

  const ask = useMutation({
    mutationFn: () =>
      apiFetch<{ conversation: { id: string } }>("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: selected.map((d) => d.id) }),
      }),
    onSuccess: (r) => router.push(`/chat/${r.conversation.id}`),
    onError: (e: Error) => toast.error(e.message),
  });
  const compare = useMutation({
    mutationFn: () =>
      apiFetch<{ comparison: { id: string } }>("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docAId: selected[0]!.id, docBId: selected[1]!.id }),
      }),
    onSuccess: (r) => router.push(`/compare/${r.comparison.id}`),
    onError: (e: Error) => toast.error(e.message),
  });

  if (selected.length === 0) return null;
  const askHint = !allReady ? "Only ready documents can be used" : selected.length < 2 ? "Select 2 to 5 documents" : selected.length > 5 ? "At most 5 documents" : "";
  const compareHint = !allReady ? "Only ready documents can be compared" : selected.length !== 2 ? "Select exactly 2 documents" : "";

  return (
    <div className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-white/95 p-2 pl-4 shadow-lg backdrop-blur" role="region" aria-label="Selection actions">
      <span className="mr-2 text-sm font-medium text-stone-800">{selected.length} selected</span>
      <HintButton hint={askHint}>
        <Button size="sm" disabled={!canAsk || ask.isPending} onClick={() => ask.mutate()}>
          {ask.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MessagesSquare aria-hidden="true" />}
          Ask across documents
        </Button>
      </HintButton>
      <HintButton hint={compareHint}>
        <Button size="sm" variant="outline" disabled={!canCompare || compare.isPending} onClick={() => compare.mutate()}>
          {compare.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}
          Compare
        </Button>
      </HintButton>
      <Button size="sm" variant="outline" className="text-red-700 hover:text-red-800" onClick={onDelete}>
        <Trash2 aria-hidden="true" /> Delete
      </Button>
      <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={onClear} aria-label="Clear selection">
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

function HintButton({ hint, children }: { hint: string; children: React.ReactElement }): React.ReactElement {
  if (!hint) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-md">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
