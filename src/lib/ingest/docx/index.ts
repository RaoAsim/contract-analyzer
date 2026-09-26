import type { DocxParseResult } from "./docx.types";
import { parseDocxWithMammoth } from "./fallback";
import { parseDocxBlocks } from "./parse";
import { renderBlocks } from "./render";

/** Custom OOXML parser first; mammoth fallback (with a `simplified_docx_render` warning) if it throws. */
export async function parseDocx(bytes: Uint8Array): Promise<DocxParseResult> {
  try {
    const blocks = await parseDocxBlocks(bytes);
    return { ...renderBlocks(blocks), simplified: false };
  } catch (err) {
    console.warn("[ingest] custom DOCX parser failed, using mammoth fallback:", err instanceof Error ? err.message : err);
    return parseDocxWithMammoth(bytes);
  }
}
