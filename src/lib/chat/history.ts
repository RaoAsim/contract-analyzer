import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { messages } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/llm/llm.types";
import { countTokens } from "@/lib/llm/tokens";
import type { Citation } from "@/types/citation";

const HISTORY_TOKENS = 3000;

/**
 * Replace ⟦cN⟧ tokens with the verified quote in the SAME <quote> tag format the model must write.
 * (Rendering them as plain "…" made the model imitate that and stop using tags.) Unverified quotes
 * are dropped.
 */
export function renderForHistory(content: string, citations: Citation[]): string {
  const byId = new Map(citations.map((c) => [c.id, c]));
  return content.replace(/⟦(c\d+)⟧/g, (_, id: string) => {
    const c = byId.get(id);
    if (!c || !c.displayText || (c.status !== "verified" && c.status !== "verified_close")) return "";
    return ` <quote doc="${c.docTag}">${c.displayText}</quote> `;
  });
}

/**
 * Last user/assistant turns (newest first) within 3k tokens (§11.8). Stopped answers get
 * "[answer interrupted]". Returns how many turns were dropped so `meta` can report it.
 */
export async function loadHistory(conversationId: string, excludeIds: string[]): Promise<{ messages: ChatMessage[]; turns: number; dropped: number }> {
  const rows = await getDb()
    .select({ id: messages.id, role: messages.role, content: messages.content, citations: messages.citations, status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        inArray(messages.status, ["complete", "stopped", "interrupted"]),
        ...excludeIds.map((id) => ne(messages.id, id)),
      ),
    )
    .orderBy(desc(messages.createdAt), asc(messages.role)) // newest first; answer before its question at the same instant
    .limit(40);

  const out: ChatMessage[] = [];
  let used = 0;
  let taken = 0;
  for (const r of rows) {
    let text = r.role === "assistant" ? renderForHistory(r.content, r.citations) : r.content;
    if (r.role === "assistant" && r.status !== "complete") text += "\n[answer interrupted]";
    text = text.replace(/\s+\n/g, "\n").trim();
    if (!text) continue;
    const t = countTokens(text);
    if (used + t > HISTORY_TOKENS) break;
    used += t;
    taken++;
    out.unshift({ role: r.role, content: text });
  }
  // Must start with a user turn.
  while (out.length > 0 && out[0]!.role !== "user") out.shift();
  const turns = Math.ceil(out.length / 2);
  const totalTurns = Math.ceil(rows.length / 2);
  return { messages: out, turns, dropped: taken < rows.length ? Math.max(0, totalTurns - turns) : 0 };
}
