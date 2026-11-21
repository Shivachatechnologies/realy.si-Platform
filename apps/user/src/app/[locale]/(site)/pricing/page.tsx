import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { World } from "@/components/ui/world";
import { Skeleton } from "@/components/ui/skeleton";
import { PricingPlans, type PublicPlan } from "@/components/site/pricing-plans";
import { SiteContainer, SiteHeading } from "@/components/site/section";
import { siteMetadata } from "@/components/site/meta";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { getPublicPricing } from "@/server/modules/pricing/service";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT(locale);
  return siteMetadata({ locale, path: "/pricing", title: t("pricing.title"), description: t("planCatalog.heroLede") });
}

const PRICING_FAQ = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

/** BigInt-safe copy of server data for the client (same shape as the public pricing API). */
const toClient = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * The initial billing country is only a hint (CDN geo header or the locale's region) and the visitor can change it;
 * it is never used for billing (docs/billing.md §5). Prices come from the pricing catalog, resolved per market.
 */
async function Plans() {
  const locale = await getLocale();
  const h = await headers();
  const countries = await db()
    .country.findMany({ where: { status: "ACTIVE", billingEnabled: true }, select: { code: true } })
    .catch(() => [] as { code: string }[]);
  const codes = countries.map((c) => c.code);
  const hint = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? locale.split("-")[1] ?? "US";
  const initialCountry = codes.includes(hint) ? hint : codes.includes("US") ? "US" : (codes[0] ?? "US");
  const initial = await getPublicPricing(initialCountry, "MONTH")
    .then((plans) => toClient({ plans }) as { plans: PublicPlan[] })
    .catch(() => null);
  return <PricingPlans countryCodes={codes.length ? codes : [initialCountry]} initialCountry={initialCountry} initial={initial} />;
}

export default async function PricingPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <World name="command" ambient={false}>
      <section className="relative overflow-hidden">
        <div aria-hidden className="site-hero-light pointer-events-none absolute inset-0 -z-10" />
        <SiteContainer className="grid gap-12 pt-14 pb-16 sm:pt-20">
          <SiteHeading as="h1" eyebrow={t("site.nav.pricing")} title={t("planCatalog.heroTitle")} lede={t("planCatalog.heroLede")} />
          <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
            <Plans />
          </Suspense>
        </SiteContainer>
      </section>
      <section className="border-t py-16 sm:py-20">
        <SiteContainer className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <h2 className="font-display text-display-lg">{t("planCatalog.faqTitle")}</h2>
          <div className="grid divide-y border-y">
            {PRICING_FAQ.map((q) => (
              <details key={q} className="group py-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                  {t(`planCatalog.faq.${q}.q`)}
                  <span aria-hidden className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="pb-4 text-[14px] leading-relaxed text-muted-foreground">{t(`planCatalog.faq.${q}.a`)}</p>
              </details>
            ))}
          </div>
        </SiteContainer>
      </section>
    </World>
  );
}
