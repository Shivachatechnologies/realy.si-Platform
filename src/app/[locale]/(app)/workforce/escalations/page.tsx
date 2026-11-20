import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Crown, GitBranch, Layers, X } from "lucide-react";
import { AiAvatar } from "@/components/graphics/ai-avatar";
import { ActionButton } from "@/components/workforce/action-button";
import { AnswerText } from "@/components/workforce/answer-text";
import { HeaderStrip } from "@/components/workforce/header-strip";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState } from "@/components/workforce/states";
import { WorkforceTabs } from "@/components/workforce/workforce-tabs";
import { TaskStatusBadge } from "@/components/agents/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listDelegations } from "@/server/modules/workforce/delegation";
import { ESCALATION_SLA_MS } from "@/server/modules/workforce/hierarchy";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("workforce.escalations.title") };
}

type Stage = "employee" | "manager" | "founder" | "resolved";

/** The escalation ladder for one report: employee → AI manager → founder (→ resolved). */
function Ladder({ stage, managerName, t }: { stage: Stage; managerName: string | null; t: Translate }) {
  const steps: { key: Stage; label: string }[] = [
    { key: "employee", label: t("workforce.escalations.ladder.employee") },
    ...(managerName ? [{ key: "manager" as const, label: managerName }] : []),
    { key: "founder", label: t("workforce.org.founder") },
  ];
  const at = stage === "resolved" ? steps.length : steps.findIndex((s) => s.key === stage);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label={t("workforce.escalations.ladder.aria")}>
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          <span
            className={cn(
              "inline-flex min-h-6 items-center gap-1 rounded-full border px-2",
              i < at && "border-success/40 text-success",
              i === at && "border-warning/50 bg-warning/10 font-semibold text-warning",
              i > at && "text-muted-foreground",
            )}
            aria-current={i === at ? "step" : undefined}
          >
            {s.key === "founder" ? <Crown aria-hidden className="size-3" /> : null}
            {s.label}
          </span>
          {i < steps.length - 1 ? <ArrowRight aria-hidden className="size-3 text-muted-foreground rtl:rotate-180" /> : null}
        </li>
      ))}
      {stage === "resolved" ? (
        <li className="inline-flex min-h-6 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 font-semibold text-success">
          <CheckCircle2 aria-hidden className="size-3" />
          {t("workforce.escalations.resolved")}
        </li>
      ) : null}
    </ol>
  );
}

/**
 * Escalations, delegations and roll-ups: what the AI team needs from people. Escalations climb employee → AI manager
 * → founder (after 24 h unresolved, or at once when the manager's task fails); supervised managers' delegation
 * proposals wait here for approval; finished delegated work rolls up as team results.
 */
export default async function EscalationsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const tabs = <WorkforceTabs locale={locale} active="escalations" labels={{ employees: t("workforce.tabs.employees"), org: t("workforce.tabs.org"), hire: t("workforce.tabs.hire"), usage: t("workforce.tabs.usage"), plans: t("workforce.tabs.plans"), tasks: t("workforce.tabs.tasks") }} />;
  const header = (
    <>
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.escalations.title")} subtitle={t("workforce.escalations.subtitle")} />
      {tabs}
    </>
  );
  if (!company) return <PageState header={header} kind="empty" message={t("company.empty")} />;
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "agents.read", chain), can(viewer.ctx, "agents.manage", chain)]);
  if (!canRead) return <PageState header={header} kind="forbidden" message={t("errors.forbidden")} />;

  const scope = { organizationId: org.id, companyId: company.id };
  const include = { aiEmployee: { select: { id: true, name: true, department: true } }, manager: { select: { id: true, name: true } } } as const;
  const [open, resolved, rollups, proposals, decided] = await Promise.all([
    db().aiEmployeeReport.findMany({ where: { ...scope, kind: "ESCALATION", resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 50, include }),
    db().aiEmployeeReport.findMany({ where: { ...scope, kind: "ESCALATION", resolvedAt: { not: null } }, orderBy: { resolvedAt: "desc" }, take: 8, include }),
    db().aiEmployeeReport.findMany({ where: { ...scope, kind: "ROLLUP" }, orderBy: { createdAt: "desc" }, take: 20, include }),
    listDelegations(viewer.ctx, org.id, company.id, { status: "PROPOSED" }),
    listDelegations(viewer.ctx, org.id, company.id, {}, 30).then((r) => r.filter((d) => d.status !== "PROPOSED").slice(0, 8)),
  ]);
  const escTaskIds = open.flatMap((r) => (r.escalationTaskId ? [r.escalationTaskId] : []));
  const escTasks = new Map((escTaskIds.length ? await db().agentTask.findMany({ where: { ...scope, id: { in: escTaskIds } }, select: { id: true, status: true } }) : []).map((x) => [x.id, x.status]));
  const apiBase = `/api/v1/organizations/${org.id}/companies/${company.id}`;
  const stageOf = (r: (typeof open)[number]): Stage => (r.resolvedAt ? "resolved" : r.founderNotifiedAt || !r.managerEmployeeId ? "founder" : "manager");
  const atFounder = open.filter((r) => stageOf(r) === "founder").length;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader eyebrow={t("modules.workforce.title")} title={t("workforce.escalations.title")} subtitle={t("workforce.escalations.subtitle")} />
      {tabs}
      <HeaderStrip
        t={t}
        what={t("workforce.escalations.strip.what")}
        why={t("workforce.escalations.strip.why", { hours: ESCALATION_SLA_MS / 3_600_000 })}
        can={t("workforce.escalations.strip.can")}
        next={proposals.length ? t("workforce.escalations.strip.nextProposals", { count: proposals.length }) : atFounder ? t("workforce.escalations.strip.nextFounder", { count: atFounder }) : t("workforce.escalations.strip.nextNone")}
      />

      <Card id="escalations" variant={atFounder ? "highlight" : "default"}>
        <CardHeader title={t("workforce.escalations.openTitle", { count: open.length })} description={t("workforce.escalations.openHint")} />
        {open.length === 0 ? (
          <CardBody className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-4 text-success" />
            {t("workforce.escalations.noneOpen")}
          </CardBody>
        ) : (
          <ul className="divide-y">
            {open.map((r) => {
              const status = r.escalationTaskId ? escTasks.get(r.escalationTaskId) : undefined;
              return (
                <li key={r.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                  <AiAvatar seed={r.aiEmployee.id} department={r.aiEmployee.department} size={36} />
                  <div className="grid min-w-0 gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${locale}/workforce/${r.aiEmployee.id}`} className="font-medium hover:underline">
                        {r.aiEmployee.name}
                      </Link>
                      <span className="min-w-0 break-words" dir="auto">
                        {r.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(r.createdAt, locale)}</span>
                    </div>
                    <Ladder stage={stageOf(r)} managerName={r.manager?.name ?? null} t={t} />
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground" dir="auto">
                      {r.body}
                    </p>
                    <span className="flex flex-wrap items-center gap-3 text-xs">
                      {r.taskId ? (
                        <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                          {t("workforce.reports.sourceTask")}
                        </Link>
                      ) : null}
                      {r.escalationTaskId ? (
                        <span className="inline-flex items-center gap-1">
                          <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/${locale}/tasks/${r.escalationTaskId}`}>
                            {t("workforce.reports.escalationTask")}
                          </Link>
                          {status ? <TaskStatusBadge status={status} label={t(`agentTasks.status.${status}`)} /> : null}
                        </span>
                      ) : null}
                      {r.founderNotifiedAt ? <Badge tone="warning">{t("workforce.escalations.founderNotified", { when: formatRelativeTime(r.founderNotifiedAt, locale) })}</Badge> : null}
                    </span>
                  </div>
                  {canManage ? (
                    <ActionButton path={`${apiBase}/workforce/reports/${r.id}/resolve`} variant="secondary">
                      <Check aria-hidden />
                      {t("workforce.escalations.resolve")}
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card id="delegations">
          <CardHeader title={t("workforce.delegations.title", { count: proposals.length })} description={t("workforce.delegations.hint")} />
          {proposals.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{t("workforce.delegations.empty")}</CardBody>
          ) : (
            <ul className="divide-y">
              {proposals.map((d) => (
                <li key={d.id} className="grid gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <AiAvatar seed={d.fromEmployee.id} department={d.fromEmployee.department} size={28} />
                    <span className="font-medium">{d.fromEmployee.name}</span>
                    <GitBranch aria-hidden className="size-3.5 text-muted-foreground" />
                    <AiAvatar seed={d.toEmployee.id} department={d.toEmployee.department} size={28} />
                    <Link className="font-medium hover:underline" href={`/${locale}/workforce/${d.toEmployee.id}`}>
                      {d.toEmployee.name}
                    </Link>
                    {d.toEmployee.status === "PAUSED" ? <Badge>{t("workforce.status.PAUSED")}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(d.createdAt, locale)}</span>
                  </div>
                  <p className="font-medium" dir="auto">
                    {d.title}
                  </p>
                  <details className="text-sm text-muted-foreground">
                    <summary className="min-h-8 cursor-pointer py-1 text-primary">{t("workforce.delegations.instructions")}</summary>
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {d.instructions}
                    </p>
                  </details>
                  <span className="flex flex-wrap items-start gap-2">
                    <Link className="inline-flex min-h-8 items-center text-xs text-primary hover:underline" href={`/${locale}/tasks/${d.parentTaskId}`}>
                      {t("workforce.delegations.parentTask")}
                    </Link>
                    {canManage ? (
                      <>
                        <ActionButton path={`${apiBase}/workforce/delegations/${d.id}/decision`} body={{ decision: "approve" }} variant="default">
                          <Check aria-hidden />
                          {t("workforce.delegations.approve")}
                        </ActionButton>
                        <ActionButton path={`${apiBase}/workforce/delegations/${d.id}/decision`} body={{ decision: "reject" }} variant="ghost">
                          <X aria-hidden />
                          {t("workforce.delegations.reject")}
                        </ActionButton>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {decided.length ? (
            <CardBody className="grid gap-1 border-t text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t("workforce.delegations.recent")}</span>
              {decided.map((d) => (
                <span key={d.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.status === "CREATED" ? "success" : d.status === "REJECTED" ? "neutral" : "danger"}>{t(`workforce.delegations.status.${d.status}`)}</Badge>
                  <span dir="auto">
                    {d.fromEmployee.name} → {d.toEmployee.name}: {d.title}
                  </span>
                  {d.childTaskId ? (
                    <Link className="text-primary hover:underline" href={`/${locale}/tasks/${d.childTaskId}`}>
                      {t("workforce.delegations.childTask")}
                    </Link>
                  ) : null}
                  {d.decisionNote ? <span dir="auto">· {d.decisionNote}</span> : null}
                </span>
              ))}
            </CardBody>
          ) : null}
        </Card>

        <Card id="rollups">
          <CardHeader title={t("workforce.rollups.title")} description={t("workforce.rollups.hint")} />
          {rollups.length === 0 ? (
            <CardBody className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers aria-hidden className="size-4" />
              {t("workforce.rollups.empty")}
            </CardBody>
          ) : (
            <ul className="divide-y">
              {rollups.map((r) => (
                <li key={r.id} className="grid gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <AiAvatar seed={r.aiEmployee.id} department={r.aiEmployee.department} size={24} />
                    <span className="font-medium" dir="auto">
                      {r.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.aiEmployee.name} → {r.manager?.name ?? t("workforce.org.founder")} · {formatRelativeTime(r.createdAt, locale)}
                    </span>
                  </div>
                  <details className="text-sm">
                    <summary className="min-h-8 cursor-pointer py-1 text-primary">{t("workforce.rollups.read")}</summary>
                    <AnswerText text={r.body} locale={locale} className="text-muted-foreground" />
                  </details>
                  {r.taskId ? (
                    <Link className="inline-flex min-h-6 items-center text-xs text-primary hover:underline" href={`/${locale}/tasks/${r.taskId}`}>
                      {t("workforce.reports.sourceTask")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {resolved.length ? (
        <Card>
          <CardHeader title={t("workforce.escalations.recentlyResolved")} />
          <ul className="divide-y text-sm">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <CheckCircle2 aria-hidden className="size-4 text-success" />
                <span className="font-medium">{r.aiEmployee.name}</span>
                <span dir="auto">{r.title}</span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(r.resolvedAt!, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
