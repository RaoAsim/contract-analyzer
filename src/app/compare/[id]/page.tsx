import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ComparisonView } from "@/components/compare/ComparisonView";

export const metadata: Metadata = { title: "Comparison" };
export const dynamic = "force-dynamic";

export default async function ComparisonPage({ params }: PageProps<"/compare/[id]">): Promise<React.ReactElement> {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-screen-lg flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/compare" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-stone-900">
        <ArrowLeft className="size-4" aria-hidden="true" /> All comparisons
      </Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-stone-900">Comparison</h1>
      <ComparisonView id={id} />
    </main>
  );
}
