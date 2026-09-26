type Run = { controller: AbortController; conversationId: string; reason?: "user" | "disconnect" };

type RegistryGlobal = { __caRuns?: { byMessage: Map<string, Run>; byConversation: Map<string, string> } };
const g = globalThis as unknown as RegistryGlobal;

function reg(): { byMessage: Map<string, Run>; byConversation: Map<string, string> } {
  g.__caRuns ??= { byMessage: new Map(), byConversation: new Map() };
  return g.__caRuns;
}

/**
 * In-memory registry of active answer runs (§11.8): at most one per conversation.
 * Single-process only — the app runs as one Railway instance (README limitation).
 */
export const runRegistry = {
  isActive(conversationId: string): boolean {
    return reg().byConversation.has(conversationId);
  },
  start(conversationId: string, messageId: string): AbortController {
    const controller = new AbortController();
    reg().byMessage.set(messageId, { controller, conversationId });
    reg().byConversation.set(conversationId, messageId);
    return controller;
  },
  stop(messageId: string, reason: "user" | "disconnect"): boolean {
    const run = reg().byMessage.get(messageId);
    if (!run) return false;
    run.reason ??= reason;
    run.controller.abort(reason);
    return true;
  },
  reason(messageId: string): "user" | "disconnect" | undefined {
    return reg().byMessage.get(messageId)?.reason;
  },
  finish(messageId: string): void {
    const run = reg().byMessage.get(messageId);
    if (!run) return;
    reg().byMessage.delete(messageId);
    if (reg().byConversation.get(run.conversationId) === messageId) reg().byConversation.delete(run.conversationId);
  },
};
