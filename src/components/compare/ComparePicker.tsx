"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, GitCompareArrows, Loader2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import type { ComparisonSummary } from "@/types/compare";
import type { DocumentSummary } from "@/types/document";
import { SignificanceBadge } from "./SignificanceBadge";

/** Compare picker (§15.2): two selects limited to ready documents, swap, Compare; past comparisons below. */
export function ComparePicker(): React.ReactElement {
  const router = useRouter();
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => apiFetch<{ documents: DocumentSummary[] }>("/api/documents") });
  const past = useQuery({
    queryKey: ["comparisons"],
    queryFn: () => apiFetch<{ comparisons: ComparisonSummary[] }>("/api/comparisons"),
    refetchInterval: (q) => (q.state.data?.comparisons.some((c) => c.status === "queued" || c.status === "processing") ? 2000 : false),
  });
  const start = useMutation({
    mutationFn: () =>
      apiFetch<{ comparison: ComparisonSummary }>("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docAId: a, docBId: b }),
      }),
    onSuccess: (r) => router.push(`/compare/${r.comparison.id}`),
  });

  const ready = (docs.data?.documents ?? []).filter((d) => d.status === "ready");

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border bg-white p-4 shadow-xs sm:p-6" aria-labelledby="new-comparison">
        <h2 id="new-comparison" className="text-base font-semibold text-stone-900">
          Compare two versions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Changes are matched clause by clause, summarised in plain language and rated by significance.</p>
        {docs.isPending ? (
          <Skeleton className="mt-4 h-20 w-full" />
        ) : docs.isError ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-sm text-red-800">
            {docs.error.message}
            <Button size="sm" variant="outline" onClick={() => void docs.refetch()}>
              <RotateCw aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : ready.length < 2 ? (
          <p className="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            You need at least two processed documents. <Link href="/" className="font-medium text-primary hover:underline">Upload contracts in the library</Link>.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
            <DocSelect id="doc-a" label="Original" value={a} onChange={setA} docs={ready} exclude={b} />
            <Button
              variant="ghost"
              size="icon"
              className="self-center md:mb-0.5"
              onClick={() => {
                setA(b);
                setB(a);
              }}
              aria-label="Swap original and revised"
              disabled={!a && !b}
            >
              <ArrowLeftRight aria-hidden="true" />
            </Button>
            <DocSelect id="doc-b" label="Revised" value={b} onChange={setB} docs={ready} exclude={a} />
            <Button onClick={() => start.mutate()} disabled={!a || !b || a === b || start.isPending} className="md:mb-0.5">
              {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GitCompareArrows aria-hidden="true" />}
              Compare
            </Button>
          </div>
        )}
        {start.isError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {start.error.message}
          </p>
        )}
      </section>

      <section aria-labelledby="past-comparisons">
        <h2 id="past-comparisons" className="mb-2 text-sm font-semibold text-stone-800">
          Past comparisons
        </h2>
        {past.isPending ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : past.isError ? (
          <p role="alert" className="text-sm text-red-700">
            {past.error.message}
          </p>
        ) : past.data.comparisons.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-muted-foreground">No comparisons yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-white">
            {past.data.comparisons.map((c) => (
              <li key={c.id}>
                <Link href={`/compare/${c.id}`} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span className="truncate font-medium text-stone-900">{c.docA?.name ?? "(deleted)"}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate font-medium text-stone-900">{c.docB?.name ?? "(deleted)"}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {c.status === "ready" && c.counts ? (
                      (["critical", "major", "minor"] as const).map((s) => (c.counts!.bySignificance[s] > 0 ? <SignificanceBadge key={s} value={s} count={c.counts!.bySignificance[s]} /> : null))
                    ) : c.status === "failed" ? (
                      <span className="text-red-700">Failed</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {c.stage ?? "Working…"}
                      </span>
                    )}
                    <span>{formatDateTime(c.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DocSelect({ id, label, value, onChange, docs, exclude }: { id: string; label: string; value: string; onChange: (v: string) => void; docs: DocumentSummary[]; exclude: string }): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full bg-white">
          <SelectValue placeholder={`Choose the ${label.toLowerCase()} version…`} />
        </SelectTrigger>
        <SelectContent>
          {docs.map((d) => (
            <SelectItem key={d.id} value={d.id} disabled={d.id === exclude}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
