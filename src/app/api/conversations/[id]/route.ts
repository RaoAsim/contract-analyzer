import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { deleteConversation, getConversation } from "@/lib/db/queries/conversations";
import type { ConversationDetail } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiHandler(async (_req: Request, ctx: Ctx): Promise<NextResponse<ConversationDetail>> => {
  const id = await idParam(ctx, "The chat");
  const c = await getConversation(id);
  if (!c) throw notFound("The chat");
  return NextResponse.json(c);
});

export const DELETE = withApiHandler(async (_req: Request, ctx: Ctx): Promise<NextResponse<{ deleted: true }>> => {
  const id = await idParam(ctx, "The chat");
  if (!(await deleteConversation(id))) throw notFound("The chat");
  return NextResponse.json({ deleted: true });
});
