"use client";

import { FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UploadLimits } from "./library.types";

type Props = { limits: UploadLimits; compact: boolean; onFiles: (files: FileList) => void };

export function UploadDropzone({ limits, compact, onFiles }: Props): React.ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hint = `PDF or Word (.docx) · up to ${limits.maxUploadMb} MB and ${limits.maxPages} pages`;

  const events = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
    },
  };

  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      className="sr-only"
      aria-label="Choose contract files to upload"
      // Hint only: the server detects the real type from the file's bytes.
      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      onChange={(e) => {
        if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <div
        {...events}
        className={cn(
          "flex flex-col items-start gap-3 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-3 transition-colors sm:flex-row sm:items-center",
          over && "border-primary bg-accent",
        )}
      >
        <FileUp className="hidden size-5 text-primary sm:block" aria-hidden="true" />
        <p className="flex-1 text-sm text-stone-600">
          Drop contracts here to upload. <span className="text-muted-foreground">{hint}</span>
        </p>
        <Button size="sm" onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" /> Upload
        </Button>
        {picker}
      </div>
    );
  }

  return (
    <div
      {...events}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-stone-300 bg-white px-6 py-16 text-center transition-colors",
        over && "border-primary bg-accent",
      )}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-primary">
        <FileUp className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold text-stone-900">Upload a contract to get started</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Drag and drop files here, or choose them from your computer. {hint}.
      </p>
      <Button className="mt-5" onClick={() => input.current?.click()}>
        <Upload aria-hidden="true" /> Choose files
      </Button>
      <p className="mt-4 max-w-md text-xs text-muted-foreground">
        Scanned PDFs without selectable text can&apos;t be analysed (no OCR). Save legacy .doc files as .docx first.
      </p>
      {picker}
    </div>
  );
}
