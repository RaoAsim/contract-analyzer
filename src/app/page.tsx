import type { Metadata } from "next";
import { LibraryView } from "@/components/library/LibraryView";
import { publicLimits } from "@/lib/config";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

export default function LibraryPage(): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload contracts, open one to ask questions, or select several to ask across them or compare two versions.
        </p>
      </div>
      <LibraryView limits={publicLimits()} />
    </main>
  );
}
