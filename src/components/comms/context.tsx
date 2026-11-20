import { PageHeader as EditorialHeader } from "@/components/ui/page-header";
import { WorldIllustration } from "@/components/graphics/illustrations";
import "server-only";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { safeTimeZone } from "@/server/modules/comms/time";
import { SectionTabs } from "./bits";

type Area = "communication" | "support";
const PERMS = {
  communication: ["communication.read", "communication.post", "communication.manage"],
  support: ["support.read", "support.manage", "support.manage"],
} as const;

export const COMMS_TABS = ["feed", "announcements", "channels", "messages", "meetings", "calendar", "inbox", "settings"] as const;
export const SUPPORT_TABS = ["inbox", "customers", "knowledge", "dashboard", "setup", "settings"] as const;

/**
 * Shared loader for Communication / Support pages: locale, translator, viewer, company, permissions and the tab bar.
 * When there is no company or the viewer can't read the area, `gate` holds the page to render instead.
 */
export async function areaPage(area: Area, active: string, opts: { title?: string } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const titleKey = area === "communication" ? "modules.communication.title" : "modules.support.title";
  const tabs =
    area === "communication"
      ? COMMS_TABS.map((k) => ({ key: k, href: `/${locale}/communication${k === "feed" ? "" : `/${k}`}`, label: t(`communication.tabs.${k}`) }))
      : SUPPORT_TABS.map((k) => ({ key: k, href: `/${locale}/support${k === "inbox" ? "" : `/${k}`}`, label: t(`support.tabs.${k}`) }));
  const header = (
    <div className="grid gap-3">
      {area === "communication" ? (
        <EditorialHeader variant="editorial" world="people" eyebrow={t("dna.worlds.communication")} title={opts.title ?? t(titleKey)} description={t(`${area}.subtitle`)} illustration={<WorldIllustration world="support" className="w-full max-w-[17rem]" />} />
      ) : (
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold tracking-tight">{opts.title ?? t(titleKey)}</h1>
          <p className="text-muted-foreground">{t(`${area}.subtitle`)}</p>
        </div>
      )}
      <SectionTabs label={t(titleKey)} tabs={tabs} active={active} />
    </div>
  );
  const wrap = (children: ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {children}
    </div>
  );
  if (!company) {
    return {
      gate: wrap(
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>,
      ),
    } as const;
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [read, post, manage, runAgents] = await Promise.all([...PERMS[area].map((p) => can(viewer.ctx, p, chain)), can(viewer.ctx, "agents.run", chain)]);
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
    perms: { read, post, manage, runAgents, aiReady: aiConfigured() },
    wrap,
  } as const;
}
