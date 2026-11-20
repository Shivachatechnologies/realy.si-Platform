"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Check, Minus } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/client";
import { displayName, formatMoney, formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface PublicPlan {
  key: string;
  name: string;
  description?: string | null;
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
  resolution: { available: true; price: { money: { amountMinor: string; currency: string }; trialDays: number } } | { available: false; reason: string };
}

/**
 * Public plans from the pricing catalog, resolved server-side per billing country and interval (no client-side price
 * math). `initial` is the server-rendered first page (same shape as GET /api/v1/catalog/pricing) so prices are in the HTML.
 */
export function PricingPlans({ countryCodes, initialCountry, initial }: { countryCodes: string[]; initialCountry: string; initial: { plans: PublicPlan[] } | null }) {
  const { t, locale } = useI18n();
  const [country, setCountry] = useState(initialCountry);
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const q = useQuery({
    queryKey: ["pricing", country, interval],
    queryFn: () => api<{ plans: PublicPlan[] }>(`/api/v1/catalog/pricing?country=${country}&interval=${interval}`),
    initialData: country === initialCountry && interval === "MONTH" && initial ? initial : undefined,
  });
  const feature = (k: string) => {
    const v = t(`pricing.features.${k}`);
    return v === `pricing.features.${k}` ? k : v;
  };

  return (
    <div className="grid gap-8">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex self-start rounded-full border bg-surface/80 p-1 shadow-elev-1" role="group" aria-label={t("site.pricing.interval")}>
          {(["MONTH", "YEAR"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn("min-h-10 rounded-full px-5 text-[13px] transition-colors", interval === i ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`settings.billing.interval.${i}`)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="shrink-0 text-muted-foreground">{t("pricing.country")}</span>
          <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full sm:w-60">
            {countryCodes
              .map((c) => ({ c, n: displayName(c, "region", locale) }))
              .sort((a, b) => a.n.localeCompare(b.n, locale))
              .map(({ c, n }) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
          </Select>
        </label>
      </div>
      {q.error ? <FormError error={q.error} /> : null}
      {!q.isLoading && q.data && q.data.plans.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{t("site.pricing.noPlans")}</p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {q.isLoading || !q.data
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-3xl" />)
          : q.data.plans.map((p, idx) => (
              <article
                key={p.key}
                className={cn(
                  "relative flex flex-col gap-6 overflow-hidden rounded-3xl border bg-surface/90 p-6 shadow-elev-2 backdrop-blur sm:p-7",
                  idx === 1 && "border-gradient shadow-float",
                )}
              >
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-[1.9rem] leading-none">{p.name}</h2>
                    {p.resolution.available && p.resolution.price.trialDays > 0 ? (
                      <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">{t("settings.billing.trial", { days: p.resolution.price.trialDays })}</span>
                    ) : null}
                  </div>
                  {p.description ? <p className="text-[13.5px] leading-relaxed text-muted-foreground">{p.description}</p> : null}
                </div>
                {p.resolution.available ? (
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-numeral font-semibold tracking-tight">{formatMoney(p.resolution.price.money, locale)}</span>
                    <span className="text-[12.5px] text-muted-foreground">{t(`settings.billing.per.${interval}`)}</span>
                  </div>
                ) : (
                  <p className="text-[15px] font-medium">{p.key === "enterprise" ? t("pricing.contactSales") : t("pricing.unavailable")}</p>
                )}
                <ul className="grid gap-3 border-t pt-5 text-[13.5px]">
                  {p.entitlements.map((e) => (
                    <li key={e.featureKey} className="flex items-center gap-2.5">
                      {e.enabled ? (
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                          <Check className="size-3" aria-hidden />
                        </span>
                      ) : (
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Minus className="size-3" aria-hidden />
                        </span>
                      )}
                      <span className={cn(!e.enabled && "text-muted-foreground")}>{feature(e.featureKey)}</span>
                      <span className="tabular ms-auto text-[12px] text-muted-foreground">
                        {e.enabled ? (e.limitValue ? formatNumber(Number(e.limitValue), locale) : t("pricing.unlimited")) : t("pricing.notIncluded")}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/${locale}/${p.resolution.available ? "sign-up" : "waitlist"}`}
                  className={cn(
                    "press mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-transform hover:scale-[1.01]",
                    p.resolution.available ? "bg-foreground text-background" : "border hover:bg-muted",
                  )}
                >
                  {p.resolution.available ? t("pricing.getStarted") : p.key === "enterprise" ? t("pricing.contactSales") : t("site.nav.waitlist")}
                  <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
                </Link>
              </article>
            ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{t("pricing.taxNote")}</p>
    </div>
  );
}
