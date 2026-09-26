import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { createComparison, listComparisons } from "@/lib/db/queries/comparisons";
import type { ComparisonSummary } from "@/types/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ docAId: z.string().uuid(), docBId: z.string().uuid() });

export const GET = withApiHandler(async (): Promise<NextResponse<{ comparisons: ComparisonSummary[] }>> =>
  NextResponse.json({ comparisons: await listComparisons() }),
);

/** Start a comparison job: original (A) → revised (B). */
export const POST = withApiHandler(async (req: Request): Promise<NextResponse<{ comparison: ComparisonSummary }>> => {
  const b = body.parse(await req.json().catch(() => ({})));
  return NextResponse.json({ comparison: await createComparison(b.docAId, b.docBId) }, { status: 201 });
});
