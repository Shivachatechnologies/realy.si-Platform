import Link from "next/link";
import { ArrowUpRight, KeyRound, MailCheck, MailWarning, SearchX, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminHeader, Avatar, EmptyState, FilterBar, NextPage, QuickFilters, guard, sp } from "@/components/admin/kit";
import { DrawerSection, SideDrawer } from "@/components/admin/drawer";
import { UserActions } from "@/components/admin/user-actions";
import { UserStatusButton } from "@/components/admin/user-status-button";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listPlatformUsers } from "@/server/modules/admin/users";
import { requestTime, requireViewer } from "@/server/session";

const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "warning", DELETED: "danger" } as const;

/** Users: searchable directory with status chips and a quick-actions drawer per user. */
export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/admin/users">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), mfa: sp(query.mfa), created: sp(query.created), login: sp(query.login) };
  const r = await guard(listPlatformUsers(viewer.ctx, { ...params, q: params.q ?? "", cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const users = r.value;
  const canManage = await canPlatform(viewer.ctx, "platform.users.manage");
  const base = `/${locale}/admin/users`;
  const now = requestTime();
  const tz = viewer.user.timezone;
  const filtered = Object.values(params).some(Boolean);
  return (
    <div className="grid gap-4">
      <AdminHeader
        icon={<Users />}
        title={t("admin.nav.users")}
        description={t("admin.users.subtitle")}
        why={t("admin.users.why")}
        meta={<Badge tone="accent">{t("admin.users.total", { count: formatNumber(users.total, locale) })}</Badge>}
      />
      <Card>
        <QuickFilters
          base={base}
          name="status"
          value={params.status}
          params={params}
          label={t("admin.users.filters.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...(["ACTIVE", "SUSPENDED", "DELETED"] as const).map((s) => ({ value: s, label: t(`admin.users.status.${s}`) }))]}
        />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.users.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "mfa", label: t("admin.users.filters.mfa"), options: [{ value: "on", label: t("admin.users.mfaOn") }, { value: "off", label: t("admin.users.mfaOff") }] },
            { name: "created", label: t("admin.users.filters.created"), options: (["7d", "30d", "90d"] as const).map((v) => ({ value: v, label: t(`admin.common.period.${v}`) })) },
            { name: "login", label: t("admin.users.filters.login"), options: (["7d", "30d", "inactive30", "never"] as const).map((v) => ({ value: v, label: t(`admin.users.login.${v}`) })) },
          ]}
          extra={params.status ? <input type="hidden" name="status" value={params.status} /> : null}
        />
        {users.data.length === 0 ? (
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
        ) : (
          <ul className="stagger divide-y">
            {users.data.map((u) => {
              const isAdmin = u.platformRoles.length > 0;
              const self = u.id === viewer.user.id;
              return (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                  <Avatar name={u.name || u.email} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`${base}/${u.id}`} className="truncate font-medium hover:underline focus-visible:outline-2">
                        {u.name}
                      </Link>
                      <Badge shape="pill" tone={STATUS_TONE[u.status]}>
                        {t(`admin.users.status.${u.status}`)}
                      </Badge>
                      {u.platformRoles.map((role) => (
                        <Badge key={role} shape="pill" tone="accent">
                          {role}
                        </Badge>
                      ))}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
                    <span className="inline-flex items-center gap-1" title={u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}>
                      {u.mfaEnabled ? <ShieldCheck className="size-3.5 text-success" aria-hidden /> : <ShieldOff className="size-3.5 text-warning" aria-hidden />}
                      <span className="sr-only">{u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}</span>
                    </span>
                    <span className="inline-flex items-center gap-1" title={u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}>
                      {u.emailVerifiedAt ? <MailCheck className="size-3.5 text-success" aria-hidden /> : <MailWarning className="size-3.5 text-warning" aria-hidden />}
                      <span className="sr-only">{u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}</span>
                    </span>
                    <span className="w-16 tabular-nums">{t("admin.users.orgCount", { count: u.organizations })}</span>
                    <span className="w-24 truncate text-end">{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt, locale, now) : t("admin.users.login.never")}</span>
                  </div>
                  <SideDrawer label={t("admin.common.quickActions")} title={u.name} description={u.email} header={<Avatar name={u.name || u.email} size="lg" />}>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge shape="pill" tone={STATUS_TONE[u.status]}>
                        {t(`admin.users.status.${u.status}`)}
                      </Badge>
                      <Badge shape="pill" tone={u.mfaEnabled ? "success" : "warning"}>
                        {u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}
                      </Badge>
                      <Badge shape="pill" tone={u.emailVerifiedAt ? "success" : "warning"}>
                        {u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}
                      </Badge>
                    </div>
                    <DrawerSection title={t("admin.users.detail.account")}>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">{t("admin.users.columns.lastLogin")}</dt>
                          <dd>{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt, locale, now) : t("admin.users.login.never")}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">{t("admin.users.columns.created")}</dt>
                          <dd>{formatDate(u.createdAt, locale, tz)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">{t("admin.users.columns.organizations")}</dt>
                          <dd className="tabular-nums">{formatNumber(u.organizations, locale)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">{t("admin.users.detail.country")}</dt>
                          <dd>{u.countryCode ?? "—"}</dd>
                        </div>
                      </dl>
                    </DrawerSection>
                    <DrawerSection title={t("admin.common.actions")}>
                      {self ? (
                        <p className="text-xs text-muted-foreground">{t("admin.users.selfNote")}</p>
                      ) : isAdmin ? (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <KeyRound className="mt-px size-3.5 shrink-0" aria-hidden />
                          {t("admin.users.adminNote")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {canManage && u.status !== "DELETED" ? <UserStatusButton userId={u.id} email={u.email} status={u.status} /> : null}
                          <UserActions userId={u.id} email={u.email} deleted={u.status === "DELETED"} canManage={canManage} />
                          {!canManage ? <p className="text-xs text-muted-foreground">{t("admin.common.readOnly")}</p> : null}
                        </div>
                      )}
                    </DrawerSection>
                    <Button asChild variant="secondary">
                      <Link href={`${base}/${u.id}`}>
                        {t("admin.users.openProfile")}
                        <ArrowUpRight aria-hidden className="rtl:-scale-x-100" />
                      </Link>
                    </Button>
                  </SideDrawer>
                </li>
              );
            })}
          </ul>
        )}
        <NextPage base={base} params={params} cursor={users.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
