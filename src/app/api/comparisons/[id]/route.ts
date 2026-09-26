import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { deleteComparison, getComparison } from "@/lib/db/queries/comparisons";
import type { ComparisonDetail } from "@/types/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_req: Request, ctx: Ctx): Promise<NextResponse<{ comparison: ComparisonDetail }>> => {
  const id = await idParam(ctx, "The comparison");
  const comparison = await getComparison(id);
  if (!comparison) throw notFound("The comparison");
  return NextResponse.json({ comparison });
});

export const DELETE = withApiHandler(async (_req: Request, ctx: Ctx): Promise<NextResponse<{ deleted: true }>> => {
  const id = await idParam(ctx, "The comparison");
  if (!(await deleteComparison(id))) throw notFound("The comparison");
  return NextResponse.json({ deleted: true });
});
