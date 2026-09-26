"use client";

import { ArrowUp, BookOpen, Bot, Square, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComposerMode } from "./Composer.types";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
};

const MODES: { value: ComposerMode; label: string; icon: typeof Zap; hint: string }[] = [
  { value: "standard", label: "Standard", icon: Zap, hint: "Reads the whole document when it fits, otherwise the most relevant sections (and automatically reads everything if the answer isn't there)." },
  { value: "thorough", label: "Read entire document", icon: BookOpen, hint: "Reads every part of the document for this question. Slower, but the answer is based on the whole text." },
  { value: "agent", label: "Research agent", icon: Bot, hint: "The AI decides what to look up with document tools (outline, search, sections, pages) before answering." },
];

/** Composer (§15.2): autosize textarea, mode control, Send ↔ Stop. Enter sends, Shift+Enter newline, Esc stops. */
export function Composer({ value, onChange, mode, onModeChange, onSend, onStop, busy, disabled, disabledReason, placeholder }: Props): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !busy && !disabled && value.trim().length > 0;

  return (
    <div className="border-t bg-white p-3">
      <div className="rounded-lg border bg-white shadow-xs focus-within:ring-2 focus-within:ring-ring/40">
        <label htmlFor="composer" className="sr-only">
          Ask a question about the document
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          maxLength={4000}
          disabled={disabled}
          placeholder={disabled ? disabledReason : (placeholder ?? "Ask about this contract…")}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              onStop();
            }
          }}
          className="block max-h-[200px] w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && onModeChange(v as ComposerMode)}
            aria-label="Answer mode"
            className="flex-wrap"
            disabled={busy}
          >
            {MODES.map((m) => (
              <Tooltip key={m.value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={m.value} size="sm" className="h-7 gap-1 px-2 text-xs data-[state=on]:bg-accent data-[state=on]:text-accent-foreground" aria-label={m.label}>
                    <m.icon className="size-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{m.label}</span>
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{m.hint}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
          <div className="ml-auto">
            {busy ? (
              <Button size="sm" variant="outline" onClick={onStop} aria-label="Stop generating (Esc)">
                <Square className="fill-current" aria-hidden="true" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={onSend} disabled={!canSend} aria-label="Send (Enter)">
                <ArrowUp aria-hidden="true" /> Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
