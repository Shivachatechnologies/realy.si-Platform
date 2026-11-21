import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { FinanceTabs, type FinanceTab } from "./finance-tabs";
import { HelpMeButton } from "@/components/crm/guided-kit";
import { PageIntro } from "@/components/crm/page-intro";
import { aiConfigured } from "@/server/modules/agents/runtime";

/** Where each finance page's "what to do next" button leads. */
const INTRO_NEXT: Record<FinanceTab, string | undefined> = {
  dashboard: "/start",
  start: undefined,
  manager: "/budgets",
  transactions: "/start?flow=expense",
  accounts: "/transactions",
  invoices: "/start?flow=invoice",
  estimates: "/invoices",
  creditNotes: "/invoices",
  receivables: "/start?flow=payments",
  bills: "/start?flow=bills",
  payables: "/start?flow=bills",
  approvals: "/bills",
  claims: "/approvals",
  recurring: "/cashflow",
  budgets: "/reports",
  vendors: "/bills",
  cashflow: "/start?flow=profit",
  alerts: "/cashflow",
  learn: "/start",
  accounting: "/reports",
  reports: "/start?flow=profit",
  settings: "/start",
};

/**
 * Everything a finance page needs: translator, viewer, company, permissions and formatters. When there is no company or
 * the viewer lacks finance.read, `blocked` holds the page to render instead.
 */
export async function financePage(active: FinanceTab, title?: string) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <FinanceTabs locale={locale} active={active} t={t} />;
  const header = (
    <PageHeader
      variant="editorial"
      world="finance"
      eyebrow={title ? t("modules.finance.title") : t(`finance.tabs.${active}`)}
      title={title ?? t("modules.finance.title")}
      description={title ? undefined : t("finance.subtitle")}
      illustration={active === "dashboard" && !title ? undefined : false}
    />
  );
  const frame = (children: ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {children}
    </div>
  );
  if (!company) return { blocked: frame(<Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card>) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRunAgents] = await Promise.all([can(viewer.ctx, "finance.read", chain), can(viewer.ctx, "finance.manage", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) return { blocked: frame(<Notice tone="warning">{t("errors.forbidden")}</Notice>) } as const;
  const currency = company.baseCurrency;
  const tz = company.timezone ?? "UTC";
  return {
    blocked: null,
    locale,
    t,
    viewer,
    org,
    company,
    canManage,
    canRunAgents,
    currency,
    tz,
    base: `/api/v1/organizations/${org.id}/companies/${company.id}/finance`,
    money: (v: bigint | string, cur = currency) => formatMoney({ amountMinor: v, currency: cur }, locale),
    /** Dates stored as calendar days (@db.Date) are formatted in UTC so they never shift. */
    day: (d: Date) => formatDate(d, locale, "UTC"),
    frame: (children: ReactNode) =>
      frame(
        <>
          {tabs}
          {title ? null : (
            <PageIntro ns={`finance.intro.${active}`} tone="finance" href={INTRO_NEXT[active] !== undefined ? `/${locale}/finance${INTRO_NEXT[active]}` : undefined}>
              {canRunAgents && aiConfigured() ? (
                <HelpMeButton base={`/api/v1/organizations/${org.id}/companies/${company.id}`} url={`/api/v1/organizations/${org.id}/companies/${company.id}/finance/guided/help`} body={{ page: `finance.${active}` }} locale={locale} />
              ) : null}
            </PageIntro>
          )}
          {children}
        </>,
      ),
  } as const;
}

export type FinancePageCtx = Extract<Awaited<ReturnType<typeof financePage>>, { blocked: null }>;
