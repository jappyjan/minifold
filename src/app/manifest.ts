import type { MetadataRoute } from "next";
import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const settings = getAllSettings(getDatabase());
  const appName =
    settings.app_name && settings.app_name.length > 0
      ? settings.app_name
      : "Minifold";
  const accent =
    settings.accent_color && settings.accent_color.length > 0
      ? settings.accent_color
      : "#3b82f6";

  return {
    name: appName,
    // 12 chars roughly matches Android home-screen label truncation; longer names get cut anyway.
    short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
    description: "Self-hosted file browser",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: accent,
    icons: [
      {
        src: "/api/icon/180/any.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/icon/192/any.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/icon/512/any.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/icon/512/maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
