"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, ExternalLink, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { useI18n } from "@/i18n/client";
import { formatDate, formatMoney } from "@/i18n/format";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useLocationSearch } from "@/lib/use-location-search";
import { FEATURES, FEATURE_GROUPS, FEATURE_KEYS, planRank, type FeatureKey } from "@/server/modules/entitlements/catalog";
import { addonLabelKey, featureLabelKey, formatLimitValue, limitLabelKey, planNameKey } from "./format";
import { overviewQueryKey, useEntitlementOverview, type OverviewWire, type WireMoney } from "./upgrade-prompt";

export interface InvoiceWire {
  id: string;
  number: string | null;
  status: string | null;
  amountDueMinor: string;
  amountPaidMinor: string;
  currency: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/**
 * Billing & usage: current plan and state, a meter for every limit, plan change (monthly / annual), add-on packs,
 * invoices and cancellation. Every action goes through Stripe; changes appear when Stripe's webhook confirms them.
 */
export function BillingOverview({ initial, invoices, invoicesConfigured, timeZone }: { initial: OverviewWire; invoices: InvoiceWire[]; invoicesConfigured: boolean; timeZone: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const search = new URLSearchParams(useLocationSearch());
  const q = useEntitlementOverview(initial.organizationId, initial);
  const o = q.data ?? initial;
  const [interval, setInterval] = useState<"MONTH" | "YEAR">(o.subscription?.interval ?? "MONTH");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const date = (d: string | number) => formatDate(typeof d === "number" ? new Date(d * 1000) : d, locale, timeZone);
  const canBuy = o.billing.configured && o.billing.canManage;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      const reason = e instanceof ApiError && typeof e.details?.reason === "string" ? e.details.reason : null;
      const specific = reason ? t(`errors.reasons.${reason}`) : "";
      setError(reason && specific !== `errors.reasons.${reason}` ? specific : t(e instanceof ApiError ? `errors.${e.code}` : "errors.internal_error"));
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: overviewQueryKey(o.organizationId) });
    router.refresh();
  };

  const choosePlan = (planKey: string) =>
    run(`plan:${planKey}`, async () => {
      if (o.subscription) {
        await api(`/api/v1/organizations/${o.organizationId}/billing/change-plan`, { body: { planKey, interval } });
        setNotice(t("billing.changeRequested"));
        await refresh();
      } else {
        const r = await api<{ url: string }>(`/api/v1/organizations/${o.organizationId}/checkout/session`, { body: { planKey, interval, locale } });
        window.location.assign(r.url);
      }
    });

  const stateTone = o.state === "subscribed" ? "success" : o.state === "trial" ? "info" : "warning";
  const currentKey = o.subscription ? o.plan : null;

  return (
    <div className="grid gap-4">
      {search.get("addon") === "success" ? <Notice tone="success">{t("billing.addonSuccess")}</Notice> : null}
      {search.get("addon") === "canceled" ? <Notice>{t("billing.addonCanceled")}</Notice> : null}
      {!o.billing.configured ? <Notice tone="warning" title={t("upgrade.notConfiguredTitle")}>{t("upgrade.notConfigured")}</Notice> : null}
      {!o.enforced ? <Notice>{t("billing.notEnforced")}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {/* Plan */}
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("billing.plan")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl leading-none">{t(planNameKey(o.plan))}</h2>
              <Badge tone={stateTone}>{t(`billing.states.${o.state}`)}</Badge>
              {o.subscription ? <Badge tone="neutral">{t(`billing.interval.${o.subscription.interval}`)}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {o.state === "trial" && o.trialEndsAt
                ? t("billing.trialEnds", { date: date(o.trialEndsAt) })
                : o.state === "trial_expired"
                  ? t("billing.trialEnded")
                  : o.subscription?.cancelAtPeriodEnd && o.subscription.currentPeriodEnd
                    ? t("billing.cancelsOn", { date: date(o.subscription.currentPeriodEnd) })
                    : o.subscription?.currentPeriodEnd
                      ? t("billing.renews", { date: date(o.subscription.currentPeriodEnd) })
                      : t(`planCatalog.plans.${o.plan}.audience`)}
            </p>
          </div>
          {o.subscription && o.billing.canManage && o.billing.configured ? (
            <div className="flex flex-wrap gap-2">
              {o.subscription.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  aria-busy={busy === "resume"}
                  onClick={() =>
                    run("resume", async () => {
                      await api(`/api/v1/organizations/${o.organizationId}/billing/cancellation`, { body: { cancel: false } });
                      setNotice(t("billing.changeRequested"));
                      await refresh();
                    })
                  }
                >
                  {t("billing.resume")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  aria-busy={busy === "cancel"}
                  onClick={() => {
                    const end = o.subscription?.currentPeriodEnd ? date(o.subscription.currentPeriodEnd) : "";
                    if (!window.confirm(t("billing.cancelConfirm", { date: end }))) return;
                    void run("cancel", async () => {
                      await api(`/api/v1/organizations/${o.organizationId}/billing/cancellation`, { body: { cancel: true } });
                      setNotice(t("billing.changeRequested"));
                      await refresh();
                    });
                  }}
                >
                  {t("billing.cancel")}
                </Button>
              )}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Usage meters */}
      <Card>
        <CardHeader title={t("billing.usageTitle")} description={t("billing.usageWindow", { start: date(o.window.start), end: date(o.window.end) })} />
        <CardBody>
          <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {o.usage.map((u) => {
              const pct = u.ratio === null ? 0 : Math.round(u.ratio * 100);
              const tone = u.ratio !== null && u.ratio >= 1 ? "bg-danger" : u.ratio !== null && u.ratio >= 0.8 ? "bg-warning" : "bg-primary";
              return (
                <li key={u.key} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{t(limitLabelKey(u.key))}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {t("billing.meterOf", { used: formatLimitValue(t, locale, u.key, u.used), limit: formatLimitValue(t, locale, u.key, u.limit) })}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label={t(limitLabelKey(u.key))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <div className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none", tone)} style={{ width: `${u.limit === null ? 0 : Math.max(pct, u.used > 0 ? 2 : 0)}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {u.metered ? <span>{t("billing.resetsMonthly")}</span> : null}
                    {u.addon > 0 ? <span>{t("billing.addonIncluded", { value: formatLimitValue(t, locale, u.key, u.addon) })}</span> : null}
                    {u.ratio !== null && u.ratio >= 1 ? <span className="text-danger">{t("billing.atLimit")}</span> : u.ratio !== null && u.ratio >= 0.8 ? <span className="text-warning">{t("billing.nearLimit")}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      {/* Change plan */}
      <Card>
        <CardHeader
          title={o.subscription ? t("billing.changePlan") : t("billing.choosePlan")}
          actions={
            <div className="inline-flex rounded-full border p-0.5" role="group" aria-label={t("planCatalog.billingInterval")}>
              {(["MONTH", "YEAR"] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={interval === i}
                  onClick={() => setInterval(i)}
                  className={cn("min-h-8 rounded-full px-3 text-xs", interval === i ? "bg-foreground font-medium text-background" : "text-muted-foreground")}
                >
                  {t(`billing.interval.${i}`)}
                  {i === "YEAR" ? <span className="ms-1 text-[10px] opacity-80">{t("planCatalog.annualSave")}</span> : null}
                </button>
              ))}
            </div>
          }
        />
        <CardBody className="grid gap-3">
          {!o.subscription && o.billing.configured && !o.billing.countryConfirmed ? <Notice>{t("upgrade.confirmCountry")}</Notice> : null}
          <div className="grid gap-3 md:grid-cols-3">
            {o.offers.map((p) => {
              const price: WireMoney | null = interval === "YEAR" ? p.annual : p.monthly;
              const current = currentKey === p.key && o.subscription?.interval === interval;
              const direction = currentKey ? Math.sign(planRank(p.key) - planRank(currentKey)) : 1;
              return (
                <div key={p.key} className={cn("grid content-start gap-3 rounded-lg border p-4", current && "border-primary/50 bg-accent/30")}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{t(planNameKey(p.key))}</h3>
                    {current ? <Badge tone="success">{t("billing.current")}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t(`planCatalog.plans.${p.key}.audience`)}</p>
                  <p className="tabular text-xl font-semibold">
                    {price ? formatMoney(price, locale) : "—"} <span className="text-xs font-normal text-muted-foreground">{t(`billing.per.${interval}`)}</span>
                  </p>
                  {o.billing.canManage ? (
                    <Button
                      variant={direction > 0 ? "default" : "secondary"}
                      size="sm"
                      disabled={current || !canBuy || !price || busy !== null || (!o.subscription && !o.billing.countryConfirmed)}
                      aria-busy={busy === `plan:${p.key}`}
                      onClick={() => choosePlan(p.key)}
                    >
                      {current ? t("billing.current") : direction > 0 ? t("billing.upgradeTo", { plan: t(planNameKey(p.key)) }) : direction < 0 ? t("billing.downgradeTo", { plan: t(planNameKey(p.key)) }) : t("billing.switchInterval")}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {o.offers.some((p) => p.indicative) ? <p className="text-xs text-muted-foreground">{t("planCatalog.indicative")}</p> : null}
          {!o.billing.canManage ? <p className="text-xs text-muted-foreground">{t("upgrade.askAdmin")}</p> : null}
        </CardBody>
      </Card>

      {/* Add-ons */}
      <Card>
        <CardHeader title={t("billing.addonsTitle")} description={t("billing.addonsHint")} />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {o.addons.map((a) => {
              const locked = a.requires !== null && !o.features[a.requires];
              return (
                <li key={a.key} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium">{t(addonLabelKey(a.key))}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(a.price, locale)}
                      {locked && a.requires ? ` · ${t("billing.requiresFeature", { feature: t(featureLabelKey(a.requires)) })}` : ""}
                    </span>
                  </div>
                  <Button
                    variant="soft"
                    size="sm"
                    disabled={locked || !canBuy || !o.billing.countryConfirmed || o.state === "trial_expired" || busy !== null}
                    aria-busy={busy === a.key}
                    onClick={() =>
                      run(a.key, async () => {
                        const r = await api<{ url: string }>(`/api/v1/organizations/${o.organizationId}/billing/addons`, { body: { addonKey: a.key, packs: 1, locale } });
                        window.location.assign(r.url);
                      })
                    }
                  >
                    {locked ? <Lock aria-hidden /> : null}
                    {t("billing.buy")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      {/* Included features */}
      <Card>
        <CardHeader title={t("billing.featuresTitle")} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {FEATURE_GROUPS.map((g) => {
            const keys = FEATURE_KEYS.filter((k) => FEATURES[k].group === g);
            if (!keys.length) return null;
            return (
              <div key={g} className="grid content-start gap-1.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`planCatalog.groups.${g}`)}</h3>
                <ul className="grid gap-1 text-sm">
                  {keys.map((k: FeatureKey) => (
                    <li key={k} className={cn("flex items-center gap-2", !o.features[k] && "text-muted-foreground")}>
                      {o.features[k] ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <Lock className="size-3.5 shrink-0" aria-hidden />}
                      <span>{t(featureLabelKey(k))}</span>
                      {!o.features[k] ? <span className="ms-auto text-[11px]">{t(planNameKey(FEATURES[k].minPlan))}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader title={t("billing.invoices")} />
        <CardBody>
          {!invoicesConfigured ? (
            <p className="text-sm text-muted-foreground">{t("upgrade.notConfigured")}</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("billing.noInvoices")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 text-start font-medium">{t("billing.invoiceCols.number")}</th>
                    <th className="py-2 text-start font-medium">{t("billing.invoiceCols.date")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.invoiceCols.amount")}</th>
                    <th className="py-2 text-start font-medium ps-4">{t("billing.invoiceCols.status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2 font-mono text-xs" dir="ltr">{i.number ?? i.id.slice(-8)}</td>
                      <td className="py-2">{date(i.created)}</td>
                      <td className="tabular py-2 text-end">{formatMoney({ amountMinor: i.amountDueMinor, currency: i.currency }, locale)}</td>
                      <td className="py-2 ps-4">
                        <Badge tone={i.status === "paid" ? "success" : i.status === "open" ? "warning" : "neutral"}>{i.status ?? "—"}</Badge>
                      </td>
                      <td className="py-2 text-end">
                        <span className="inline-flex gap-2">
                          {i.hostedInvoiceUrl ? (
                            <a href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <ExternalLink className="size-3" aria-hidden />
                              {t("billing.view")}
                            </a>
                          ) : null}
                          {i.invoicePdf ? (
                            <a href={i.invoicePdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <Download className="size-3" aria-hidden />
                              PDF
                            </a>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
