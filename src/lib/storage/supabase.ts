import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import type { DocumentKind } from "@/types/document";

let client: SupabaseClient | undefined;

/** Secret-key client (bypasses RLS), used ONLY for Storage and only on the server (I7). */
function storage(): SupabaseClient {
  if (!client) {
    const cfg = getConfig();
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function bucket(): string {
  return getConfig().SUPABASE_STORAGE_BUCKET;
}

export const CONTENT_TYPES: Record<DocumentKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Storage paths come only from our own UUIDs, never from the uploaded file name. */
export function storagePathFor(documentId: string, kind: DocumentKind): string {
  return `${documentId}/original.${kind}`;
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await storage().storage.from(bucket()).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function downloadObject(path: string): Promise<Uint8Array> {
  const { data, error } = await storage().storage.from(bucket()).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await storage().storage.from(bucket()).remove(paths);
  if (error) throw new Error(`Storage remove failed: ${error.message}`);
}

/** Creates the private bucket if it does not exist. Used by setup scripts and the health check. */
export async function ensureBucket(): Promise<"exists" | "created"> {
  const s = storage().storage;
  const { data } = await s.getBucket(bucket());
  if (data) {
    if (data.public) throw new Error(`Bucket "${bucket()}" is public; it must be private.`);
    return "exists";
  }
  const { error } = await s.createBucket(bucket(), { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not create bucket "${bucket()}": ${error.message}`);
  }
  return "created";
}

export async function bucketReachable(): Promise<boolean> {
  const { data, error } = await storage().storage.getBucket(bucket());
  return !error && !!data && !data.public;
}
