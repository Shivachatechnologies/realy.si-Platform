import { ImageResponse } from "next/og";

export const alt = "Realy — One founder. One platform. An entire company.";
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
          background: "radial-gradient(ellipse 70% 80% at 85% 10%, #4f46e5 0%, transparent 60%), radial-gradient(ellipse 60% 70% at 10% 100%, #7c3aed 0%, transparent 60%), #0f1017",
          color: "#f5f5f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 17, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 700 }}>R</div>
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: -1 }}>Realy</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 76, lineHeight: 1.02, letterSpacing: -2 }}>
          <div>One founder.</div>
          <div>One platform.</div>
          <div style={{ color: "#c4b5fd" }}>An entire company.</div>
        </div>
        <div style={{ fontSize: 26, color: "#a1a1aa" }}>The AI business operating system — every AI action that changes data waits for your approval.</div>
      </div>
    ),
    size,
  );
}
