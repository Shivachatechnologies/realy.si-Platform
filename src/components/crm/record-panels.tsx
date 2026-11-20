import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/i18n/format";
import { emailTimeline, type EmailSubject } from "@/server/modules/crm/emails";
import { listProposals } from "@/server/modules/crm/proposals";
import { listOwners } from "@/server/modules/crm/service";
import { listSalesTasks, type SalesTaskSubject } from "@/server/modules/crm/tasks";
import { EmailHistoryList } from "./email-history";
import { NewProposalForm } from "./proposals";
import { NewSalesTaskForm, SalesTaskControls } from "./sales-task-forms";
import { PROPOSAL_TONE, crmContext } from "./shell";

/** Server panels shown on CRM record pages: sales tasks, unified email history and a deal's proposals. */

const PRIORITY_TONE = { URGENT: "danger", HIGH: "warning", MEDIUM: "neutral", LOW: "neutral" } as const;

export async function SalesTasksPanel({ subjectType, subjectId, active = true, defaultAssignee }: { subjectType: SalesTaskSubject; subjectId: string; active?: boolean; defaultAssignee?: string | null }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return null;
  const { t, locale, base, org, company, viewer } = c;
  const [tasks, owners] = await Promise.all([listSalesTasks(viewer.ctx, org.id, company.id, subjectType, subjectId), c.canManage ? listOwners(viewer.ctx, org.id, company.id) : Promise.resolve([])]);
  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const open = tasks.filter((x) => x.status !== "DONE" && x.status !== "CANCELLED");
  return (
    <Card>
      <CardHeader title={t("crm.salesTasks.panel")} description={t("crm.salesTasks.openCount", { count: open.length })} />
      <CardBody className="grid gap-3">
        {tasks.length ? (
          <ul className="grid divide-y text-sm">
            {tasks.map((task) => {
              const done = task.status === "DONE";
              const overdue = !done && task.dueDate && task.dueDate < todayStart;
              return (
                <li key={task.id} className="grid gap-1 py-2 first:pt-0">
                  {c.canManage && active ? (
                    <SalesTaskControls base={base} owners={owners} task={{ id: task.id, done, assigneeId: task.assignee?.id ?? null, dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null, title: task.title }} />
                  ) : (
                    <span className={done ? "text-muted-foreground line-through" : "font-medium"}>{task.title}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge tone={PRIORITY_TONE[task.priority]}>{t(`crm.salesTasks.priorities.${task.priority}`)}</Badge>
                    {task.assignee ? <span>{task.assignee.name}</span> : <span>{t("crm.unassigned")}</span>}
                    {task.dueDate ? <span className={overdue ? "text-danger" : undefined}>{t("crm.salesTasks.due", { date: formatDate(task.dueDate, locale, "UTC") })}</span> : null}
                    {done && task.completedAt ? <span>{t("crm.salesTasks.doneOn", { date: formatDate(task.completedAt, locale, c.tz) })}</span> : null}
                    <Link href={`/${locale}/projects/tasks/${task.id}`} className="hover:underline">
                      {t("crm.salesTasks.open")}
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("crm.salesTasks.none")}</p>
        )}
        {c.canManage && active ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">{t("crm.salesTasks.new")}</summary>
            <div className="pt-2">
              <NewSalesTaskForm base={base} subjectType={subjectType} subjectId={subjectId} owners={owners} defaultAssignee={defaultAssignee} />
            </div>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

export async function EmailHistoryPanel({ subjectType, subjectId }: { subjectType: EmailSubject; subjectId: string }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return null;
  const { t, base, org, company, viewer, tz } = c;
  const r = await emailTimeline(viewer.ctx, org.id, company.id, subjectType, subjectId, 1);
  const hidden = [r.hidden.marketing ? t("crm.emails.sources.marketing") : null, r.hidden.inbox ? t("crm.emails.sources.inbox") : null].filter(Boolean).join(", ");
  return (
    <Card>
      <CardHeader title={t("crm.emails.title")} description={r.addresses.length ? t("crm.emails.matching", { addresses: r.addresses.slice(0, 3).join(", ") + (r.addresses.length > 3 ? ` +${r.addresses.length - 3}` : "") }) : t("crm.emails.noAddress")} />
      <CardBody className="grid gap-2">
        <EmailHistoryList base={base} type={subjectType} id={subjectId} total={r.total} tz={tz} initial={r.items.map((i) => ({ ...i, at: i.at.toISOString() }))} />
        {hidden ? <p className="text-xs text-muted-foreground">{t("crm.emails.hiddenSources", { sources: hidden })}</p> : null}
      </CardBody>
    </Card>
  );
}

export async function DealProposalsPanel({ dealId, active = true }: { dealId: string; active?: boolean }) {
  const c = await crmContext();
  if (!c.company || !c.canRead) return null;
  const { t, locale, base, org, company, viewer } = c;
  const list = await listProposals(viewer.ctx, org.id, company.id, { dealId }, { take: 20 });
  return (
    <Card>
      <CardHeader
        title={t("crm.tabs.proposals")}
        description={t("crm.proposals.count", { count: list.total })}
        actions={
          list.total > list.rows.length ? (
            <Link href={`/${locale}/crm/proposals?deal=${dealId}`} className="text-xs hover:underline">
              {t("crm.proposals.viewAll")}
            </Link>
          ) : null
        }
      />
      <CardBody className="grid gap-3">
        {list.rows.length ? (
          <ul className="grid divide-y text-sm">
            {list.rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0">
                <span className="grid min-w-0">
                  <Link href={`/${locale}/crm/proposals/${p.id}`} className="truncate font-medium hover:underline">
                    {p.number} · {p.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    v{p.version}
                    {p.validUntil ? ` · ${t("crm.proposals.validUntilDate", { date: formatDate(p.validUntil, locale, "UTC") })}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney({ amountMinor: p.totalMinor, currency: p.currency }, locale)}</span>
                  <Badge tone={PROPOSAL_TONE[p.status]}>{t(`crm.proposals.status.${p.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("crm.proposals.noneForDeal")}</p>
        )}
        {c.canManage && active ? <NewProposalForm base={base} locale={locale} deals={[]} dealId={dealId} /> : null}
      </CardBody>
    </Card>
  );
}
