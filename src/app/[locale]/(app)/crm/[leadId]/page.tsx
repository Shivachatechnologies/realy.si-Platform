import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActivityForm,
  ArchiveLeadButton,
  CompleteFollowUpButton,
  DealForm,
  LeadAssistant,
  LeadNotesForm,
  LeadStageSelect,
  MergeButton,
  NewFollowUpForm,
} from "@/components/crm/lead-forms";
import { SCORE_TONE } from "@/components/crm/score";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import { db } from "@/server/core/db";
import { AppError } from "@/server/core/errors";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { getLead, listOwners } from "@/server/modules/crm/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.crm.title") };
}

const PRIORITY_TONE = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" } as const;
const ACTIVITY_ICON = { CALL: "☎", EMAIL: "✉", MEETING: "◷", NOTE: "✎" } as const;
const TASK_TONE = { QUEUED: "neutral", RUNNING: "accent", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" } as const;

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  if (!company) notFound();
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage, canRunAgents] = await Promise.all([
    can(viewer.ctx, "sales.read", chain),
    can(viewer.ctx, "sales.manage", chain),
    can(viewer.ctx, "agents.run", chain),
  ]);
  if (!canRead) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  const lead = await getLead(viewer.ctx, org.id, company.id, leadId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const owners = canManage ? await listOwners(viewer.ctx, org.id, company.id) : [];
  const base = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const tz = company.timezone ?? "UTC";
  const active = !lead.archivedAt;
  const now = new Date();
  const money = (m: bigint | null) => (m != null ? formatMoney({ amountMinor: m, currency: lead.currency }, locale) : null);
  const facts: [string, string | null][] = [
    [t("crm.email"), lead.email],
    [t("crm.phone"), lead.phone],
    [t("crm.account"), lead.account],
    [t("crm.source"), lead.source],
    [t("crm.lastContacted"), lead.lastContactedAt ? formatDateTime(lead.lastContactedAt, locale, tz) : null],
    [t("crm.created"), formatDate(lead.createdAt, locale, tz)],
  ];
  const deal: [string, string | null][] = [
    [t("crm.owner"), lead.owner?.name ?? t("crm.unassigned")],
    [t("crm.value"), money(lead.valueMinor)],
    [t("crm.probability"), `${lead.effectiveProbability}%${lead.probability == null ? ` (${t("crm.stageDefault")})` : ""}`],
    [t("crm.weighted"), lead.valueMinor != null ? money(lead.weightedMinor) : null],
    [t("crm.expectedClose"), lead.expectedCloseDate ? formatDate(lead.expectedCloseDate, locale, "UTC") : null],
  ];
  const dateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const majorUnits = (m: bigint | null) => (m == null ? "" : `${m / 100n}${m % 100n ? `.${(m % 100n).toString().padStart(2, "0")}` : ""}`);

  return (
    <div className="mx-auto grid max-w-[1000px] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/${locale}/crm`} className="text-sm text-muted-foreground hover:underline">
          ← {t("crm.back")}
        </Link>
        {canManage && active ? <ArchiveLeadButton base={base} locale={locale} leadId={lead.id} /> : null}
      </div>
      {!active ? (
        <Notice tone="warning">
          {lead.mergedIntoId ? (
            <Link href={`/${locale}/crm/${lead.mergedIntoId}`} className="hover:underline">
              {t("crm.mergedNotice")}
            </Link>
          ) : (
            t("crm.archivedNotice")
          )}
        </Notice>
      ) : null}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              {lead.name}
              <Badge tone={SCORE_TONE[lead.scoreLabel]} title={t("crm.scoreHint")}>
                {t(`crm.scoreLabels.${lead.scoreLabel}`)} · {lead.score}
              </Badge>
              {!canManage || !active ? <Badge>{t(`crm.stages.${lead.stage}`)}</Badge> : null}
            </span>
          }
          actions={canManage && active ? <LeadStageSelect base={base} leadId={lead.id} stage={lead.stage} /> : null}
        />
        <CardBody className="grid gap-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {canManage && active ? (
            <LeadNotesForm base={base} leadId={lead.id} notes={lead.notes ?? ""} />
          ) : lead.notes ? (
            <p className="whitespace-pre-wrap text-sm">{lead.notes}</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("crm.deal")} />
        <CardBody className="grid gap-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-5">
            {deal.map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd>{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {canManage && active ? (
            <DealForm
              base={base}
              leadId={lead.id}
              owners={owners}
              initial={{
                ownerId: lead.ownerId ?? "",
                value: majorUnits(lead.valueMinor),
                probability: lead.probability == null ? "" : String(lead.probability),
                expectedCloseDate: dateInput(lead.expectedCloseDate),
              }}
            />
          ) : null}
        </CardBody>
      </Card>

      {canRunAgents && active ? (
        <Card>
          <CardHeader title={t("crm.assistant")} description={t("crm.assistantDescription")} />
          <CardBody className="grid gap-3">
            {aiConfigured() ? (
              <LeadAssistant base={base} locale={locale} leadId={lead.id} hasEmail={!!lead.email} />
            ) : (
              <Notice tone="warning">{t("agentTasks.notConfigured")}</Notice>
            )}
            {lead.agentTasks.length ? (
              <ul className="grid gap-1 text-sm">
                {lead.agentTasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={TASK_TONE[task.status]}>{t(`agentTasks.status.${task.status}`)}</Badge>
                    <Link href={`/${locale}/tasks/${task.id}`} className="hover:underline">
                      {task.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("crm.followUps")} />
        <CardBody className="grid gap-3">
          {lead.followUps.length ? (
            <ul className="grid gap-1.5">
              {lead.followUps.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span aria-hidden>{f.completedAt ? "✓" : "○"}</span>
                  <Badge tone={f.completedAt ? "neutral" : PRIORITY_TONE[f.priority]}>{t(`crm.priorities.${f.priority}`)}</Badge>
                  <span className={f.completedAt ? "text-muted-foreground line-through" : ""}>{f.note}</span>
                  <span className={!f.completedAt && f.dueAt < now ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
                    {!f.completedAt && f.dueAt < now ? t("crm.overdueOn", { date: formatDate(f.dueAt, locale, tz) }) : formatDate(f.dueAt, locale, tz)}
                  </span>
                  {canManage && active && !f.completedAt ? <CompleteFollowUpButton base={base} followUpId={f.id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("crm.noFollowUps")}</p>
          )}
          {canManage && active ? <NewFollowUpForm base={base} leadId={lead.id} /> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("crm.timeline")} description={t("crm.timelineHint")} />
        <CardBody className="grid gap-4">
          {canManage && active ? <ActivityForm base={base} leadId={lead.id} /> : null}
          {lead.activities.length ? (
            <ol className="grid gap-3 border-s ps-4">
              {lead.activities.map((a) => (
                <li key={a.id} className="grid gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden>{ACTIVITY_ICON[a.type]}</span>
                    <span className="font-medium text-foreground">{t(`crm.activityTypes.${a.type}`)}</span>
                    {formatDateTime(a.occurredAt, locale, tz)}
                    {a.author ? <span>· {a.author}</span> : null}
                  </span>
                  <p className="whitespace-pre-wrap">{a.summary}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t("crm.noActivities")}</p>
          )}
        </CardBody>
      </Card>

      {lead.duplicates.length ? (
        <Card>
          <CardHeader title={t("crm.duplicates")} description={t("crm.duplicatesHint")} />
          <ul className="grid divide-y">
            {lead.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <Link href={`/${locale}/crm/${d.id}`} className="font-medium hover:underline">
                  {d.name}
                </Link>
                <span className="flex-1 text-muted-foreground">{[d.email, d.phone].filter(Boolean).join(" · ")}</span>
                {canManage ? <MergeButton base={base} locale={locale} primaryId={lead.id} secondaryId={d.id} label={d.name} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
