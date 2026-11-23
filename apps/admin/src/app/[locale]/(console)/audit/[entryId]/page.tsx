import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, Facts, guard } from "@/components/admin/kit";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { CopyButton } from "@/components/admin/copy-button";
import { Timestamp } from "@/components/admin/timestamp";
import { JsonDiff } from "@/components/admin/security/json-diff";
import { getLocale, getT } from "@/i18n/server";
import { isAppError } from "@/server/core/errors";
import { getAuditEntry } from "@/server/modules/admin/security";
import { requireViewer } from "@/server/session";

/** Where a resource lives in the console (deep link from an audit record), when it has a page. */
function resourceHref(base: string, type: string, id: string | null): string | null {
  if (!id) return null;
  const map: Record<string, string> = {
    user: `/users/${id}`,
    organization: `/organizations/${id}`,
    api_key: `/developers/keys/${id}`,
    webhook_subscription: `/webhooks/${id}`,
    integration_webhook: `/webhooks/${id}`,
    platform_support_ticket: `/support/${id}`,
    feature_flag: `/flags?flag=${id}`,
    platform_control: `/settings?q=${id}`,
    email_message: `/email/messages/${id}`,
    cms_entry: `/cms/${id}`,
  };
  return map[type] ? `${base}${map[type]}` : null;
}

/** One audit record, read-only: actor, resource, request, reason and the before/after diff of its values. */
export default async function AuditEntryPage({ params }: PageProps<"/[locale]/audit/[entryId]">) {
  const { entryId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let r;
  try {
    r = await guard(getAuditEntry(viewer.ctx, entryId), t("errors.forbidden"));
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  if (!r.ok) return r.node;
  const { entry: a, actor, organization, sameRequest } = r.value;
  const base = `/${locale}`;
  const href = resourceHref(base, a.resourceType, a.resourceId);
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: a.action }]} />
      <AdminHeader icon={<ScrollText />} title={a.action} description={t("admin.audit.entrySubtitle")} why={t("admin.audit.immutable")} eyebrow={<Badge tone={a.category === "SECURITY" ? "warning" : a.category === "ADMIN" ? "accent" : "neutral"}>{t(`admin.audit.categories.${a.category}`)}</Badge>} />
      <Card>
        <CardHeader title={t("admin.audit.overview")} />
        <Facts
          rows={[
            [t("admin.audit.time"), <Timestamp key="t" value={a.createdAt} />],
            [
              t("admin.audit.actor"),
              actor ? (
                <Link key="a" href={`${base}/users/${actor.id}`} className="text-primary hover:underline">
                  {actor.name} · {actor.email}
                </Link>
              ) : (
                <span key="a" className="font-mono text-xs">{`${a.actorType}${a.actorId ? `:${a.actorId}` : ""}`}</span>
              ),
            ],
            [
              t("admin.audit.resource"),
              <span key="r" className="inline-flex items-center gap-1 font-mono text-xs">
                {href ? (
                  <Link href={href} className="text-primary hover:underline">{`${a.resourceType}:${a.resourceId}`}</Link>
                ) : (
                  `${a.resourceType}${a.resourceId ? `:${a.resourceId}` : ""}`
                )}
                {a.resourceId ? <CopyButton value={a.resourceId} /> : null}
              </span>,
            ],
            [
              t("admin.audit.organization"),
              organization ? (
                <Link key="o" href={`${base}/organizations/${organization.id}`} className="text-primary hover:underline">
                  {organization.name}
                </Link>
              ) : (
                t("admin.audit.platformLevel")
              ),
            ],
            [
              t("admin.audit.requestId"),
              a.requestId ? (
                <span key="q" className="inline-flex items-center gap-1 font-mono text-xs">
                  <Link href={`${base}/audit?requestId=${encodeURIComponent(a.requestId)}&scope=all`} className="text-primary hover:underline">
                    {a.requestId}
                  </Link>
                  <CopyButton value={a.requestId} />
                </span>
              ) : (
                "—"
              ),
            ],
            [t("admin.audit.reason"), a.reason ?? "—"],
            [t("admin.audit.ip"), a.ip ?? "—"],
            [t("admin.audit.userAgent"), <span key="ua" className="text-xs">{a.userAgent ?? "—"}</span>],
            [t("admin.audit.recordId"), <span key="id" className="inline-flex items-center gap-1 font-mono text-xs">{a.id} <CopyButton value={a.id} /></span>],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={t("admin.audit.diff")} description={t("admin.audit.diffHint")} />
        <JsonDiff
          before={a.oldValue}
          after={a.newValue}
          labels={{ path: t("admin.audit.field"), before: t("admin.audit.before"), after: t("admin.audit.after"), empty: t("admin.audit.noValues"), kinds: { added: t("admin.audit.kinds.added"), removed: t("admin.audit.kinds.removed"), changed: t("admin.audit.kinds.changed"), same: t("admin.audit.kinds.same") } }}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.audit.rawOld")} />
          <pre className="max-h-80 overflow-auto p-4 font-mono text-[11px]">{a.oldValue === null ? "null" : JSON.stringify(a.oldValue, null, 2)}</pre>
        </Card>
        <Card>
          <CardHeader title={t("admin.audit.rawNew")} />
          <pre className="max-h-80 overflow-auto p-4 font-mono text-[11px]">{a.newValue === null ? "null" : JSON.stringify(a.newValue, null, 2)}</pre>
        </Card>
      </div>
      {sameRequest.length ? (
        <Card>
          <CardHeader title={t("admin.audit.sameRequest")} description={t("admin.audit.sameRequestHint")} />
          <ul className="divide-y text-sm">
            {sameRequest.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <Link href={`${base}/audit/${s.id}`} className="font-mono text-xs text-primary hover:underline">
                  {s.action}
                </Link>
                <span className="font-mono text-[11px] text-muted-foreground">{`${s.resourceType}${s.resourceId ? `:${s.resourceId.slice(0, 12)}` : ""}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
