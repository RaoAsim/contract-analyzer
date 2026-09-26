"use client";

import { AlertTriangle, Info, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notice } from "@/types/chat";

const INFO_CODES = new Set(["ESCALATING", "TOOLS_UNSUPPORTED", "DOCS_UNAVAILABLE"]);

/** Non-fatal server notices (§11.5). Absence warnings offer "Check the entire document". */
export function NoticeList({ notices, onThorough, disabled }: { notices: Notice[]; onThorough?: () => void; disabled?: boolean }): React.ReactElement | null {
  const shown = notices.filter((n) => n.code !== "RETRYING");
  if (shown.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {shown.map((n, i) => {
        const info = INFO_CODES.has(n.code);
        return (
          <li
            key={`${n.code}-${i}`}
            className={info ? "flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" : "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"}
          >
            {info ? <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <span className="flex-1">{n.text}</span>
              {n.action?.kind === "thorough" && onThorough && (
                <Button size="sm" variant="outline" className="shrink-0 bg-white" onClick={onThorough} disabled={disabled}>
                  <ScanSearch aria-hidden="true" /> {n.action.label}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
