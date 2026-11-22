import { Archive, Database, Download, FileClock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, guard, StatGrid, StatTile } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { EnvBadge } from "@/components/admin/env-badge";
import { OpsAction, OpsButton } from "@/components/admin/ops/ops-action";
import { ProductionNotice, SourceLine } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { DATA_EXPORT, dataOpsOverview } from "@/server/modules/admin/data-ops";
import { isProduction, productionPhrase } from "@/server/modules/admin/releases";
import { requireViewer } from "@/server/session";

/** Data operations: migration status, read-only integrity checks, retention policies and managed exports. No editor. */
export default async function DataOpsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(dataOpsOverview(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const d = r.value;
  const canExport = await canPlatform(viewer.ctx, DATA_EXPORT);
  const prod = isProduction();
  const m = d.migrations;
  const failing = d.integrity?.checks.filter((c) => (c.count ?? 0) > 0) ?? [];
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Database />} title={t("admin.data.title")} description={t("admin.data.subtitle")} why={t("admin.data.why")} meta={<EnvBadge />} />
      {canExport ? <ProductionNotice production={prod} title={t("admin.system.env.productionTitle")} body={t("admin.system.env.productionBody")} /> : null}
      <StatGrid>
        <StatTile icon={<FileClock />} label={t("admin.data.applied")} value={m.available ? formatNumber(m.applied.length, locale) : "—"} hint={m.available && m.latest ? m.latest : undefined} />
        <StatTile label={t("admin.data.pending")} value={m.available && m.pending ? formatNumber(m.pending.length, locale) : "—"} hint={m.available && m.pending === null ? t("admin.data.repoUnavailable") : undefined} tone={m.available && m.pending?.length ? "warning" : undefined} />
        <StatTile label={t("admin.data.failed")} value={m.available ? formatNumber(m.failed.length, locale) : "—"} tone={m.available && m.failed.length ? "danger" : "success"} />
        <StatTile icon={<ShieldCheck />} label={t("admin.data.integrityIssues")} value={d.integrity ? formatNumber(failing.length, locale) : "—"} hint={d.integrity ? <Timestamp value={d.integrity.checkedAt} mode="relative" /> : t("admin.data.neverChecked")} tone={failing.some((c) => c.severity === "warning") ? "warning" : undefined} />
      </StatGrid>
      <Card>
        <CardHeader icon={<FileClock />} title={t("admin.data.migrations")} description={t("admin.data.migrationsHint")} />
        {!m.available ? (
          <EmptyState title={t("admin.data.migrationsUnavailable")} />
        ) : (
          <CardBody className="grid gap-3 text-xs">
            {m.failed.map((f) => (
              <Notice key={f.name} tone="danger" title={f.name}>
                {f.logs ?? t("admin.data.noLogs")}
              </Notice>
            ))}
            {m.pending?.length ? (
              <Notice tone="warning" title={t("admin.data.pendingTitle")}>
                <span className="font-mono">{m.pending.join(", ")}</span>
              </Notice>
            ) : null}
            {m.unknown?.length ? <Notice tone="info" title={t("admin.data.unknownTitle")}>{m.unknown.join(", ")}</Notice> : null}
            <ul className="divide-y rounded-md border">
              {m.applied.slice(0, 15).map((a) => (
                <li key={a.name} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="font-mono">{a.name}</span>
                  <span className="ms-auto text-muted-foreground">{a.finishedAt ? <Timestamp value={a.finishedAt} /> : "—"}</span>
                </li>
              ))}
            </ul>
            <SourceLine source={t("admin.data.migrationsSource")} />
          </CardBody>
        )}
      </Card>
      <Card>
        <CardHeader icon={<ShieldCheck />} title={t("admin.data.integrity")} description={t("admin.data.integrityHint")} actions={<OpsButton label={t("admin.data.runChecks")} path="/api/v1/admin/data/integrity" success={t("admin.data.checksDone")} />} />
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.data.check")}</Th>
                <Th>{t("admin.data.severity")}</Th>
                <Th className="text-end">{t("admin.data.affected")}</Th>
                <Th>{t("admin.data.samples")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.checks.map((c) => {
                const res = d.integrity?.checks.find((x) => x.key === c.key);
                return (
                  <Tr key={c.key}>
                    <Td>
                      <div className="font-medium">{t(`admin.data.checks.${c.key}`)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{c.key}</div>
                    </Td>
                    <Td>
                      <Badge tone={c.severity === "warning" ? "warning" : "info"}>{t(`admin.data.severities.${c.severity}`)}</Badge>
                    </Td>
                    <Td className={`text-end tabular-nums ${(res?.count ?? 0) > 0 ? "text-warning" : ""}`}>{res ? (res.error ? t("admin.data.checkFailed") : formatNumber(res.count ?? 0, locale)) : "—"}</Td>
                    <Td className="max-w-96 truncate font-mono text-[11px] text-muted-foreground">{res?.samples.join(", ") || "—"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground">{t("admin.data.readOnly")}</p>
      </Card>
      <Card>
        <CardHeader icon={<Archive />} title={t("admin.data.retention")} description={t("admin.data.retentionHint")} />
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.data.table")}</Th>
                <Th>{t("admin.data.keep")}</Th>
                <Th>{t("admin.data.job")}</Th>
                <Th className="text-end">{t("admin.data.rows")}</Th>
                <Th>{t("admin.data.lastRun")}</Th>
              </Tr>
            </THead>
            <TBody>
              {d.retention.map((x) => (
                <Tr key={x.table}>
                  <Td className="font-mono text-xs">{x.table}</Td>
                  <Td className="text-xs">{t(`admin.data.keepValues.${x.table}`)}</Td>
                  <Td className="font-mono text-[11px]">{x.job ?? "—"}</Td>
                  <Td className="text-end tabular-nums">{formatNumber(x.rowsEstimate, locale)}</Td>
                  <Td className="text-xs">
                    {x.lastRun ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge domain="jobRun" value={x.lastRun.status}>
                          {t(`admin.system.jobs.status.${x.lastRun.status}`)}
                        </StatusBadge>
                        <Timestamp value={x.lastRun.at} mode="relative" />
                      </span>
                    ) : x.job ? (
                      <span className="text-muted-foreground">{t("admin.data.noRecordedRun")}</span>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </Card>
      <Card>
        <CardHeader icon={<Download />} title={t("admin.data.exports")} description={t("admin.data.exportsHint", { limit: d.exportLimit })} />
        <CardBody className="flex flex-wrap gap-2">
          {d.datasets.map((ds) =>
            canExport ? (
              <OpsAction key={ds} label={t(`admin.data.datasets.${ds}`)} title={t("admin.data.exportTitle", { dataset: t(`admin.data.datasets.${ds}`) })} description={t("admin.data.exportHint")} path="/api/v1/admin/data/export" body={{ dataset: ds }} phrase={prod ? productionPhrase(`export ${ds}`) : undefined} production={prod} download icon={<Download aria-hidden />} success={t("admin.data.exported")} />
            ) : (
              <Badge key={ds}>{t(`admin.data.datasets.${ds}`)}</Badge>
            ),
          )}
          {!canExport ? <p className="w-full text-xs text-muted-foreground">{t("admin.data.exportForbidden")}</p> : null}
        </CardBody>
        {d.recentExports.length ? (
          <ul className="divide-y border-t text-xs">
            {d.recentExports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <span className="font-mono">{e.resourceId}</span>
                <span>{e.actor ?? "—"}</span>
                {e.reason ? <span className="min-w-0 truncate text-muted-foreground">“{e.reason}”</span> : null}
                <span className="ms-auto text-muted-foreground">
                  <Timestamp value={e.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("admin.data.noExports")} />
        )}
      </Card>
    </div>
  );
}
