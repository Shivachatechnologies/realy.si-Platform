"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Lock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, usePrefetchMessages } from "@/i18n/client";
import { formatMoney, formatNumber } from "@/i18n/format";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { isLimitKey, type LimitKey } from "@/server/modules/entitlements/catalog";
import { addonLabelKey, featureLabelKey, formatLimitValue, limitLabelKey, planNameKey } from "./format";

export interface WireMoney {
  amountMinor: string;
  currency: string;
}

/** GET /api/v1/organizations/:orgId/entitlements (dates as ISO strings). */
export interface OverviewWire {
  organizationId: string;
  state: "subscribed" | "past_due" | "trial" | "trial_expired";
  plan: string;
  planName: string;
  subscription: { id: string; planKey: string; planName: string; status: string; interval: "MONTH" | "YEAR"; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; lastPaymentFailedAt?: string | null; lastPaymentSucceededAt?: string | null } | null;
  trialEndsAt: string | null;
  window: { start: string; end: string };
  enforced: boolean;
  features: Record<string, boolean>;
  usage: { key: LimitKey; unit: string; metered: boolean; used: number; planLimit: number | null; addon: number; limit: number | null; ratio: number | null; addons: string[] }[];
  offers: { key: string; name: string; description: string; monthly: WireMoney | null; annual: WireMoney | null; indicative: boolean }[];
  addons: { key: string; limit: string; quantity: number; price: WireMoney; requires: string | null; maxPacks: number }[];
  billing: { configured: boolean; countryConfirmed: boolean; hasBillingAccount: boolean; canManage: boolean };
}

export const overviewQueryKey = (orgId: string) => ["entitlements", orgId] as const;
export const useEntitlementOverview = (orgId: string, initialData?: OverviewWire) =>
  useQuery({ queryKey: overviewQueryKey(orgId), queryFn: () => api<OverviewWire>(`/api/v1/organizations/${orgId}/entitlements`), initialData, staleTime: 30_000 });

export interface UpgradePromptProps {
  orgId: string;
  reason: "plan_feature_locked" | "plan_limit_reached" | "plan_trial_expired";
  feature?: string | null;
  limitKey?: string | null;
  used?: number | null;
  limit?: number | null;
  requiredPlan?: string | null;
  /** Server-rendered overview (avoids a client round-trip on full pages). */
  initial?: OverviewWire;
  variant?: "inline" | "page";
  className?: string;
}

/** Plan details carried by plan_feature_locked / plan_limit_reached / plan_trial_expired API errors, or null. */
export function upgradePropsFromError(err: unknown): UpgradePromptProps | null {
  if (!(err instanceof ApiError)) return null;
  const d = err.details ?? {};
  const reason = d.reason;
  if (reason !== "plan_feature_locked" && reason !== "plan_limit_reached" && reason !== "plan_trial_expired") return null;
  if (typeof d.organizationId !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return { orgId: d.organizationId, reason, feature: str(d.feature), limitKey: str(d.limitKey), used: num(d.used), limit: num(d.limit), requiredPlan: str(d.requiredPlan) };
}

/**
 * Upgrade prompt for a locked feature, a reached limit or an ended trial: what is blocked, usage vs limit, the
 * current plan, the plan that unlocks it (with its real price) and upgrade buttons (monthly / annual) plus a
 * matching add-on pack where one exists. Checkout runs through Stripe; without Stripe it says credentials are needed.
 */
export function UpgradePrompt(props: UpgradePromptProps) {
  const { t, locale } = useI18n();
  usePrefetchMessages("errors.reasons"); // specific reasons for failed upgrade actions (lazy subtree)
  const q = useEntitlementOverview(props.orgId, props.initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const o = q.data;
  const limitKey = props.limitKey && isLimitKey(props.limitKey) ? props.limitKey : null;
  const row = limitKey ? o?.usage.find((u) => u.key === limitKey) : undefined;
  const used = props.used ?? row?.used ?? null;
  const limit = props.limit ?? row?.limit ?? null;
  const requiredKey = props.requiredPlan ?? null;
  const target = o?.offers.find((p) => p.key === requiredKey) ?? null;
  const addons = limitKey && o ? o.addons.filter((a) => a.limit === limitKey && (!a.requires || o.features[a.requires])) : [];
  const featureName = props.feature ? t(featureLabelKey(props.feature)) : null;
  const limitName = limitKey ? t(limitLabelKey(limitKey)) : null;

  const title =
    props.reason === "plan_trial_expired"
      ? t("upgrade.trialExpiredTitle")
      : props.reason === "plan_limit_reached"
        ? t("upgrade.limitTitle", { limit: limitName ?? "" })
        : t("upgrade.featureTitle", { feature: featureName ?? "" });

  const fail = (e: unknown) => {
    const reason = e instanceof ApiError && typeof e.details?.reason === "string" ? e.details.reason : null;
    const specific = reason ? t(`errors.reasons.${reason}`) : "";
    const code = e instanceof ApiError ? t(`errors.${e.code}`) : t("errors.internal_error");
    setError(reason && specific !== `errors.reasons.${reason}` ? specific : code);
  };

  const upgrade = async (interval: "MONTH" | "YEAR") => {
    if (!o || !target) return;
    setBusy(interval);
    setError(null);
    try {
      if (o.subscription) {
        await api(`/api/v1/organizations/${props.orgId}/billing/change-plan`, { body: { planKey: target.key, interval } });
        setPending(true);
      } else {
        const r = await api<{ url: string }>(`/api/v1/organizations/${props.orgId}/checkout/session`, { body: { planKey: target.key, interval, locale } });
        window.location.assign(r.url);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const buyAddon = async (addonKey: string) => {
    setBusy(addonKey);
    setError(null);
    try {
      const r = await api<{ url: string }>(`/api/v1/organizations/${props.orgId}/billing/addons`, { body: { addonKey, packs: 1, locale } });
      window.location.assign(r.url);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const page = props.variant === "page";
  return (
    <section
      aria-live="polite"
      className={cn(
        "relative overflow-hidden rounded-xl border border-primary/25 bg-surface text-sm shadow-elev-1",
        page ? "p-6 sm:p-8" : "p-4",
        props.className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)] opacity-60" />
      <div className="relative grid gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Lock className="size-4" aria-hidden />
          </span>
          <div className="grid min-w-0 gap-1">
            <h2 className={cn("font-medium text-foreground", page ? "font-display text-2xl" : "text-[15px]")}>{title}</h2>
            <p className="text-muted-foreground">
              {props.reason === "plan_trial_expired"
                ? t("upgrade.trialExpiredBody")
                : props.reason === "plan_limit_reached" && limitKey
                  ? used !== null && limit !== null
                    ? t("upgrade.limitBody", { used: formatLimitValue(t, locale, limitKey, used), limit: formatLimitValue(t, locale, limitKey, limit) })
                    : t("upgrade.limitBodyShort")
                  : t("upgrade.featureBody", { plan: requiredKey ? t(planNameKey(requiredKey)) : t("upgrade.higherPlan") })}
            </p>
          </div>
        </div>

        {limitKey && used !== null && limit !== null && limit > 0 ? (
          <div className="grid gap-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} aria-label={limitName ?? undefined}>
              <div className="h-full rounded-full bg-danger" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
            </div>
          </div>
        ) : null}

        {q.isLoading ? <Skeleton className="h-20 rounded-lg" /> : null}
        {q.error ? <Notice tone="warning">{t("upgrade.loadFailed")}</Notice> : null}

        {o ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t("upgrade.currentPlan")}</span>
              <Badge tone="neutral">{t(planNameKey(o.plan))}</Badge>
              {o.state === "trial" ? <Badge tone="info">{t("billing.states.trial")}</Badge> : null}
              {target ? (
                <>
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                  <span>{t("upgrade.unlocksWith")}</span>
                  <Badge tone="brand">{t(planNameKey(target.key))}</Badge>
                </>
              ) : null}
            </div>

            {pending ? <Notice tone="success">{t("upgrade.pendingChange")}</Notice> : null}
            {!o.billing.configured ? <Notice tone="warning" title={t("upgrade.notConfiguredTitle")}>{t("upgrade.notConfigured")}</Notice> : null}
            {o.billing.configured && !o.billing.canManage ? <Notice>{t("upgrade.askAdmin")}</Notice> : null}
            {o.billing.configured && o.billing.canManage && !o.subscription && !o.billing.countryConfirmed ? (
              <Notice
                action={
                  <Link href={`/${locale}/settings/billing`} className="text-xs font-medium text-primary hover:underline">
                    {t("upgrade.goToBilling")}
                  </Link>
                }
              >
                {t("upgrade.confirmCountry")}
              </Notice>
            ) : null}

            {target && !pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="luminous"
                  disabled={!o.billing.configured || !o.billing.canManage || (!o.subscription && !o.billing.countryConfirmed) || busy !== null || !target.monthly}
                  aria-busy={busy === "MONTH"}
                  onClick={() => upgrade("MONTH")}
                >
                  <Sparkles aria-hidden />
                  {target.monthly ? t("upgrade.upgradeMonthly", { plan: t(planNameKey(target.key)), price: formatMoney(target.monthly, locale) }) : t(planNameKey(target.key))}
                </Button>
                {target.annual ? (
                  <Button
                    variant="secondary"
                    disabled={!o.billing.configured || !o.billing.canManage || (!o.subscription && !o.billing.countryConfirmed) || busy !== null}
                    aria-busy={busy === "YEAR"}
                    onClick={() => upgrade("YEAR")}
                  >
                    {t("upgrade.upgradeAnnual", { price: formatMoney(target.annual, locale) })}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {target?.indicative ? <p className="text-xs text-muted-foreground">{t("planCatalog.indicative")}</p> : null}

            {addons.length && props.reason === "plan_limit_reached" ? (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{target ? t("upgrade.orAddon") : t("upgrade.addonOnly")}</p>
                <div className="flex flex-wrap gap-2">
                  {addons.map((a) => (
                    <Button
                      key={a.key}
                      variant="soft"
                      size="sm"
                      disabled={!o.billing.configured || !o.billing.canManage || !o.billing.countryConfirmed || busy !== null}
                      aria-busy={busy === a.key}
                      onClick={() => buyAddon(a.key)}
                    >
                      {t("upgrade.buyAddon", { addon: t(addonLabelKey(a.key)), price: formatMoney(a.price, locale) })}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {!target && props.reason !== "plan_trial_expired" && !addons.length ? <p className="text-xs text-muted-foreground">{t("upgrade.contactUs")}</p> : null}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Link href={`/${locale}/settings/billing`} className="text-primary hover:underline">
                {t("upgrade.goToBilling")}
              </Link>
              <Link href={`/${locale}/pricing`} className="text-muted-foreground hover:text-foreground hover:underline">
                {t("upgrade.comparePlans")}
              </Link>
            </div>
          </div>
        ) : null}

        {error ? <Notice tone="danger">{error}</Notice> : null}
        {o && limitKey && row && !page ? (
          <p className="text-[11px] text-muted-foreground tabular">
            {t("upgrade.usageLine", { used: formatNumber(row.used, locale), limit: row.limit === null ? t("planCatalog.unlimited") : formatNumber(row.limit, locale) })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Small lock marker for navigation items whose page needs a higher plan. */
export function PlanLockBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("ms-auto inline-flex items-center text-muted-foreground", className)} title={t("upgrade.lockedNav")}>
      <Lock className="size-3" aria-hidden />
      <span className="sr-only">{t("upgrade.lockedNav")}</span>
    </span>
  );
}
