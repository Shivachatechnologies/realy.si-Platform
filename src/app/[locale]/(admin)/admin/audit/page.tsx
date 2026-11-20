import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, Empty, FilterBar, NextPage, guard, sp } from "@/components/admin/kit";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { searchAudit } from "@/server/modules/admin/security";
import { requireViewer } from "@/server/session";

const CATEGORIES = ["ADMIN", "SECURITY", "TENANT"] as const;

/** Platform audit trail with filters and CSV export. */
export default async function AuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const query = await searchParams;
  const params = { category: sp(query.category), action: sp(query.action), actor: sp(query.actor), org: sp(query.org), resource: sp(query.resource), from: sp(query.from), to: sp(query.to), scope: sp(query.scope) };
  const r = await guard(searchAudit(viewer.ctx, { ...params, cursor: sp(query.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const page = r.value;
  const base = `/${locale}/admin/audit`;
  const exportQs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return (
    <div className="grid gap-4">
      <AdminHeader
        title={t("admin.nav.audit")}
        description={t("admin.audit.subtitle")}
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/v1/admin/audit-logs/export?${exportQs}`} download>
              <Download aria-hidden />
              {t("admin.audit.exportCsv")}
            </a>
          </Button>
        }
      />
      <Card>
        <FilterBar
          action={base}
          values={params}
          submitLabel={t("admin.users.searchButton")}
          filters={[
            { name: "category", label: t("admin.audit.category"), options: CATEGORIES.map((c) => ({ value: c, label: t(`admin.audit.categories.${c}`) })) },
            { name: "scope", label: t("admin.audit.scope"), options: [{ value: "platform", label: t("admin.audit.scopes.platform") }, { value: "all", label: t("admin.audit.scopes.all") }] },
          ]}
          extra={
            <>
              <Input name="action" defaultValue={params.action} placeholder={t("admin.audit.action")} aria-label={t("admin.audit.action")} className="w-40" maxLength={120} />
              <Input name="actor" defaultValue={params.actor} placeholder={t("admin.audit.actorEmail")} aria-label={t("admin.audit.actorEmail")} className="w-48" maxLength={254} />
              <Input name="resource" defaultValue={params.resource} placeholder={t("admin.audit.resource")} aria-label={t("admin.audit.resource")} className="w-40" maxLength={120} />
              <Input name="from" type="date" defaultValue={params.from} aria-label={t("admin.audit.from")} className="w-auto" />
              <Input name="to" type="date" defaultValue={params.to} aria-label={t("admin.audit.to")} className="w-auto" />
              {params.org ? <input type="hidden" name="org" value={params.org} /> : null}
            </>
          }
        />
        {page.data.length === 0 ? (
          <Empty>{t("admin.audit.empty")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.audit.time")}</Th>
                <Th>{t("admin.audit.category")}</Th>
                <Th>{t("admin.audit.actor")}</Th>
                <Th>{t("admin.audit.action")}</Th>
                <Th>{t("admin.audit.resource")}</Th>
                <Th>{t("admin.audit.reason")}</Th>
              </Tr>
            </THead>
            <TBody>
              {page.data.map((a) => (
                <Tr key={a.id}>
                  <Td className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(a.createdAt, locale, viewer.user.timezone)}</Td>
                  <Td>
                    <Badge tone={a.category === "SECURITY" ? "warning" : a.category === "ADMIN" ? "accent" : "neutral"}>{t(`admin.audit.categories.${a.category}`)}</Badge>
                  </Td>
                  <Td className="text-xs">{a.actorEmail ?? <span className="font-mono text-[11px] text-muted-foreground">{`${a.actorType}${a.actorId ? `:${a.actorId.slice(0, 8)}` : ""}`}</span>}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="font-mono text-[11px] text-muted-foreground">{`${a.resourceType}${a.resourceId ? `:${a.resourceId.slice(0, 12)}` : ""}`}</Td>
                  <Td className="max-w-72 truncate text-xs">{a.reason ?? ""}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <NextPage base={base} params={params} cursor={page.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
