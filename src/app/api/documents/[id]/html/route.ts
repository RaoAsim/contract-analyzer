import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { getDb } from "@/lib/db/client";
import { documentHtml } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DOCX render produced by our own parser (every text fragment is HTML-escaped at write time). */
export const GET = withApiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse<{ html: string }>> => {
  const id = await idParam(ctx, "The document");
  const [row] = await getDb().select({ html: documentHtml.html }).from(documentHtml).where(eq(documentHtml.documentId, id));
  if (!row) throw notFound("The document view");
  return NextResponse.json({ html: row.html }, { headers: { "Cache-Control": "private, max-age=300" } });
});
