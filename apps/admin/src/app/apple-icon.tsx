import { ImageResponse } from "next/og";
import { R_MARK_PATHS, R_MARK_VIEWBOX } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (home-screen tile): the white R mark on the Realy Blue gradient tile, as in src/app/icon.svg.
 * iOS rounds the corners itself, so the tile is a full square. Served at /apple-icon (excluded from the proxy matcher).
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2f78ff 0%, #0b4fe6 100%)",
        }}
      >
        <svg width="96" height="102" viewBox={R_MARK_VIEWBOX}>
          {R_MARK_PATHS.map((d) => (
            <path key={d} d={d} fill="#ffffff" stroke="#ffffff" strokeWidth={2.4} strokeLinejoin="round" />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
