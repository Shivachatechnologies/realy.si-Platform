import type { Metadata } from "next";
import Link from "next/link";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { NewTicketForm, CHANNELS, PRIORITIES } from "@/components/support/ticket-forms";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/support/bits";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listAgents } from "@/server/modules/support/common";
import { listCategories } from "@/server/modules/support/config";
import { listTickets, parseTicketFilters, SORTS, viewCounts, VIEWS } from "@/server/modules/support/tickets";
import { cn } from "@/lib/utils";
import { Inbox, Sparkles } from "lucide-react";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { SentimentStrip, SlaTimers, TicketFlow } from "@/components/support/pulse";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { supportPulse } from "@/server/modules/support/setup";
import { ensureSettings } from "@/server/modules/support/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.support.title") };
}

export default async function SupportInboxPage({ searchParams }: PageProps<"/[locale]/support">) {
  const p = await areaPage("support", "inbox");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const f = parseTicketFilters(sp);
  const [list, counts, agents, categories, teams] = await Promise.all([
    listTickets(viewer.ctx, org.id, company.id, f),
    viewCounts(viewer.ctx, org.id, company.id),
    listAgents(viewer.ctx, org.id, company.id),
    listCategories(viewer.ctx, org.id, company.id),
    db().team.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const [pulse, settings, helpTask] = await Promise.all([
    supportPulse(viewer.ctx, org.id, company.id),
    ensureSettings(db(), org.id, company.id),
    latestSubjectTask(viewer.ctx, org.id, company.id, "support_inbox", company.id),
  ]);
  const path = `/${locale}/support`;
  const setupPending = perms.manage && !settings.setupCompletedAt;
  const viewHref = (v: string) => `${path}${v === "open" ? "" : `?view=${v}`}`;
  const filtered = !!(f.q || f.priority || f.categoryId || f.assigneeId || f.channel || f.status);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  return wrap(
    <>
    <PageIntro
      labels={introLabels(t)}
      what={t("support.intro.inbox.what")}
      why={t("support.intro.inbox.why")}
      can={t("support.intro.inbox.can")}
      next={setupPending ? { label: t("support.intro.inbox.setup"), href: `${path}/setup` } : { label: t("support.intro.inbox.next"), href: viewHref("mine") }}
      accent="warning"
      extra={
        <HelpMeButton
          base={base}
          aiReady={perms.aiReady && perms.runAgents}
          profile="support_lead"
          subject={{ type: "support_inbox", id: company.id }}
          title="Help me with the support inbox"
          instructions="The person is looking at the support inbox and is not a support expert. Read the queue (read_support_queue, views open, breached and unassigned). In plain words: which tickets to handle first and why (SLA risk, urgency, unhappy customers), who should take them, and any recurring problem worth a help article. Do not reply to customers; drafts and replies need approval."
          initial={helpTask}
        />
      }
    />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title={t("support.pulse.flowTitle")} description={t("support.pulse.flowHint")} />
        <CardBody>
          <TicketFlow flow={pulse.flow} hrefs={{ NEW: viewHref("unassigned"), OPEN: viewHref("open"), PENDING: viewHref("pending"), ON_HOLD: viewHref("all"), SOLVED: viewHref("solved") }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("support.pulse.sentimentTitle")} description={t("support.pulse.sentimentHint")} />
        <CardBody>
          <SentimentStrip days={pulse.sentiment} locale={locale} />
        </CardBody>
      </Card>
    </div>
    <Card>
      <CardHeader title={t("support.pulse.timersTitle")} description={t("support.pulse.timersHint")} />
      <CardBody>
        <SlaTimers items={pulse.sla.map((x) => ({ ...x, dueAt: x.dueAt.toISOString() }))} locale={locale} />
      </CardBody>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:grid lg:content-start" aria-label={t("support.views.label")}>
        {VIEWS.map((v) => (
          <Link key={v} href={hrefWith(path, {}, { view: v === "open" ? undefined : v })} aria-current={f.view === v ? "page" : undefined} className={cn("flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-1.5 text-sm", f.view === v ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
            {t(`support.views.${v}`)}
            <span className={cn("tabular-nums text-xs", v === "breached" && counts[v] ? "text-danger" : "")}>{counts[v]}</span>
          </Link>
        ))}
      </nav>
      <div className="grid content-start gap-4">
        {perms.manage ? (
          <Card>
            <details>
              <summary className="cursor-pointer p-4 text-sm font-medium">{t("support.ticket.new")}</summary>
              <NewTicketForm base={base} locale={locale} agents={agents} categories={categories.map((c) => ({ id: c.id, name: c.name }))} teams={teams} />
            </details>
          </Card>
        ) : null}
        <Card>
          <form className="grid gap-2 border-b p-3 sm:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_8rem_9rem_9rem_8rem_8rem_auto]" action={path}>
            {f.view !== "open" ? <input type="hidden" name="view" value={f.view} /> : null}
            <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} placeholder={t("support.search")} aria-label={t("support.search")} className="sm:col-span-3 xl:col-span-1" />
            <Select name="priority" defaultValue={f.priority ?? ""} aria-label={t("support.ticket.priority")}>
              <option value="">{t("support.filters.anyPriority")}</option>
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {t(`support.priorities.${x}`)}
                </option>
              ))}
            </Select>
            <Select name="category" defaultValue={f.categoryId ?? ""} aria-label={t("support.ticket.category")}>
              <option value="">{t("support.filters.anyCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select name="assignee" defaultValue={f.assigneeId ?? ""} aria-label={t("support.ticket.assignee")}>
              <option value="">{t("support.filters.anyAssignee")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select name="channel" defaultValue={f.channel ?? ""} aria-label={t("support.ticket.channel")}>
              <option value="">{t("support.filters.anyChannel")}</option>
              {CHANNELS.map((x) => (
                <option key={x} value={x}>
                  {t(`support.channels.${x}`)}
                </option>
              ))}
            </Select>
            <Select name="sort" defaultValue={f.sort} aria-label={t("support.filters.sort")}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`support.sorts.${s}`)}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="secondary">
                {t("support.apply")}
              </Button>
              {filtered ? (
                <Link className="text-xs text-muted-foreground hover:underline" href={hrefWith(path, {}, { view: f.view === "open" ? undefined : f.view })}>
                  {t("support.clear")}
                </Link>
              ) : null}
            </div>
          </form>
          {list.data.length === 0 ? (
            !filtered && f.view === "open" && pulse.flow.SOLVED + pulse.flow.CLOSED === 0 ? (
              <SmartEmpty
                icon={<Inbox />}
                title={t("support.emptyInbox.title")}
                body={t("support.emptyInbox.body")}
                primary={perms.manage ? <Link href={`${path}/setup`} className={buttonVariants({ size: "sm" })}><Sparkles aria-hidden /> {t("support.intro.inbox.setup")}</Link> : undefined}
                ai={<Link href={`/${locale}/support-form/${company.id}`} target="_blank" className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("support.emptyInbox.form")}</Link>}
              />
            ) : (
              <EmptyState>{filtered ? t("common.noResults") : t(`support.empty.${f.view}`)}</EmptyState>
            )
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>#</Th>
                  <Th>{t("support.ticket.subject")}</Th>
                  <Th className="hidden md:table-cell">{t("support.ticket.requester")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="hidden sm:table-cell">{t("support.ticket.priority")}</Th>
                  <Th className="hidden lg:table-cell">{t("support.ticket.assignee")}</Th>
                  <Th className="hidden md:table-cell">{t("support.sla.title")}</Th>
                  <Th className="hidden xl:table-cell">{t("support.updated")}</Th>
                </Tr>
              </THead>
              <TBody>
                {list.data.map((tk) => (
                  <Tr key={tk.id}>
                    <Td className="tabular-nums text-muted-foreground">{tk.number}</Td>
                    <Td className="max-w-[24rem]">
                      <Link href={`${path}/tickets/${tk.id}`} className="block truncate font-medium hover:underline">
                        {tk.subject}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {t(`support.channels.${tk.channel}`)}
                        {tk.category ? ` · ${tk.category.name}` : ""}
                      </span>
                    </Td>
                    <Td className="hidden max-w-48 truncate md:table-cell">{tk.requester ? [tk.requester.firstName, tk.requester.lastName].filter(Boolean).join(" ") : "—"}{tk.account ? <span className="block text-xs text-muted-foreground">{tk.account.name}</span> : null}</Td>
                    <Td>
                      <StatusBadge t={t} status={tk.status} />
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <PriorityBadge t={t} priority={tk.priority} />
                    </Td>
                    <Td className="hidden lg:table-cell">{tk.assigneeName ?? <span className="text-muted-foreground">{t("support.ticket.unassigned")}</span>}</Td>
                    <Td className="hidden md:table-cell">
                      <SlaBadge t={t} locale={locale} tz={tz} ticket={tk} />
                    </Td>
                    <Td className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">{formatRelativeTime(tk.updatedAt, locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
          <Pager
            labels={{ prev: t("common.previous"), next: t("common.next") }}
            info={t("support.pageInfo", { page: list.page, pages, total: list.total })}
            prevHref={list.page > 1 ? hrefWith(path, sp, { page: list.page - 1 }) : null}
            nextHref={list.page < pages ? hrefWith(path, sp, { page: list.page + 1 }) : null}
          />
        </Card>
      </div>
    </div>
    </>,
  );
}
