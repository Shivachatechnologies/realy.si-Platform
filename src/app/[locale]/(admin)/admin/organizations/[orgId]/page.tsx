import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, Facts, StatGrid, StatTile, guard, usd } from "@/components/admin/kit";
import { OrgRestrictions, OrgStatusButton, TenantViewGate } from "@/components/admin/org-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { db } from "@/server/core/db";
import { PLATFORM_MODULES } from "@/server/core/platform-controls";
import { canPlatform } from "@/server/modules/admin/access";
import { getPlatformOrganization, hasTenantViewGrant } from "@/server/modules/admin/tenants";
import { requireViewer } from "@/server/session";

export default async function AdminOrganizationPage({ params }: PageProps<"/[locale]/admin/organizations/[orgId]">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { orgId } = await params;
  if (!(await canPlatform(viewer.ctx, "platform.organizations.read"))) return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  if (!(await hasTenantViewGrant(viewer.ctx, orgId))) {
    const org = await db().organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (!org) notFound();
    return <TenantViewGate organizationId={orgId} name={org.name} />;
  }
  const r = await guard(getPlatformOrganization(viewer.ctx, orgId), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const o = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.organizations.manage");
  const tz = viewer.user.timezone;
  const base = `/${locale}/admin`;
  const sub = o.subscriptions[0];
  const n = (v: number) => formatNumber(v, locale);
  return (
    <div className="grid gap-4">
      <AdminHeader
        title={o.name}
        description={`${o.slug} · ${formatDate(o.createdAt, locale, tz)}`}
        actions={
          <>
            <Badge tone={o.status === "ACTIVE" ? "success" : "danger"}>{t(`admin.organizations.status.${o.status}`)}</Badge>
            {canManage ? <OrgStatusButton organizationId={o.id} slug={o.slug} status={o.status} /> : null}
            <OrgRestrictions organizationId={o.id} value={o.override} modules={[...PLATFORM_MODULES]} canManage={canManage} />
          </>
        }
      />
      <StatGrid>
        <StatTile label={t("admin.organizations.columns.members")} value={n(o.members.filter((m) => m.status === "ACTIVE").length)} hint={o.owners.map((u) => u.email).join(", ") || "—"} />
        <StatTile label={t("admin.organizations.columns.companies")} value={n(o.companies.filter((c) => !c.deletedAt).length)} />
        <StatTile label={t("admin.organizations.detail.aiTasks30")} value={n(o.ai.tasks30d)} hint={t("admin.organizations.detail.failed", { count: n(o.ai.failed30d) })} tone={o.ai.failed30d ? "warning" : undefined} href={`${base}/ai/tasks?org=${o.id}`} />
        <StatTile label={t("admin.organizations.detail.aiTokensMonth")} value={n(o.ai.month.tokens)} hint={usd(o.ai.month.costMicros, locale)} />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.organizations.detail.plan")} />
          <Facts
            rows={[
              [t("admin.organizations.columns.subscription"), sub ? `${sub.plan.name} · ${t(`admin.subscriptions.status.${sub.status}`)}` : t("admin.organizations.noSubscription")],
              [t("admin.subscriptions.periodEnd"), sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, locale, tz) : "—"],
              [t("admin.plans.limits.seats.max"), o.plan.seats ?? "∞"],
              [t("admin.plans.limits.companies.max"), o.plan.companies ?? "∞"],
              [t("admin.plans.limits.ai.tokens.month"), o.plan.aiTokensPerMonth === null ? "∞" : n(o.plan.aiTokensPerMonth)],
              [t("admin.plans.limits.api.calls.month"), o.plan.apiCallsPerMonth === null ? "∞" : n(o.plan.apiCallsPerMonth)],
            ]}
          />
        </Card>
        <Card>
          <CardHeader title={t("admin.organizations.restrictions")} />
          <Facts
            rows={[
              [t("admin.organizations.disabledModules"), o.override.disabledModules.length ? o.override.disabledModules.map((m) => t(`admin.modules.${m}`)).join(", ") : t("admin.controls.none")],
              [t("admin.organizations.aiDisabled"), o.override.aiDisabled ? t("admin.controls.on") : t("admin.controls.off")],
              [t("admin.organizations.aiDaily"), o.override.aiDailyTokenBudget === null ? "∞" : n(o.override.aiDailyTokenBudget)],
              [t("admin.organizations.aiMonthly"), o.override.aiMonthlyTokenBudget === null ? "∞" : n(o.override.aiMonthlyTokenBudget)],
              [t("admin.organizations.detail.usage"), o.usage.map((u) => `${u.meter}: ${n(u.quantity)}`).join(" · ") || "—"],
            ]}
          />
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.organizations.detail.modules")} description={t("admin.organizations.detail.modulesHint")} />
        <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-5">
          {o.modules.map((m) => {
            const total = Object.values(m.counts).reduce((a, b) => a + b, 0);
            return (
              <div key={m.module} className="bg-surface p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t(`admin.modules.${m.module}`)}
                  {total ? <Badge tone="success">{t("admin.organizations.detail.inUse")}</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {Object.entries(m.counts)
                    .map(([k, v]) => `${t(`admin.organizations.counts.${k}`)}: ${n(v)}`)
                    .join(" · ")}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("admin.organizations.detail.members")} />
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.users.columns.user")}</Th>
                <Th>{t("admin.users.detail.roles")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.members.map((m) => (
                <Tr key={m.user.id}>
                  <Td>
                    <Link href={`${base}/users/${m.user.id}`} className="hover:underline">
                      {m.user.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{m.user.email}</div>
                  </Td>
                  <Td className="font-mono text-[11px]">{m.roles.join(", ") || "—"}</Td>
                  <Td>
                    <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{t(`admin.users.status.${m.user.status}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("admin.organizations.columns.companies")} />
          {o.companies.length === 0 ? (
            <Empty>{t("common.noResults")}</Empty>
          ) : (
            <ul className="divide-y">
              {o.companies.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <Badge>{c.stage}</Badge>
                  {c.deletedAt ? <Badge tone="danger">{t("admin.organizations.detail.deleted")}</Badge> : null}
                  <span className="ms-auto text-xs text-muted-foreground">{formatDate(c.createdAt, locale, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title={t("admin.organizations.detail.recentTasks")} actions={<Link href={`${base}/ai/tasks?org=${o.id}`} className="text-xs underline">{t("admin.overview.viewAll")}</Link>} />
        {o.ai.recentTasks.length === 0 ? (
          <Empty>{t("admin.ai.noTasks")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.ai.columns.task")}</Th>
                <Th>{t("admin.ai.columns.status")}</Th>
                <Th>{t("admin.ai.columns.tokens")}</Th>
                <Th>{t("admin.audit.time")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.ai.recentTasks.map((task) => (
                <Tr key={task.id}>
                  <Td>
                    <div className="max-w-80 truncate">{task.title}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{task.profile}</div>
                  </Td>
                  <Td>
                    <Badge tone={task.status === "FAILED" ? "danger" : task.status === "COMPLETED" ? "success" : "neutral"}>{t(`admin.ai.status.${task.status}`)}</Badge>
                    {task.errorCode ? <div className="font-mono text-[11px] text-danger">{task.errorCode}</div> : null}
                  </Td>
                  <Td className="tabular text-xs">{n((task.inputTokens ?? 0) + (task.outputTokens ?? 0))}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(task.createdAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("admin.organizations.detail.activity")} />
        {o.activity.length === 0 ? (
          <Empty>{t("admin.audit.empty")}</Empty>
        ) : (
          <ul className="divide-y">
            {o.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                <span className="text-muted-foreground">{formatDateTime(a.createdAt, locale, tz)}</span>
                <Badge tone={a.category === "TENANT" ? "neutral" : a.category === "SECURITY" ? "warning" : "accent"}>{a.action}</Badge>
                <span className="font-mono text-[11px] text-muted-foreground">{`${a.resourceType}${a.resourceId ? `:${a.resourceId.slice(0, 8)}` : ""}`}</span>
                {a.reason ? <span className="truncate">{a.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
