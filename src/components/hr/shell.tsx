import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageIntro } from "@/components/guide-kit/page-intro";
import type { AppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";
import { hrAccess, type HrAccess } from "@/server/modules/hr/access";
import { requireOrgContext } from "@/server/workspace";
import { HR_TABS, HrTabs, OrgTabs, ORG_TABS, type HrTab, type OrgTab } from "./hr-tabs";

/** Everything an HR page needs: translator, workspace, viewer access and the API base path. */
export async function loadHr(locale: AppLocale) {
  const t = await getT(locale);
  const ctx = await requireOrgContext(locale);
  const access = ctx.company ? await hrAccess(ctx.viewer.ctx, ctx.org.id, ctx.company.id) : null;
  const base = ctx.company ? `/api/v1/organizations/${ctx.org.id}/companies/${ctx.company.id}` : "";
  return { t, ...ctx, access, base, tz: ctx.company?.timezone ?? "UTC" };
}

export function visibleTabs(access: HrAccess | null): HrTab[] {
  if (!access) return [];
  return HR_TABS.filter((k) => {
    if (k === "payroll") return access.payrollRead;
    if (["recruiting", "onboarding", "hire"].includes(k)) return access.manage;
    if (k === "me") return !!access.me;
    return access.read;
  });
}

export function hrTabLabels(t: Translate) {
  return Object.fromEntries(HR_TABS.map((k) => [k, t(`hr.tabs.${k}`)])) as Record<HrTab, string>;
}

/** "Next step" link of each tab's intro strip (null: the page itself is the next step). */
const HR_NEXT: Partial<Record<HrTab, string>> = {
  employees: "/hr/hire",
  recruiting: "/hr/hire",
  onboarding: "/hr/employees?status=ONBOARDING",
  time: "/hr/leave",
  leave: "/hr/me",
  policies: "/hr/me",
  requests: "/hr/me",
  me: "/hr/leave",
};
const ORG_NEXT: Partial<Record<OrgTab, string>> = { structure: "/organization/chart", chart: "/hr/employees", roles: "/organization" };

function TabIntro({ t, locale, prefix, next }: { t: Translate; locale: string; prefix: string; next?: string }) {
  return (
    <PageIntro
      labels={{ what: t("guideKit.intro.what"), why: t("guideKit.intro.why"), can: t("guideKit.intro.can"), next: t("guideKit.intro.next") }}
      what={t(`${prefix}.what`)}
      why={t(`${prefix}.why`)}
      can={t(`${prefix}.can`)}
      next={next ? { label: t(`${prefix}.next`), href: `/${locale}${next}` } : undefined}
      accent="success"
    />
  );
}

/** Page frame for /hr/*: title, tabs and the no-company / forbidden states. Returns null children when blocked. */
export function HrFrame({
  t,
  locale,
  title,
  subtitle,
  tab,
  access,
  hasCompany,
  allowed,
  actions,
  children,
}: {
  t: Translate;
  locale: string;
  title: string;
  subtitle?: string;
  tab: HrTab;
  access: HrAccess | null;
  hasCompany: boolean;
  allowed: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const showIntro = hasCompany && allowed && tab !== "overview" && tab !== "hire";
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {hasCompany && access?.read ? <HrTabs locale={locale} active={tab} labels={hrTabLabels(t)} visible={visibleTabs(access)} /> : null}
      {showIntro ? <TabIntro t={t} locale={locale} prefix={`hr.intro.${tab}`} next={HR_NEXT[tab]} /> : null}
      {!hasCompany ? (
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      ) : !allowed ? (
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      ) : (
        children
      )}
    </div>
  );
}

export function OrgFrame({ t, locale, tab, hasCompany, allowed, children, actions }: { t: Translate; locale: string; tab: OrgTab; hasCompany: boolean; allowed: boolean; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{t("modules.organization.title")}</h1>
          <p className="text-muted-foreground">{t("hr.org.subtitle")}</p>
        </div>
        {actions}
      </div>
      {hasCompany && allowed ? <OrgTabs locale={locale} active={tab} labels={Object.fromEntries(ORG_TABS.map((k) => [k, t(`hr.org.tabs.${k}`)])) as Record<OrgTab, string>} /> : null}
      {hasCompany && allowed ? <TabIntro t={t} locale={locale} prefix={`hr.intro.org_${tab}`} next={ORG_NEXT[tab]} /> : null}
      {!hasCompany ? (
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      ) : !allowed ? (
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      ) : (
        children
      )}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/** Previous/next page links that keep the other query parameters. */
export function Pager({ locale, path, params, page, pages, t }: { locale: string; path: string; params: Record<string, string | undefined>; page: number; pages: number; t: Translate }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter((e): e is [string, string] => !!e[1]));
    return `/${locale}${path}?${q}`;
  };
  return (
    <nav className="flex items-center justify-between border-t px-3 py-2 text-sm" aria-label={t("hr.pagination")}>
      {page > 1 ? (
        <a href={href(page - 1)} className="hover:underline">
          {t("common.previous")}
        </a>
      ) : (
        <span />
      )}
      <span className="text-xs text-muted-foreground">{t("hr.pageOf", { page, pages })}</span>
      {page < pages ? (
        <a href={href(page + 1)} className="hover:underline">
          {t("common.next")}
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

export const personName = (e: { firstName: string; lastName: string | null } | null | undefined) => (e ? [e.firstName, e.lastName].filter(Boolean).join(" ") : "");
