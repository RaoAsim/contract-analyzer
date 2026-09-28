import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only parsers: keep them out of the server bundle so pdf.js can find its
  // worker, cMaps and standard fonts on disk at runtime.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "linkedom", "jszip", "@xmldom/xmldom"],
  // Compression buffers streamed responses; SSE tokens must arrive as they are generated (§11.5).
  compress: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // The service worker must never be served stale.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
