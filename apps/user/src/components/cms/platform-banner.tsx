import Link from "next/link";
import { activeBanner } from "@/server/modules/cms/public";

const TONE = {
  info: "border-primary/30 bg-accent text-accent-foreground",
  warning: "border-warning/40 bg-warning/10 text-foreground",
  danger: "border-danger/40 bg-danger/10 text-foreground",
} as const;

/**
 * Site-wide platform banner (Admin → Announcements: maintenance notices etc.). Server component, cached ~1 minute.
 * Renders nothing when no banner is active.
 */
export async function PlatformBanner() {
  const b = await activeBanner();
  if (!b) return null;
  const safeHref = b.href && (/^\/(?!\/)[^\s]*$/.test(b.href) || /^https:\/\/[^\s]+$/.test(b.href)) ? b.href : null;
  return (
    <div role={b.tone === "info" ? "status" : "alert"} className={`border-b px-4 py-2 text-center text-sm ${TONE[b.tone]}`}>
      {b.message}
      {safeHref ? (
        <>
          {" "}
          <Link href={safeHref} className="font-medium underline underline-offset-2">
            →
          </Link>
        </>
      ) : null}
    </div>
  );
}
