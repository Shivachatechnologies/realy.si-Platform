import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { World } from "@/components/ui/world";
import { WaitlistForm } from "@/components/site/waitlist-form";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/waitlist", title: t("site.waitlist.pageTitle"), description: t("site.waitlist.pageLede") });
}

/** Waitlist sign-up (stored in SiteWaitlistEntry; rate limited, idempotent per email). */
export default async function WaitlistPage({ searchParams }: PageProps<"/[locale]/waitlist">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from.slice(0, 80) : null;
  return (
    <World name="command" ambient={false}>
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid gap-12 pt-14 pb-20 sm:pt-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div className="grid content-start gap-8">
            <SiteHeading as="h1" eyebrow={t("site.waitlist.pageEyebrow")} title={t("site.waitlist.pageTitle")} lede={t("site.waitlist.pageLede")} />
            <ul className="grid gap-4">
              {(["why1", "why2", "why3"] as const).map((w) => (
                <li key={w} className="flex items-start gap-3 text-[14.5px] leading-relaxed">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent text-primary">
                    <Check className="size-3.5" aria-hidden />
                  </span>
                  {t(`site.waitlist.${w}`)}
                </li>
              ))}
            </ul>
            <p className="text-[13.5px] text-muted-foreground">
              {t("site.waitlist.alreadyOpen")}{" "}
              <Link href={`/${locale}/sign-up`} className="font-medium text-foreground underline underline-offset-4">
                {t("site.home.ctaPrimary")}
              </Link>
            </p>
          </div>
          <WaitlistForm source={from ? `waitlist:${from}` : "waitlist"} />
        </SiteContainer>
      </section>
    </World>
  );
}
