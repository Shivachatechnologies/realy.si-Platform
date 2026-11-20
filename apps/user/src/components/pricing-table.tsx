"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormError } from "@/components/form-error";
import { useI18n } from "@/i18n/client";
import { displayName, formatMoney, formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";

interface PublicPlan {
  key: string;
  name: string;
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
  resolution: { available: true; price: { money: { amountMinor: string; currency: string }; trialDays: number } } | { available: false; reason: string };
}

/** Public pricing: resolved server-side per billing country (no client-side price math). */
export function PricingTable({ countryCodes, initialCountry }: { countryCodes: string[]; initialCountry: string }) {
  const { t, locale } = useI18n();
  const [country, setCountry] = useState(initialCountry);
  const [interval, setInterval] = useState<"MONTH" | "YEAR">("MONTH");
  const q = useQuery({
    queryKey: ["pricing", country, interval],
    queryFn: () => api<{ plans: PublicPlan[] }>(`/api/v1/catalog/pricing?country=${country}&interval=${interval}`),
  });
  const feature = (k: string) => {
    const v = t(`pricing.features.${k}`);
    return v === `pricing.features.${k}` ? k : v;
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("pricing.country")}</span>
          <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-56">
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
        <div className="inline-flex rounded-md border p-0.5" role="group">
          {(["MONTH", "YEAR"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={`rounded px-3 py-1.5 text-xs ${interval === i ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              {t(`settings.billing.interval.${i}`)}
            </button>
          ))}
        </div>
      </div>
      {q.error ? <FormError error={q.error} /> : null}
      <div className="grid gap-4 md:grid-cols-3">
        {q.isLoading || !q.data
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)
          : q.data.plans.map((p) => (
              <div key={p.key} className="flex flex-col gap-4 rounded-lg border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.resolution.available && p.resolution.price.trialDays > 0 ? (
                    <Badge tone="accent">{t("settings.billing.trial", { days: p.resolution.price.trialDays })}</Badge>
                  ) : null}
                </div>
                {p.resolution.available ? (
                  <div>
                    <span className="tabular text-2xl font-semibold">{formatMoney(p.resolution.price.money, locale)}</span>{" "}
                    <span className="text-xs text-muted-foreground">{t(`settings.billing.per.${interval}`)}</span>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">{p.key === "enterprise" ? t("pricing.contactSales") : t("pricing.unavailable")}</div>
                )}
                <ul className="grid gap-2 text-sm">
                  {p.entitlements.map((e) => (
                    <li key={e.featureKey} className="flex items-center gap-2">
                      {e.enabled ? <Check className="size-4 text-success" aria-hidden /> : <Minus className="size-4 text-muted-foreground" aria-hidden />}
                      <span>{feature(e.featureKey)}</span>
                      <span className="tabular ms-auto text-xs text-muted-foreground">
                        {e.enabled ? (e.limitValue ? formatNumber(Number(e.limitValue), locale) : t("pricing.unlimited")) : t("pricing.notIncluded")}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-auto" variant={p.resolution.available ? "default" : "secondary"}>
                  <Link href={`/${locale}/sign-up`}>{t("pricing.getStarted")}</Link>
                </Button>
              </div>
            ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("pricing.taxNote")}</p>
    </div>
  );
}
