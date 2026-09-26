import Link from "next/link";
import { FileSearch } from "lucide-react";
import { NavLinks } from "./NavLinks";

export function AppHeader(): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FileSearch className="size-4" aria-hidden="true" />
          </span>
          <span>Contract Analyzer</span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
