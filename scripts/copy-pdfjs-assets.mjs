// Copies the pdf.js worker, cMaps and standard fonts into public/pdfjs so the browser viewer
// (react-pdf) loads the SAME pdf.js version the server uses for extraction.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
const out = path.resolve("public/pdfjs");
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, "build", "pdf.worker.min.mjs"), path.join(out, "pdf.worker.min.mjs"));
fs.cpSync(path.join(root, "cmaps"), path.join(out, "cmaps"), { recursive: true });
fs.cpSync(path.join(root, "standard_fonts"), path.join(out, "standard_fonts"), { recursive: true });
console.log(`pdf.js assets copied to ${path.relative(process.cwd(), out)}`);
