import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Bot, Gauge, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, SectionLink, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { OrgTabs } from "@/components/admin/people-extras";
import { OrgAiPauseButton } from "@/components/admin/ai-models-editor";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { canPlatform } from "@/server/modules/admin/access";
import { hasTenantViewGrant, organizationAiSummary } from "@/server/modules/admin/tenants";
import { requireViewer } from "@/server/session";

/** Organization AI workforce summary: employees, 30-day spend from the cost ledger, budgets, and the AI kill switch. */
export default async function AdminOrgAiPage({ params }: PageProps<"/[locale]/organizations/[orgId]/ai">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true, status: true } });
  if (!org) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) redirect(`/${locale}/organizations/${orgId}`);
  const r = await guard(Promise.all([organizationAiSummary(viewer.ctx, orgId), canPlatform(viewer.ctx, "platform.organizations.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [s, canManage] = r.value;
  const spend = s.ledger30d.reduce((a, l) => a + l.costMicros, 0);
  const tokens = s.ledger30d.reduce((a, l) => a + l.tokens, 0);
  return (
    <div className="grid gap-4">
      <OrgTabs locale={locale} orgId={orgId} active="ai" />
      <AdminHeader
        icon={<Bot />}
        title={t("admin.access.org.aiTitle", { name: org.name })}
        description={t("admin.access.org.aiHint")}
        actions={
          <>
            {canManage && org.status !== "CLOSED" ? <OrgAiPauseButton organizationId={orgId} name={org.name} paused={s.aiDisabled} /> : null}
            <SectionLink href={`/${locale}/ai/workforce?org=${orgId}`}>{t("admin.access.org.aiEmployees")}</SectionLink>
          </>
        }
      />
      {s.aiDisabled ? <Notice tone="danger">{t("admin.access.org.aiKilled")}</Notice> : null}
      <StatGrid>
        <StatTile icon={<Bot />} label={t("admin.access.org.employees")} value={formatNumber(s.employees.length, locale)} hint={Object.entries(s.byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"} href={`/${locale}/ai/workforce?org=${orgId}`} />
        <StatTile icon={<Wallet />} label={t("admin.access.org.spend30")} value={usd(spend, locale)} hint={t("admin.access.org.fromLedger")} href={`/${locale}/ai/usage`} />
        <StatTile icon={<Gauge />} label={t("admin.access.org.tokens30")} value={formatNumber(tokens, locale)} />
        <StatTile icon={<Wallet />} label={t("admin.access.org.budgets")} value={formatNumber(s.budgets.length, locale)} hint={t("admin.access.org.hardStops", { count: s.budgets.filter((b) => b.hardStop).length })} />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Bot />} title={t("admin.access.org.employees")} />
          {s.employees.length === 0 ? (
            <EmptyState icon={<Bot />} title={t("admin.access.org.noEmployees")} />
          ) : (
            <Table density="compact">
              <THead>
                <Tr>
                  <Th>{t("admin.access.roles.name")}</Th>
                  <Th>{t("admin.access.org.department")}</Th>
                  <Th>{t("admin.access.users.columns.status")}</Th>
                  <Th>{t("admin.access.org.autonomy")}</Th>
                </Tr>
              </THead>
              <TBody>
                {s.employees.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={`/${locale}/ai/workforce?q=${encodeURIComponent(e.name)}&org=${orgId}`} className="font-medium hover:underline">
                        {e.name}
                      </Link>
                    </Td>
                    <Td>{e.department}</Td>
                    <Td>
                      <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{e.status}</Badge>
                    </Td>
                    <Td className="font-mono text-xs">{e.autonomy}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader icon={<Wallet />} title={t("admin.access.org.spendByCategory")} description={t("admin.access.org.fromLedger")} />
          {s.ledger30d.length === 0 ? (
            <EmptyState icon={<Wallet />} title={t("admin.access.common.noEvents")} body={t("admin.access.org.noSpend")} />
          ) : (
            <ul className="divide-y text-sm">
              {s.ledger30d.map((l) => (
                <li key={l.category} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Badge>{l.category}</Badge>
                  <span className="text-xs text-muted-foreground">{t("admin.access.org.entries", { count: l.entries })}</span>
                  <span className="tabular-nums">{usd(l.costMicros, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
