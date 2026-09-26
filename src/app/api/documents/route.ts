import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { listDocuments } from "@/lib/db/queries/documents";
import type { DocumentSummary } from "@/types/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idsSchema = z.array(z.string().uuid()).max(50);

export const GET = withApiHandler(async (req: Request): Promise<NextResponse<{ documents: DocumentSummary[] }>> => {
  const raw = new URL(req.url).searchParams.get("ids");
  const ids = raw ? idsSchema.parse(raw.split(",").filter(Boolean)) : undefined;
  return NextResponse.json({ documents: await listDocuments(ids) });
});
