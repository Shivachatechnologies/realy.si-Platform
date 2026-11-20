import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Download, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { ActionButton, AiButtons } from "@/components/comms/client";
import { AiTasksCard } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { Markdownish } from "@/components/comms/markdownish";
import { FollowUpForm, FollowUpToggle, ReplyBox, TicketProperties } from "@/components/support/ticket-forms";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/support/bits";
import { getT } from "@/i18n/server";
import { formatDate, formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { listSubjectTasks } from "@/server/modules/agents/service";
import { contactName } from "@/server/modules/support/common";
import { listAgents } from "@/server/modules/support/common";
import { listCategories } from "@/server/modules/support/config";
import { getTicket, publicTicketUrl } from "@/server/modules/support/tickets";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.ticket.title") };
}

const EMAIL_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { SENT: "success", FAILED: "danger", NOT_CONFIGURED: "warning", NO_EMAIL: "warning", QUEUED: "neutral" };

export default async function TicketPage({ params, searchParams }: PageProps<"/[locale]/support/tickets/[ticketId]">) {
  const { ticketId } = await params;
  const p = await areaPage("support", "inbox");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const tk = await getTicket(viewer.ctx, org.id, company.id, ticketId).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const [agents, categories, teams, tasks] = await Promise.all([
    listAgents(viewer.ctx, org.id, company.id),
    listCategories(viewer.ctx, org.id, company.id),
    db().team.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    perms.runAgents ? listSubjectTasks(viewer.ctx, org.id, company.id, "ticket", tk.id) : Promise.resolve([]),
  ]);
  const draftId = typeof sp.draft === "string" ? sp.draft : null;
  const draft = draftId ? tk.messages.find((m) => m.id === draftId && m.isDraft) : null;
  const cls = (tk.classification ?? {}) as { sentiment?: string; matched?: string[]; priority?: string };
  const customerUrl = publicTicketUrl(locale, tk.publicToken);
  const attachmentHref = (id: string) => `${base}/support/attachments/${id}`;
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.ticket.what")} why={t("support.intro.ticket.why")} can={t("support.intro.ticket.can")} accent="warning" />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader
            title={`#${tk.number} ${tk.subject}`}
            description={`${t(`support.channels.${tk.channel}`)} · ${formatDateTime(tk.createdAt, locale, tz)}`}
            actions={
              <div className="flex flex-wrap justify-end gap-1">
                <StatusBadge t={t} status={tk.status} />
                <PriorityBadge t={t} priority={tk.priority} />
                <SlaBadge t={t} locale={locale} tz={tz} ticket={tk} />
              </div>
            }
          />
          <CardBody className="grid gap-2">
            {tk.description ? <Markdownish text={tk.description} /> : <p className="text-sm text-muted-foreground">{t("support.ticket.noDescription")}</p>}
            {tk.attachments.length ? (
              <ul className="flex flex-wrap gap-2">
                {tk.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={attachmentHref(a.id)} className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted">
                      <Paperclip className="size-3" aria-hidden /> {a.fileName} · {Math.max(1, Math.round(a.size / 1024))} KB
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.conversation.title")} description={t("support.conversation.count", { count: tk.messages.filter((m) => m.authorType !== "SYSTEM").length })} />
          {tk.messages.length ? (
            <ul className="grid divide-y">
              {tk.messages.map((m) => {
                const note = m.kind === "INTERNAL_NOTE";
                const system = m.authorType === "SYSTEM";
                return (
                  <li key={m.id} className={cn("grid gap-1.5 px-4 py-3", note && "bg-warning/5", m.authorType === "CUSTOMER" && "bg-accent/30")}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {m.authorType === "AI" ? <Bot className="size-3.5" aria-hidden /> : null}
                      <span className="text-sm font-medium text-foreground">
                        {system ? t("support.conversation.system") : m.authorType === "CUSTOMER" ? (m.authorName ?? t("support.conversation.customer")) : (m.authorName ?? "?")}
                      </span>
                      <Badge tone={note ? "warning" : "neutral"}>{m.isDraft ? t("support.conversation.aiDraft") : t(`support.conversation.kinds.${m.authorType === "CUSTOMER" ? "CUSTOMER" : m.kind}`)}</Badge>
                      <span>{formatDateTime(m.createdAt, locale, tz)}</span>
                      {m.emailStatus ? <Badge tone={EMAIL_TONE[m.emailStatus] ?? "neutral"}>{t(`support.emailStatus.${m.emailStatus}`)}</Badge> : null}
                    </div>
                    {system ? <p className="text-sm text-muted-foreground">{t("support.conversation.receivedNotice")}</p> : <Markdownish text={m.body} />}
                    {m.attachments.length ? (
                      <ul className="flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <li key={a.id}>
                            <a href={attachmentHref(a.id)} className="flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-xs hover:bg-muted">
                              <Download className="size-3" aria-hidden /> {a.fileName} · {Math.max(1, Math.round(a.size / 1024))} KB
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {m.isDraft && perms.manage ? (
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/${locale}/support/tickets/${tk.id}?draft=${m.id}#reply`} className="rounded-md border bg-surface px-2 py-1 text-xs hover:bg-muted">
                          {t("support.conversation.useDraft")}
                        </Link>
                        <ActionButton path={`${base}/support/tickets/${tk.id}/drafts/${m.id}`} method="DELETE" variant="ghost">
                          {t("support.conversation.dismissDraft")}
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t("support.conversation.empty")}</p>
          )}
          {perms.manage ? (
            <CardBody id="reply" className="border-t">
              {tk.status === "CLOSED" ? <Notice className="mb-2">{t("support.reply.closedNotice")}</Notice> : null}
              <ReplyBox key={draft?.id ?? "reply"} base={base} ticketId={tk.id} status={tk.status} hasEmail={!!tk.requester?.email} prefill={draft ? { id: draft.id, body: draft.body } : null} />
            </CardBody>
          ) : null}
        </Card>
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={t("support.ticket.properties")} />
          <CardBody>
            {perms.manage ? (
              <TicketProperties base={base} agents={agents} categories={categories.map((c) => ({ id: c.id, name: c.name }))} teams={teams} ticket={{ id: tk.id, status: tk.status, priority: tk.priority, assigneeId: tk.assigneeId, categoryId: tk.categoryId, teamId: tk.teamId, tags: tk.tags }} />
            ) : (
              <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-1.5 text-sm">
                <dt className="text-muted-foreground">{t("support.ticket.assignee")}</dt>
                <dd>{tk.assigneeName ?? t("support.ticket.unassigned")}</dd>
                <dt className="text-muted-foreground">{t("support.ticket.category")}</dt>
                <dd>{tk.category?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("support.ticket.team")}</dt>
                <dd>{tk.team?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("support.ticket.tags")}</dt>
                <dd>{tk.tags.join(", ") || "—"}</dd>
              </dl>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.ticket.requester")} />
          <CardBody className="grid gap-2 text-sm">
            {tk.requester ? (
              <>
                <Link href={`/${locale}/support/customers/contact/${tk.requester.id}`} className="font-medium hover:underline">
                  {contactName(tk.requester)}
                </Link>
                <span className="text-muted-foreground">{[tk.requester.email, tk.requester.phone].filter(Boolean).join(" · ") || "—"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("support.ticket.noRequester")}</span>
            )}
            {tk.account ? (
              <Link href={`/${locale}/support/customers/account/${tk.account.id}`} className="hover:underline">
                {tk.account.name}
              </Link>
            ) : null}
            {tk.otherTickets.length ? (
              <div className="grid gap-1 border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground">{t("support.ticket.otherTickets")}</p>
                {tk.otherTickets.map((o) => (
                  <Link key={o.id} href={`/${locale}/support/tickets/${o.id}`} className="flex items-center gap-2 text-xs hover:underline">
                    <span className="tabular-nums text-muted-foreground">#{o.number}</span>
                    <span className="min-w-0 flex-1 truncate">{o.subject}</span>
                    <StatusBadge t={t} status={o.status} />
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="grid gap-1 border-t pt-2">
              <p className="text-xs font-medium text-muted-foreground">{t("support.ticket.customerLink")}</p>
              <a href={customerUrl} target="_blank" rel="noreferrer" className="break-all text-xs underline">
                {customerUrl}
              </a>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.sla.title")} description={tk.slaPolicy?.name ?? t("support.sla.noPolicy")} />
          <CardBody>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 text-sm">
              <dt className="text-muted-foreground">{t("support.sla.firstResponseDue")}</dt>
              <dd className={tk.firstResponseBreachedAt ? "text-danger" : ""}>{tk.firstResponseDueAt ? formatDateTime(tk.firstResponseDueAt, locale, tz) : "—"}</dd>
              <dt className="text-muted-foreground">{t("support.sla.firstResponded")}</dt>
              <dd>{tk.firstRespondedAt ? formatDateTime(tk.firstRespondedAt, locale, tz) : "—"}</dd>
              <dt className="text-muted-foreground">{t("support.sla.resolutionDue")}</dt>
              <dd className={tk.resolutionBreachedAt ? "text-danger" : ""}>{tk.resolutionDueAt ? formatDateTime(tk.resolutionDueAt, locale, tz) : "—"}</dd>
              <dt className="text-muted-foreground">{t("support.sla.solved")}</dt>
              <dd>{tk.solvedAt ? formatDateTime(tk.solvedAt, locale, tz) : "—"}</dd>
              {tk.escalationLevel ? (
                <>
                  <dt className="text-muted-foreground">{t("support.sla.escalation")}</dt>
                  <dd className="text-warning">{t("support.sla.escalationLevel", { level: tk.escalationLevel })}</dd>
                </>
              ) : null}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.classification.title")} description={t("support.classification.description")} />
          <CardBody className="grid gap-1 text-sm">
            <p>
              {t("support.classification.sentiment")}: <Badge tone={cls.sentiment === "negative" ? "danger" : cls.sentiment === "positive" ? "success" : "neutral"}>{t(`support.classification.sentiments.${cls.sentiment ?? "neutral"}`)}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">{cls.matched?.length ? t("support.classification.matched", { words: cls.matched.slice(0, 8).join(", ") }) : t("support.classification.noMatch")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("support.followUps.heading")} />
          <CardBody className="grid gap-3">
            {tk.followUps.length ? (
              <ul className="grid gap-1.5">
                {tk.followUps.map((fu) => (
                  <li key={fu.id} className="flex flex-wrap items-center gap-2 text-sm">
                    {perms.manage ? <FollowUpToggle base={base} ticketId={tk.id} taskId={fu.id} done={fu.status === "DONE"} /> : null}
                    <span className={fu.status === "DONE" ? "text-muted-foreground line-through" : ""}>{fu.title}</span>
                    {fu.assigneeName ? <Badge>{fu.assigneeName}</Badge> : null}
                    {fu.dueDate ? <span className="text-xs text-muted-foreground">{formatDate(fu.dueDate, locale, "UTC")}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("support.followUps.none")}</p>
            )}
            {perms.manage ? <FollowUpForm base={base} ticketId={tk.id} agents={agents} /> : null}
          </CardBody>
        </Card>
        {perms.runAgents ? (
          <AiTasksCard
            t={t}
            locale={locale}
            tz={tz}
            title={t("support.ai.title")}
            description={t("support.ai.description")}
            tasks={tasks}
            notConfigured={!perms.aiReady}
            actions={
              <AiButtons
                path={`${base}/support/tickets/${tk.id}/ai`}
                modes={[
                  { mode: "suggest_reply", label: t("support.ai.suggestReply") },
                  { mode: "summarize", label: t("support.ai.summarize") },
                  { mode: "sentiment", label: t("support.ai.sentiment") },
                  { mode: "resolution", label: t("support.ai.resolution") },
                  { mode: "escalation", label: t("support.ai.escalation") },
                ]}
              />
            }
          />
        ) : null}
        <Link href={`/${locale}/support`} className="text-sm hover:underline">
          ← {t("support.backToInbox")}
        </Link>
      </div>
    </div>
    </>,
  );
}
