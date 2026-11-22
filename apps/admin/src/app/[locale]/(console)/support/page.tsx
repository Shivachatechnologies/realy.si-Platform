import Link from "next/link";
import { AlertTriangle, Clock, Inbox, LifeBuoy, UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, NextPage, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, supportQueue } from "@/server/modules/admin/support";
import { requireViewer } from "@/server/session";

/** Platform support queue: customers' tickets to Realy (not a company's own helpdesk). */
export default async function SupportQueuePage({ searchParams }: PageProps<"/[locale]/support">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { status: sp(q.status), priority: sp(q.priority), assignee: sp(q.assignee), org: sp(q.org), user: sp(q.user), category: sp(q.category), sla: sp(q.sla), q: sp(q.q) };
  const r = await guard(supportQueue(viewer.ctx, { ...params, cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const base = `/${locale}/support`;
  const c = page.counts.byStatus;
  const open = (c.NEW ?? 0) + (c.OPEN ?? 0) + (c.PENDING_CUSTOMER ?? 0) + (c.ON_HOLD ?? 0);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader icon={<LifeBuoy />} title={t("admin.support.title")} description={t("admin.support.subtitle")} why={t("admin.support.why")} meta={<SourceNote source="platform_support_tickets" at={new Date()} label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} />} />
      <StatGrid>
        <StatTile icon={<Inbox />} label={t("admin.support.open")} value={open} hint={t("admin.support.newCount", { count: c.NEW ?? 0 })} href={`${base}?status=open`} />
        <StatTile icon={<UserX />} label={t("admin.support.unassigned")} value={page.counts.unassigned} href={`${base}?assignee=none`} tone={page.counts.unassigned ? "warning" : undefined} />
        <StatTile icon={<AlertTriangle />} label={t("admin.support.slaBreached")} value={page.counts.breached} href={`${base}?sla=breached`} tone={page.counts.breached ? "danger" : undefined} />
        <StatTile icon={<Clock />} label={t("admin.support.pendingCustomer")} value={c.PENDING_CUSTOMER ?? 0} href={`${base}?status=PENDING_CUSTOMER`} />
      </StatGrid>
      <Card>
        <QuickFilters
          base={base}
          name="assignee"
          value={params.assignee}
          params={params}
          label={t("admin.support.assignee")}
          options={[
            { value: "", label: t("admin.common.all") },
            { value: "me", label: t("admin.support.mine") },
            { value: "none", label: t("admin.support.unassigned") },
          ]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.support.search")}
          values={params}
          submitLabel={t("admin.settings.kit.apply")}
          filters={[
            { name: "status", label: t("admin.support.status"), options: [{ value: "open", label: t("admin.support.openStatuses") }, { value: "all", label: t("admin.common.all") }, ...(["NEW", "OPEN", "PENDING_CUSTOMER", "ON_HOLD", "SOLVED", "CLOSED"] as const).map((s) => ({ value: s, label: t(`admin.support.statuses.${s}`) }))] },
            { name: "priority", label: t("admin.support.priority"), options: TICKET_PRIORITIES.map((p) => ({ value: p, label: t(`admin.support.priorities.${p}`) })) },
            { name: "category", label: t("admin.support.category"), options: TICKET_CATEGORIES.map((p) => ({ value: p, label: t(`admin.support.categories.${p}`) })) },
            { name: "sla", label: t("admin.support.sla"), options: [{ value: "breached", label: t("admin.support.slaStates.breached") }, { value: "due", label: t("admin.support.slaStates.due") }] },
          ]}
          extra={
            <>
              {params.assignee ? <input type="hidden" name="assignee" value={params.assignee} /> : null}
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
              {params.user ? <input type="hidden" name="user" value={params.user} /> : null}
              {Object.values(params).some(Boolean) ? (
                <Link href={base} className="self-center text-xs text-primary hover:underline">
                  {t("admin.common.clearFilters")}
                </Link>
              ) : null}
            </>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<LifeBuoy />} title={t("admin.support.empty")} body={t("admin.support.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.support.ticket")}</Th>
                <Th>{t("admin.support.requester")}</Th>
                <Th>{t("admin.support.status")}</Th>
                <Th>{t("admin.support.priority")}</Th>
                <Th>{t("admin.support.sla")}</Th>
                <Th>{t("admin.support.assignee")}</Th>
                <Th>{t("admin.support.updated")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((tk) => (
                <Tr key={tk.id}>
                  <Td>
                    <Link href={`${base}/${tk.id}`} className="font-medium text-primary hover:underline">
                      <span className="font-mono text-xs text-muted-foreground">#{tk.number}</span> {tk.subject}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">
                      {tk.category ? t(`admin.support.categories.${tk.category}`) : null}
                      {tk.escalationLevel ? ` · ${t("admin.support.escalated", { level: tk.escalationLevel })}` : null}
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <div>{tk.requester?.name ?? tk.requesterEmail}</div>
                    {tk.organization ? (
                      <Link href={`${base}/customers/${tk.organization.id}`} className="text-[11px] text-muted-foreground hover:underline">
                        {tk.organization.name}
                      </Link>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge domain="platformTicket" value={tk.status}>
                      {t(`admin.support.statuses.${tk.status}`)}
                    </StatusBadge>
                  </Td>
                  <Td>
                    <StatusBadge domain="ticketPriority" value={tk.priority}>
                      {t(`admin.support.priorities.${tk.priority}`)}
                    </StatusBadge>
                  </Td>
                  <Td className="text-xs">
                    <StatusBadge domain="ticketSla" value={tk.slaState}>
                      {t(`admin.support.slaStates.${tk.slaState}`)}
                    </StatusBadge>
                    {tk.slaDueAt && !tk.firstResponseAt ? (
                      <div className="text-[11px] text-muted-foreground">
                        <Timestamp value={tk.slaDueAt} mode="relative" />
                      </div>
                    ) : null}
                  </Td>
                  <Td className="text-xs">{tk.assignee?.name ?? <span className="text-muted-foreground">{t("admin.support.unassigned")}</span>}</Td>
                  <Td className="text-xs text-muted-foreground">
                    <Timestamp value={tk.updatedAt} mode="relative" />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
