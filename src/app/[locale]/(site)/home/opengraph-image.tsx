import { ImageResponse } from "next/og";
import { R_MARK_PATHS, R_MARK_VIEWBOX } from "@/components/brand";

export const alt = "Realy.si — One founder. One platform. An entire company.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social card for the public site (referenced by every public page's metadata). The bundled OG font covers Latin only,
 * so the card carries the brand line in English for every locale.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(ellipse 70% 80% at 88% 8%, #1d4fd8 0%, transparent 62%), linear-gradient(135deg, #0b1220 0%, #0d1a36 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="54" height="57" viewBox={R_MARK_VIEWBOX}>
            {R_MARK_PATHS.map((d) => (
              <path key={d} d={d} fill="#1764ff" stroke="#1764ff" strokeWidth={2.4} strokeLinejoin="round" />
            ))}
          </svg>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -1.5 }}>
            Realy<span style={{ color: "#1764ff" }}>.si</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 76, lineHeight: 1.02, letterSpacing: -2 }}>
          <div>One founder.</div>
          <div>One platform.</div>
          <div style={{ color: "#6fa3ff" }}>An entire company.</div>
        </div>
        <div style={{ fontSize: 26, color: "#9aa5bd" }}>The AI business operating system — every AI action that changes data waits for your approval.</div>
      </div>
    ),
    size,
  );
}
