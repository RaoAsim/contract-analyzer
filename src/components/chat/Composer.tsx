"use client";

import { ArrowUp, BookOpen, Bot, Loader2, Square, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComposerMode } from "./Composer.types";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode: ComposerMode;
  onModeChange: (m: ComposerMode) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  /** The answer hasn't started streaming yet (Stop is still available). */
  starting?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
};

const MODES: { value: ComposerMode; label: string; icon: typeof Zap; hint: string }[] = [
  { value: "standard", label: "Standard", icon: Zap, hint: "Fast. Reads the whole contract if it's short, otherwise the most relevant sections — and reads everything automatically if the answer isn't there." },
  { value: "thorough", label: "Whole document", icon: BookOpen, hint: "Reads every part of the contract for this question. Slower (about 10–30 s on a long contract), but nothing is skipped." },
  { value: "agent", label: "Research agent", icon: Bot, hint: "The AI plans its own research — outline, search, sections, cross-references — then answers. You'll see each step." },
];

/** Composer (§15.2): autosize textarea, a segmented mode control, Send ↔ Stop. Enter sends, Shift+Enter newline, Esc stops. */
export function Composer({ value, onChange, mode, onModeChange, onSend, onStop, busy, starting, disabled, disabledReason, placeholder }: Props): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !busy && !disabled && value.trim().length > 0;
  const current = MODES.find((m) => m.value === mode)!;

  return (
    <div className="border-t bg-white px-3 pt-2 pb-3">
      <div role="radiogroup" aria-label="Answer mode" className="mb-2 inline-flex rounded-lg bg-stone-100 p-0.5">
        {MODES.map((m) => {
          const on = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => onModeChange(m.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                on ? "bg-white text-stone-900 shadow-xs ring-1 ring-stone-200" : "text-stone-500 hover:text-stone-800",
              )}
            >
              <m.icon className={cn("size-3.5", on && "text-primary")} aria-hidden="true" />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-white shadow-xs focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20">
        <label htmlFor="composer" className="sr-only">
          Ask a question about the document
        </label>
        <div className="flex items-end gap-2 p-2">
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
            className="block max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />
          {busy ? (
            <Button size="sm" variant="outline" onClick={onStop} aria-label="Stop generating (Esc)" className="h-9">
              {starting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Square className="fill-current" aria-hidden="true" />} Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onSend} disabled={!canSend} aria-label="Send (Enter)" className="h-9">
              <ArrowUp aria-hidden="true" /> Send
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 px-1 text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium text-stone-600">{current.label}:</span> {current.hint}
      </p>
    </div>
  );
}
