import { cn } from "@/lib/utils";
import { shortName, tagStyle } from "@/lib/client/docColors";

type Props = { tag: string; name: string; deleted?: boolean; compact?: boolean; className?: string };

/** Document chip in the tag's colour: "D1 · MSA_v1". */
export function DocTag({ tag, name, deleted, compact, className }: Props): React.ReactElement {
  const s = tagStyle(tag);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        deleted ? "bg-stone-100 text-stone-500 ring-stone-200 line-through" : s.chip,
        className,
      )}
      title={name}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", deleted ? "bg-stone-400" : s.dot)} aria-hidden="true" />
      <span className="font-semibold">{tag}</span>
      <span className="truncate">{compact ? shortName(name, 18) : shortName(name)}</span>
    </span>
  );
}
