import "dotenv/config";
import { ensureBucket } from "@/lib/storage/supabase";

/** Creates the private Storage bucket if needed (idempotent). */
ensureBucket()
  .then((r) => console.log(`Storage bucket "${process.env.SUPABASE_STORAGE_BUCKET ?? "documents"}": ${r} (private).`))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
