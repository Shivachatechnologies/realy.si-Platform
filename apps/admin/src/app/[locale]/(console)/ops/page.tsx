import Link from "next/link";
import { ArrowUpRight, Construction, CreditCard, Database, HardDrive, Mail, Server } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AdminHeader, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { EnvBadge } from "@/components/admin/env-badge";
import { MaintenanceToggle } from "@/components/admin/ops/maintenance-toggle";
import { ProductionNotice, SourceLine, bytes } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { opsOverview } from "@/server/modules/admin/ops";
import { requireViewer } from "@/server/session";

/**
 * Platform ops: maintenance mode plus cache, database and storage status. The email delivery log moved to /email
 * (stream F) and the failed-payment recovery list to /payments (stream D).
 */
export default async function AdminOpsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([opsOverview(viewer.ctx), canPlatform(viewer.ctx, "platform.controls.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, canControl] = r.value;
  const production = o.environment === "production";
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Server />} title={t("admin.nav.ops")} description={t("admin.ops.subtitleV2")} why={t("admin.ops.why")} meta={<EnvBadge />} />
      {canControl ? <ProductionNotice production={production} title={t("admin.system.env.productionTitle")} body={t("admin.system.env.productionBody")} /> : null}
      <Card className={o.maintenance.on ? "border-danger/50" : undefined}>
        <CardHeader
          icon={<Construction />}
          title={t("admin.ops.maintenance")}
          description={o.maintenance.on ? t("admin.ops.maintenanceActive") : t("admin.ops.maintenanceInactive")}
          actions={canControl ? <MaintenanceToggle on={o.maintenance.on} phrase={o.maintenance.phrase} production={production} /> : null}
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
      <StatGrid className="xl:grid-cols-3">
        <StatTile icon={<Database />} label={t("admin.ops.database")} value={bytes(o.database.sizeBytes, locale)} hint={t("admin.ops.checkMs", { ms: o.database.checkMs })} tone={o.database.ok ? "success" : "danger"} href={`/${locale}/infra`} />
        <StatTile
          icon={<Server />}
          label={t("admin.ops.cache")}
          value={!o.cache.configured ? t("admin.system.notConfigured") : o.cache.ok ? t("admin.ops.up") : t("admin.ops.down")}
          hint={o.cache.ok ? `${bytes(o.cache.usedMemory, locale)} · ${t("admin.ops.keys", { count: o.cache.keys ?? 0 })}` : t("admin.ops.cacheDownHint")}
          tone={o.cache.ok ? "success" : o.cache.configured ? "danger" : undefined}
          href={`/${locale}/infra`}
        />
        <StatTile icon={<HardDrive />} label={t("admin.ops.storage")} value={formatNumber(o.storage.s3.CONNECTED ?? 0, locale)} hint={t("admin.ops.storageHint", { objects: o.storage.dbFallback?.count ?? 0, size: bytes(o.storage.dbFallback?.bytes ?? null, locale) })} href={`/${locale}/health/storage`} />
      </StatGrid>
      <SourceLine source={t("admin.ops.cacheSource")} at={o.cache.fetchedAt} />
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { icon: <Mail />, title: t("admin.ops.emailMoved"), body: t("admin.ops.emailMovedHint"), href: `/${locale}/email` },
          { icon: <CreditCard />, title: t("admin.ops.paymentsMoved"), body: t("admin.ops.paymentsMovedHint"), href: `/${locale}/payments` },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="group rounded-lg border bg-surface p-4 hover:border-border-strong">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-accent-foreground [&_svg]:size-3.5">
                {c.icon}
              </span>
              {c.title}
              <ArrowUpRight aria-hidden className="ms-auto size-3.5 text-muted-foreground rtl:-scale-x-100" />
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{c.body}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
