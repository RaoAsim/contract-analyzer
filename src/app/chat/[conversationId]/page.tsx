import type { Metadata } from "next";
import { MultiWorkspace } from "@/components/workspace/MultiWorkspace";

export const metadata: Metadata = { title: "Multi-document chat" };
export const dynamic = "force-dynamic";

export default async function MultiChatPage({ params }: PageProps<"/chat/[conversationId]">): Promise<React.ReactElement> {
  const { conversationId } = await params;
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <MultiWorkspace conversationId={conversationId} />
    </main>
  );
}
