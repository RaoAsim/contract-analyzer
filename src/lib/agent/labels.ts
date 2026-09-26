import type { ChatDoc } from "@/lib/chat/chat.types";
import { shortName } from "@/lib/client/docColors";
import { CLAUSE_LABELS } from "@/lib/ingest/clauses";
import type { ClauseType } from "@/lib/ingest/clauses.types";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined;
}

function sectionTitle(docs: ChatDoc[], tag: string | undefined, number: string): string | undefined {
  const d = docs.find((x) => x.tag === (tag ?? "D1")) ?? docs[0];
  return d?.data.sections.find((s) => s.number === number)?.title;
}

/** Live status labels are functions of the arguments — never a generic spinner (§14.1). */
export function toolLabel(name: string, args: unknown, docs: ChatDoc[], multi: boolean): string {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const tag = str(a.doc)?.toUpperCase();
  const doc = docs.find((d) => d.tag === (tag ?? "D1"));
  const prefix = multi && doc ? `${shortName(doc.data.name, 20)}: ` : "";
  let label: string;
  switch (name) {
    case "search_document":
      label = `Searching for "${str(a.query) ?? "…"}"…`;
      break;
    case "get_section": {
      const n = str(a.number) ?? "?";
      const t = sectionTitle(docs, tag, n);
      label = t ? `Reading §${n} ${t}…` : `Reading section ${n}…`;
      break;
    }
    case "read_pages": {
      const s = str(a.start);
      const e = str(a.end);
      label = s && e && s !== e ? `Reading pages ${s}–${e}…` : `Reading page ${s ?? "?"}…`;
      break;
    }
    case "find_exact":
      label = `Finding every mention of "${str(a.text) ?? "…"}"…`;
      break;
    case "list_clauses": {
      const t = str(a.type) as ClauseType | undefined;
      label = t && CLAUSE_LABELS[t] ? `Listing ${CLAUSE_LABELS[t].toLowerCase()} clauses…` : "Listing the standard clauses…";
      break;
    }
    case "get_outline":
      label = "Reviewing the contract's structure…";
      break;
    case "check_entire_document":
      label = "Reading the entire document (this takes a moment)…";
      break;
    case "finish_research":
      label = "Finishing research…";
      break;
    default:
      label = `Calling "${name}"…`;
  }
  return prefix + label;
}
