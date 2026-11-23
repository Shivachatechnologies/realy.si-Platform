import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminHeader, EmptyState, QuickFilters, sp } from "@/components/admin/kit";
import { DataTable, type DataTableRow } from "@/components/admin/data-table/data-table";
import { filterParams, tableParams } from "@/components/admin/data-table/params";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { MarkAllRead, MarkSelected } from "@/components/admin/notifications/actions";
import { getLocale, getT } from "@/i18n/server";
import { listNotifications } from "@/server/modules/admin/notifications";
import { requestTime, requireViewer } from "@/server/session";

/** Admin notifications (stream A): everything raised for you or your roles, newest first; read state, filters, deep links. */
export default async function NotificationsPage({ searchParams }: PageProps<"/[locale]/notifications">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const raw = await searchParams;
  const { cursor, pageSize } = tableParams(raw);
  const filter = sp(raw.filter) === "unread" ? "unread" : "all";
  const severity = ["INFO", "WARNING", "CRITICAL"].find((s) => s === sp(raw.severity));
  const r = await listNotifications(viewer.ctx, { filter, severity, cursor, limit: pageSize });
  const base = `/${locale}`;
  const path = `${base}/notifications`;
  const query = filterParams(raw, ["filter", "severity"]);

  const rows: DataTableRow[] = r.data.map((n) => ({
    id: n.id,
    href: n.href ? `${base}${n.href}` : undefined,
    cells: {
      title: (
        <span className="flex min-w-0 items-start gap-2">
          <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-border" : n.severity === "CRITICAL" ? "bg-danger" : n.severity === "WARNING" ? "bg-warning" : "bg-info"}`} />
          <span className="min-w-0">
            <span className={`block truncate ${n.read ? "" : "font-semibold"}`}>{n.title}</span>
            {n.body ? <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span> : null}
          </span>
        </span>
      ),
      severity: (
        <StatusBadge domain="notificationSeverity" value={n.severity}>
          {t(`admin.notifications.severity.${n.severity}`)}
        </StatusBadge>
      ),
      type: <span className="font-mono text-[11px] text-muted-foreground">{n.type}</span>,
      audience: <span className="text-xs text-muted-foreground">{n.roleWide ? t("admin.notifications.roleWide") : t("admin.notifications.personal")}</span>,
      occurrences: n.occurrences,
      raised: <Timestamp value={n.lastRaisedAt} mode="relative" />,
      status: n.read ? <span className="text-xs text-muted-foreground">{t("admin.notifications.read")}</span> : <Badge tone="accent">{t("admin.notifications.unread")}</Badge>,
    },
    csv: { title: n.title, severity: n.severity, type: n.type, occurrences: n.occurrences, raised: n.lastRaisedAt, status: n.read ? "read" : "unread" },
  }));

  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Bell />} title={t("admin.notifications.title")} description={t("admin.notifications.subtitle")} actions={<MarkAllRead />} meta={<Link href={`${base}/me#notifications`} className="text-xs text-primary hover:underline">{t("admin.notifications.preferences")}</Link>} />
      <DataTable
        id="notifications"
        caption={t("admin.notifications.title")}
        query={query}
        filterKeys={["filter", "severity"]}
        toolbar={
          <div className="flex flex-wrap items-center gap-1">
            <QuickFilters base={path} name="filter" value={filter === "all" ? "" : filter} params={{ severity }} label={t("admin.notifications.filter")} options={[{ value: "", label: t("admin.common.all") }, { value: "unread", label: t("admin.notifications.unread") }]} />
            <QuickFilters
              base={path}
              name="severity"
              value={severity}
              params={{ filter: filter === "unread" ? "unread" : undefined }}
              label={t("admin.notifications.severityLabel")}
              options={[{ value: "", label: t("admin.notifications.anySeverity") }, ...(["CRITICAL", "WARNING", "INFO"] as const).map((s) => ({ value: s, label: t(`admin.notifications.severity.${s}`) }))]}
            />
          </div>
        }
        columns={[
          { id: "title", header: t("admin.notifications.cols.title"), hideable: false },
          { id: "severity", header: t("admin.notifications.cols.severity") },
          { id: "type", header: t("admin.notifications.cols.type"), defaultHidden: true },
          { id: "audience", header: t("admin.notifications.cols.audience"), defaultHidden: true },
          { id: "occurrences", header: t("admin.notifications.cols.occurrences"), align: "end", defaultHidden: true },
          { id: "raised", header: t("admin.notifications.cols.raised") },
          { id: "status", header: t("admin.notifications.cols.status") },
        ]}
        rows={rows}
        pagination={{ nextCursor: r.nextCursor, pageSize }}
        selectable
        bulkBar={<MarkSelected />}
        exportOptions={{ allowed: true, filename: "notifications.csv" }}
        meta={{ source: "platform_notifications", loadedAt: requestTime(), staleAfterMs: 5 * 60_000 }}
        empty={<EmptyState icon={<BellOff />} title={t("admin.notifications.empty")} body={t("admin.notifications.emptyHint")} />}
      />
    </div>
  );
}
