import { aiConfigured } from "@/server/modules/agents/runtime";
import { HelpMeButton } from "@/components/crm/guided-kit";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubjectActivity } from "@/components/crm/activity-cards";
import { ActionButton, AiActions } from "@/components/crm/kit";
import { DealForm, DealStageControls } from "@/components/crm/record-forms";
import { DealProposalsPanel, EmailHistoryPanel, SalesTasksPanel } from "@/components/crm/record-panels";
import { CrmFrame, DEAL_STATUS_TONE, Facts, SubjectTasks, TagList, crmContext } from "@/components/crm/shell";
import { RevenueWorkspace } from "@/components/crm/revenue/panels";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { AppError } from "@/server/core/errors";
import { accountOptions } from "@/server/modules/crm/accounts";
import { toMajor } from "@/server/modules/crm/common";
import { sourceNames } from "@/server/modules/crm/config";
import { contactName, contactOptions } from "@/server/modules/crm/contacts";
import { customDisplay, listFieldDefs } from "@/server/modules/crm/custom-fields";
import { getDeal } from "@/server/modules/crm/deals";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.deals") };
}

export default async function DealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const c = await crmContext();
  if (!c.company || !c.canRead) return <CrmFrame active="deals">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer, tz } = c;
  const d = await getDeal(viewer.ctx, org.id, company.id, dealId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const [owners, accounts, contacts, sources, fields] = await Promise.all([
    listOwners(viewer.ctx, org.id, company.id),
    c.canManage ? accountOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    c.canManage ? contactOptions(viewer.ctx, org.id, company.id) : Promise.resolve([]),
    sourceNames(viewer.ctx, org.id, company.id),
    listFieldDefs(viewer.ctx, org.id, company.id, "DEAL"),
  ]);
  const active = !d.archivedAt;
  const money = (m: bigint) => formatMoney({ amountMinor: m, currency: d.currency }, locale);
  const custom = (d.customFields ?? {}) as Record<string, string | number | null>;
  const daysInStage = d.daysInStage;
  return (
    <CrmFrame active="deals" intro={false} actions={c.canRunAgents && aiConfigured() ? <HelpMeButton base={base} url={`${base}/crm/help`} body={{ kind: "deal", id: d.id, page: "crm.deal" }} locale={locale} /> : undefined} title={d.name} subtitle={[d.account?.name, `${d.pipeline.name} · ${d.stage.name}`].filter(Boolean).join(" · ")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/crm/pipeline?pipeline=${d.pipelineId}`} className="text-sm text-muted-foreground hover:underline">
          ← {t("crm.deals.backToPipeline")}
        </Link>
        {c.canManage && active ? (
          <ActionButton url={`${base}/crm/deals/${d.id}`} method="DELETE" icon="archive" label={t("crm.archive")} confirm={t("crm.archiveRecordConfirm")} redirectTo={`/${locale}/crm/deals`} />
        ) : null}
      </div>
      {!active ? <Notice tone="warning">{t("crm.archivedRecordNotice")}</Notice> : null}
      {d.staleSince && d.status === "OPEN" ? <Notice tone="warning">{t("crm.deals.staleNotice", { days: daysInStage })}</Notice> : null}
      {active && d.status === "OPEN" ? <RevenueWorkspace kind="deal" id={d.id} name={d.contact ? contactName(d.contact) : d.name} hasEmail={!!d.contact?.email} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {money(d.amountMinor)}
                  <Badge tone={DEAL_STATUS_TONE[d.status]}>{t(`crm.dealStatus.${d.status}`)}</Badge>
                  <Badge>{d.stage.name}</Badge>
                </span>
              }
              actions={<TagList tags={d.tags} />}
            />
            <CardBody className="grid gap-4">
              {c.canManage && active ? <DealStageControls base={base} dealId={d.id} stageId={d.stageId} status={d.status} stages={d.pipeline.stages} /> : null}
              <Facts
                items={[
                  [t("crm.probability"), `${d.effectiveProbability}%${d.probability == null && d.status === "OPEN" ? ` (${t("crm.stageDefault")})` : ""}`],
                  [t("crm.weighted"), money(d.weightedMinor)],
                  [t("crm.expectedClose"), d.expectedCloseDate ? formatDate(d.expectedCloseDate, locale, "UTC") : null],
                  [t("crm.owner"), d.ownerName ?? t("crm.unassigned")],
                  [t("crm.fields.account"), d.account ? <Link href={`/${locale}/crm/accounts/${d.account.id}`} className="hover:underline">{d.account.name}</Link> : null],
                  [t("crm.fields.contact"), d.contact ? <Link href={`/${locale}/crm/contacts/${d.contact.id}`} className="hover:underline">{contactName(d.contact)}</Link> : null],
                  [t("crm.source"), d.source],
                  [t("crm.fields.campaignCode"), d.campaignCode],
                  [t("crm.deals.inStage"), t("crm.deals.days", { count: daysInStage })],
                  [t("crm.created"), formatDate(d.createdAt, locale, tz)],
                  [t("crm.deals.closed"), d.closedAt ? formatDate(d.closedAt, locale, tz) : null],
                  [t("crm.deals.lostReason"), d.lostReason],
                  [t("crm.contacts.fromLead"), d.lead ? <Link href={`/${locale}/crm/${d.lead.id}`} className="hover:underline">{d.lead.name}</Link> : null],
                  ...customDisplay(fields, d.customFields).map((f) => [f.label, f.value] as [string, string]),
                ]}
              />
              {d.description ? <p className="whitespace-pre-wrap text-sm">{d.description}</p> : null}
              {c.canManage && active ? (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{t("crm.edit")}</summary>
                  <DealForm
                    base={base}
                    locale={locale}
                    owners={owners}
                    accounts={accounts}
                    contacts={contacts}
                    pipelines={[]}
                    sources={sources}
                    fields={fields}
                    currency={d.currency}
                    dealId={d.id}
                    initial={{
                      name: d.name,
                      accountId: d.accountId ?? "",
                      contactId: d.contactId ?? "",
                      ownerId: d.ownerId ?? "",
                      amount: toMajor(d.amountMinor, d.currency),
                      currency: d.currency,
                      probability: d.probability == null ? "" : String(d.probability),
                      expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.toISOString().slice(0, 10) : "",
                      source: d.source ?? "",
                      campaignCode: d.campaignCode ?? "",
                      description: d.description ?? "",
                      tags: d.tags,
                      customFields: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v == null ? "" : String(v)])),
                    }}
                  />
                </details>
              ) : null}
            </CardBody>
          </Card>
          <SubjectActivity subjectType="deal" subjectId={d.id} owners={owners} active={active} defaultAssignee={d.ownerId} />
          <EmailHistoryPanel subjectType="deal" subjectId={d.id} />
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <DealProposalsPanel dealId={d.id} active={active} />
          <SalesTasksPanel subjectType="deal" subjectId={d.id} active={active} defaultAssignee={d.ownerId} />
          <SubjectTasks
            subjectType="crm_deal"
            subjectId={d.id}
            actions={
              active ? (
                <AiActions
                  url={`${base}/crm/deals/${d.id}/ai`}
                  locale={locale}
                  actions={[
                    { mode: "analyze", label: t("crm.ai.analyzeDeal") },
                    { mode: "next_action", label: t("crm.ai.nextAction") },
                    { mode: "draft_follow_up", label: t("crm.ai.draftFollowUp") },
                  ]}
                />
              ) : null
            }
          />
          <Card>
            <CardHeader title={t("crm.deals.stageHistory")} />
            {d.stageHistory.length ? (
              <ol className="grid gap-2 p-4 text-sm">
                {d.stageHistory.map((h) => (
                  <li key={h.id} className="grid gap-0.5">
                    <span>
                      {h.from ? `${h.from} → ` : ""}
                      <span className="font-medium">{h.to ?? "—"}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(h.changedAt, locale, tz)}
                      {h.by ? ` · ${h.by}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">—</p>
            )}
          </Card>
        </div>
      </div>
    </CrmFrame>
  );
}
