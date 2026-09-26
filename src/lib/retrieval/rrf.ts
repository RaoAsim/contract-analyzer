/** Reciprocal Rank Fusion (k = 60) across ranked id lists; weights let exact lookups count more (§11.2). */
export function rrf(lists: { ids: string[]; weight?: number }[], k = 60): string[] {
  const score = new Map<string, number>();
  for (const { ids, weight = 1 } of lists) {
    ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + weight / (k + rank + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
