import path from "node:path";
import type * as PdfjsModule from "pdfjs-dist/legacy/build/pdf.mjs";

export type Pdfjs = typeof PdfjsModule;

let loaded: Promise<Pdfjs> | undefined;

/** Lazily imports the pdf.js legacy build (Node-compatible). */
export function loadPdfjs(): Promise<Pdfjs> {
  loaded ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return loaded;
}

function assetDir(name: "cmaps" | "standard_fonts"): string {
  // pdfjs-dist is a serverExternalPackage, so it lives in node_modules at runtime (next start + tests).
  // pdf.js requires a trailing "/" (even on Windows).
  return `${path.join(process.cwd(), "node_modules", "pdfjs-dist", name).replace(/\\/g, "/")}/`;
}

/**
 * Standard options for server-side parsing. Without cMaps, CID fonts extract as garbage (§8.3).
 */
export function pdfDocumentOptions(data: Uint8Array): Parameters<Pdfjs["getDocument"]>[0] {
  return {
    // pdf.js transfers (detaches) the buffer; give it a copy so callers can keep theirs.
    data: new Uint8Array(data),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  };
}
