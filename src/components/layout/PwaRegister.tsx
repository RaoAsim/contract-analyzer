"use client";

import { useEffect } from "react";

/** Registers the service worker in production builds only (it would fight dev hot reloading). */
export function PwaRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not fatal: the app works without it (it only adds installability and the offline page).
    });
  }, []);
  return null;
}
