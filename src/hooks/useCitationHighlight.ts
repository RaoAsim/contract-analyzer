"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ViewerHighlight } from "@/components/viewer/viewer.types";
import type { Citation } from "@/types/citation";

function toHighlight(c: Citation, index: number, nonce: number): ViewerHighlight {
  const occ = c.occurrences[index] ?? c.occurrences[c.primary];
  // Elided quotes: highlight every segment of the primary chain.
  const active = c.segments && index === c.primary ? c.segments : occ ? [occ] : [];
  return {
    nonce,
    docId: c.docId,
    active,
    faint: c.occurrences.filter((_, i) => i !== index),
    occurrence: c.occurrences.length > 1 ? { index, total: c.occurrences.length } : undefined,
  };
}

/** Citation → viewer highlight state, with occurrence cycling and Esc to clear (§10.1). */
export function useCitationHighlight(): {
  highlight: ViewerHighlight | null;
  show: (c: Citation) => void;
  cycle: (delta: number) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ c: Citation; index: number; nonce: number } | null>(null);

  const show = useCallback((c: Citation) => {
    setState((s) => ({ c, index: c.primary, nonce: (s?.nonce ?? 0) + 1 }));
  }, []);
  const cycle = useCallback((delta: number) => {
    setState((s) => {
      if (!s) return s;
      const n = s.c.occurrences.length;
      return { ...s, index: (s.index + delta + n) % n, nonce: s.nonce + 1 };
    });
  }, []);
  const clear = useCallback(() => setState(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return; // Esc there stops generation
      setState(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Stable identity: viewers re-scroll only when the highlight really changes (not on every render).
  const highlight = useMemo(() => (state ? toHighlight(state.c, state.index, state.nonce) : null), [state]);
  return { highlight, show, cycle, clear };
}
