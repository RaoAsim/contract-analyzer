"use client";

import { ArrowRight, ChevronDown, Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Change } from "@/types/compare";
import { SignificanceBadge } from "./SignificanceBadge";

const TYPE_LABEL: Record<Change["type"], string> = { modified: "Modified", added: "Added", removed: "Removed", moved: "Moved", unchanged: "Unchanged" };
const CATEGORY_LABEL: Record<string, string> = {
  liability: "Liability",
  indemnity: "Indemnity",
  payment: "Payment",
  term: "Term",
  termination: "Termination",
  ip: "Intellectual property",
  confidentiality: "Confidentiality",
  governing_law: "Governing law",
  obligations: "Obligations",
  scope: "Scope",
  warranties: "Warranties",
  data_protection: "Data protection",
  other: "Other",
};
const FACT_LABEL: Record<string, string> = {
  money: "Amount",
  percent: "Percentage",
  duration: "Period",
  date: "Date",
  number: "Number",
  modality: "Obligation wording",
  negation: "Negation / exception",
  party: "Defined term",
  jurisdiction: "Law / forum",
};

function ref(r?: Change["a"]): string {
  if (!r) return "—";
  return r.number ? `§${r.number}` : r.title.slice(0, 40);
}

/** One change (§13.7): badge + category, clause refs, plain summary, facts table, expandable redline, view buttons. */
export function ChangeCard({ change: c, onView, highlighted }: { change: Change; onView: (c: Change, side: "a" | "b") => void; highlighted: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const title = c.b?.title ?? c.a?.title ?? "";
  return (
    <article id={`change-${c.id}`} className={cn("rounded-lg border bg-white p-4 shadow-xs transition-shadow", highlighted && "ring-2 ring-primary")}>
      <header className="flex flex-wrap items-center gap-2">
        <SignificanceBadge value={c.significance} />
        <span className="text-xs font-medium text-muted-foreground">
          {TYPE_LABEL[c.type]} · {CATEGORY_LABEL[c.category] ?? c.category}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{c.id}</span>
      </header>
      <h3 className="mt-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-stone-900">
        {c.a && c.b && ref(c.a) !== ref(c.b) ? (
          <>
            <span>{ref(c.a)}</span>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
            <span>{ref(c.b)}</span>
          </>
        ) : (
          <span>{ref(c.b ?? c.a)}</span>
        )}
        <span className="font-normal text-stone-700">{title}</span>
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-stone-800">{c.summary}</p>
      {c.classifiedBy === "rules" && c.type !== "unchanged" && <p className="mt-1 text-xs text-muted-foreground">Rated by deterministic rules.</p>}

      {c.facts.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Facts that changed</caption>
          <tbody className="divide-y">
            {c.facts.map((f, i) => (
              <tr key={i}>
                <th scope="row" className="w-40 py-1 pr-3 text-left text-xs font-medium text-muted-foreground">
                  {FACT_LABEL[f.kind] ?? f.kind}
                </th>
                <td className="py-1">
                  <span className="text-stone-600 line-through decoration-red-400">{f.before}</span>
                  <ArrowRight className="mx-1.5 inline size-3 text-muted-foreground" aria-label="changed to" />
                  <span className="font-semibold text-stone-900">{f.after}</span>
                  {f.ratio !== undefined && f.ratio !== 1 && <span className="ml-2 text-xs text-muted-foreground">({f.ratio > 1 ? `×${f.ratio}` : `÷${Math.round((1 / f.ratio) * 100) / 100}`})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.type !== "unchanged" && (
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-7 px-2 text-xs">
            <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} aria-hidden="true" />
            {open ? "Hide" : "Show"} {c.type === "added" ? "new text" : c.type === "removed" ? "removed text" : "redline"}
          </Button>
        )}
        {c.a && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onView(c, "a")}>
            <Eye aria-hidden="true" /> View in original
          </Button>
        )}
        {c.b && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onView(c, "b")}>
            <Eye aria-hidden="true" /> View in revised
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 rounded-md border bg-stone-50 p-3 font-serif text-sm leading-relaxed whitespace-pre-wrap text-stone-800">
          {c.hunks.map((h, i) =>
            h.op === "eq" ? (
              <span key={i}>{h.text}</span>
            ) : h.op === "ins" ? (
              <ins key={i} className="bg-emerald-100 text-emerald-900 underline decoration-emerald-600">
                {h.text}
              </ins>
            ) : (
              <del key={i} className="bg-red-50 text-red-800 line-through decoration-red-500">
                {h.text}
              </del>
            ),
          )}
        </div>
      )}
    </article>
  );
}
