import type { MetadataRoute } from "next";

/** Web app manifest: makes the app installable (desktop and phone home screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Contract Analyzer",
    short_name: "Contracts",
    description: "Ask questions about your contracts and get answers backed by verified quotes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#0f766e",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
