import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, Facts, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { emailMessageDetail } from "@/server/modules/admin/email-admin";
import { requireViewer } from "@/server/session";

/** One platform email: send outcome, provider events in order, suppression state (bodies are never stored). */
export default async function EmailMessagePage({ params }: PageProps<"/[locale]/email/messages/[messageId]">) {
  const { messageId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(emailMessageDetail(viewer.ctx, messageId), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const { message: m, events, suppression } = r.value;
  const delivered = events.some((e) => e.type === "delivered");
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: m.toEmail }]} />
      <AdminHeader icon={<Mail />} title={m.toEmail} description={t("admin.email.messageSubtitle")} eyebrow={<StatusBadge domain="emailStatus" value={m.status}>{t(`admin.email.statuses.${m.status}`)}</StatusBadge>} />
      <Card>
        <CardHeader title={t("admin.email.outcome")} />
        <Facts
          rows={[
            [t("admin.email.template"), <span key="t" className="font-mono text-xs">{m.template}</span>],
            [t("admin.email.provider"), m.provider ?? "—"],
            [t("admin.email.providerMessageId"), m.providerMessageId ? <span key="p" className="inline-flex items-center gap-1 font-mono text-[11px]">{m.providerMessageId}<CopyButton value={m.providerMessageId} /></span> : "—"],
            [t("admin.email.deliveryState"), delivered ? <Badge key="d" tone="success">{t("admin.email.eventTypes.delivered")}</Badge> : m.status === "SENT" ? t("admin.email.acceptedOnly") : t(`admin.email.statuses.${m.status}`)],
            [t("admin.email.error"), m.error ?? "—"],
            [t("admin.settings.kit.organization"), m.organizationId ? <Link key="o" href={`/${locale}/organizations/${m.organizationId}`} className="text-primary hover:underline">{m.organizationId.slice(0, 8)}</Link> : t("admin.audit.platformLevel")],
            [t("admin.email.suppression"), suppression ? <Badge key="s" tone="danger">{t(`admin.email.reasons.${suppression.reason}`)}</Badge> : t("common.no")],
            [t("admin.settings.kit.when"), <Timestamp key="w" value={m.createdAt} />],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={t("admin.email.providerEvents")} description={t("admin.email.providerEventsHint")} />
        {events.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.email.noProviderEvents")}</p>
        ) : (
          <ol className="divide-y text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <StatusBadge domain="emailEvent" value={e.type}>{t(`admin.email.eventTypes.${e.type}`)}</StatusBadge>
                <span className="font-mono text-[11px] text-muted-foreground">{JSON.stringify(e.detail)}</span>
                <span className="ms-auto text-xs text-muted-foreground"><Timestamp value={e.occurredAt} /></span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
