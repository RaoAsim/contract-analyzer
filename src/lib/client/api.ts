import type { ApiErrorBody } from "@/types/api";

/** An API failure carrying the server's user-facing message. */
export class ClientApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as { error: unknown }).error === "object" &&
    (v as { error: { message?: unknown } }).error !== null &&
    typeof (v as { error: { message?: unknown } }).error.message === "string"
  );
}

/** `fetch` wrapper for our own JSON API. Throws `ClientApiError` with the server's message. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch {
    throw new ClientApiError(0, "network_error", "Can't reach the server. Check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorBody(body)) throw new ClientApiError(res.status, body.error.code, body.error.message);
    throw new ClientApiError(res.status, "http_error", `The server returned an error (${res.status}). Please try again.`);
  }
  return body as T;
}
