/** Fixed colours per document tag (§12.1): D1 indigo, D2 teal, D3 amber, D4 rose, D5 violet. */
export const TAG_STYLES: Record<string, { chip: string; dot: string; text: string; border: string; bg: string }> = {
  D1: { chip: "bg-indigo-50 text-indigo-800 ring-indigo-200", dot: "bg-indigo-600", text: "text-indigo-700", border: "border-indigo-500", bg: "bg-indigo-600" },
  D2: { chip: "bg-teal-50 text-teal-800 ring-teal-200", dot: "bg-teal-600", text: "text-teal-700", border: "border-teal-500", bg: "bg-teal-600" },
  D3: { chip: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-600", text: "text-amber-800", border: "border-amber-500", bg: "bg-amber-600" },
  D4: { chip: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-600", text: "text-rose-700", border: "border-rose-500", bg: "bg-rose-600" },
  D5: { chip: "bg-violet-50 text-violet-800 ring-violet-200", dot: "bg-violet-600", text: "text-violet-700", border: "border-violet-500", bg: "bg-violet-600" },
};

export function tagStyle(tag: string): (typeof TAG_STYLES)[string] {
  return TAG_STYLES[tag] ?? TAG_STYLES.D1!;
}

/** Short display name: file name without extension, truncated. */
export function shortName(name: string, max = 28): string {
  const base = name.replace(/\.(pdf|docx)$/i, "");
  return base.length > max ? `${base.slice(0, max - 1)}…` : base;
}
