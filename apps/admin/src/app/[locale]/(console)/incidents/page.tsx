import Link from "next/link";
import { Plus, Siren } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, FilterBar, guard, NextPage, QuickFilters, sp, StatGrid, StatTile } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { OpsAction } from "@/components/admin/ops/ops-action";
import { duration } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { HEALTH_SERVICE_KEYS } from "@/server/modules/admin/health";
import { INCIDENT_MANAGE, INCIDENT_SEVERITIES, INCIDENT_STATUSES, listIncidents, type IncidentSeverity, type IncidentStatus } from "@/server/modules/admin/incidents";
import { requestTime, requireViewer } from "@/server/session";

/** Incident center: active and past incidents with lifecycle, severity, owner and duration. */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const status = INCIDENT_STATUSES.find((s) => s === sp(q.status)) as IncidentStatus | undefined;
  const severity = INCIDENT_SEVERITIES.find((s) => s === sp(q.severity)) as IncidentSeverity | undefined;
  const state = (["active", "resolved", "all"] as const).find((s) => s === sp(q.state)) ?? (status ? "all" : "active");
  const service = HEALTH_SERVICE_KEYS.find((s) => s === sp(q.service));
  const text = sp(q.q);
  const cursor = sp(q.cursor);
  const r = await guard(listIncidents(viewer.ctx, { status, severity, state, service, q: text, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const canManage = await canPlatform(viewer.ctx, INCIDENT_MANAGE);
  const base = `/${locale}/incidents`;
  const now = requestTime();
  const active = INCIDENT_STATUSES.filter((s) => s !== "RESOLVED" && s !== "CLOSED").reduce((a, s) => a + page.counts[s], 0);
  const params = { status, severity, state, service, q: text };
  const svcLabel = (k: string) => t(`admin.system.hc.services.${k.replace(".", "_")}`);
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Siren />}
        title={t("admin.incidents.title")}
        description={t("admin.incidents.subtitle")}
        why={t("admin.incidents.why")}
        actions={
          canManage ? (
            <OpsAction
              label={t("admin.incidents.create")}
              title={t("admin.incidents.create")}
              description={t("admin.incidents.createHint")}
              path="/api/v1/admin/incidents"
              variant="default"
              icon={<Plus aria-hidden />}
              success={t("admin.incidents.created")}
              fields={[
                { name: "title", label: t("admin.incidents.fields.title"), type: "text", required: true, maxLength: 200 },
                { name: "severity", label: t("admin.incidents.fields.severity"), type: "select", required: true, defaultValue: "SEV3", options: INCIDENT_SEVERITIES.map((s) => ({ value: s, label: t(`admin.incidents.severity.${s}`) })) },
                { name: "services", label: t("admin.incidents.fields.services"), type: "checkboxes", options: HEALTH_SERVICE_KEYS.map((k) => ({ value: k, label: k })) },
                { name: "summary", label: t("admin.incidents.fields.summary"), type: "textarea", maxLength: 5000 },
                { name: "customerImpact", label: t("admin.incidents.fields.customerImpact"), type: "textarea", maxLength: 5000 },
              ]}
            />
          ) : null
        }
      />
      <StatGrid>
        <StatTile label={t("admin.incidents.active")} value={formatNumber(active, locale)} href={`${base}?state=active`} tone={active ? "danger" : "success"} />
        <StatTile label={t("admin.incidents.status.MONITORING")} value={formatNumber(page.counts.MONITORING, locale)} href={`${base}?status=MONITORING`} />
        <StatTile label={t("admin.incidents.status.RESOLVED")} value={formatNumber(page.counts.RESOLVED, locale)} href={`${base}?status=RESOLVED`} hint={t("admin.incidents.awaitingClose")} />
        <StatTile label={t("admin.incidents.status.CLOSED")} value={formatNumber(page.counts.CLOSED, locale)} href={`${base}?status=CLOSED`} />
      </StatGrid>
      <Card>
        <CardHeader icon={<Siren />} title={t("admin.incidents.list")} />
        <QuickFilters base={base} name="state" value={status ? undefined : state} params={{ severity, service, q: text }} label={t("admin.incidents.filterState")} options={(["active", "resolved", "all"] as const).map((s) => ({ value: s, label: t(`admin.incidents.state.${s}`) }))} />
        <FilterBar
          action={base}
          q={text}
          qLabel={t("admin.incidents.search")}
          values={params}
          submitLabel={t("admin.incidents.apply")}
          filters={[
            { name: "status", label: t("admin.incidents.fields.status"), options: INCIDENT_STATUSES.map((s) => ({ value: s, label: t(`admin.incidents.status.${s}`) })) },
            { name: "severity", label: t("admin.incidents.fields.severity"), options: INCIDENT_SEVERITIES.map((s) => ({ value: s, label: t(`admin.incidents.severity.${s}`) })) },
            { name: "service", label: t("admin.incidents.fields.services"), options: HEALTH_SERVICE_KEYS.map((k) => ({ value: k, label: svcLabel(k) })) },
          ]}
          extra={
            <Link href={base} className="self-center text-xs text-muted-foreground hover:underline">
              {t("admin.incidents.reset")}
            </Link>
          }
        />
        {page.data.length === 0 ? (
          <EmptyState icon={<Siren />} title={t("admin.incidents.empty")} body={t("admin.incidents.emptyHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.incidents.fields.title")}</Th>
                  <Th>{t("admin.incidents.fields.severity")}</Th>
                  <Th>{t("admin.incidents.fields.status")}</Th>
                  <Th>{t("admin.incidents.fields.services")}</Th>
                  <Th>{t("admin.incidents.fields.owner")}</Th>
                  <Th>{t("admin.incidents.fields.detectedAt")}</Th>
                  <Th className="text-end">{t("admin.incidents.fields.duration")}</Th>
                </Tr>
              </THead>
              <TBody>
                {page.data.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link href={`${base}/${i.id}`} className="font-medium hover:underline">
                        #{i.number} {i.title}
                      </Link>
                      {i.source === "alert" ? <div className="text-[11px] text-muted-foreground">{t("admin.incidents.fromAlert")}</div> : null}
                    </Td>
                    <Td>
                      <StatusBadge domain="incidentSeverity" value={i.severity}>
                        {t(`admin.incidents.severity.${i.severity}`)}
                      </StatusBadge>
                    </Td>
                    <Td>
                      <StatusBadge domain="incident" value={i.status}>
                        {t(`admin.incidents.status.${i.status}`)}
                      </StatusBadge>
                    </Td>
                    <Td className="max-w-48 truncate font-mono text-[11px]">{i.services.join(", ") || "—"}</Td>
                    <Td className="text-xs">{i.owner?.name ?? t("admin.incidents.unowned")}</Td>
                    <Td className="text-xs">
                      <Timestamp value={i.detectedAt} />
                    </Td>
                    <Td className="text-end text-xs tabular-nums">{duration((i.resolvedAt?.getTime() ?? now) - i.detectedAt.getTime(), locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
