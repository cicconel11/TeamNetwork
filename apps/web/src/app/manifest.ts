import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_ICON_PATHS, SITE_NAME } from "@/lib/site-metadata";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#040b18",
    theme_color: "#040b18",
    icons: [
      {
        src: SITE_ICON_PATHS.favicon,
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: SITE_ICON_PATHS.icon192,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: SITE_ICON_PATHS.appleTouch,
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
