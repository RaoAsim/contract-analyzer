import { cn } from "@/lib/utils";
import type { Significance } from "@/types/compare";

export const SIG_STYLE: Record<Significance, string> = {
  critical: "bg-red-600 text-white ring-red-600",
  major: "bg-amber-100 text-amber-900 ring-amber-300",
  minor: "bg-sky-50 text-sky-800 ring-sky-200",
  cosmetic: "bg-stone-100 text-stone-600 ring-stone-200",
};

export const SIG_LABEL: Record<Significance, string> = { critical: "Critical", major: "Major", minor: "Minor", cosmetic: "Cosmetic" };

export function SignificanceBadge({ value, count, className }: { value: Significance; count?: number; className?: string }): React.ReactElement {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset", SIG_STYLE[value], className)}>
      {SIG_LABEL[value]}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  );
}
