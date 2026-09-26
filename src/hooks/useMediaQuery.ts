"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Server render assumes `serverDefault`. */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}
