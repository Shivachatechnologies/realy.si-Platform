import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, Bug, Building2, FileText, ListOrdered, Siren, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { AdminHeader, Avatar, EmptyState, Facts, guard } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { NoteForm, OpsAction } from "@/components/admin/ops/ops-action";
import { PostmortemEditor } from "@/components/admin/ops/postmortem-editor";
import { duration } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { HEALTH_SERVICE_KEYS } from "@/server/modules/admin/health";
import { getIncident, INCIDENT_MANAGE, INCIDENT_SEVERITIES, platformStaffOptions } from "@/server/modules/admin/incidents";
import { requestTime, requireViewer } from "@/server/session";

/** One incident: lifecycle, owner, impact, root cause, mitigation, resolution, timeline, related alerts and errors, postmortem. */
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { id } = await params;
  const r = await guard(
    getIncident(viewer.ctx, id).catch((e) => {
      if (isAppError(e) && e.code === "not_found") notFound();
      throw e;
    }),
    t("errors.forbidden"),
  );
  if (!r.ok) return r.node;
  const d = r.value;
  const i = d.incident;
  const [canManage, staff] = await Promise.all([canPlatform(viewer.ctx, INCIDENT_MANAGE), platformStaffOptions()]);
  const base = `/${locale}`;
  const closed = i.status === "CLOSED";
  const now = requestTime();
  const stamp = (v: Date | null) => (v ? <Timestamp value={v} /> : "—");
  const kindLabel = (k: string) => t(`admin.incidents.timeline.${["created", "status", "note", "owner", "field", "alert_linked", "postmortem"].includes(k) ? k : "field"}`);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: `#${i.number}` }]} />
      <AdminHeader
        icon={<Siren />}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <StatusBadge domain="incidentSeverity" value={i.severity}>
              {t(`admin.incidents.severity.${i.severity}`)}
            </StatusBadge>
            <StatusBadge domain="incident" value={i.status} pulse={!["RESOLVED", "CLOSED"].includes(i.status)}>
              {t(`admin.incidents.status.${i.status}`)}
            </StatusBadge>
            {i.source === "alert" ? <Badge tone="info">{t("admin.incidents.fromAlert")}</Badge> : null}
          </span>
        }
        title={`#${i.number} ${i.title}`}
        description={i.summary ?? undefined}
        meta={<CopyButton value={i.id} label={t("admin.incidents.copyId")} />}
        actions={
          canManage && !closed ? (
            <div className="flex flex-wrap gap-2">
              {d.nextStatuses.length ? (
                <OpsAction
                  label={t("admin.incidents.changeStatus")}
                  title={t("admin.incidents.changeStatus")}
                  description={t("admin.incidents.changeStatusHint")}
                  path={`/api/v1/admin/incidents/${i.id}/status`}
                  variant="default"
                  success={t("admin.incidents.statusChanged")}
                  fields={[
                    { name: "status", label: t("admin.incidents.fields.status"), type: "select", required: true, defaultValue: d.nextStatuses[0], options: d.nextStatuses.map((s) => ({ value: s, label: t(`admin.incidents.status.${s}`) })) },
                    { name: "message", label: t("admin.incidents.fields.update"), type: "textarea", required: true, maxLength: 5000, placeholder: t("admin.incidents.updatePlaceholder") },
                  ]}
                />
              ) : null}
              <OpsAction
                label={t("admin.incidents.edit")}
                title={t("admin.incidents.edit")}
                path={`/api/v1/admin/incidents/${i.id}`}
                method="PATCH"
                success={t("admin.incidents.saved")}
                fields={[
                  { name: "title", label: t("admin.incidents.fields.title"), type: "text", defaultValue: i.title, maxLength: 200 },
                  { name: "severity", label: t("admin.incidents.fields.severity"), type: "select", required: true, defaultValue: i.severity, options: INCIDENT_SEVERITIES.map((s) => ({ value: s, label: t(`admin.incidents.severity.${s}`) })) },
                  { name: "ownerId", label: t("admin.incidents.fields.owner"), type: "select", defaultValue: i.ownerId ?? "", options: staff.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })) },
                  { name: "services", label: t("admin.incidents.fields.services"), type: "checkboxes", defaultValue: i.services, options: HEALTH_SERVICE_KEYS.map((k) => ({ value: k, label: k })) },
                  { name: "customerImpact", label: t("admin.incidents.fields.customerImpact"), type: "textarea", defaultValue: i.customerImpact ?? "", maxLength: 5000 },
                  { name: "affectedOrganizationIds", label: t("admin.incidents.fields.affectedOrgs"), type: "textarea", split: true, defaultValue: i.affectedOrganizationIds.join("\n"), hint: t("admin.incidents.affectedOrgsHint") },
                  { name: "rootCause", label: t("admin.incidents.fields.rootCause"), type: "textarea", defaultValue: i.rootCause ?? "", maxLength: 10000 },
                  { name: "mitigation", label: t("admin.incidents.fields.mitigation"), type: "textarea", defaultValue: i.mitigation ?? "", maxLength: 10000 },
                  { name: "resolution", label: t("admin.incidents.fields.resolution"), type: "textarea", defaultValue: i.resolution ?? "", maxLength: 10000 },
                ]}
              />
            </div>
          ) : null
        }
      />
      {closed ? <Notice tone="info">{t("admin.incidents.closedNotice")}</Notice> : null}
      {i.status === "RESOLVED" && (i.severity === "SEV1" || i.severity === "SEV2") && i.postmortemState !== "published" ? <Notice tone="warning">{t("admin.incidents.postmortemRequired")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<Wrench />} title={t("admin.incidents.analysis")} />
            <CardBody className="grid gap-3 text-sm">
              {(["customerImpact", "rootCause", "mitigation", "resolution"] as const).map((k) => (
                <div key={k}>
                  <p className="text-xs font-medium text-muted-foreground">{t(`admin.incidents.fields.${k}`)}</p>
                  <p className="whitespace-pre-wrap">{i[k] || <span className="text-muted-foreground">{t("admin.incidents.notYet")}</span>}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<ListOrdered />} title={t("admin.incidents.timelineTitle")} description={t("admin.incidents.timelineHint")} />
            <ol className="relative grid gap-0 px-4 py-3">
              {d.timeline.map((u) => (
                <li key={u.id} className="flex gap-3 border-s ps-4 pb-4 last:pb-0">
                  <Avatar name={u.author?.name ?? t("admin.incidents.system")} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{u.author?.name ?? t("admin.incidents.system")}</span>
                      <Badge tone="accent">{kindLabel(u.kind)}</Badge>
                      {u.status ? (
                        <StatusBadge domain="incident" value={u.status}>
                          {t(`admin.incidents.status.${u.status}`)}
                        </StatusBadge>
                      ) : null}
                      <span className="ms-auto text-muted-foreground">
                        <Timestamp value={u.createdAt} />
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{u.message}</p>
                  </div>
                </li>
              ))}
            </ol>
            {canManage && !closed ? (
              <CardBody className="border-t">
                <NoteForm path={`/api/v1/admin/incidents/${i.id}/notes`} label={t("admin.incidents.addNote")} placeholder={t("admin.incidents.notePlaceholder")} />
              </CardBody>
            ) : null}
          </Card>
          <Card>
            <CardHeader icon={<FileText />} title={t("admin.incidents.postmortem.title")} description={t(`admin.incidents.postmortem.state.${["draft", "published"].includes(i.postmortemState) ? i.postmortemState : "none"}`)} />
            <CardBody>
              <PostmortemEditor incidentId={i.id} initial={i.postmortem ?? ""} state={i.postmortemState} readOnly={!canManage || closed} template={t("admin.incidents.postmortem.template")} />
            </CardBody>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title={t("admin.incidents.details")} />
            <Facts
              rows={[
                [t("admin.incidents.fields.owner"), d.owner ? `${d.owner.name}` : t("admin.incidents.unowned")],
                [t("admin.incidents.fields.services"), i.services.length ? i.services.map((s) => <Link key={s} href={`${base}/health/${encodeURIComponent(s)}`} className="me-2 font-mono text-xs hover:underline">{s}</Link>) : "—"],
                [t("admin.incidents.fields.detectedAt"), stamp(i.detectedAt)],
                [t("admin.incidents.fields.acknowledgedAt"), stamp(i.acknowledgedAt)],
                [t("admin.incidents.fields.identifiedAt"), stamp(i.identifiedAt)],
                [t("admin.incidents.fields.mitigatedAt"), stamp(i.mitigatedAt)],
                [t("admin.incidents.fields.resolvedAt"), stamp(i.resolvedAt)],
                [t("admin.incidents.fields.closedAt"), stamp(i.closedAt)],
                [t("admin.incidents.fields.duration"), duration((i.resolvedAt?.getTime() ?? now) - i.detectedAt.getTime(), locale)],
                [t("admin.incidents.fields.createdBy"), d.createdBy?.name ?? t("admin.incidents.system")],
              ]}
            />
          </Card>
          <Card>
            <CardHeader icon={<Building2 />} title={t("admin.incidents.affectedCustomers")} />
            {d.organizations.length === 0 ? (
              <EmptyState title={t("admin.incidents.noAffected")} />
            ) : (
              <ul className="divide-y text-xs">
                {d.organizations.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 px-4 py-2">
                    <Link href={`${base}/organizations/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                    <span className="ms-auto text-muted-foreground">{o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Bell />} title={t("admin.incidents.relatedAlerts")} />
            {d.alerts.length === 0 ? (
              <EmptyState title={t("admin.incidents.noAlerts")} />
            ) : (
              <ul className="divide-y text-xs">
                {d.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <StatusBadge domain="alertSeverity" value={a.severity}>
                      {t(`admin.alerts.severity.${a.severity}`)}
                    </StatusBadge>
                    <Link href={`${base}/alerts/${a.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {a.title}
                    </Link>
                    <StatusBadge domain="alert" value={a.status} className="ms-auto">
                      {t(`admin.alerts.status.${a.status}`)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Bug />} title={t("admin.incidents.relatedErrors")} />
            {d.errorGroups.length === 0 ? (
              <EmptyState title={t("admin.incidents.noErrors")} />
            ) : (
              <ul className="divide-y text-xs">
                {d.errorGroups.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <Link href={`${base}/errors/${g.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {g.name}: {g.message}
                    </Link>
                    <span className="ms-auto tabular-nums text-muted-foreground">×{g.count}</span>
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
