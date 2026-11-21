import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTabs } from "@/components/comms/bits";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { safeTimeZone } from "@/server/modules/comms/time";
import { chatAiConfigured } from "@/server/modules/livechat/agent";

export const LIVECHAT_TABS = ["inbox", "settings"] as const;

/**
 * Shared loader for /livechat pages: locale, translator, viewer, company, permissions (support.read / support.manage)
 * and the editorial header with tabs. When there is no company or the viewer can't read the area, `gate` is the page.
 */
export async function livechatPage(active: (typeof LIVECHAT_TABS)[number] | null, opts: { header?: boolean } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = LIVECHAT_TABS.map((k) => ({ key: k, href: `/${locale}/livechat${k === "inbox" ? "" : `/${k}`}`, label: t(`livechat.tabs.${k}`) }));
  const header =
    opts.header === false ? null : (
      <PageHeader variant="editorial" world="support" eyebrow={t("livechat.eyebrow")} title={t("livechat.title")} description={t("livechat.subtitle")}>
        {active ? <SectionTabs label={t("livechat.title")} tabs={tabs} active={active} /> : null}
      </PageHeader>
    );
  const wrap = (children: ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      {children}
    </div>
  );
  if (!company) return { gate: wrap(<Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card>) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [read, manage] = await Promise.all([can(viewer.ctx, "support.read", chain), can(viewer.ctx, "support.manage", chain)]);
  if (!read) return { gate: wrap(<Notice tone="warning">{t("errors.forbidden")}</Notice>) } as const;
  return {
    gate: null,
    locale,
    t,
    viewer,
    org,
    company,
    tz: safeTimeZone(company.timezone),
    base: `/api/v1/organizations/${org.id}/companies/${company.id}`,
    perms: { read, manage },
    aiReady: chatAiConfigured(),
    wrap,
  } as const;
}
