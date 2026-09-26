"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Library" },
  { href: "/compare", label: "Compare" },
] as const;

export function NavLinks(): React.ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900",
              active && "bg-stone-100 text-stone-900",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
