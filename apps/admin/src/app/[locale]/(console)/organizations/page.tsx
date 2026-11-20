import Link from "next/link";
import { ArrowUpRight, Bot, Building2, Lock, SearchX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminHeader, Avatar, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { DrawerSection, SideDrawer } from "@/components/admin/drawer";
import { OrgStatusButton } from "@/components/admin/org-actions";
import { CreateOrganization } from "@/components/admin/people-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listPlatformOrganizations } from "@/server/modules/admin/users";
import { requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "danger", CLOSED: "neutral" } as const;
const SUB_TONE: Record<string, "success" | "accent" | "warning" | "danger" | "neutral"> = { ACTIVE: "success", TRIALING: "accent", PAST_DUE: "warning", UNPAID: "danger" };

/** Organizations: searchable list with plan/status chips and a quick-actions drawer; details stay behind the audited reason gate. */
export default async function AdminOrganizationsPage({ searchParams }: PageProps<"/[locale]/organizations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), subscription: sp(query.subscription), created: sp(query.created) };
  const r = await guard(listPlatformOrganizations(viewer.ctx, { ...params, q: params.q ?? "", cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const orgs = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.organizations.manage");
  const base = `/${locale}/organizations`;
  const tz = viewer.user.timezone;
  const n = (v: number) => formatNumber(v, locale);
  const filtered = Object.values(params).some(Boolean);
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Building2 />}
        title={t("admin.nav.companies")}
        description={t("admin.organizations.hint")}
        why={t("admin.organizations.why")}
        meta={<Badge tone="accent">{t("admin.organizations.total", { count: n(orgs.total) })}</Badge>}
        actions={canManage ? <CreateOrganization /> : null}
      />
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.users.filters.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...(["ACTIVE", "SUSPENDED", "CLOSED"] as const).map((s) => ({ value: s, label: t(`admin.organizations.status.${s}`) }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.organizations.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            {
              name: "subscription",
              label: t("admin.organizations.columns.subscription"),
              options: [...(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"] as const).map((s) => ({ value: s, label: t(`admin.subscriptions.status.${s}`) })), { value: "NONE", label: t("admin.organizations.noSubscription") }],
            },
            { name: "created", label: t("admin.users.filters.created"), options: (["7d", "30d", "90d"] as const).map((v) => ({ value: v, label: t(`admin.common.period.${v}`) })) },
          ]}
          extra={params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        />
        {orgs.data.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={filtered ? t("common.noResults") : t("admin.organizations.emptyTitle")}
            body={filtered ? t("admin.common.tryOtherFilters") : t("admin.organizations.emptyBody")}
            action={
              filtered ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={base}>{t("admin.common.clearFilters")}</Link>
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="stagger divide-y">
            {orgs.data.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <Avatar name={o.name} square />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`${base}/${o.id}`} className="truncate font-medium hover:underline focus-visible:outline-2">
                      {o.name}
                    </Link>
                    <Badge shape="pill" tone={STATUS_TONE[o.status]}>
                      {t(`admin.organizations.status.${o.status}`)}
                    </Badge>
                    {o.subscription ? (
                      <Badge shape="pill" tone={SUB_TONE[o.subscription.status] ?? "neutral"}>
                        {o.subscription.plan} · {t(`admin.subscriptions.status.${o.subscription.status}`)}
                      </Badge>
                    ) : (
                      <Badge shape="pill">{t("admin.organizations.noSubscription")}</Badge>
                    )}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{o.slug}</div>
                </div>
                <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
                  <span className="inline-flex w-14 items-center gap-1 tabular-nums" title={t("admin.organizations.columns.members")}>
                    <Users className="size-3.5" aria-hidden />
                    {n(o.members)}
                  </span>
                  <span className="inline-flex w-14 items-center gap-1 tabular-nums" title={t("admin.organizations.columns.companies")}>
                    <Building2 className="size-3.5" aria-hidden />
                    {n(o.companies)}
                  </span>
                  <span className="inline-flex w-16 items-center gap-1 tabular-nums" title={t("admin.organizations.columns.aiTasks")}>
                    <Bot className="size-3.5" aria-hidden />
                    {n(o.aiTasks30d)}
                  </span>
                  <span className="w-24 text-end">{formatDate(o.createdAt, locale, tz)}</span>
                </div>
                <SideDrawer label={t("admin.common.quickActions")} title={o.name} description={o.slug} header={<Avatar name={o.name} size="lg" square />}>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge shape="pill" tone={STATUS_TONE[o.status]}>
                      {t(`admin.organizations.status.${o.status}`)}
                    </Badge>
                    {o.subscription ? (
                      <Badge shape="pill" tone={SUB_TONE[o.subscription.status] ?? "neutral"}>
                        {o.subscription.plan} · {t(`admin.subscriptions.status.${o.subscription.status}`)}
                      </Badge>
                    ) : null}
                  </div>
                  <DrawerSection title={t("admin.organizations.detail.atAGlance")}>
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">{t("admin.organizations.columns.members")}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{n(o.members)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t("admin.organizations.columns.companies")}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{n(o.companies)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t("admin.organizations.columns.aiTasks")}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{n(o.aiTasks30d)}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-muted-foreground">{t("admin.organizations.createdOn", { date: formatDate(o.createdAt, locale, tz) })}</p>
                  </DrawerSection>
                  <DrawerSection title={t("admin.common.actions")}>
                    <div className="flex flex-wrap gap-2">
                      {canManage ? <OrgStatusButton organizationId={o.id} slug={o.slug} status={o.status} /> : <p className="text-xs text-muted-foreground">{t("admin.common.readOnly")}</p>}
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/${locale}/ai/tasks?org=${o.id}`}>{t("admin.organizations.viewTasks")}</Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/${locale}/audit?org=${o.id}&scope=all`}>{t("admin.organizations.viewAudit")}</Link>
                      </Button>
                    </div>
                  </DrawerSection>
                  <div className="grid gap-2 rounded-lg border border-dashed p-3">
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
                      {t("admin.organizations.gateNote")}
                    </p>
                    <Button asChild>
                      <Link href={`${base}/${o.id}`}>
                        {t("admin.organizations.openDetails")}
                        <ArrowUpRight aria-hidden className="rtl:-scale-x-100" />
                      </Link>
                    </Button>
                  </div>
                </SideDrawer>
              </li>
            ))}
          </ul>
        )}
        <NextPage base={base} params={params} cursor={orgs.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
