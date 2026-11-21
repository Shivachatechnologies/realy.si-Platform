import type { Metadata } from "next";
import Link from "next/link";
import { Newspaper, Settings2 } from "lucide-react";
import { BriefingTabs } from "@/components/briefing/briefing-tabs";
import { BriefingView } from "@/components/briefing/briefing-view";
import { pendingApprovalIds } from "@/components/briefing/load";
import { ReportMasthead } from "@/components/briefing/report-masthead";
import { TestBriefingButton } from "@/components/briefing/test-briefing";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getSubscription, latestReport } from "@/server/modules/briefing/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("briefing.title") };
}

export default async function BriefingPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const header = (
    <PageHeader
      variant="editorial"
      world="command"
      eyebrow={t("briefing.eyebrow")}
      title={t("briefing.title")}
      description={t("briefing.subtitle")}
      actions={
        company ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/${locale}/briefing/settings`}>
              <Settings2 aria-hidden />
              {t("briefing.tabs.settings")}
            </Link>
          </Button>
        ) : null
      }
    >
      <BriefingTabs locale={locale} active="today" />
    </PageHeader>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-6">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canDecide, canRun] = await Promise.all([can(viewer.ctx, "analytics.read", chain), can(viewer.ctx, "approvals.decide", chain), can(viewer.ctx, "agents.run", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-6">
        {header}
        <Notice tone="warning">{t("briefing.forbidden")}</Notice>
      </div>
    );
  }
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const [sub, latest] = await Promise.all([getSubscription(viewer.ctx, org.id, company.id), latestReport(viewer.ctx, org.id, company.id)]);
  const pendingIds = latest ? await pendingApprovalIds(org.id, company.id, latest.data.approvals?.items.map((a) => a.id) ?? []) : new Set<string>();
  const setupDone = sub.saved && !!sub.setupCompletedAt;
  const channels = ["IN_APP", ...(sub.emailEnabled ? ["EMAIL"] : []), ...(sub.whatsappEnabled ? ["WHATSAPP"] : [])] as ("IN_APP" | "EMAIL" | "WHATSAPP")[];
  const whatsappReady = !!sub.whatsappVerifiedAt;
  const helpTask = canRun ? await latestSubjectTask(viewer.ctx, org.id, company.id, "briefing", company.id) : null;
  const schedule = sub.enabled ? t("briefing.intro.schedule", { time: sub.morningTime, tz: sub.timezone.replace(/_/g, " ") }) : t("briefing.intro.paused");

  return (
    <div className="mx-auto grid max-w-[1400px] gap-8">
      {header}
      <PageIntro
        labels={introLabels(t)}
        what={t("briefing.intro.what")}
        why={t("briefing.intro.why")}
        can={t("briefing.intro.can")}
        next={setupDone ? { label: t("briefing.intro.nextHistory"), href: `/${locale}/briefing/history` } : { label: t("briefing.intro.nextSetup"), href: `/${locale}/briefing/settings` }}
      />
      {setupDone ? (
        <p className="text-sm text-muted-foreground">
          {schedule}{" "}
          <Link href={`/${locale}/briefing/settings`} className="text-primary hover:underline">
            {t("briefing.intro.change")}
          </Link>
        </p>
      ) : (
        <Notice tone="info" title={t("briefing.start.title")} action={<Link className="text-sm font-medium text-primary hover:underline" href={`/${locale}/briefing/settings`}>{t("briefing.start.cta")}</Link>}>
          {t("briefing.start.body")}
        </Notice>
      )}

      {latest ? (
        <>
          <ReportMasthead data={latest.data} t={t} locale={locale} deliveries={latest.deliveries.map((d) => ({ channel: d.channel, status: d.status, error: d.error }))} />
          <BriefingView data={latest.data} summary={latest.summary} summaryStatus={latest.summaryStatus} t={t} locale={locale} apiBase={apiBase} pendingIds={pendingIds} canDecide={canDecide} />
        </>
      ) : (
        <Card variant="glass">
          <SmartEmpty
            icon={<Newspaper />}
            title={t("briefing.empty.title")}
            body={t("briefing.empty.body")}
            primary={<TestBriefingButton apiBase={apiBase} channels={channels} whatsappReady={whatsappReady} size="sm" />}
          />
        </Card>
      )}

      <div className="grid gap-6 border-t pt-6 md:grid-cols-2">
        {latest ? (
          <div className="grid content-start gap-2">
            <h2 className="text-sm font-semibold">{t("briefing.test.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("briefing.test.hint")}</p>
            <TestBriefingButton apiBase={apiBase} channels={channels} whatsappReady={whatsappReady} variant="secondary" size="sm" />
          </div>
        ) : null}
        {canRun ? (
          <div className="grid content-start gap-2">
            <h2 className="text-sm font-semibold">{t("briefing.help.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("briefing.help.hint")}</p>
            <HelpMeButton
              base={apiBase}
              aiReady={aiConfigured()}
              profile="ai_ceo"
              subject={{ type: "briefing", id: company.id }}
              title="Walk me through today's briefing"
              label={t("briefing.help.label")}
              instructions={`The person is a non-technical founder reading their daily briefing on the Briefing page. Use read_company_kpis, read_open_issues and the company's objectives to explain in plain words what happened yesterday, what needs their decision today and the three most important next steps, each with the evidence. Never invent numbers; if a figure is unavailable, say so. Do not take actions yourself.`}
              initial={helpTask}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
