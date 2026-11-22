import Link from "next/link";
import { MailCheck, MailWarning, SearchX, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminHeader, Avatar, EmptyState, FilterBar, QuickFilters, guard, sp } from "@/components/admin/kit";
import { CopyButton } from "@/components/admin/copy-button";
import { Timestamp } from "@/components/admin/timestamp";
import { DirectoryTable, colsParam, type DirectoryColumn } from "@/components/admin/people/directory-table";
import { ExportUsersButton } from "@/components/admin/people/user-admin-actions";
import { getLocale, getT } from "@/i18n/server";
import { formatNumber } from "@/i18n/format";
import { capabilitiesFor } from "@/server/modules/admin/access";
import { USER_STATUSES, USER_SORTS, listPlatformUsers } from "@/server/modules/admin/users";
import { requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "warning", PENDING_DELETION: "danger", DELETED: "neutral" } as const;

type Row = Awaited<ReturnType<typeof listPlatformUsers>>["data"][number];

/** Users: server-paginated directory (filters, sort, page size, column chooser, CSV export where authorized). */
export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/users">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = {
    q: sp(query.q),
    status: sp(query.status),
    mfa: sp(query.mfa),
    verified: sp(query.verified),
    method: sp(query.method),
    role: sp(query.role),
    org: sp(query.org),
    country: sp(query.country),
    created: sp(query.created),
    login: sp(query.login),
    sort: sp(query.sort),
    limit: sp(query.limit),
    cols: colsParam(query),
  };
  const r = await guard(listPlatformUsers(viewer.ctx, { ...params, q: params.q ?? "", cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const users = r.value;
  const caps = await capabilitiesFor(viewer.ctx, ["platform.data.export"] as const);
  const base = `/${locale}/users`;
  const filterKeys = ["q", "status", "mfa", "verified", "method", "role", "org", "country", "created", "login"] as const;
  const filtered = filterKeys.some((k) => !!params[k]);
  const filters = Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => !!e[1] && e[0] !== "cols" && e[0] !== "limit"));
  const L = (k: string) => t(`admin.access.users.columns.${k}`);

  const columns: DirectoryColumn<Row>[] = [
    {
      key: "user",
      label: L("user"),
      fixed: true,
      render: (u) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={u.name || u.email} size="sm" />
          <span className="min-w-0">
            <Link href={`${base}/${u.id}`} className="block truncate font-medium hover:underline focus-visible:outline-2">
              {u.name}
            </Link>
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              {u.email}
              <CopyButton value={u.email} label={t("admin.people.email")} />
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "status",
      label: L("status"),
      render: (u) => (
        <span className="flex flex-wrap gap-1">
          <Badge shape="pill" tone={STATUS_TONE[u.status]}>
            {t(`admin.access.users.status.${u.status}`)}
          </Badge>
          {u.restrictions.readOnly || u.restrictions.aiDisabled ? (
            <Badge shape="pill" tone="warning">
              {t("admin.access.users.restricted")}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "roles",
      label: L("roles"),
      render: (u) =>
        u.platformRoles.length ? (
          <span className="flex flex-wrap gap-1">
            {u.platformRoles.map((role) => (
              <Badge key={role} tone="accent" className="font-mono">
                {role}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "mfa",
      label: L("mfa"),
      render: (u) => (
        <span className="inline-flex items-center gap-1 text-xs">
          {u.mfaEnabled ? <ShieldCheck className="size-3.5 text-success" aria-hidden /> : <ShieldOff className="size-3.5 text-warning" aria-hidden />}
          {u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}
        </span>
      ),
    },
    {
      key: "verified",
      label: L("verified"),
      render: (u) => (
        <span className="inline-flex items-center gap-1 text-xs">
          {u.emailVerifiedAt ? <MailCheck className="size-3.5 text-success" aria-hidden /> : <MailWarning className="size-3.5 text-warning" aria-hidden />}
          {u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}
        </span>
      ),
    },
    { key: "methods", label: L("methods"), render: (u) => <span className="font-mono text-xs">{u.loginMethods.join(", ") || "—"}</span> },
    { key: "orgs", label: L("orgs"), className: "text-end tabular-nums", render: (u) => formatNumber(u.organizations, locale) },
    { key: "country", label: L("country"), optional: true, render: (u) => u.countryCode ?? "—" },
    { key: "locale", label: L("locale"), optional: true, render: (u) => <span className="font-mono text-xs">{u.locale}</span> },
    { key: "lastLogin", label: L("lastLogin"), render: (u) => (u.lastLoginAt ? <Timestamp value={u.lastLoginAt} mode="relative" className="text-xs" /> : <span className="text-xs text-muted-foreground">{t("admin.users.login.never")}</span>) },
    { key: "lastSeen", label: L("lastSeen"), optional: true, render: (u) => <Timestamp value={u.lastSeenAt} mode="relative" className="text-xs" /> },
    { key: "created", label: L("created"), render: (u) => <Timestamp value={u.createdAt} mode="absolute" className="text-xs" /> },
    { key: "deletion", label: L("deletion"), optional: true, render: (u) => (u.deletionScheduledFor ? <Timestamp value={u.deletionScheduledFor} mode="absolute" className="text-xs text-danger" /> : "—") },
    {
      key: "id",
      label: L("id"),
      optional: true,
      render: (u) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {u.id.slice(0, 8)}…<CopyButton value={u.id} label="ID" />
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Users />}
        title={t("admin.nav.users")}
        description={t("admin.users.subtitle")}
        why={t("admin.users.why")}
        meta={<Badge tone="accent">{t("admin.users.total", { count: formatNumber(users.total, locale) })}</Badge>}
        actions={caps["platform.data.export"] ? <ExportUsersButton filters={filters} /> : null}
      />
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.users.filters.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...USER_STATUSES.map((s) => ({ value: s, label: t(`admin.access.users.status.${s}`) }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.access.users.searchHint")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "mfa", label: t("admin.users.filters.mfa"), options: [{ value: "on", label: t("admin.users.mfaOn") }, { value: "off", label: t("admin.users.mfaOff") }] },
            { name: "verified", label: t("admin.access.users.filters.verified"), options: [{ value: "yes", label: t("admin.users.verified") }, { value: "no", label: t("admin.users.unverified") }] },
            { name: "method", label: t("admin.access.users.filters.method"), options: [{ value: "password", label: t("admin.users.detail.password") }, { value: "oauth", label: t("admin.access.users.oauth") }] },
            { name: "role", label: t("admin.access.users.filters.role"), options: [{ value: "admin", label: t("admin.access.users.platformAdmins") }, { value: "none", label: t("admin.access.users.noPlatformRole") }] },
            { name: "created", label: t("admin.users.filters.created"), options: (["7d", "30d", "90d"] as const).map((v) => ({ value: v, label: t(`admin.common.period.${v}`) })) },
            { name: "login", label: t("admin.users.filters.login"), options: (["7d", "30d", "inactive30", "never"] as const).map((v) => ({ value: v, label: t(`admin.users.login.${v}`) })) },
            { name: "sort", label: t("admin.access.users.filters.sort"), options: USER_SORTS.map((v) => ({ value: v, label: t(`admin.access.users.sort.${v}`) })) },
          ]}
          extra={
            <>
              <input name="country" defaultValue={params.country} maxLength={2} placeholder={t("admin.access.users.filters.country")} aria-label={t("admin.access.users.filters.country")} className="h-9 w-24 rounded-md border bg-surface px-2 text-sm uppercase" />
              <input name="org" defaultValue={params.org} maxLength={36} placeholder={t("admin.access.users.filters.org")} aria-label={t("admin.access.users.filters.org")} className="h-9 w-48 rounded-md border bg-surface px-2 font-mono text-xs" />
              {params.status ? <input type="hidden" name="status" value={params.status} /> : null}
              {params.cols ? <input type="hidden" name="cols" value={params.cols} /> : null}
              {params.limit ? <input type="hidden" name="limit" value={params.limit} /> : null}
            </>
          }
        />
        <DirectoryTable
          columns={columns}
          rows={users.data}
          params={params}
          base={base}
          nextCursor={users.nextCursor}
          limit={users.limit}
          filtered={filtered}
          source={t("admin.access.common.sourceUsers")}
          labels={{ columns: t("admin.access.common.columns"), apply: t("admin.access.common.apply"), pageSize: t("admin.access.common.pageSize"), reset: t("admin.common.clearFilters"), next: t("common.next"), source: t("admin.access.common.sourceHint") }}
          empty={
            <EmptyState
              icon={<SearchX />}
              title={filtered ? t("common.noResults") : t("admin.users.emptyTitle")}
              body={filtered ? t("admin.common.tryOtherFilters") : t("admin.users.emptyBody")}
              action={
                filtered ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={base}>{t("admin.common.clearFilters")}</Link>
                  </Button>
                ) : null
              }
            />
          }
        />
      </Card>
    </div>
  );
}
