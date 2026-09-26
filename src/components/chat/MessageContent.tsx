"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@/types/citation";
import { CitationChip } from "./CitationChip";

type Props = {
  content: string;
  citations: Citation[];
  numbers: Map<string, number>;
  docName: (docId: string) => string;
  multi: boolean;
  onOpen: (c: Citation) => void;
};

/**
 * A sentence the model wrote *around* its quote ("The agreement is made ⟦c1⟧.", "…as stated in ⟦c2⟧")
 * would read as broken if the quote became a bare number. Detect a dangling lead-in word.
 */
const DANGLING = /(?:\b(?:is|are|was|were|be|made|that|where|which|as|since|because|states?|stating|provides?|providing|says?|saying|reads?|noting|meaning|namely|including|of|by|under|in|to|with|from|between|and|or|than|per)|[:—–])\s*$/i;

function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]<>#|~])/g, "\\$1");
}

/** ⟦cN⟧ → a chip link; when the sentence depends on the quote, show the verified words inline too. */
export function toMarkdown(content: string, byId: Map<string, Citation>): string {
  return content.replace(/⟦(c\d+)⟧/g, (_, id: string, offset: number) => {
    const c = byId.get(id);
    const verified = c && (c.status === "verified" || c.status === "verified_close") && c.displayText;
    if (verified && DANGLING.test(content.slice(Math.max(0, offset - 40), offset))) {
      const q = c.displayText!.length > 240 ? `${c.displayText!.slice(0, 237)}…` : c.displayText!;
      return ` *“${escapeMd(q)}”* [${id}](#cite-${id})`;
    }
    return ` [${id}](#cite-${id})`;
  });
}

/** Markdown with ⟦cN⟧ tokens rendered as citation chips (§11.7). Raw HTML is never rendered. */
function MessageContentInner({ content, citations, numbers, docName, multi, onOpen }: Props): React.ReactElement {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const md = toMarkdown(content, byId);
  return (
    <div className="prose-answer text-[15px] leading-relaxed text-stone-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const id = href.slice(6);
              return <CitationChip citation={byId.get(id)} number={numbers.get(id) ?? null} docName={docName} multi={multi} onOpen={onOpen} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">
                {children}
              </a>
            );
          },
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold text-stone-900">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold text-stone-900">{children}</h3>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-[15px] font-semibold text-stone-900">{children}</h3>,
          strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
          code: ({ children }) => <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-600">{children}</blockquote>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full text-sm">{children}</table></div>,
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

export const MessageContent = memo(MessageContentInner);
