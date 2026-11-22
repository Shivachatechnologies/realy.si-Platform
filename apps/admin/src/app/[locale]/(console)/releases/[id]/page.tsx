import Link from "next/link";
import { notFound } from "next/navigation";
import { Bug, HeartPulse, Rocket } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, EmptyState, Facts, guard } from "@/components/admin/kit";
import { StatusBadge } from "@/components/admin/status-badge";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { getRelease } from "@/server/modules/admin/releases";
import { requireViewer } from "@/server/session";

/** One release: metadata, new and recurring error groups, failed health checks in the first hour after boot. */
export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { id } = await params;
  const r = await guard(getRelease(viewer.ctx, id), t("errors.forbidden"));
  if (!r.ok) return r.node;
  if (!r.value) notFound();
  const { release: rel, newGroups, errorsByGroup, healthAfterDeploy } = r.value;
  const base = `/${locale}`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: rel.shortSha }]} />
      <AdminHeader icon={<Rocket />} title={`${t(`admin.releases.apps.${rel.app === "user" || rel.app === "admin" || rel.app === "worker" ? rel.app : "user"}`)} · ${rel.shortSha}`} description={rel.message ?? undefined} meta={<CopyButton value={rel.sha} label={t("admin.releases.fields.commit")} showValue />} />
      <Card>
        <CardHeader title={t("admin.incidents.details")} />
        <Facts
          rows={[
            [t("admin.releases.fields.environment"), rel.environment],
            [t("admin.releases.fields.branch"), rel.ref ?? "—"],
            [t("admin.releases.fields.deployment"), rel.deploymentId ?? "—"],
            [t("admin.releases.fields.url"), rel.url ?? "—"],
            [t("admin.releases.fields.deployedAt"), rel.deployedAt ? <Timestamp key="d" value={rel.deployedAt} /> : t("admin.releases.unknownDeployTime")],
            [t("admin.releases.fields.firstSeen"), <Timestamp key="f" value={rel.firstSeenAt} />],
            [t("admin.releases.fields.lastBoot"), <Timestamp key="l" value={rel.lastSeenAt} />],
            [t("admin.releases.fields.boots"), formatNumber(rel.boots, locale)],
          ]}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Bug />} title={t("admin.releases.newErrors")} />
          {newGroups.length === 0 ? (
            <EmptyState title={t("admin.releases.noNewErrors")} />
          ) : (
            <ul className="divide-y text-xs">
              {newGroups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <Link href={`${base}/errors/${g.id}`} className="min-w-0 truncate font-medium hover:underline">
                    {g.name}: {g.message}
                  </Link>
                  <span className="ms-auto tabular-nums">×{formatNumber(g.count, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Bug />} title={t("admin.releases.errorsInRelease")} />
          {errorsByGroup.length === 0 ? (
            <EmptyState title={t("admin.releases.noErrors")} />
          ) : (
            <ul className="divide-y text-xs">
              {errorsByGroup.map((g) => (
                <li key={g.groupId} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <Link href={`${base}/errors/${g.groupId}`} className="min-w-0 truncate hover:underline">
                    {g.group ? `${g.group.name}: ${g.group.message}` : g.groupId}
                  </Link>
                  <span className="ms-auto tabular-nums">×{formatNumber(g.count, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader icon={<HeartPulse />} title={t("admin.releases.healthAfter")} description={t("admin.releases.healthAfterHint")} />
        {healthAfterDeploy.length === 0 ? (
          <EmptyState icon={<HeartPulse />} title={t("admin.releases.healthClean")} />
        ) : (
          <ul className="divide-y text-xs">
            {healthAfterDeploy.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <StatusBadge domain="serviceHealth" value={c.status}>
                  {t(`admin.system.hc.status.${c.status}`)}
                </StatusBadge>
                <Link href={`${base}/health/${encodeURIComponent(c.service)}`} className="font-mono hover:underline">
                  {c.service}
                </Link>
                <span className="ms-auto text-muted-foreground">
                  <Timestamp value={c.checkedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
