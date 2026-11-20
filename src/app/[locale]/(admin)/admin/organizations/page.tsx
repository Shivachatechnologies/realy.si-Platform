import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, NextPage, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDate, formatNumber } from "@/i18n/format";
import { listPlatformOrganizations } from "@/server/modules/admin/users";
import { requireViewer } from "@/server/session";

export default async function AdminOrganizationsPage({ searchParams }: PageProps<"/[locale]/admin/organizations">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { q: sp(query.q), status: sp(query.status), subscription: sp(query.subscription), created: sp(query.created) };
  const r = await guard(listPlatformOrganizations(viewer.ctx, { ...params, q: params.q ?? "", cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const orgs = r.value;
  const base = `/${locale}/admin/organizations`;
  return (
    <div className="grid gap-4">
      <AdminHeader title={t("admin.nav.companies")} description={t("admin.organizations.hint")} />
      <Card>
        <CardHeader title={t("admin.organizations.total", { count: formatNumber(orgs.total, locale) })} />
        <FilterBar
          action={base}
          q={params.q}
          qLabel={t("admin.organizations.search")}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "status", label: t("admin.users.filters.status"), options: (["ACTIVE", "SUSPENDED", "CLOSED"] as const).map((s) => ({ value: s, label: t(`admin.organizations.status.${s}`) })) },
            {
              name: "subscription",
              label: t("admin.organizations.columns.subscription"),
              options: [...(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED"] as const).map((s) => ({ value: s, label: t(`admin.subscriptions.status.${s}`) })), { value: "NONE", label: t("admin.organizations.noSubscription") }],
            },
            { name: "created", label: t("admin.users.filters.created"), options: (["7d", "30d", "90d"] as const).map((v) => ({ value: v, label: t(`admin.common.period.${v}`) })) },
          ]}
        />
        {orgs.data.length === 0 ? (
          <Empty>{t("common.noResults")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.organizations.columns.name")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.organizations.columns.members")}</Th>
                <Th>{t("admin.organizations.columns.companies")}</Th>
                <Th>{t("admin.organizations.columns.subscription")}</Th>
                <Th>{t("admin.organizations.columns.aiTasks")}</Th>
                <Th>{t("admin.organizations.columns.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {orgs.data.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <Link href={`${base}/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{o.slug}</div>
                  </Td>
                  <Td>
                    <Badge tone={o.status === "ACTIVE" ? "success" : "danger"}>{t(`admin.organizations.status.${o.status}`)}</Badge>
                  </Td>
                  <Td className="tabular">{o.members}</Td>
                  <Td className="tabular">{o.companies}</Td>
                  <Td className="text-xs">{o.subscription ? `${o.subscription.plan} · ${t(`admin.subscriptions.status.${o.subscription.status}`)}` : <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="tabular">{o.aiTasks30d}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={orgs.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
