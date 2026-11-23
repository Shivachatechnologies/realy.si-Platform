import Link from "next/link";
import { notFound } from "next/navigation";
import { Bug, GitCommit, ListOrdered, Lock, Route, ScrollText, Siren } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, EmptyState, Facts, guard, NextPage, StatGrid, StatTile } from "@/components/admin/kit";
import { Sparkline } from "@/components/admin/viz";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { ERROR_STATUSES, getErrorGroup } from "@/server/modules/admin/errors";
import { platformStaffOptions } from "@/server/modules/admin/incidents";
import { requireViewer } from "@/server/session";

/** One error group: occurrences over time, releases, routes, events (stack traces need platform.logs.read), triage. */
export default async function ErrorGroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { id } = await params;
  const cursor = (await searchParams).cursor;
  const r = await guard(
    getErrorGroup(viewer.ctx, id, { eventsCursor: typeof cursor === "string" ? cursor : undefined }).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const d = r.value;
  const g = d.group;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.incidents.manage", "platform.alerts.manage"] as const);
  const canManage = caps["platform.incidents.manage"] || caps["platform.alerts.manage"];
  const [staff, incidents] = canManage ? await Promise.all([platformStaffOptions(), db().platformIncident.findMany({ where: { status: { not: "CLOSED" } }, orderBy: { detectedAt: "desc" }, take: 30, select: { id: true, number: true, title: true } })]) : [[], []];
  const base = `/${locale}`;
  const path = `/api/v1/admin/errors/${g.id}`;
  const statusAction = (s: (typeof ERROR_STATUSES)[number], label: string) => <OpsAction key={s} label={label} title={label} path={path} method="PATCH" body={{ status: s }} success={t("admin.errors.updated")} />;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: g.name }]} />
      <AdminHeader
        icon={<Bug />}
        eyebrow={
          <StatusBadge domain="errorGroup" value={g.status}>
            {t(`admin.errors.status.${g.status}`)}
          </StatusBadge>
        }
        title={g.name}
        description={g.message}
        meta={<CopyButton value={g.fingerprint} label={t("admin.errors.fields.fingerprint")} />}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {g.status !== "RESOLVED" ? statusAction("RESOLVED", t("admin.errors.actions.resolve")) : null}
              {g.status === "OPEN" || g.status === "REGRESSED" ? statusAction("ACKNOWLEDGED", t("admin.errors.actions.acknowledge")) : null}
              {g.status !== "IGNORED" ? statusAction("IGNORED", t("admin.errors.actions.ignore")) : null}
              {g.status === "RESOLVED" || g.status === "IGNORED" ? statusAction("OPEN", t("admin.errors.actions.reopen")) : null}
              <OpsAction label={t("admin.errors.actions.assign")} title={t("admin.errors.actions.assign")} path={path} method="PATCH" success={t("admin.errors.updated")} fields={[{ name: "assigneeId", label: t("admin.errors.fields.assignee"), type: "select", required: true, defaultValue: g.assigneeId ?? viewer.user.id, options: staff.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })) }]} />
              {incidents.length ? <OpsAction label={t("admin.errors.actions.linkIncident")} title={t("admin.errors.actions.linkIncident")} path={path} method="PATCH" success={t("admin.errors.updated")} fields={[{ name: "incidentId", label: t("admin.alerts.fields.incident"), type: "select", required: true, defaultValue: g.incidentId ?? incidents[0]!.id, options: incidents.map((i) => ({ value: i.id, label: `#${i.number} ${i.title}` })) }]} /> : null}
              <OpsAction label={t("admin.errors.actions.note")} title={t("admin.errors.actions.note")} path={path} method="PATCH" success={t("admin.errors.updated")} fields={[{ name: "note", label: t("admin.alerts.fields.note"), type: "textarea", required: true, maxLength: 2000 }]} />
            </div>
          ) : null
        }
      />
      <StatGrid>
        <StatTile label={t("admin.errors.fields.events")} value={formatNumber(g.count, locale)} spark={<Sparkline values={d.hourly} label={t("admin.errors.last24hChart")} tone="danger" />} hint={t("admin.errors.last24hChart")} />
        <StatTile label={t("admin.errors.fields.firstSeen")} value={<Timestamp value={g.firstSeenAt} mode="relative" />} hint={g.firstRelease ? t("admin.errors.inRelease", { release: g.firstRelease }) : undefined} />
        <StatTile label={t("admin.errors.fields.lastSeen")} value={<Timestamp value={g.lastSeenAt} mode="relative" />} hint={g.lastRelease ? t("admin.errors.inRelease", { release: g.lastRelease }) : undefined} />
        <StatTile label={t("admin.errors.fields.assignee")} value={d.assignee?.name ?? "—"} />
      </StatGrid>
      {!d.canStack ? (
        <Notice tone="info" title={t("admin.errors.stackHiddenTitle")}>
          <span className="inline-flex items-center gap-1.5">
            <Lock aria-hidden className="size-3.5" />
            {t("admin.errors.stackHidden")}
          </span>
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<ListOrdered />} title={t("admin.errors.events")} description={t("admin.errors.eventsHint")} />
          {d.events.length === 0 ? (
            <EmptyState title={t("admin.errors.noEvents")} body={t("admin.errors.noEventsHint")} />
          ) : (
            <ul className="divide-y">
              {d.events.map((e) => (
                <li key={e.id} className="grid gap-1.5 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Timestamp value={e.createdAt} />
                    {e.method || e.route ? <span className="font-mono">{[e.method, e.route].filter(Boolean).join(" ")}</span> : null}
                    {e.statusCode ? <span className="font-mono text-danger">{e.statusCode}</span> : null}
                    {e.release ? <span className="font-mono text-muted-foreground">{e.release}</span> : null}
                    {e.requestId ? (
                      <Link href={`${base}/logs?requestId=${encodeURIComponent(e.requestId)}`} className="ms-auto font-mono text-primary hover:underline">
                        {e.requestId}
                      </Link>
                    ) : null}
                  </div>
                  {e.stack ? (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">{t("admin.errors.stack")}</summary>
                      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{e.stack}</pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <NextPage base={`${base}/errors/${g.id}`} params={{}} cursor={d.eventsNextCursor} label={t("admin.system.jobs.next")} />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<GitCommit />} title={t("admin.errors.byRelease")} />
            {d.releases.length === 0 ? <EmptyState title={t("admin.errors.noReleases")} /> : <Facts rows={d.releases.map((x) => [x.release ?? t("admin.errors.unknownRelease"), formatNumber(x.count, locale)])} />}
          </Card>
          <Card>
            <CardHeader icon={<Route />} title={t("admin.errors.byRoute")} />
            {d.routes.length === 0 ? <EmptyState title={t("admin.errors.noRoutes")} /> : <Facts rows={d.routes.map((x) => [[x.method, x.route].filter(Boolean).join(" ") || "—", formatNumber(x.count, locale)])} />}
          </Card>
          <Card>
            <CardHeader icon={<Siren />} title={t("admin.alerts.fields.incident")} />
            {d.incident ? (
              <CardBody className="text-sm">
                <Link href={`${base}/incidents/${d.incident.id}`} className="font-medium hover:underline">
                  #{d.incident.number} {d.incident.title}
                </Link>
              </CardBody>
            ) : (
              <EmptyState title={t("admin.alerts.noIncident")} />
            )}
          </Card>
          <Card>
            <CardHeader icon={<ScrollText />} title={t("admin.errors.relatedLogs")} description={t("admin.errors.relatedLogsHint")} />
            {d.relatedLogs.length + d.relatedAudit.length === 0 ? (
              <EmptyState title={t("admin.errors.noRelatedLogs")} />
            ) : (
              <ul className="divide-y text-xs">
                {d.relatedLogs.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-2 px-4 py-2">
                    <StatusBadge domain="logLevel" value={l.level === "warn" ? "warn" : "error"} />
                    <span className="min-w-0 truncate">{l.message}</span>
                  </li>
                ))}
                {d.relatedAudit.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-2 px-4 py-2">
                    <span className="font-mono">{l.action}</span>
                    <span className="ms-auto text-muted-foreground">{l.resourceType}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t("admin.errors.notes")} />
            {g.notes.length === 0 ? (
              <EmptyState title={t("admin.errors.noNotes")} />
            ) : (
              <ul className="divide-y text-xs">
                {g.notes.map((n, i) => (
                  <li key={i} className="grid gap-1 px-4 py-2">
                    <Timestamp value={n.at} className="text-muted-foreground" />
                    <p className="whitespace-pre-wrap">{n.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
