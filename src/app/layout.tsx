import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { AppHeader } from "@/components/layout/AppHeader";
import { PwaRegister } from "@/components/layout/PwaRegister";
import { Providers } from "@/components/layout/Providers";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Contract Analyzer", template: "%s · Contract Analyzer" },
  description: "Ask questions about your contracts and get answers backed by verified quotes.",
  applicationName: "Contract Analyzer",
  appleWebApp: { capable: true, title: "Contract Analyzer", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">): React.ReactElement {
  return (
    <html
      lang="en"
      // Browser extensions (e.g. ColorZilla adds cz-shortcut-listen) edit <html>/<body> before React loads.
      suppressHydrationWarning
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <PwaRegister />
        <Providers>
          <AppHeader />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
