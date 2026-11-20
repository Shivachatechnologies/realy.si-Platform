import Link from "next/link";
import { Bot, Building2, PauseCircle, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Avatar, EmptyState, FilterBar, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { OrgAiPauseButton } from "@/components/admin/ai-models-editor";
import { EmployeeAdmin } from "@/components/admin/people-actions";
import { db } from "@/server/core/db";
import { getControls } from "@/server/core/platform-controls";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { MODEL_PRICES } from "@/server/modules/workforce/pricing";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { adminCapabilities } from "@/server/modules/admin/access";
import { aiWorkforceBrowser } from "@/server/modules/admin/ai-models";
import { requireViewer } from "@/server/session";

/** AI employees & agents across tenants (read-only) with per-organization pause / resume of all AI work. */
export default async function AdminAiWorkforcePage({ searchParams }: PageProps<"/[locale]/ai/workforce">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const params = { q: sp(q.q), org: sp(q.org), status: sp(q.status), department: sp(q.department) };
  const r = await guard(Promise.all([aiWorkforceBrowser(viewer.ctx, params), adminCapabilities(viewer.ctx)]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [o, caps] = r.value;
  const canManageAi = caps["platform.ai.manage"];
  const controls = await getControls();
  const models = Object.keys(MODEL_PRICES).filter((m) => !controls.aiDisabledModels.includes(m) && (controls.aiAllowedModels.length === 0 || controls.aiAllowedModels.includes(m)));
  const extra = canManageAi && o.employees.length ? await db().aiEmployee.findMany({ where: { id: { in: o.employees.map((e) => e.id) } }, select: { id: true, allowedTools: true, monthlyCostBudgetCents: true } }) : [];
  const canPause = caps["platform.organizations.manage"];
  const base = `/${locale}/ai/workforce`;
  const n = (v: number) => formatNumber(v, locale);
  const totals = o.organizations.reduce((a, x) => ({ active: a.active + x.active, paused: a.paused + x.paused, orgsPaused: a.orgsPaused + (x.aiDisabled ? 1 : 0) }), { active: 0, paused: 0, orgsPaused: 0 });
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<Bot />} title={t("admin.nav.aiWorkforce")} description={t("admin.aiWorkforce.subtitle")} why={t("admin.aiWorkforce.why")} />
      <StatGrid>
        <StatTile icon={<Bot />} label={t("admin.aiWorkforce.active")} value={n(totals.active)} href={`${base}?status=ACTIVE`} live={totals.active > 0} />
        <StatTile icon={<PauseCircle />} label={t("admin.aiWorkforce.paused")} value={n(totals.paused)} href={`${base}?status=PAUSED`} />
        <StatTile icon={<Building2 />} label={t("admin.aiWorkforce.organizations")} value={n(o.organizations.length)} />
        <StatTile icon={<Users />} label={t("admin.aiWorkforce.orgsPaused")} value={n(totals.orgsPaused)} tone={totals.orgsPaused ? "warning" : undefined} />
      </StatGrid>
      <Card>
        <CardHeader icon={<Building2 />} title={t("admin.aiWorkforce.byOrg")} description={t("admin.aiWorkforce.byOrgHint")} />
        {o.organizations.length === 0 ? (
          <EmptyState icon={<Bot />} title={t("admin.aiWorkforce.empty")} body={t("admin.aiWorkforce.emptyHint")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.aiWorkforce.active")}</Th>
                <Th>{t("admin.aiWorkforce.paused")}</Th>
                <Th>{t("admin.aiWorkforce.aiState")}</Th>
                <Th className="text-end">{t("admin.common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {o.organizations.slice(0, 50).map((x) => (
                <Tr key={x.id}>
                  <Td>
                    <Link href={`${base}?org=${x.id}`} className="font-medium hover:underline">
                      {x.name}
                    </Link>
                  </Td>
                  <Td className="tabular-nums">{n(x.active)}</Td>
                  <Td className="tabular-nums">{n(x.paused)}</Td>
                  <Td>{x.aiDisabled ? <Badge tone="warning">{t("admin.aiWorkforce.aiPaused")}</Badge> : <Badge tone="success">{t("admin.aiWorkforce.aiRunning")}</Badge>}</Td>
                  <Td className="text-end">{canPause ? <OrgAiPauseButton organizationId={x.id} name={x.name} paused={x.aiDisabled} /> : null}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Card>
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.aiWorkforce.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.users.filters.status"), options: (["ACTIVE", "PAUSED"] as const).map((s) => ({ value: s, label: t(`admin.aiWorkforce.status.${s}`) })) },
            { name: "department", label: t("admin.aiWorkforce.department"), options: o.departments.map((d) => ({ value: d.department, label: `${d.department.replace(/_/g, " ")} (${d.count})` })) },
          ]}
          extra={params.org ? <input type="hidden" name="org" value={params.org} /> : undefined}
        />
        {o.employees.length === 0 ? (
          <EmptyState icon={<Bot />} title={t("common.noResults")} body={t("admin.common.tryOtherFilters")} />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.aiWorkforce.employee")}</Th>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.aiWorkforce.department")}</Th>
                <Th>{t("admin.aiWorkforce.autonomy")}</Th>
                <Th>{t("admin.aiModels.model")}</Th>
                <Th>{t("admin.aiWorkforce.month")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                {canManageAi ? <Th className="text-end">{t("admin.common.actions")}</Th> : null}
              </Tr>
            </THead>
            <TBody>
              {o.employees.map((e) => (
                <Tr key={e.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={e.name} size="sm" square />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{e.jobTitle ?? e.profileKey}</div>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-xs">
                    <Link href={`/${locale}/organizations/${e.organizationId}`} className="hover:underline">
                      {e.organizationName}
                    </Link>
                    <div className="text-[11px] text-muted-foreground">{e.companyName}</div>
                  </Td>
                  <Td className="text-xs capitalize">{e.department.replace(/_/g, " ")}</Td>
                  <Td className="font-mono text-[11px]">{e.autonomy}</Td>
                  <Td className="font-mono text-[11px]">{e.model ?? t("admin.aiModels.platformDefault")}</Td>
                  <Td className="text-xs tabular-nums">
                    {t("admin.aiWorkforce.tasks", { count: e.tasksMonth })} · {t("admin.aiModels.tokens", { count: e.tokensMonth })}
                  </Td>
                  <Td>
                    <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{t(`admin.aiWorkforce.status.${e.status}`)}</Badge>
                    {e.orgAiDisabled ? <div className="text-[11px] text-warning">{t("admin.aiWorkforce.aiPaused")}</div> : null}
                  </Td>
                  {canManageAi ? (
                    <Td className="text-end">
                      <EmployeeAdmin
                        models={models}
                        employee={{
                          id: e.id,
                          name: e.name,
                          model: e.model,
                          autonomy: e.autonomy,
                          status: e.status,
                          monthlyTokenBudget: e.monthlyTokenBudget,
                          monthlyCostBudgetCents: extra.find((x) => x.id === e.id)?.monthlyCostBudgetCents?.toString() ?? null,
                          allowedTools: extra.find((x) => x.id === e.id)?.allowedTools ?? [],
                          profileTools: [...(AGENT_PROFILES.find((p) => p.key === e.profileKey)?.tools ?? [])],
                        }}
                      />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
