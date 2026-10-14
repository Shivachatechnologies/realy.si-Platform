import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { BrandMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PricingTable } from "@/components/pricing-table";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("pricing.title") };
}

/**
 * The initial billing country is only a hint (CDN geo header or the locale's region) and the visitor can change it;
 * it is never used for billing (docs/billing.md §5).
 */
async function Table() {
  const locale = await getLocale();
  const h = await headers();
  const countries = await db().country.findMany({ where: { status: "ACTIVE", billingEnabled: true }, select: { code: true } });
  const codes = countries.map((c) => c.code);
  const hint = h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? locale.split("-")[1] ?? "US";
  return <PricingTable countryCodes={codes} initialCountry={codes.includes(hint) ? hint : "US"} />;
}

export default async function PricingPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          <span>{t("common.appName")}</span>
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 pt-8 pb-16">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("pricing.title")}</h1>
          <p className="text-muted-foreground">{t("pricing.subtitle")}</p>
        </div>
        <Suspense fallback={<Skeleton className="h-80" />}>
          <Table />
        </Suspense>
      </main>
    </div>
  );
}
