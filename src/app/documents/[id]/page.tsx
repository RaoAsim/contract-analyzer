import type { Metadata } from "next";
import { DocumentWorkspace } from "@/components/workspace/DocumentWorkspace";

export const metadata: Metadata = { title: "Document" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">): Promise<React.ReactElement> {
  const { id } = await params;
  const sp = await searchParams;
  const c = typeof sp.c === "string" && UUID.test(sp.c) ? sp.c : null;
  return (
    <main className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col">
      <DocumentWorkspace id={id} initialConversationId={c} />
    </main>
  );
}
