import { ImageResponse } from "next/og";
import { AppIcon } from "@/lib/pwa/AppIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iOS (full-bleed; iOS rounds the corners itself). */
export default function AppleIcon(): ImageResponse {
  return new ImageResponse(<AppIcon size={180} fullBleed />, size);
}
