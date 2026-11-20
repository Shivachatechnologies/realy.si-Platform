import type { Metadata } from "next";
import { BriefingTabs } from "@/components/briefing/briefing-tabs";
import { ChannelSettingsForm } from "@/components/briefing/channel-settings-form";
import { BriefingSettingsForm } from "@/components/briefing/settings-form";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getChannelSettings, getSubscription } from "@/server/modules/briefing/service";
import { emailConfigured } from "@/server/modules/email/service";
import { companyEmailProvider } from "@/server/modules/email/provider";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("briefing.settings.title") };
}

export default async function BriefingSettingsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <PageHeader variant="editorial" world="command" eyebrow={t("briefing.eyebrow")} title={t("briefing.settings.title")} description={t("briefing.settings.subtitle")} illustration={false}>
      <BriefingTabs locale={locale} active="settings" />
    </PageHeader>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[960px] gap-6">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  if (!(await can(viewer.ctx, "analytics.read", chain))) {
    return (
      <div className="mx-auto grid max-w-[960px] gap-6">
        {header}
        <Notice tone="warning">{t("briefing.forbidden")}</Notice>
      </div>
    );
  }
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const [sub, channels, emailCompany] = await Promise.all([getSubscription(viewer.ctx, org.id, company.id), getChannelSettings(viewer.ctx, org.id, company.id), companyEmailProvider(org.id, company.id)]);
  const guided = !sub.saved || !sub.setupCompletedAt;
  const startStep = !sub.saved ? 0 : 1;
  const emailNote = emailCompany ? (emailCompany.scope === "company" ? t("briefing.settings.where.emailCompany") : null) : emailConfigured() ? null : t("briefing.settings.where.emailMissing");
  return (
    <div className="mx-auto grid max-w-[960px] gap-8">
      {header}
      <PageIntro labels={introLabels(t)} what={t("briefing.settings.intro.what")} why={t("briefing.settings.intro.why")} can={t("briefing.settings.intro.can")} />
      <BriefingSettingsForm
        apiBase={apiBase}
        guided={guided}
        startStep={startStep}
        aiReady={aiConfigured()}
        emailNote={emailNote}
        whatsapp={{ connected: !!channels.connected, provider: channels.connected?.provider ?? null, businessNumber: channels.connected?.businessNumber ?? null, verified: !!sub.whatsappVerifiedAt, number: sub.whatsappNumber }}
        initial={{
          enabled: sub.enabled,
          timezone: sub.timezone,
          locale: sub.locale,
          morningTime: sub.morningTime,
          days: sub.days,
          eveningEnabled: sub.eveningEnabled,
          eveningTime: sub.eveningTime,
          weeklyEnabled: sub.weeklyEnabled,
          emailEnabled: sub.emailEnabled,
          whatsappEnabled: sub.whatsappEnabled,
          aiSummary: sub.aiSummary,
          whatsappNumber: sub.whatsappNumber ?? "",
        }}
      />
      {channels.connected && channels.webhooks ? (
        <Card>
          <CardHeader title={t("briefing.channelSettings.title")} description={t("briefing.channelSettings.hint")} />
          <CardBody>
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t("briefing.settings.advanced.title")}</summary>
              <div className="mt-4">
                <ChannelSettingsForm
                  apiBase={apiBase}
                  provider={channels.connected.provider}
                  webhooks={channels.webhooks}
                  canManage={channels.canManage}
                  initial={{ metaAppSecretSet: channels.metaAppSecretSet, metaTemplateName: channels.metaTemplateName ?? "", metaTemplateLanguage: channels.metaTemplateLanguage ?? "", twilioContentSid: channels.twilioContentSid ?? "" }}
                />
              </div>
            </details>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
