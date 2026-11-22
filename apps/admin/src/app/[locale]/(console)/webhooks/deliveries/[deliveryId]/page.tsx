import Link from "next/link";
import { notFound } from "next/navigation";
import { Webhook } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, Facts, guard } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { canPlatform } from "@/server/modules/admin/access";
import { webhookDelivery } from "@/server/modules/admin/webhooks-admin";
import { requireViewer } from "@/server/session";

/** One outbound delivery: payload, attempts, last response, retry schedule and redeliver. */
export default async function WebhookDeliveryPage({ params }: PageProps<"/[locale]/webhooks/deliveries/[deliveryId]">) {
  const { deliveryId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(Promise.all([webhookDelivery(viewer.ctx, deliveryId), canPlatform(viewer.ctx, "platform.security.manage")]), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const [d, canManage] = r.value;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: d.subscription.name, href: `/${locale}/webhooks/${d.subscription.id}` }, { label: d.eventType }]} />
      <AdminHeader
        icon={<Webhook />}
        title={d.eventType}
        eyebrow={<StatusBadge domain="webhookDelivery" value={d.status}>{t(`admin.webhooks.deliveryStatus.${d.status}`)}</StatusBadge>}
        description={d.subscription.url}
        actions={canManage && d.subscription.active ? <ActionButton label={t("admin.webhooks.redeliver")} title={t("admin.webhooks.redeliverTitle")} description={t("admin.webhooks.redeliverHint")} path={`/api/v1/admin/webhooks/deliveries/${d.id}/redeliver`} method="POST" /> : null}
      />
      <Card>
        <CardHeader title={t("admin.webhooks.details")} />
        <Facts
          rows={[
            [t("admin.webhooks.endpoint"), <Link key="e" href={`/${locale}/webhooks/${d.subscription.id}`} className="text-primary hover:underline">{d.subscription.name}</Link>],
            [t("admin.webhooks.attempts"), String(d.attempts)],
            [t("admin.webhooks.response"), <span key="r" className="font-mono text-xs">{d.lastStatusCode ?? "—"}</span>],
            [t("admin.webhooks.error"), d.lastError ?? "—"],
            [t("admin.webhooks.nextAttempt"), d.nextAttemptAt ? <Timestamp key="n" value={d.nextAttemptAt} /> : "—"],
            [t("admin.webhooks.delivered"), d.deliveredAt ? <Timestamp key="d" value={d.deliveredAt} /> : "—"],
            [t("admin.webhooks.created"), <Timestamp key="c" value={d.createdAt} />],
            [t("admin.webhooks.eventId"), <span key="i" className="inline-flex items-center gap-1 font-mono text-[11px]">{d.eventId}<CopyButton value={d.eventId} /></span>],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={t("admin.webhooks.payload")} description={t("admin.webhooks.payloadHint")} />
        <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-[11px]">{JSON.stringify(d.payload, null, 2)}</pre>
      </Card>
    </div>
  );
}
