import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, AuditTimeline, Facts, guard } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SelectAction } from "@/components/admin/security/actions";
import { LinkTicket, ReplyComposer } from "@/components/admin/support/ticket-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { SLA_HOURS, TICKET_PRIORITIES, supportTicket } from "@/server/modules/admin/support";
import { requireViewer } from "@/server/session";

/** One platform support ticket: conversation (internal notes marked), people, SLA, links, actions and history. */
export default async function SupportTicketPage({ params }: PageProps<"/[locale]/support/[ticketId]">) {
  const { ticketId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(Promise.all([supportTicket(viewer.ctx, ticketId), canPlatform(viewer.ctx, "platform.support.manage")]), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const [d, canManage] = r.value;
  const tk = d.ticket;
  const base = `/${locale}`;
  const api = `/api/v1/admin/support/${tk.id}`;
  const closed = tk.status === "CLOSED";
  const finished = tk.status === "SOLVED" || tk.status === "CLOSED";
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: `#${tk.number}` }]} />
      <AdminHeader
        icon={<LifeBuoy />}
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-xs">#{tk.number}</span>
            <StatusBadge domain="platformTicket" value={tk.status}>
              {t(`admin.support.statuses.${tk.status}`)}
            </StatusBadge>
            <StatusBadge domain="ticketPriority" value={tk.priority}>
              {t(`admin.support.priorities.${tk.priority}`)}
            </StatusBadge>
            {tk.escalationLevel ? <Badge tone="danger">{t("admin.support.escalated", { level: tk.escalationLevel })}</Badge> : null}
          </span>
        }
        title={tk.subject}
        description={t("admin.support.ticketSubtitle")}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <SelectAction path={`${api}/assign`} method="PUT" field="assigneeId" nullable current={tk.assigneeId} label={tk.assigneeId ? t("admin.support.reassign") : t("admin.support.assign")} title={t("admin.support.assignTitle")} options={d.staff.map((s) => ({ value: s.id, label: `${s.name} · ${s.email}` }))} />
              <SelectAction path={`${api}/priority`} method="PUT" field="priority" current={tk.priority} label={t("admin.support.priority")} title={t("admin.support.priorityTitle")} options={TICKET_PRIORITIES.map((p) => ({ value: p, label: `${t(`admin.support.priorities.${p}`)} · ${t("admin.support.slaHours", { hours: SLA_HOURS[p] })}` }))} />
              {!finished ? <ActionButton label={t("admin.support.escalate")} title={t("admin.support.escalateTitle")} description={t("admin.support.escalateHint")} path={`${api}/escalate`} method="POST" /> : null}
              {!finished ? <ActionButton label={t("admin.support.solve")} title={t("admin.support.solveTitle")} path={`${api}/status`} method="PUT" body={{ status: "SOLVED" }} /> : null}
              {!closed ? <ActionButton label={t("admin.support.close")} title={t("admin.support.closeTitle")} description={t("admin.support.closeHint")} path={`${api}/status`} method="PUT" body={{ status: "CLOSED" }} danger /> : null}
              {finished ? <ActionButton label={t("admin.support.reopen")} title={t("admin.support.reopenTitle")} path={`${api}/status`} method="PUT" body={{ status: "OPEN" }} /> : null}
              {!finished && tk.status !== "ON_HOLD" ? <ActionButton label={t("admin.support.hold")} title={t("admin.support.holdTitle")} path={`${api}/status`} method="PUT" body={{ status: "ON_HOLD" }} variant="ghost" /> : null}
              <LinkTicket ticketId={tk.id} incidentId={tk.incidentId} organizationId={tk.organizationId} tags={tk.tags} />
            </div>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.support.conversation")} description={t("admin.support.conversationHint")} />
            <ol className="grid gap-3 p-4">
              {d.messages.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    m.internal ? "border-warning/40 bg-warning/5" : m.authorType === "customer" ? "bg-surface" : m.authorType === "system" ? "border-dashed bg-muted/40 text-xs" : "border-primary/30 bg-accent/40",
                  )}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{m.author?.name ?? (m.authorType === "customer" ? tk.requesterEmail : t(`admin.support.authors.${m.authorType}`))}</span>
                    <Badge tone={m.authorType === "customer" ? "neutral" : "accent"}>{t(`admin.support.authors.${m.authorType}`)}</Badge>
                    {m.internal ? (
                      <Badge tone="warning">
                        <Lock className="size-3" aria-hidden /> {t("admin.support.internal")}
                      </Badge>
                    ) : null}
                    {m.emailStatus ? <StatusBadge domain="emailStatus" value={m.emailStatus}>{t("admin.support.emailStatus", { status: m.emailStatus })}</StatusBadge> : null}
                    <time dateTime={m.createdAt.toISOString()} title={formatDateTime(m.createdAt, locale, viewer.user.timezone)} className="ms-auto">
                      {formatRelativeTime(m.createdAt, locale)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ol>
            {canManage ? <ReplyComposer ticketId={tk.id} closed={closed} /> : null}
          </Card>
          <Card>
            <CardHeader title={t("admin.support.history")} />
            {d.audit.length ? (
              <AuditTimeline
                items={d.audit.map((a) => ({ id: a.id, who: a.actor?.name ?? t("admin.support.authors.system"), action: a.action.replace("platform_support.", ""), security: false, reason: a.reason, iso: a.createdAt.toISOString(), exact: formatDateTime(a.createdAt, locale, viewer.user.timezone), relative: formatRelativeTime(a.createdAt, locale) }))}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{t("admin.settings.kit.noEvents")}</p>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.support.details")} />
            <Facts
              rows={[
                [t("admin.support.requester"), d.requester ? <Link key="r" href={`${base}/users/${d.requester.id}`} className="text-primary hover:underline">{d.requester.name}</Link> : tk.requesterEmail],
                [t("admin.support.email"), <span key="e" className="inline-flex items-center gap-1 text-xs">{tk.requesterEmail}<CopyButton value={tk.requesterEmail} /></span>],
                [t("admin.support.organization"), d.organization ? <Link key="o" href={`${base}/support/customers/${d.organization.id}`} className="text-primary hover:underline">{d.organization.name}</Link> : "—"],
                [t("admin.support.assignee"), d.assignee?.name ?? t("admin.support.unassigned")],
                [t("admin.support.category"), tk.category ? t(`admin.support.categories.${tk.category}`) : "—"],
                [t("admin.support.channel"), tk.channel],
                [t("admin.support.created"), <Timestamp key="c" value={tk.createdAt} />],
                [t("admin.support.sla"), <span key="s"><StatusBadge domain="ticketSla" value={tk.slaState}>{t(`admin.support.slaStates.${tk.slaState}`)}</StatusBadge> {tk.slaDueAt ? <Timestamp value={tk.slaDueAt} mode="absolute" className="text-xs" /> : null}</span>],
                [t("admin.support.firstResponse"), tk.firstResponseAt ? <Timestamp key="f" value={tk.firstResponseAt} /> : "—"],
                [t("admin.support.incident"), tk.incidentId ? <Link key="i" href={`${base}/incidents/${tk.incidentId}`} className="font-mono text-xs text-primary hover:underline">{tk.incidentId.slice(0, 8)}</Link> : "—"],
                [t("admin.support.tags"), tk.tags.length ? tk.tags.join(", ") : "—"],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t("admin.support.related")} description={t("admin.support.relatedHint")} />
            {d.related.length ? (
              <ul className="divide-y text-xs">
                {d.related.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link href={`${base}/support/${x.id}`} className="truncate hover:underline">
                      #{x.number} {x.subject}
                    </Link>
                    <StatusBadge domain="platformTicket" value={x.status}>{t(`admin.support.statuses.${x.status}`)}</StatusBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">{t("admin.support.noRelated")}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
