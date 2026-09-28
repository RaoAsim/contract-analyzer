import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/pwa/AppIcon";

/** PNG icons for the web app manifest: /pwa-icon/192, /pwa-icon/512, /pwa-icon/maskable. */
const VARIANTS: Record<string, { size: number; fullBleed: boolean }> = {
  "192": { size: 192, fullBleed: false },
  "512": { size: 512, fullBleed: false },
  maskable: { size: 512, fullBleed: true },
};

export const dynamic = "force-static";

export function generateStaticParams(): { variant: string }[] {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ variant: string }> }): Promise<Response> {
  const { variant } = await ctx.params;
  const v = VARIANTS[variant];
  if (!v) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIcon size={v.size} fullBleed={v.fullBleed} />, { width: v.size, height: v.size });
}
