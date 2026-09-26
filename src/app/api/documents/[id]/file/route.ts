import { eq } from "drizzle-orm";
import { notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { getDb } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { CONTENT_TYPES, downloadObject } from "@/lib/storage/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the original file from the private bucket through our server (no signed URLs, no CORS). */
export const GET = withApiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const id = await idParam(ctx, "The document");
  const [doc] = await getDb()
    .select({ storagePath: documents.storagePath, kind: documents.kind, name: documents.name })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) throw notFound("The document");
  const bytes = await downloadObject(doc.storagePath);
  const ascii = doc.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[doc.kind],
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
