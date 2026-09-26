import type { DocumentSummary } from "@/types/document";
import { ClientApiError } from "./api";

/**
 * Upload one file with XMLHttpRequest so we can report upload progress (fetch can't).
 * Resolves with the created document; rejects with ClientApiError carrying the server's message.
 */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DocumentSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { document?: DocumentSummary; error?: { code: string; message: string } } | null;
      if (xhr.status === 201 && body?.document) resolve(body.document);
      else if (body?.error) reject(new ClientApiError(xhr.status, body.error.code, body.error.message));
      else reject(new ClientApiError(xhr.status, "http_error", `Upload failed (${xhr.status || "no response"}). Please try again.`));
    };
    xhr.onerror = () => reject(new ClientApiError(0, "network_error", "The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new ClientApiError(0, "aborted", "Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
