"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { ArrowRight, Check, Minus } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/client";
import { displayName, formatMoney } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  ANNUAL_MONTHS_CHARGED,
  FEATURES,
  FEATURE_GROUPS,
  FEATURE_KEYS,
  LIMITS,
  LIMIT_KEYS,
  PLAN_KEYS,
  PLAN_META,
  PLAN_PRICES,
  TRIAL_DAYS,
  featureDefault,
  isFeatureKey,
  isLimitKey,
  limitDefault,
  type FeatureKey,
  type LimitKey,
  type PlanKey,
} from "@/server/modules/entitlements/catalog";
import { featureLabelKey, formatLimitValue, limitLabelKey, planNameKey } from "@/components/billing/format";

export interface PublicPlan {
  key: string;
  name: string;
  description?: string | null;
  entitlements: { featureKey: string; enabled: boolean; limitValue: string | null }[];
  resolution: { available: true; price: { money: { amountMinor: string; currency: string }; trialDays: number } } | { available: false; reason: string };
}

interface PlanView {
  key: PlanKey;
  price: { amountMinor: string; currency: string };
  /** Catalog list price shown because the market has no price yet. */
  indicative: boolean;
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number | null>;
}

const HIGHLIGHT_LIMITS: LimitKey[] = ["agents.max", "ai.credits.month", "crm.contacts.max", "companies.max", "seats.max"];

/** Database entitlements of a public plan over the catalog defaults (single source: entitlements/catalog.ts). */
function planView(key: PlanKey, interval: "MONTH" | "YEAR", fromApi: PublicPlan | undefined): PlanView {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureDefault(key, k)])) as Record<FeatureKey, boolean>;
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, limitDefault(key, k)])) as Record<LimitKey, number | null>;
  for (const e of fromApi?.entitlements ?? []) {
    if (isFeatureKey(e.featureKey)) features[e.featureKey] = e.enabled;
    else if (isLimitKey(e.featureKey)) {
      const highCost = "highCost" in LIMITS[e.featureKey];
      limits[e.featureKey] = !e.enabled ? 0 : e.limitValue === null ? (highCost ? limitDefault(key, e.featureKey) : null) : Number(e.limitValue);
    }
  }
  const resolved = fromApi?.resolution.available ? fromApi.resolution.price.money : null;
  const list = PLAN_PRICES[key].USD * (interval === "YEAR" ? ANNUAL_MONTHS_CHARGED : 1);
  return { key, price: resolved ?? { amountMinor: String(list), currency: "USD" }, indicative: !resolved, features, limits };
}

/**
 * Public plans: Starter / Growth / Scale with real market prices (pricing catalog, resolved server-side per billing
 * country and interval), monthly/annual toggle and the full comparison table — all from the entitlement catalog.
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
  const plans = useMemo(() => PLAN_KEYS.map((k) => planView(k, interval, q.data?.plans.find((p) => p.key === k))), [q.data, interval]);
  const value = (p: PlanView, k: LimitKey) => formatLimitValue(t, locale, k, p.limits[k]);

  return (
    <div className="grid gap-12">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex self-start rounded-full border bg-surface/80 p-1 shadow-elev-1" role="group" aria-label={t("planCatalog.billingInterval")}>
          {(["MONTH", "YEAR"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setInterval(i)}
              className={cn("min-h-10 rounded-full px-5 text-[13px] transition-colors", interval === i ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`billing.interval.${i}`)}
              {i === "YEAR" ? <span className={cn("ms-2 rounded-full px-2 py-0.5 text-[11px]", interval === i ? "bg-background/20" : "bg-accent text-accent-foreground")}>{t("planCatalog.annualSave")}</span> : null}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {q.isLoading && !q.data
          ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-[30rem] rounded-3xl" />)
          : plans.map((p) => {
              const featured = PLAN_META[p.key].highlight;
              const news = FEATURE_KEYS.filter((k) => FEATURES[k].minPlan === p.key && p.features[k]).slice(0, 6);
              const prev = PLAN_KEYS[PLAN_KEYS.indexOf(p.key) - 1];
              return (
                <article
                  key={p.key}
                  className={cn(
                    "relative flex flex-col gap-6 overflow-hidden rounded-3xl border bg-surface/90 p-6 shadow-elev-2 backdrop-blur sm:p-7",
                    featured && "border-gradient shadow-float",
                  )}
                >
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-display text-[1.9rem] leading-none">{t(planNameKey(p.key))}</h2>
                      {featured ? <span className="rounded-full bg-brand-gradient px-2.5 py-1 text-[11px] font-medium text-primary-foreground">{t("planCatalog.mostPopular")}</span> : null}
                    </div>
                    <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t(`planCatalog.plans.${p.key}.audience`)}</p>
                  </div>
                  <div className="grid gap-1">
                    <div className="flex items-baseline gap-2">
                      <span className="tabular text-numeral font-semibold tracking-tight">{formatMoney(p.price, locale)}</span>
                      <span className="text-[12.5px] text-muted-foreground">{t(`billing.per.${interval}`)}</span>
                    </div>
                    {interval === "YEAR" ? <span className="text-[12px] text-success">{t("planCatalog.annualNote")}</span> : null}
                    {p.indicative ? <span className="text-[11.5px] text-muted-foreground">{t("planCatalog.indicative")}</span> : null}
                  </div>
                  <ul className="grid gap-2.5 border-t pt-5 text-[13.5px]">
                    {HIGHLIGHT_LIMITS.map((k) => (
                      <li key={k} className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t(limitLabelKey(k))}</span>
                        <span className="tabular font-medium">{value(p, k)}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="grid gap-2.5 text-[13.5px]">
                    {prev ? <li className="text-[12px] font-medium text-muted-foreground">{t("planCatalog.everythingIn", { plan: t(planNameKey(prev)) })}</li> : null}
                    {news.map((k) => (
                      <li key={k} className="flex items-start gap-2.5">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                          <Check className="size-3" aria-hidden />
                        </span>
                        <span>{t(featureLabelKey(k))}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/${locale}/sign-up`}
                    className={cn(
                      "press mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-full text-[14px] font-medium transition-transform hover:scale-[1.01] motion-reduce:transition-none",
                      featured ? "bg-foreground text-background" : "border hover:bg-muted",
                    )}
                  >
                    {t("planCatalog.startTrial", { days: TRIAL_DAYS })}
                    <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </article>
              );
            })}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {t("planCatalog.trialNote", { days: TRIAL_DAYS })} {t("pricing.taxNote")}
      </p>

      <section className="grid gap-4" aria-labelledby="compare-plans">
        <div className="grid gap-1">
          <h2 id="compare-plans" className="font-display text-display-md">{t("planCatalog.compareTitle")}</h2>
          <p className="text-[14px] text-muted-foreground">{t("planCatalog.compareLede")}</p>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[40rem] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-3 text-start font-medium text-muted-foreground">{t("planCatalog.feature")}</th>
                {plans.map((p) => (
                  <th key={p.key} scope="col" className="w-[22%] py-3 text-center font-display text-[1.15rem] font-normal">
                    {t(planNameKey(p.key))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_GROUPS.map((g) => {
                const limits = LIMIT_KEYS.filter((k) => LIMITS[k].group === g);
                const features = FEATURE_KEYS.filter((k) => FEATURES[k].group === g);
                if (!limits.length && !features.length) return null;
                return (
                  <Fragment key={g}>
                    <tr>
                      <th colSpan={4} scope="colgroup" className="pt-6 pb-2 text-start text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t(`planCatalog.groups.${g}`)}
                      </th>
                    </tr>
                    {limits.map((k) => (
                      <tr key={k} className="border-b border-border/60">
                        <th scope="row" className="py-2.5 text-start font-normal">{t(limitLabelKey(k))}</th>
                        {plans.map((p) => (
                          <td key={p.key} className="tabular py-2.5 text-center">
                            {p.limits[k] === 0 ? <Minus className="mx-auto size-3.5 text-muted-foreground" aria-label={t("pricing.notIncluded")} /> : value(p, k)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {features.map((k) => (
                      <tr key={k} className="border-b border-border/60">
                        <th scope="row" className="py-2.5 text-start font-normal">{t(featureLabelKey(k))}</th>
                        {plans.map((p) => (
                          <td key={p.key} className="py-2.5 text-center">
                            {p.features[k] ? (
                              <Check className="mx-auto size-4 text-success" aria-label={t("pricing.included")} />
                            ) : (
                              <Minus className="mx-auto size-3.5 text-muted-foreground" aria-label={t("pricing.notIncluded")} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-muted-foreground">{t("planCatalog.addonsLede")}</p>
      </section>
    </div>
  );
}
