import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { runRegistry } from "@/lib/chat/runRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop generation; the partial answer and its verified quotes are kept (§11.8). */
export const POST = withApiHandler(async (_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse<{ stopped: boolean }>> => {
  const id = await idParam(ctx, "The answer");
  return NextResponse.json({ stopped: runRegistry.stop(id, "user") });
});
