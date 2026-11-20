import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { UserStatusButton } from "@/components/admin/user-status-button";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listPlatformUsers } from "@/server/modules/admin/users";
import { can } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { requireViewer } from "@/server/session";

export default async function AdminUsersPage({ searchParams }: PageProps<"/[locale]/admin/users">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 200) : "";
  let users: Awaited<ReturnType<typeof listPlatformUsers>>;
  try {
    users = await listPlatformUsers(viewer.ctx, { q: query });
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const canManage = await can(viewer.ctx, "platform.users.manage", platformChain());
  return (
    <Card>
      <CardHeader title={t("admin.nav.users")} description={t("admin.users.count", { count: users.length })} />
      <form className="flex gap-2 border-b p-3" action={`/${locale}/admin/users`}>
        <Input name="q" type="search" defaultValue={query} maxLength={200} aria-label={t("admin.users.search")} placeholder={t("admin.users.search")} />
        <Button type="submit" variant="secondary">
          {t("admin.users.searchButton")}
        </Button>
      </form>
      {users.length === 0 ? (
        <p className="p-4 text-muted-foreground">{t("common.noResults")}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.users.columns.user")}</Th>
              <Th>{t("admin.users.columns.status")}</Th>
              <Th>{t("admin.users.columns.security")}</Th>
              <Th>{t("admin.users.columns.organizations")}</Th>
              <Th>{t("admin.users.columns.created")}</Th>
              {canManage ? <Th>{t("common.actions")}</Th> : null}
            </Tr>
          </THead>
          <TBody>
            {users.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                  {u.platformRoles.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.platformRoles.map((r) => (
                        <Badge key={r} tone="accent">
                          {r}
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
                <Td className="whitespace-nowrap text-muted-foreground">{formatDate(u.createdAt, locale, viewer.user.timezone)}</Td>
                {canManage ? (
                  <Td>
                    {u.status !== "DELETED" && u.id !== viewer.user.id && u.platformRoles.length === 0 ? (
                      <UserStatusButton userId={u.id} email={u.email} status={u.status} />
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
