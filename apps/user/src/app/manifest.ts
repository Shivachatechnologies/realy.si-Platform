import type { MetadataRoute } from "next";

/** Web app manifest (/manifest.webmanifest): installable app shell with the Realy icon and colours. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Realy.si",
    short_name: "Realy",
    description: "One founder. One platform. An entire company.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0B1220",
    theme_color: "#1764FF",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
