import Link from "next/link";
import { GitCommit, Rocket } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, Facts, guard, NextPage, QuickFilters, sp } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { CopyButton } from "@/components/admin/copy-button";
import { EnvBadge } from "@/components/admin/env-badge";
import { SourceLine } from "@/components/admin/ops/ops-kit";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { latestChecks } from "@/server/modules/admin/health";
import { listReleases } from "@/server/modules/admin/releases";
import { StatusBadge } from "@/components/admin/status-badge";
import { requireViewer } from "@/server/session";

/** Releases: what each app runs now (from the host's build metadata) and the boot history. No deploy or rollback. */
export default async function ReleasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const app = (["user", "admin", "worker"] as const).find((a) => a === sp(q.app));
  const cursor = sp(q.cursor);
  const r = await guard(listReleases(viewer.ctx, { app, cursor: cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined, limit: 30 }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const checks = await latestChecks();
  const base = `/${locale}/releases`;
  const healthOf: Record<string, string> = { user: "web", admin: "admin", worker: "workers" };
  const cur = page.current;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Rocket />} title={t("admin.releases.title")} description={t("admin.releases.subtitle")} why={t("admin.releases.why")} meta={<EnvBadge />} />
      {cur.source === "none" ? <Notice tone="info" title={t("admin.releases.noMetadataTitle")}>{t("admin.releases.noMetadata")}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {(["user", "admin", "worker"] as const).map((a) => {
          const latest = page.latestByApp.find((l) => l.app === a);
          const h = checks.get(healthOf[a]!);
          return (
            <Card key={a}>
              <CardHeader icon={<GitCommit />} title={t(`admin.releases.apps.${a}`)} actions={h ? <StatusBadge domain="serviceHealth" value={h.status}>{t(`admin.system.hc.status.${h.status}`)}</StatusBadge> : null} />
              <Facts
                rows={[
                  [t("admin.releases.fields.version"), latest ? <span key="v" className="inline-flex items-center gap-1 font-mono text-xs">{latest.sha.slice(0, 12)}<CopyButton value={latest.sha} label={t("admin.releases.fields.commit")} /></span> : t("admin.releases.notRecorded")],
                  [t("admin.releases.fields.environment"), latest?.environment ?? "—"],
                  [t("admin.releases.fields.lastBoot"), latest ? <Timestamp key="b" value={latest.lastSeenAt} mode="relative" /> : "—"],
                ]}
              />
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title={t("admin.releases.thisProcess")} description={t("admin.releases.thisProcessHint")} />
        <Facts
          rows={[
            [t("admin.releases.fields.environment"), cur.environment],
            [t("admin.releases.fields.commit"), cur.sha ? <span key="c" className="font-mono text-xs">{cur.sha}</span> : "—"],
            [t("admin.releases.fields.branch"), cur.ref ?? "—"],
            [t("admin.releases.fields.message"), cur.message ?? "—"],
            [t("admin.releases.fields.deployment"), cur.deploymentId ?? "—"],
            [t("admin.releases.fields.deployedAt"), cur.deployedAt ? <Timestamp key="d" value={cur.deployedAt} /> : t("admin.releases.unknownDeployTime")],
          ]}
        />
      </Card>
      <SourceLine source={t("admin.releases.source")} />
      <Card>
        <CardHeader icon={<Rocket />} title={t("admin.releases.history")} />
        <QuickFilters base={base} name="app" value={app} params={{}} label={t("admin.releases.fields.app")} options={[{ value: "", label: t("admin.releases.allApps") }, ...(["user", "admin", "worker"] as const).map((a) => ({ value: a, label: t(`admin.releases.apps.${a}`) }))]} />
        {page.data.length === 0 ? (
          <EmptyState icon={<Rocket />} title={t("admin.releases.empty")} body={t("admin.releases.emptyHint")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("admin.releases.fields.app")}</Th>
                  <Th>{t("admin.releases.fields.commit")}</Th>
                  <Th>{t("admin.releases.fields.branch")}</Th>
                  <Th>{t("admin.releases.fields.environment")}</Th>
                  <Th>{t("admin.releases.fields.firstSeen")}</Th>
                  <Th className="text-end">{t("admin.releases.fields.boots")}</Th>
                  <Th className="text-end">{t("admin.releases.fields.errors")}</Th>
                </Tr>
              </THead>
              <TBody>
                {page.data.map((rel) => (
                  <Tr key={rel.id}>
                    <Td className="text-xs">{t(`admin.releases.apps.${rel.app === "user" || rel.app === "admin" || rel.app === "worker" ? rel.app : "user"}`)}</Td>
                    <Td>
                      <Link href={`${base}/${rel.id}`} className="font-mono text-xs hover:underline">
                        {rel.shortSha}
                      </Link>
                      {rel.message ? <div className="max-w-80 truncate text-[11px] text-muted-foreground">{rel.message}</div> : null}
                    </Td>
                    <Td className="font-mono text-[11px]">{rel.ref ?? "—"}</Td>
                    <Td className="text-xs">{rel.environment}</Td>
                    <Td className="text-xs">
                      <Timestamp value={rel.firstSeenAt} />
                    </Td>
                    <Td className="text-end tabular-nums">{formatNumber(rel.boots, locale)}</Td>
                    <Td className={`text-end tabular-nums ${rel.errors ? "text-danger" : ""}`}>{formatNumber(rel.errors, locale)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <NextPage base={base} params={{ app }} cursor={page.nextCursor} label={t("admin.system.jobs.next")} />
      </Card>
    </div>
  );
}
