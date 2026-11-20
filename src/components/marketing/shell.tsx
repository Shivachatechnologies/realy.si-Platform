import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";
import type { AppLocale } from "@/i18n/config";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { requireOrgContext } from "@/server/workspace";
import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Aurora } from "@/components/motion/aurora";
import { MARKETING_TABS, MarketingTabs, type MarketingTab } from "./marketing-tabs";

export type MarketingContext = Awaited<ReturnType<typeof loadMarketing>>;

/** Viewer, company and marketing capabilities for a page; `blocked` is set when the page cannot render its content. */
export async function loadMarketing() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) return { locale, t, viewer, org, company: null, blocked: "no_company" as const };
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRunAgents] = await Promise.all([
    can(viewer.ctx, "marketing.read", chain),
    can(viewer.ctx, "marketing.manage", chain),
    can(viewer.ctx, "agents.run", chain),
  ]);
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}/marketing`;
  return {
    locale,
    t,
    viewer,
    org,
    company,
    canRead,
    canManage,
    canRunAgents: canRunAgents && canManage,
    aiReady: aiConfigured(),
    base,
    tz: company.timezone ?? "UTC",
    blocked: canRead ? null : ("forbidden" as const),
  };
}

export function tabLabels(t: Translate) {
  return Object.fromEntries(MARKETING_TABS.map((k) => [k, t(`marketing.tabs.${k}`)])) as Record<MarketingTab, string>;
}

/** Page frame: title, subtitle, tabs and the no-company / forbidden states. */
export function MarketingShell({
  locale,
  t,
  tab,
  title,
  subtitle,
  actions,
  blocked,
  back,
  children,
}: {
  locale: AppLocale;
  t: Translate;
  tab: MarketingTab;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  blocked?: "no_company" | "forbidden" | null;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="relative mx-auto grid w-full max-w-[1400px] gap-4">
      <Aurora />
      {back ? (
        <Link href={back.href} className="text-xs text-muted-foreground hover:underline">
          <span className="rtl:hidden">←</span>
          <span className="hidden rtl:inline">→</span> {back.label}
        </Link>
      ) : null}
      <PageHeader eyebrow={t("marketing.studio.eyebrow")} icon={<Megaphone />} title={title} description={subtitle} actions={actions} />
      <MarketingTabs locale={locale} active={tab} labels={tabLabels(t)} />
      {blocked === "no_company" ? (
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      ) : blocked === "forbidden" ? (
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      ) : (
        children
      )}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "success" | "danger" }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : ""}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/** Page-number pagination that keeps the other search params. */
export function Pager({ path, params, page, total, pageSize, t }: { path: string; params: Record<string, string | undefined>; page: number; total: number; pageSize: number; t: Translate }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => !!e[1]));
    return `${path}?${q}`;
  };
  return (
    <nav className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs" aria-label={t("marketing.common.pagination")}>
      <span className="text-muted-foreground">{t("marketing.common.pageOf", { page, pages })}</span>
      <div className="flex gap-3">
        {page > 1 ? (
          <Link href={href(page - 1)} className="hover:underline">
            {t("common.previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className="hover:underline">
            {t("common.next")}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

const TONES: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  PLANNED: "accent",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "neutral",
  IN_REVIEW: "warning",
  APPROVED: "accent",
  SCHEDULED: "accent",
  PUBLISHED: "success",
  PUBLISHING: "accent",
  PARTIAL: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  PENDING: "neutral",
  SENT: "success",
  SENDING: "accent",
  NOT_CONFIGURED: "warning",
  STOPPED: "neutral",
  UNSUBSCRIBED: "warning",
  QUEUED: "neutral",
  RUNNING: "accent",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label}</Badge>;
}

/** Thin horizontal progress bar (0–100+). */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="grid gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}>
        <div className={`h-full rounded-full ${value != null && value > 100 ? "bg-danger" : "bg-primary"}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
