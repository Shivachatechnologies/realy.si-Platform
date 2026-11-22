"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Ban, BadgeCheck, CheckCircle2, CircleDashed, Clock, KeyRound, Lock, Search, ShieldCheck, ShieldQuestion, Sparkles } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Stagger, StaggerItem } from "@/components/motion";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { PROVIDER_CATEGORIES } from "@/server/modules/integrations/catalog";

/**
 * Connection state shown in the marketplace. "verified" is the only state that reads as connected: the credentials were
 * accepted by the provider (connection test, scheduled health check or a successful call) and no error is pending.
 */
export type MarketplaceState =
  | "verified"
  | "configured"
  | "unverified"
  | "failing"
  | "ready"
  | "credentials_required"
  | "platform_setup"
  | "awaiting_docs"
  /** Platform-managed provider (AI, research, creative, voice, video, telephony) running on the platform's account. */
  | "platform_available"
  /** Platform-managed provider the platform has not configured yet. */
  | "platform_unavailable"
  /** Customer-connected provider switched off platform-wide by the admin. */
  | "disabled"
  /** Acts in the customer's own account but has no OAuth sign-in yet: customers cannot connect it. */
  | "unavailable";

export interface MarketplaceItem {
  key: string;
  name: string;
  category: string;
  authType: string;
  status: "CONNECTED" | "ERROR" | null;
  account: string | null;
  configured: boolean;
  /** Derived on the server from the connection row (see MarketplaceState). */
  state?: MarketplaceState;
  /** Capability keys (integrations.capabilities.*) this provider unlocks. */
  capabilities?: string[];
  /** Pre-formatted "verified …" time (server locale + time zone), when verified. */
  verifiedLabel?: string | null;
  /** Plan restriction of the provider's category: cheapest plan that unlocks it, and whether this organization's plan lacks it. */
  plan?: { minPlan: string; locked: boolean };
  /** How the customer gets this provider (catalog customerConnectMode): "oauth" = Connect with their own account. */
  connect?: "platform" | "oauth" | "unavailable";
  /** The customer's own account was set up by the Realy team (admin app), not by the customer's Connect login. */
  setupByRealy?: boolean;
}

type Filter = "all" | "connected" | "attention" | "available";

const STATE_STYLE: Record<MarketplaceState, { tone: string; icon: typeof CheckCircle2 }> = {
  verified: { tone: "border-success/30 bg-success/8 text-success", icon: CheckCircle2 },
  configured: { tone: "border-success/30 bg-success/8 text-success", icon: BadgeCheck },
  unverified: { tone: "border-warning/40 bg-warning/8 text-warning", icon: ShieldQuestion },
  failing: { tone: "border-danger/40 bg-danger/8 text-danger", icon: AlertTriangle },
  ready: { tone: "border-[var(--world-line)] bg-[var(--world-soft)] text-foreground", icon: Sparkles },
  credentials_required: { tone: "bg-muted text-muted-foreground", icon: KeyRound },
  platform_setup: { tone: "bg-muted text-muted-foreground", icon: CircleDashed },
  awaiting_docs: { tone: "bg-muted text-muted-foreground", icon: Clock },
  platform_available: { tone: "border-success/30 bg-success/8 text-success", icon: ShieldCheck },
  platform_unavailable: { tone: "bg-muted text-muted-foreground", icon: Clock },
  disabled: { tone: "bg-muted text-muted-foreground", icon: Ban },
  unavailable: { tone: "bg-muted text-muted-foreground", icon: Clock },
};

/** Fallback for callers that do not pass `state` (older call sites): derive it from status + configuration. */
export function itemState(i: MarketplaceItem): MarketplaceState {
  if (i.state) return i.state;
  if (i.status === "ERROR") return "failing";
  if (i.status === "CONNECTED") return "unverified";
  if (i.authType === "oauth2" && !i.configured) return "platform_setup";
  if (i.authType === "api_key") return "credentials_required";
  return "ready";
}

const inFilter = (s: MarketplaceState, f: Filter) =>
  f === "all" ||
  (f === "connected" && (s === "verified" || s === "configured")) ||
  (f === "attention" && (s === "failing" || s === "unverified")) ||
  (f === "available" && (s === "ready" || s === "credentials_required" || s === "platform_setup" || s === "platform_available"));

const isPlatformState = (s: MarketplaceState) => s === "platform_available" || s === "platform_unavailable";

/** Searchable, filterable integrations marketplace: readiness filters, state per provider and what each one unlocks. */
export function Marketplace({ locale, items, initialView }: { locale: string; items: MarketplaceItem[]; initialView: "all" | "connected" }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<Filter>(initialView === "connected" ? "connected" : "all");
  const withState = useMemo(() => items.map((i) => ({ ...i, s: itemState(i) })), [items]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: withState.length, connected: 0, attention: 0, available: 0 };
    for (const i of withState) for (const f of ["connected", "attention", "available"] as const) if (inFilter(i.s, f)) c[f]++;
    return c;
  }, [withState]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return withState.filter(
      (i) =>
        (!category || i.category === category) &&
        inFilter(i.s, filter) &&
        (!needle ||
          i.name.toLowerCase().includes(needle) ||
          i.key.includes(needle) ||
          t(`integrations.providers.${i.key}.description`).toLowerCase().includes(needle) ||
          (i.capabilities ?? []).some((c) => t(`integrations.capabilities.${c}`).toLowerCase().includes(needle))),
    );
  }, [withState, q, category, filter, t]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("integrations.marketplace.filters.all") },
    { key: "connected", label: t("integrations.marketplace.filters.connected") },
    { key: "attention", label: t("integrations.marketplace.filters.attention") },
    { key: "available", label: t("integrations.marketplace.filters.available") },
  ];

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 rounded-3xl border bg-surface/80 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t("integrations.view")}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-colors sm:min-h-9",
                filter === f.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", filter === f.key ? "bg-background/20" : "bg-muted")}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="relative block">
            <span className="sr-only">{t("integrations.search")}</span>
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder={t("integrations.marketplace.searchPlaceholder")} className="min-h-11 ps-9 sm:min-h-9" />
          </label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("integrations.category")} className="min-h-11 sm:min-h-9">
            <option value="">{t("integrations.allCategories")}</option>
            {PROVIDER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`integrations.categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-3xl border border-dashed p-10 text-center">
          <p className="font-medium">{filter === "connected" && !q && !category ? t("integrations.noneConnected") : t("common.noResults")}</p>
          {filter !== "all" ? (
            <button type="button" className="min-h-11 text-sm text-primary hover:underline" onClick={() => setFilter("all")}>
              {t("integrations.marketplace.showAll")}
            </button>
          ) : null}
        </div>
      ) : (
        PROVIDER_CATEGORIES.filter((c) => shown.some((i) => i.category === c)).map((c, idx) => {
          const group = shown.filter((i) => i.category === c);
          return (
            <section key={c} className="grid gap-3" aria-labelledby={`cat-${c}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2">
                <span aria-hidden className="font-mono text-xs text-muted-foreground tabular-nums">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                {/* Long single-word categories (de: "Automatisierungsplattformen") must wrap, not widen the page. */}
                <h2 id={`cat-${c}`} className="min-w-0 font-display text-xl tracking-tight hyphens-auto [overflow-wrap:anywhere]">
                  {t(`integrations.categories.${c}`)}
                </h2>
                <span className="ms-auto text-xs text-muted-foreground">{t("integrations.marketplace.categoryCount", { count: group.length })}</span>
              </div>
              <Stagger as="ul" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((i) => (
                  <StaggerItem as="li" key={i.key} className="min-w-0">
                    <ProviderCard locale={locale} item={i} state={i.s} />
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Deterministic hue per provider for its monogram tile (no brand logos are bundled). */
function hueOf(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function ProviderCard({ locale, item: i, state }: { locale: string; item: MarketplaceItem; state: MarketplaceState }) {
  const t = useT();
  const style = STATE_STYLE[state];
  const Icon = style.icon;
  const caps = i.capabilities ?? [];
  const hue = hueOf(i.key);
  const footer =
    state === "verified" || state === "configured" ? (i.verifiedLabel ?? i.account ?? "") : state === "failing" || state === "unverified" ? (i.account ?? "") : i.plan?.locked ? t("integrations.marketplace.planLockedHint", { plan: t(`integrations.marketplace.plans.${i.plan.minPlan}`) }) : t(`integrations.marketplace.hints.${state}`);
  return (
    <Link
      href={`/${locale}/integrations/${i.key}`}
      className={cn(
        "group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border bg-surface p-4 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-[var(--world-line)] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        state === "failing" && "border-danger/40",
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -end-10 -top-10 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60" style={{ background: `oklch(0.7 0.12 ${hue} / 0.35)` }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold uppercase text-white shadow-inner"
            style={{ background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.48 0.12 ${(hue + 40) % 360}))` }}
          >
            {i.name.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{i.name}</p>
            <p className="text-xs text-muted-foreground">
              {isPlatformState(state) ? t("integrations.platform.managedBy") : i.setupByRealy ? t("integrations.ownAccount.setUpByRealy") : i.connect === "oauth" || i.authType === "oauth2" ? t("integrations.platform.oauthLogin") : t("integrations.platform.managedBy")}
            </p>
          </div>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", style.tone)}>
          <Icon aria-hidden className="size-3" />
          {t(`integrations.marketplace.states.${state}`)}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{t(`integrations.providers.${i.key}.description`)}</p>
      {i.plan && i.plan.minPlan !== "starter" ? (
        <p className={cn("inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", i.plan.locked ? "border-warning/40 bg-warning/8 text-warning" : "text-muted-foreground")}>
          <Lock aria-hidden className="size-3" />
          {i.plan.locked ? t("integrations.marketplace.planLocked", { plan: t(`integrations.marketplace.plans.${i.plan.minPlan}`) }) : t("integrations.marketplace.planIncluded", { plan: t(`integrations.marketplace.plans.${i.plan.minPlan}`) })}
        </p>
      ) : null}
      {caps.length ? (
        <div className="grid gap-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{state === "verified" || state === "configured" || state === "platform_available" ? t("integrations.marketplace.powering") : t("integrations.marketplace.unlocks")}</p>
          <ul className="flex flex-wrap gap-1">
            {caps.slice(0, 4).map((c) => (
              <li key={c} className="rounded-md bg-[var(--world-soft)] px-1.5 py-0.5 text-xs">
                {t(`integrations.capabilities.${c}`)}
              </li>
            ))}
            {caps.length > 4 ? <li className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">+{caps.length - 4}</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{footer}</span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
          {t(`integrations.marketplace.cta.${state}`)}
          <ArrowUpRight aria-hidden className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100 motion-reduce:transition-none" />
        </span>
      </div>
    </Link>
  );
}
