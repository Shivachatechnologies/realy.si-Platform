import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/agents/auto-refresh";
import { SalesJourney, type JourneyView } from "@/components/crm/sales-journey";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { formatMoney } from "@/i18n/format";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getJourney } from "@/server/modules/crm/guided";
import { listLeads } from "@/server/modules/crm/service";
import { DismissJourneyButton } from "@/components/crm/journey-buttons";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("sales.journey.title") };
}

/** Guided "Start selling" journey: from "who is your customer?" to a tracked deal, with AI at every step. */
export default async function SalesStartPage() {
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame area="sales" active="start">{null}</CrmFrame>;
  const { t, locale, viewer, org, company, base } = c;
  const [j, leads] = await Promise.all([getJourney(viewer.ctx, org.id, company.id), listLeads(viewer.ctx, org.id, company.id, { converted: "no" }, { take: 50 })]);
  const task = (x: (typeof j.tasks)[keyof typeof j.tasks]) => (x ? { id: x.id, status: x.status, title: x.title, output: x.output } : null);
  const view: JourneyView = {
    step: j.step,
    completed: !!j.completedAt,
    data: j.data,
    tasks: Object.fromEntries(Object.entries(j.tasks).map(([k, v]) => [k, task(v)])),
    candidates: j.candidates,
    draft: j.draft,
    lead: j.lead ? { id: j.lead.id, name: j.lead.name, email: j.lead.email, account: j.lead.account, stage: j.lead.stage, score: j.lead.score, scoreLabel: j.lead.scoreLabel } : null,
    deal: j.deal
      ? {
          id: j.deal.id,
          name: j.deal.name,
          status: j.deal.status,
          amount: formatMoney({ amountMinor: j.deal.amountMinor, currency: j.deal.currency }, locale),
          stageId: j.deal.stageId,
          stageName: j.deal.stage.name,
          stages: j.deal.pipeline.stages,
        }
      : null,
    addedLeads: j.addedLeads,
    existingLeads: leads.map((l) => ({ id: l.id, name: l.name, account: l.account })),
  };
  const running = Object.values(j.tasks).some((x) => x?.status === "QUEUED" || x?.status === "RUNNING");
  return (
    <CrmFrame
      area="sales"
      active="start"
      title={t("sales.journey.title")}
      subtitle={t("sales.journey.subtitle")}
      actions={
        <>
          {c.canManage && !j.completedAt && !j.dismissedAt ? <DismissJourneyButton base={base} locale={locale} /> : null}
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/sales`}>{t("sales.journey.toDashboard")}</Link>
          </Button>
        </>
      }
    >
      <AutoRefresh active={running} intervalMs={3500} />
      <SalesJourney base={base} locale={locale} journey={view} canManage={c.canManage} aiReady={aiConfigured() && c.canRunAgents} />
    </CrmFrame>
  );
}
