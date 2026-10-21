import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listPlatformOrganizations } from "@/server/modules/admin/users";
import { requireViewer } from "@/server/session";

export default async function AdminOrganizationsPage({ searchParams }: PageProps<"/[locale]/admin/organizations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 200) : "";
  let orgs: Awaited<ReturnType<typeof listPlatformOrganizations>>;
  try {
    orgs = await listPlatformOrganizations(viewer.ctx, { q: query });
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  return (
    <Card>
      <CardHeader title={t("admin.nav.organizations")} description={t("admin.organizations.hint")} />
      <form className="flex gap-2 border-b p-3" action={`/${locale}/admin/organizations`}>
        <Input name="q" type="search" defaultValue={query} maxLength={200} aria-label={t("admin.organizations.search")} placeholder={t("admin.organizations.search")} />
        <Button type="submit" variant="secondary">
          {t("admin.users.searchButton")}
        </Button>
      </form>
      {orgs.length === 0 ? (
        <p className="p-4 text-muted-foreground">{t("common.noResults")}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("admin.organizations.columns.name")}</Th>
              <Th>{t("admin.organizations.columns.members")}</Th>
              <Th>{t("admin.organizations.columns.companies")}</Th>
              <Th>{t("admin.organizations.columns.subscription")}</Th>
              <Th>{t("admin.organizations.columns.created")}</Th>
            </Tr>
          </THead>
          <TBody>
            {orgs.map((o) => (
              <Tr key={o.id}>
                <Td>
                  <div className="font-medium">{o.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{o.slug}</div>
                </Td>
                <Td className="tabular">{o.members}</Td>
                <Td className="tabular">{o.companies}</Td>
                <Td>{o.subscription ? <Badge>{o.subscription}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt, locale, viewer.user.timezone)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
