import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { retryComparison } from "@/lib/db/queries/comparisons";
import type { ComparisonSummary } from "@/types/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse<{ comparison: ComparisonSummary }>> => {
  const id = await idParam(ctx, "The comparison");
  return NextResponse.json({ comparison: await retryComparison(id) });
});
