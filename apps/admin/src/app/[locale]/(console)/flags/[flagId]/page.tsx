import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { AdminHeader, guard } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { flagHistory } from "@/server/modules/flags/service";
import { db } from "@/server/core/db";
import { requireViewer } from "@/server/session";

/** One flag's version history (snapshots after every change) with rollback, and its audit records. */
export default async function FlagHistoryPage({ params }: PageProps<"/[locale]/flags/[flagId]">) {
  const { flagId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(Promise.all([flagHistory(viewer.ctx, flagId), canPlatform(viewer.ctx, "flags.manage"), db().featureFlag.findUnique({ where: { id: /^[0-9a-f-]{36}$/i.test(flagId) ? flagId : "00000000-0000-0000-0000-000000000000" }, select: { key: true } })]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [h, editable, flag] = r.value;
  const latest = h.versions[0]?.version ?? 0;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs extra={[{ label: flag?.key ?? flagId.slice(0, 8) }]} />
      <AdminHeader icon={<History />} title={flag?.key ?? t("admin.flags.deletedFlag")} description={t("admin.flags.historySubtitle")} />
      <Card>
        <CardHeader title={t("admin.flags.versions")} description={t("admin.flags.versionsHint")} />
        {h.versions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("admin.flags.noVersions")}</p>
        ) : (
          <ol className="divide-y">
            {h.versions.map((v) => (
              <li key={v.id} className="grid gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">v{v.version}</span>
                  <span className="font-medium">{v.action}</span>
                  <span className="text-xs text-muted-foreground">{v.who}</span>
                  <Timestamp value={v.createdAt} className="text-xs text-muted-foreground" />
                  {editable && flag && v.version !== latest && v.action !== "deleted" ? (
                    <span className="ms-auto">
                      <ActionButton label={t("admin.flags.rollback")} title={t("admin.flags.rollbackTitle", { version: v.version })} description={t("admin.flags.rollbackHint")} path={`/api/v1/admin/feature-flags/${flagId}/rollback`} method="POST" body={{ version: v.version }} />
                    </span>
                  ) : null}
                </div>
                {v.reason ? <p className="text-xs text-muted-foreground">“{v.reason}”</p> : null}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{t("admin.flags.snapshot")}</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">{JSON.stringify(v.snapshot, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.flags.auditRecords")} />
        <ul className="divide-y text-xs">
          {h.audit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Link href={`/${locale}/audit/${a.id}`} className="font-mono text-primary hover:underline">{a.action}</Link>
              <span>{a.who}</span>
              {a.reason ? <span className="text-muted-foreground">“{a.reason}”</span> : null}
              <Timestamp value={a.createdAt} mode="relative" className="ms-auto text-muted-foreground" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
