import Link from "next/link";
import { AlertTriangle, Bot, Building2, Bug } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, StatGrid, StatTile, guard } from "@/components/admin/kit";
import { BarList } from "@/components/admin/viz";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber, formatRelativeTime } from "@/i18n/format";
import { aiErrors } from "@/server/modules/admin/ai-ops";
import { requireViewer } from "@/server/session";

/** AI error management: failures by error code, role and organization (7 days) with drill-down to the task logs. */
export default async function AdminAiErrorsPage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const r = await guard(aiErrors(viewer.ctx), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const tasks = `/${locale}/ai/tasks`;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Bug />} title={t("admin.nav.aiErrors")} description={t("admin.aiErrors.subtitle")} why={t("admin.aiErrors.why")} />
      <StatGrid>
        <StatTile icon={<AlertTriangle />} label={t("admin.aiErrors.failed7d")} value={formatNumber(o.total, locale)} tone={o.total ? "danger" : "success"} href={`${tasks}?status=FAILED`} />
        <StatTile label={t("admin.aiErrors.rate")} value={o.rate === null ? "—" : formatNumber(o.rate, locale, { style: "percent", maximumFractionDigits: 1 })} tone={o.rate !== null && o.rate > 0.1 ? "warning" : undefined} />
        <StatTile icon={<Bug />} label={t("admin.aiErrors.codes")} value={o.byCode.length} />
        <StatTile icon={<Building2 />} label={t("admin.aiErrors.orgs")} value={o.byOrg.length} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={<Bug />} title={t("admin.aiErrors.byCode")} />
          <CardBody>
            <BarList label={t("admin.aiErrors.byCode")} tone="danger" items={o.byCode.map((c) => ({ key: c.code, label: <span className="font-mono text-xs">{c.code}</span>, value: c.count, href: `${tasks}?status=FAILED&errorCode=${c.code}` }))} empty={<Empty>{t("admin.aiErrors.none")}</Empty>} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Bot />} title={t("admin.aiErrors.byRole")} />
          <CardBody>
            <BarList label={t("admin.aiErrors.byRole")} tone="warning" items={o.byProfile.map((c) => ({ key: c.profile, label: <span className="font-mono text-xs">{c.profile}</span>, value: c.count, href: `${tasks}?status=FAILED&profile=${c.profile}` }))} empty={<Empty>{t("admin.aiErrors.none")}</Empty>} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<Building2 />} title={t("admin.aiErrors.byOrg")} />
          <CardBody>
            <BarList label={t("admin.aiErrors.byOrg")} items={o.byOrg.map((c) => ({ key: c.id, label: c.name, value: c.count, href: `${tasks}?status=FAILED&org=${c.id}` }))} empty={<Empty>{t("admin.aiErrors.none")}</Empty>} />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader icon={<AlertTriangle />} title={t("admin.aiErrors.latest")} description={t("admin.aiErrors.latestHint")} />
        {o.latest.length === 0 ? (
          <Empty>{t("admin.aiErrors.none")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiErrors.task")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.aiErrors.error")}</Th>
                <Th>{t("admin.developers.when")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.latest.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <Link href={`${tasks}?q=${l.id}`} className="font-medium hover:underline">
                      {l.title}
                    </Link>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {l.profile} · {t("admin.developers.attempts", { count: l.attempts })}
                    </div>
                  </Td>
                  <Td className="text-xs">{l.organizationName}</Td>
                  <Td className="max-w-sm text-xs">
                    <span className="font-mono text-danger">{l.errorCode ?? "unknown"}</span>
                    <div className="line-clamp-2 text-muted-foreground">{l.errorMessage}</div>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{l.completedAt ? formatRelativeTime(l.completedAt, locale) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
