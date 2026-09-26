import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { createConversation, listConversations } from "@/lib/db/queries/conversations";
import type { ConversationSummary } from "@/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuery = z.object({ documentId: z.string().uuid().optional(), kind: z.enum(["single", "multi"]).optional() });
const createBody = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(5) });

/** Threads for a document (`?documentId=`) or multi-document chats (`?kind=multi`). */
export const GET = withApiHandler(async (req: Request): Promise<NextResponse<{ conversations: ConversationSummary[] }>> => {
  const sp = new URL(req.url).searchParams;
  const q = listQuery.parse({ documentId: sp.get("documentId") ?? undefined, kind: sp.get("kind") ?? undefined });
  return NextResponse.json({ conversations: await listConversations(q) });
});

export const POST = withApiHandler(async (req: Request): Promise<NextResponse<{ conversation: ConversationSummary }>> => {
  const body = createBody.parse(await req.json().catch(() => ({})));
  return NextResponse.json({ conversation: await createConversation(body.documentIds) }, { status: 201 });
});
