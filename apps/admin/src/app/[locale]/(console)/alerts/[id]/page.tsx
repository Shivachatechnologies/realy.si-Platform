import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Bell, Layers, ListOrdered, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Avatar, EmptyState, Facts, guard } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { ALERT_MANAGE, getAlert } from "@/server/modules/admin/alerts";
import { INCIDENT_SEVERITIES, platformStaffOptions } from "@/server/modules/admin/incidents";
import { requireViewer } from "@/server/session";

const SNOOZE = [15, 60, 240, 1440, 10080];

/** One alert: evidence, investigate links and next step, triage actions, timeline, group siblings, incident. */
export default async function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { id } = await params;
  const r = await guard(
    getAlert(viewer.ctx, id).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const d = r.value;
  const a = d.alert;
  const canManage = await canPlatform(viewer.ctx, ALERT_MANAGE);
  const [staff, openIncidents] = canManage
    ? await Promise.all([platformStaffOptions(), db().platformIncident.findMany({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, orderBy: { detectedAt: "desc" }, take: 30, select: { id: true, number: true, title: true } })])
    : [[], []];
  const base = `/${locale}`;
  const resolved = a.status === "RESOLVED";
  const ruleKey = a.rule.replace(".", "_");
  const detail = (a.detail ?? {}) as Record<string, unknown>;
  const act = (action: string, label: string, extra: Partial<Parameters<typeof OpsAction>[0]> = {}) => (
    <OpsAction key={action} label={label} title={label} path={`/api/v1/admin/alerts/${a.id}`} body={{ action }} success={t("admin.alerts.done")} {...extra} />
  );
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: a.title.slice(0, 60) }]} />
      <AdminHeader
        icon={<Bell />}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="alertSeverity" value={a.severity}>
              {t(`admin.alerts.severity.${a.severity}`)}
            </StatusBadge>
            <StatusBadge domain="alert" value={a.status} pulse={a.status === "OPEN"}>
              {t(`admin.alerts.status.${a.status}`)}
            </StatusBadge>
            {a.escalationLevel ? <Badge tone="danger">{t("admin.alerts.escalatedLevel", { level: a.escalationLevel })}</Badge> : null}
          </span>
        }
        title={a.title}
        description={t(`admin.alerts.rules.${ruleKey}.title`)}
        meta={<CopyButton value={a.fingerprint} label={t("admin.alerts.fields.fingerprint")} showValue />}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {resolved ? (
                act("reopen", t("admin.alerts.actions.reopen"))
              ) : (
                <>
                  {a.status !== "ACKNOWLEDGED" ? act("ack", t("admin.alerts.actions.ack"), { variant: "default" }) : null}
                  {act("assign", t("admin.alerts.actions.assign"), { fields: [{ name: "assigneeId", label: t("admin.alerts.fields.assignee"), type: "select", required: true, defaultValue: a.assigneeId ?? viewer.user.id, options: staff.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })) }] })}
                  {act("snooze", t("admin.alerts.actions.snooze"), { fields: [{ name: "minutes", label: t("admin.alerts.fields.snoozeFor"), type: "select", required: true, defaultValue: "60", options: SNOOZE.map((m) => ({ value: String(m), label: t("admin.alerts.snoozeMinutes", { minutes: m }) })) }] })}
                  {act("escalate", t("admin.alerts.actions.escalate"), { description: t("admin.alerts.escalateHint") })}
                  {act("resolve", t("admin.alerts.actions.resolve"))}
                  {!a.incidentId
                    ? act("open_incident", t("admin.alerts.actions.openIncident"), {
                        fields: [
                          { name: "severity", label: t("admin.incidents.fields.severity"), type: "select", required: true, defaultValue: a.severity === "CRITICAL" ? "SEV2" : "SEV3", options: INCIDENT_SEVERITIES.map((s) => ({ value: s, label: t(`admin.incidents.severity.${s}`) })) },
                          { name: "note", label: t("admin.incidents.fields.summary"), type: "textarea", maxLength: 2000 },
                        ],
                      })
                    : null}
                  {!a.incidentId && openIncidents.length
                    ? act("link_incident", t("admin.alerts.actions.linkIncident"), { fields: [{ name: "incidentId", label: t("admin.alerts.fields.incident"), type: "select", required: true, defaultValue: openIncidents[0]!.id, options: openIncidents.map((i) => ({ value: i.id, label: `#${i.number} ${i.title}` })) }] })
                    : null}
                </>
              )}
              {act("note", t("admin.alerts.actions.note"), { fields: [{ name: "note", label: t("admin.alerts.fields.note"), type: "textarea", required: true, maxLength: 2000 }] })}
            </div>
          ) : null
        }
      />
      <Notice tone={a.severity === "CRITICAL" ? "danger" : "warning"} title={t("admin.alerts.nextStep")}>
        <span className="grid gap-2">
          <span>{t(`admin.alerts.rules.${ruleKey}.next`)}</span>
          <span className="flex flex-wrap gap-3">
            {d.investigate.map((l) => (
              <Link key={l.href} href={`${base}${l.href}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                {t(`admin.alerts.links.${l.key}`)}
                <ArrowUpRight aria-hidden className="size-3 rtl:-scale-x-100" />
              </Link>
            ))}
          </span>
        </span>
      </Notice>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.alerts.evidence")} description={d.rule.threshold ?? undefined} />
            <Facts rows={Object.entries(detail).map(([k, v]) => [k, typeof v === "object" && v !== null ? <code className="font-mono text-[11px]">{JSON.stringify(v)}</code> : String(v ?? "—")])} />
          </Card>
          <Card>
            <CardHeader icon={<ListOrdered />} title={t("admin.alerts.timeline")} />
            <ol className="grid px-4 py-3">
              {d.events.map((e) => (
                <li key={e.id} className="flex gap-3 border-s ps-4 pb-3 last:pb-0">
                  <Avatar name={e.actor?.name ?? t("admin.incidents.system")} size="sm" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.actor?.name ?? t("admin.incidents.system")}</span>
                      <Badge tone="accent">{t(`admin.alerts.events.${e.kind}`)}</Badge>
                      <span className="ms-auto text-muted-foreground">
                        <Timestamp value={e.createdAt} />
                      </span>
                    </div>
                    {e.note ? <p className="mt-1 whitespace-pre-wrap">{e.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.incidents.details")} />
            <Facts
              rows={[
                [t("admin.alerts.fields.rule"), <span key="r" className="font-mono text-xs">{a.rule}</span>],
                [t("admin.alerts.fields.service"), a.service ? <Link key="s" href={`${base}/health/${encodeURIComponent(a.service)}`} className="font-mono text-xs hover:underline">{a.service}</Link> : "—"],
                [t("admin.alerts.fields.count"), String(a.count)],
                [t("admin.alerts.fields.firstSeen"), <Timestamp key="f" value={a.firstSeenAt} />],
                [t("admin.alerts.fields.lastSeen"), <Timestamp key="l" value={a.lastSeenAt} />],
                [t("admin.alerts.fields.assignee"), d.assignee?.name ?? "—"],
                [t("admin.alerts.fields.acknowledged"), a.acknowledgedAt ? <Timestamp key="a" value={a.acknowledgedAt} /> : "—"],
                [t("admin.alerts.fields.snoozedUntil"), a.snoozedUntil ? <Timestamp key="z" value={a.snoozedUntil} /> : "—"],
                [t("admin.alerts.fields.resolved"), a.resolvedAt ? <Timestamp key="x" value={a.resolvedAt} /> : "—"],
              ]}
            />
          </Card>
          <Card>
            <CardHeader icon={<Siren />} title={t("admin.alerts.fields.incident")} />
            {d.incident ? (
              <CardBody className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge domain="incidentSeverity" value={d.incident.severity} />
                <Link href={`${base}/incidents/${d.incident.id}`} className="font-medium hover:underline">
                  #{d.incident.number} {d.incident.title}
                </Link>
                <StatusBadge domain="incident" value={d.incident.status}>
                  {t(`admin.incidents.status.${d.incident.status}`)}
                </StatusBadge>
              </CardBody>
            ) : (
              <EmptyState title={t("admin.alerts.noIncident")} />
            )}
          </Card>
          <Card>
            <CardHeader icon={<Layers />} title={t("admin.alerts.siblings")} description={t("admin.alerts.siblingsHint")} />
            {d.siblings.length === 0 ? (
              <EmptyState title={t("admin.alerts.noSiblings")} />
            ) : (
              <ul className="divide-y text-xs">
                {d.siblings.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Link href={`${base}/alerts/${s.id}`} className="min-w-0 truncate hover:underline">
                      {s.title}
                    </Link>
                    <StatusBadge domain="alert" value={s.status} className="ms-auto">
                      {t(`admin.alerts.status.${s.status}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t("admin.alerts.policyTitle")} />
            <CardBody className="text-xs text-muted-foreground">{t(`admin.alerts.policy.${a.severity}`)}</CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
