import "dotenv/config";
import { randomUUID } from "node:crypto";
import { downloadObject, ensureBucket, removeObjects, uploadObject } from "@/lib/storage/supabase";

/** Milestone 1 acceptance: a test file round-trips through Supabase Storage. */
async function main(): Promise<void> {
  await ensureBucket();
  const path = `_smoke/${randomUUID()}/original.pdf`;
  const bytes = new TextEncoder().encode(`%PDF-1.4 smoke test ${new Date().toISOString()}`);
  await uploadObject(path, bytes, "application/pdf");
  const back = await downloadObject(path);
  const same = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
  await removeObjects([path]);
  if (!same) throw new Error("Downloaded bytes differ from uploaded bytes.");
  console.log(`Storage round-trip OK (${bytes.length} bytes uploaded, downloaded, verified, removed).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
