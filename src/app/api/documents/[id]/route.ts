import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { deleteDocumentRows, deletionImpact, getDocumentDetail } from "@/lib/db/queries/documents";
import { removeObjects } from "@/lib/storage/supabase";
import type { DeletionImpact, DocumentDetail } from "@/types/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (req: Request, ctx: Ctx): Promise<NextResponse<{ document: DocumentDetail; impact?: DeletionImpact }>> => {
  const id = await idParam(ctx, "The document");
  const document = await getDocumentDetail(id);
  if (!document) throw notFound("The document");
  const withImpact = new URL(req.url).searchParams.get("impact") === "1";
  return NextResponse.json({ document, ...(withImpact ? { impact: await deletionImpact(id) } : {}) });
});

export const DELETE = withApiHandler(async (_req: Request, ctx: Ctx): Promise<NextResponse<{ deleted: true }>> => {
  const id = await idParam(ctx, "The document");
  const deleted = await deleteDocumentRows(id);
  if (!deleted) throw notFound("The document");
  // The DB delete is what matters; a Storage failure is logged, not surfaced (§7).
  await removeObjects([deleted.storagePath]).catch((err: unknown) =>
    console.error(`[documents] could not remove ${deleted.storagePath} from storage:`, err instanceof Error ? err.message : err),
  );
  return NextResponse.json({ deleted: true });
});
