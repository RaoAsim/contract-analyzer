"use client";

import { FileText } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/useMediaQuery";

type Props = {
  viewer: React.ReactNode;
  chat: React.ReactNode;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  title: string;
};

/**
 * Resizable split (viewer 60% | chat 40%) on desktop. On mobile the chat is full-screen and the
 * viewer opens as a sheet when a citation is tapped (§15.2).
 */
export function WorkspaceLayout({ viewer, chat, sheetOpen, onSheetOpenChange, title }: Props): React.ReactElement {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  if (desktop) {
    return (
      <Group orientation="horizontal" className="h-full min-h-0 flex-1">
        <Panel defaultSize="60" minSize="30">
          {viewer}
        </Panel>
        <Separator className="w-1.5 bg-stone-200 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 data-[separator=active]:bg-primary/60" />
        <Panel defaultSize="40" minSize="28">
          {chat}
        </Panel>
      </Group>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b bg-white px-3 py-1.5">
        <span className="truncate text-sm font-medium text-stone-800">{title}</span>
        <Button variant="outline" size="sm" onClick={() => onSheetOpenChange(true)}>
          <FileText aria-hidden="true" /> View document
        </Button>
      </div>
      <div className="min-h-0 flex-1">{chat}</div>
      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent side="bottom" className="h-[88dvh] gap-0 p-0">
          <SheetHeader className="border-b px-4 py-2">
            <SheetTitle className="truncate text-sm">{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">{viewer}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
