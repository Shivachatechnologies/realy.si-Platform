import { cookies } from "next/headers";
import { getLocale } from "@/i18n/server";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { getT } from "@/i18n/server";

/**
 * Public website chrome (homepage, platform, AI workforce, pricing, journal, docs, help, waitlist). No session needed;
 * a session cookie only switches the header's call-to-action to "Open Realy" (the app re-checks the session itself).
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const signedIn = !!(await cookies()).get("realy_session")?.value;
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip" data-site>
      <a
        href="#site-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-elev-3"
      >
        {t("common.skipToContent")}
      </a>
      <SiteHeader signedIn={signedIn} />
      <main id="site-main" className="relative flex-1">
        {children}
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
