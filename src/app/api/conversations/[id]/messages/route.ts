import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { idParam } from "@/lib/api/params";
import { startAnswer } from "@/lib/chat/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  content: z.string().trim().min(1, "Type a question first.").max(4000, "Questions are limited to 4,000 characters."),
  options: z
    .object({ thorough: z.boolean().optional(), agent: z.boolean().optional(), debugInjectFakeQuote: z.boolean().optional() })
    .default({})
    .refine((o) => !(o.thorough && o.agent), "Choose either “Read entire document” or “Research agent”, not both."),
});

/** Ask a question. Responds with a text/event-stream (§11.5). */
export const POST = withApiHandler(async (req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const id = await idParam(ctx, "The chat");
  const b = body.parse(await req.json().catch(() => ({})));
  return startAnswer(id, b.content, b.options, req.signal);
});
