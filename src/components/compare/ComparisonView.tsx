"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, RotateCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewerPane } from "@/components/viewer/ViewerPane";
import type { ViewerHighlight } from "@/components/viewer/viewer.types";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import type { Change, ChangeType, ComparisonDetail, Significance } from "@/types/compare";
import type { DocumentDetail } from "@/types/document";
import { ChangeCard } from "./ChangeCard";
import { SIG_LABEL, SIG_STYLE, SignificanceBadge } from "./SignificanceBadge";

const SIGS: Significance[] = ["critical", "major", "minor", "cosmetic"];
const TYPES: ChangeType[] = ["modified", "added", "removed", "moved"];
const RANK: Record<Significance, number> = { critical: 3, major: 2, minor: 1, cosmetic: 0 };

/** Comparison results (§13.7): header counts, executive summary, filters/sort/search, change cards, side-by-side view. */
export function ComparisonView({ id }: { id: string }): React.ReactElement {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["comparison", id],
    queryFn: () => apiFetch<{ comparison: ComparisonDetail }>(`/api/comparisons/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.comparison.status;
      return s === "queued" || s === "processing" ? 1000 : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => apiFetch(`/api/comparisons/${id}/retry`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comparison", id] }),
  });

  const [sigs, setSigs] = useState<Set<Significance>>(new Set(["critical", "major", "minor"]));
  const [types, setTypes] = useState<Set<ChangeType>>(new Set(TYPES));
  const [sort, setSort] = useState<"significance" | "document">("significance");
  const [search, setSearch] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<{ change: Change; side: "a" | "b"; nonce: number } | null>(null);

  const result = q.data?.comparison.result ?? null;
  const visible = useMemo(() => {
    if (!result) return [];
    const needle = search.trim().toLowerCase();
    const list = result.changes.filter((c) => {
      if (c.type === "unchanged") return showUnchanged;
      if (!sigs.has(c.significance) || !types.has(c.type)) return false;
      if (!needle) return true;
      return [c.summary, c.a?.title, c.b?.title, c.a?.number, c.b?.number, ...c.hunks.map((h) => h.text)].some((s) => s?.toLowerCase().includes(needle));
    });
    return sort === "significance" ? [...list].sort((a, b) => RANK[b.significance] - RANK[a.significance]) : list;
  }, [result, sigs, types, sort, search, showUnchanged]);

  if (q.isPending) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (q.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertCircle className="size-4" aria-hidden="true" /> {q.error.message}
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          <RotateCw aria-hidden="true" /> Retry
        </Button>
      </div>
    );
  }
  const c = q.data.comparison;
  const names = (
    <p className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
      <span className="text-muted-foreground">Original:</span> <span className="font-semibold">{c.docA?.name ?? "(deleted document)"}</span>
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">Revised:</span> <span className="font-semibold">{c.docB?.name ?? "(deleted document)"}</span>
    </p>
  );

  if (c.status === "queued" || c.status === "processing") {
    return (
      <div className="flex flex-col gap-4">
        {names}
        <div className="rounded-lg border bg-white p-6" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-medium text-stone-800">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /> {c.stage ?? "Waiting to start"}
          </p>
          <Progress value={c.progress} className="mt-3 h-1.5" />
        </div>
      </div>
    );
  }
  if (c.status === "failed" || !result) {
    return (
      <div className="flex flex-col gap-4">
        {names}
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{c.errorMessage ?? "The comparison failed."}</p>
          <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />} Retry
          </Button>
        </div>
      </div>
    );
  }

  const changed = result.changes.filter((x) => x.type !== "unchanged");
  const jump = (cid: string): void => {
    const target = result.changes.find((x) => x.id === cid);
    if (target) {
      setSigs((s) => new Set([...s, target.significance]));
      setTypes((t) => new Set([...t, target.type === "unchanged" ? "modified" : target.type]));
    }
    setFocus(cid);
    requestAnimationFrame(() => document.getElementById(`change-${cid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        {names}
        <div className="flex flex-wrap gap-2">
          {SIGS.map((s) => (
            <SignificanceBadge key={s} value={s} count={result.counts.bySignificance[s]} />
          ))}
          <span className="mx-1 hidden h-5 w-px bg-stone-200 sm:block" aria-hidden="true" />
          {TYPES.map((t) => (
            <span key={t} className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">
              {t.charAt(0).toUpperCase() + t.slice(1)} {result.counts.byType[t]}
            </span>
          ))}
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500">Unchanged {result.counts.byType.unchanged}</span>
        </div>
      </header>

      {changed.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-10 text-center">
          <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" />
          <p className="font-semibold text-stone-900">No differences found.</p>
          <p className="text-sm text-muted-foreground">The documents are identical in substance.</p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border bg-white p-4 shadow-xs sm:p-5" aria-labelledby="exec-summary">
            <h2 id="exec-summary" className="text-sm font-semibold text-stone-900">
              Executive summary
            </h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-stone-800">
              {result.summary.bullets.map((b, i) => (
                <li key={i}>
                  {b.split(/(\[C\d+(?:,\s*C\d+)*\])/g).map((part, k) =>
                    /^\[C\d+/.test(part) ? (
                      <span key={k} className="ml-0.5">
                        {part
                          .slice(1, -1)
                          .split(/,\s*/)
                          .map((cid) => (
                            <button key={cid} type="button" onClick={() => jump(cid)} className="mx-0.5 rounded bg-accent px-1 font-mono text-[11px] font-medium text-accent-foreground hover:underline">
                              {cid}
                            </button>
                          ))}
                      </span>
                    ) : (
                      <span key={k}>{part}</span>
                    ),
                  )}
                </li>
              ))}
            </ul>
            {result.summary.source === "rules" && <p className="mt-2 text-xs text-muted-foreground">Generated from the change list (AI summary unavailable).</p>}
            {result.notes.map((n) => (
              <p key={n} className="mt-2 text-xs text-amber-800">
                {n}
              </p>
            ))}
          </section>

          <div className="sticky top-14 z-10 -mx-1 flex flex-col gap-2 rounded-lg border bg-white/95 p-2 shadow-xs backdrop-blur md:flex-row md:flex-wrap md:items-center" role="toolbar" aria-label="Filter changes">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Significance">
              {SIGS.map((s) => {
                const on = sigs.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSigs((cur) => {
                      const n = new Set(cur);
                      if (n.has(s)) n.delete(s);
                      else n.add(s);
                      return n;
                    })}
                    className={cn("rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset transition-opacity", on ? SIG_STYLE[s] : "bg-white text-stone-400 ring-stone-200 hover:text-stone-600")}
                  >
                    {SIG_LABEL[s]} {result.counts.bySignificance[s]}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Change type">
              {TYPES.map((t) => {
                const on = types.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTypes((cur) => {
                      const n = new Set(cur);
                      if (n.has(t)) n.delete(t);
                      else n.add(t);
                      return n;
                    })}
                    className={cn("rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset", on ? "bg-stone-800 text-white ring-stone-800" : "bg-white text-stone-500 ring-stone-200")}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-stone-600">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} className="size-3.5 accent-primary" />
              Show unchanged
            </label>
            <div className="flex flex-1 items-center gap-2 md:justify-end">
              <Select value={sort} onValueChange={(v) => setSort(v as "significance" | "document")}>
                <SelectTrigger className="h-8 w-44 text-xs" aria-label="Sort changes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="significance">Sort: significance</SelectItem>
                  <SelectItem value="document">Sort: document order</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative w-full max-w-56">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search changes" aria-label="Search changes" className="h-8 pl-7 text-xs" />
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">No changes match these filters. Cosmetic changes are hidden by default.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Showing {visible.length} of {changed.length} changes
              </p>
              {visible.map((ch) => (
                <ChangeCard key={ch.id} change={ch} highlighted={focus === ch.id} onView={(change, side) => setView({ change, side, nonce: Date.now() })} />
              ))}
            </div>
          )}
        </>
      )}

      <SideBySide view={view} onClose={() => setView(null)} docAId={c.docA?.id ?? null} docBId={c.docB?.id ?? null} />
    </div>
  );
}

function SideBySide({ view, onClose, docAId, docBId }: { view: { change: Change; side: "a" | "b"; nonce: number } | null; onClose: () => void; docAId: string | null; docBId: string | null }): React.ReactElement {
  const ids = [docAId, docBId];
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["document", id],
      queryFn: () => apiFetch<{ document: DocumentDetail }>(`/api/documents/${id}`),
      enabled: !!view && !!id,
    })),
  });
  const panes = (["a", "b"] as const).map((side, i) => {
    const d = details[i]?.data?.document;
    const unit = view?.change[side];
    const hl: ViewerHighlight | null = d && unit && view ? { nonce: view.nonce, docId: d.id, active: [{ start: unit.start, end: unit.end, boxes: unit.boxes }], faint: [] } : null;
    return { side, d, hl };
  });
  return (
    <Sheet open={!!view} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[min(96vw,1400px)]">
        <SheetHeader className="border-b px-4 py-2">
          <SheetTitle className="text-sm">{view ? `${view.change.b?.title ?? view.change.a?.title} — original and revised` : ""}</SheetTitle>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {panes.map(({ side, d, hl }) => (
            <div key={side} className="flex min-h-0 flex-col border-r last:border-r-0">
              <p className="border-b bg-stone-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{side === "a" ? "Original" : "Revised"}</p>
              <div className="min-h-[40vh] flex-1">
                {!d ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{(side === "a" ? docAId : docBId) ? "Loading…" : "Document deleted"}</div>
                ) : !view?.change[side] ? (
                  <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">{side === "a" ? "This clause is new in the revised version." : "This clause was removed in the revised version."}</div>
                ) : (
                  <ViewerPane docs={[{ id: d.id, name: d.name, kind: d.kind, pages: d.pages }]} activeDocId={d.id} onActiveDocChange={() => {}} highlight={hl} onClearHighlight={() => {}} onOccurrence={() => {}} />
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
