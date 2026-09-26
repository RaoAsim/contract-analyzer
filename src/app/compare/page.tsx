import type { Metadata } from "next";
import { ComparePicker } from "@/components/compare/ComparePicker";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

export default function ComparePage(): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-screen-lg flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-stone-900">Compare</h1>
      <ComparePicker />
    </main>
  );
}
