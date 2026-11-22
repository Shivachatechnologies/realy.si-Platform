import Link from "next/link";
import { Construction, CreditCard, Database, ExternalLink, HardDrive, Mail, Server } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, Facts, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { MaintenanceToggle } from "@/components/admin/ops/maintenance-toggle";
import { getLocale, getT } from "@/i18n/server";
import { formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { opsOverview } from "@/server/modules/admin/ops";
import { requireViewer } from "@/server/session";

const bytes = (n: number | null, locale: string) => (n === null ? "—" : n > 1e9 ? `${formatNumber(n / 1e9, locale, { maximumFractionDigits: 1 })} GB` : `${formatNumber(n / 1e6, locale, { maximumFractionDigits: 1 })} MB`);

/** Platform ops: maintenance mode, email delivery log, cache / storage status and the failed-payment recovery list. */
export default async function AdminOpsPage({ searchParams }: PageProps<"/[locale]/ops">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { emailStatus: sp(q.emailStatus) };
  const r = await guard(Promise.all([opsOverview(viewer.ctx, params), canPlatform(viewer.ctx, "platform.controls.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canControl] = r.value;
  const base = `/${locale}/ops`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Server />} title={t("admin.nav.ops")} description={t("admin.ops.subtitle")} why={t("admin.ops.why")} />
      <Card className={o.maintenance.on ? "border-danger/50" : undefined}>
        <CardHeader
          icon={<Construction />}
          title={t("admin.ops.maintenance")}
          description={o.maintenance.on ? t("admin.ops.maintenanceActive") : t("admin.ops.maintenanceInactive")}
          actions={canControl ? <MaintenanceToggle on={o.maintenance.on} /> : null}
        />
        <CardBody className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={o.maintenance.on ? "danger" : "success"} pulse={o.maintenance.on} />
            {o.maintenance.on ? t("admin.ops.on") : t("admin.ops.off")}
          </span>
          {o.maintenance.readOnly ? <Badge tone="warning">{t("admin.ops.readOnly")}</Badge> : null}
          <span className="text-muted-foreground">{o.maintenance.message || t("admin.ops.noMessage")}</span>
          <Link href={`/${locale}/settings`} className="ms-auto font-medium text-primary hover:underline">
            {t("admin.ops.editMessage")}
          </Link>
        </CardBody>
      </Card>
      <StatGrid>
        <StatTile icon={<Database />} label={t("admin.ops.database")} value={bytes(o.database.sizeBytes, locale)} hint={t("admin.ops.checkMs", { ms: o.database.checkMs })} tone="success" />
        <StatTile icon={<Server />} label={t("admin.ops.cache")} value={o.cache.ok ? t("admin.ops.up") : t("admin.ops.down")} hint={o.cache.ok ? `${o.cache.latencyMs ?? "—"} ms · ${o.cache.usedMemory ?? "—"} · ${t("admin.ops.keys", { count: o.cache.keys ?? 0 })}` : t("admin.ops.cacheDownHint")} tone={o.cache.ok ? "success" : "danger"} />
        <StatTile icon={<HardDrive />} label={t("admin.ops.storage")} value={formatNumber(o.storage.s3.CONNECTED ?? 0, locale)} hint={t("admin.ops.storageHint", { objects: o.storage.dbFallback?.count ?? 0, size: bytes(o.storage.dbFallback?.bytes ?? null, locale) })} />
        <StatTile icon={<Mail />} label={t("admin.ops.emails7d")} value={formatNumber(o.email.last7d.SENT ?? 0, locale)} hint={t("admin.ops.emailFailures", { failed: o.email.last7d.FAILED ?? 0, skipped: o.email.last7d.NOT_CONFIGURED ?? 0 })} tone={o.email.last7d.FAILED ? "warning" : undefined} />
      </StatGrid>
      <Card>
        <CardHeader icon={<CreditCard />} title={t("admin.ops.failedPayments")} description={t("admin.ops.failedPaymentsHint")} />
        {o.failedPayments.length === 0 ? (
          <Empty>{t("admin.ops.noFailedPayments")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.subscriptions.plan")}</Th>
                <Th>{t("admin.pricing.amount")}</Th>
                <Th>{t("admin.ops.lastFailure")}</Th>
                <Th className="text-end">{t("admin.ops.recovery")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.failedPayments.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <Link href={`/${locale}/organizations/${f.organizationId}`} className="font-medium hover:underline">
                      {f.organizationName}
                    </Link>
                  </Td>
                  <Td className="text-xs">
                    {f.plan} <Badge tone={f.status === "UNPAID" ? "danger" : "warning"}>{t(`admin.subscriptions.status.${f.status}`)}</Badge>
                  </Td>
                  <Td className="text-xs tabular-nums">{formatMoney({ amountMinor: f.amountMinor, currency: f.currency }, locale)}</Td>
                  <Td className="text-xs text-muted-foreground">{f.lastPaymentFailedAt ? formatRelativeTime(f.lastPaymentFailedAt, locale) : "—"}</Td>
                  <Td className="text-end">
                    {f.stripeUrl ? (
                      <a href={f.stripeUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        {t("admin.ops.openStripe")}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("admin.ops.noStripe")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Mail />} title={t("admin.ops.emailLog")} description={o.email.configured ? t("admin.ops.emailLogHint") : t("admin.emailTemplates.notConfigured")} />
        {!o.email.configured ? <div className="p-3"><Notice tone="warning">{t("admin.emailTemplates.notConfigured")}</Notice></div> : null}
        <QuickFilters
          base={base}
          name="emailStatus"
          value={params.emailStatus}
          params={params}
          label={t("admin.users.filters.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...(["SENT", "FAILED", "NOT_CONFIGURED"] as const).map((s) => ({ value: s, label: t(`admin.ops.emailStatus.${s}`) }))]}
        />
        {o.email.log.length === 0 ? (
          <Empty>{t("admin.ops.noEmails")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.ops.recipient")}</Th>
                <Th>{t("admin.emailTemplates.template")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.developers.when")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.email.log.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-xs">{e.toEmail}</Td>
                  <Td className="font-mono text-[11px]">
                    {e.template} · {e.locale}
                  </Td>
                  <Td>
                    <Badge tone={e.status === "SENT" ? "success" : e.status === "FAILED" ? "danger" : "neutral"}>{t(`admin.ops.emailStatus.${e.status}`)}</Badge>
                    {e.error ? <div className="max-w-xs truncate text-[11px] text-danger">{e.error}</div> : null}
                    {e.provider ? <div className="text-[11px] text-muted-foreground">{e.provider}</div> : null}
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatRelativeTime(e.createdAt, locale)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader icon={<Server />} title={t("admin.ops.details")} />
        <Facts
          rows={[
            [t("admin.ops.cacheLatency"), o.cache.latencyMs === null ? "—" : `${o.cache.latencyMs} ms`],
            [t("admin.ops.cacheMemory"), o.cache.usedMemory ?? "—"],
            [t("admin.ops.s3Connections"), Object.entries(o.storage.s3).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"],
            [t("admin.ops.dbObjects"), o.storage.dbFallback ? `${formatNumber(o.storage.dbFallback.count, locale)} · ${bytes(o.storage.dbFallback.bytes, locale)}` : "—"],
          ]}
        />
      </Card>
    </div>
  );
}
