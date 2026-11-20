import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, NextPage, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber, formatRelativeTime } from "@/i18n/format";
import { listPlatformUsers } from "@/server/modules/admin/users";
import { requestTime, requireViewer } from "@/server/session";

export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/admin/users">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), mfa: sp(query.mfa), created: sp(query.created), login: sp(query.login) };
  const r = await guard(listPlatformUsers(viewer.ctx, { ...params, q: params.q ?? "", cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const users = r.value;
  const base = `/${locale}/admin/users`;
  const now = requestTime();
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.users")} description={t("admin.users.subtitle")} />
      <Card>
        <CardHeader title={t("admin.users.total", { count: formatNumber(users.total, locale) })} />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.users.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.users.filters.status"), options: (["ACTIVE", "SUSPENDED", "DELETED"] as const).map((s) => ({ value: s, label: t(`admin.users.status.${s}`) })) },
            { name: "mfa", label: t("admin.users.filters.mfa"), options: [{ value: "on", label: t("admin.users.mfaOn") }, { value: "off", label: t("admin.users.mfaOff") }] },
            { name: "created", label: t("admin.users.filters.created"), options: (["7d", "30d", "90d"] as const).map((v) => ({ value: v, label: t(`admin.common.period.${v}`) })) },
            { name: "login", label: t("admin.users.filters.login"), options: (["7d", "30d", "inactive30", "never"] as const).map((v) => ({ value: v, label: t(`admin.users.login.${v}`) })) },
          ]}
        />
        {users.data.length === 0 ? (
          <Empty>{t("common.noResults")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.users.columns.user")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.users.columns.security")}</Th>
                <Th>{t("admin.users.columns.organizations")}</Th>
                <Th>{t("admin.users.columns.lastLogin")}</Th>
                <Th>{t("admin.users.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {users.data.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <Link href={`${base}/${u.id}`} className="font-medium hover:underline">
                      {u.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {u.platformRoles.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.platformRoles.map((role) => (
                          <Badge key={role} tone="accent">
                            {role}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{t(`admin.users.status.${u.status}`)}</Badge>
                  </Td>
                  <Td className="text-xs">
                    <div>{u.mfaEnabled ? t("admin.users.mfaOn") : t("admin.users.mfaOff")}</div>
                    <div className="text-muted-foreground">{u.emailVerifiedAt ? t("admin.users.verified") : t("admin.users.unverified")}</div>
                  </Td>
                  <Td className="tabular">{u.organizations}</Td>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? formatRelativeTime(u.lastLoginAt, locale, now) : t("admin.users.login.never")}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={users.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
