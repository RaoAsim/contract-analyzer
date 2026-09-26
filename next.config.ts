import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only parsers: keep them out of the server bundle so pdf.js can find its
  // worker, cMaps and standard fonts on disk at runtime.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "linkedom", "jszip", "@xmldom/xmldom"],
  // Compression buffers streamed responses; SSE tokens must arrive as they are generated (§11.5).
  compress: false,
  poweredByHeader: false,
};

export default nextConfig;
