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
import { safeTz } from "@/server/modules/voice/common";
import { PhoneWaves } from "./graphics";

export const VOICE_TABS = ["overview", "live", "calls", "agents", "numbers", "campaigns", "analytics", "settings"] as const;
export type VoiceTab = (typeof VOICE_TABS)[number] | "setup";

/**
 * Shared loader for the /voice pages: locale, translator, viewer, company, permissions and the header with tabs.
 * When there is no company or the viewer can't read calls, `gate` holds the page to render instead.
 */
export async function voicePage(active: VoiceTab, opts: { title?: string; description?: string } = {}) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <div className="grid gap-3">
      <PageHeader
        variant="editorial"
        world="sales"
        eyebrow={t("voice.eyebrow")}
        title={opts.title ?? t("voice.title")}
        description={opts.description ?? t("voice.subtitle")}
        illustration={<PhoneWaves className="w-full max-w-[17rem]" />}
      />
      <SectionTabs label={t("voice.title")} tabs={VOICE_TABS.map((k) => ({ key: k, href: `/${locale}/voice${k === "overview" ? "" : `/${k}`}`, label: t(`voice.tabs.${k}`) }))} active={active} />
    </div>
  );
  const wrap = (children: ReactNode) => (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      {header}
      {children}
    </div>
  );
  if (!company) return { gate: wrap(<Card><p className="p-4 text-muted-foreground">{t("company.empty")}</p></Card>) } as const;
  const chain = await companyChain(db(), org.id, company.id);
  const [read, post, manage, approve, integrations] = await Promise.all([
    can(viewer.ctx, "communication.read", chain),
    can(viewer.ctx, "communication.post", chain),
    can(viewer.ctx, "communication.manage", chain),
    can(viewer.ctx, "approvals.decide", chain),
    can(viewer.ctx, "integrations.manage", chain),
  ]);
  if (!read) return { gate: wrap(<Notice tone="warning">{t("errors.forbidden")}</Notice>) } as const;
  return {
    gate: null,
    locale,
    t,
    viewer,
    org,
    company,
    tz: safeTz(company.timezone),
    base: `/api/v1/organizations/${org.id}/companies/${company.id}`,
    perms: { read, post, manage, approve, integrations },
    wrap,
  } as const;
}
