"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientApiError } from "@/lib/client/api";
import { uploadFile } from "@/lib/client/upload";
import type { UploadItem, UploadLimits } from "@/components/library/library.types";

const PARALLEL = 3;

/** Upload queue: one request per file, up to 3 in parallel, with per-file progress and inline errors (§8.1). */
export function useUploads(limits: UploadLimits): {
  uploads: UploadItem[];
  addFiles: (files: FileList | File[]) => void;
  dismiss: (localId: string) => void;
  handedOff: (documentIds: string[]) => void;
} {
  const qc = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const files = useRef(new Map<string, File>());
  const started = useRef(new Set<string>());
  const running = useRef(0);

  const patch = useCallback((localId: string, p: Partial<UploadItem>) => {
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...p } : u)));
  }, []);

  // Start waiting uploads whenever there is capacity. Side effects live here, never in updaters.
  useEffect(() => {
    for (const u of uploads) {
      if (running.current >= PARALLEL) break;
      if (u.state !== "waiting" || started.current.has(u.localId)) continue;
      const file = files.current.get(u.localId);
      if (!file) continue;
      started.current.add(u.localId);
      running.current++;
      patch(u.localId, { state: "uploading" });
      uploadFile(file, (f) => patch(u.localId, { progress: f }))
        .then((doc) => {
          patch(u.localId, { state: "processing-handoff", progress: 1, documentId: doc.id });
          void qc.invalidateQueries({ queryKey: ["documents"] });
        })
        .catch((err: unknown) => {
          const message = err instanceof ClientApiError ? err.message : "Upload failed. Please try again.";
          patch(u.localId, { state: "error", error: message });
        })
        .finally(() => {
          running.current--;
          files.current.delete(u.localId);
          // Trigger the effect again so the next waiting file starts.
          setUploads((list) => [...list]);
        });
    }
  }, [uploads, patch, qc]);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const added: UploadItem[] = [];
      for (const file of Array.from(list)) {
        const localId = crypto.randomUUID();
        const tooBig = file.size > limits.maxUploadMb * 1024 * 1024;
        added.push({
          localId,
          name: file.name,
          size: file.size,
          progress: 0,
          state: tooBig ? "error" : "waiting",
          error: tooBig ? `"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB. The limit is ${limits.maxUploadMb} MB.` : undefined,
        });
        if (!tooBig) files.current.set(localId, file);
      }
      setUploads((u) => [...added, ...u]);
    },
    [limits.maxUploadMb],
  );

  const dismiss = useCallback((localId: string) => {
    files.current.delete(localId);
    setUploads((u) => u.filter((x) => x.localId !== localId));
  }, []);

  /** Once the library list includes a document, drop its upload row (the real row takes over). */
  const handedOff = useCallback((documentIds: string[]) => {
    const ids = new Set(documentIds);
    setUploads((u) => {
      const next = u.filter((x) => !(x.state === "processing-handoff" && x.documentId && ids.has(x.documentId)));
      return next.length === u.length ? u : next;
    });
  }, []);

  return { uploads, addFiles, dismiss, handedOff };
}
