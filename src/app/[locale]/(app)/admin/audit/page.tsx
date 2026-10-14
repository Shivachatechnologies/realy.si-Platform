import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { listAuditLogs } from "@/server/modules/audit/service";
import { requireViewer } from "@/server/session";

const CATEGORIES = ["ADMIN", "SECURITY", "TENANT"] as const;

export default async function AuditPage({ searchParams }: PageProps<"/[locale]/admin/audit">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const sp = await searchParams;
  const category = CATEGORIES.find((c) => c === sp.category);
  const cursor = typeof sp.cursor === "string" && /^[0-9a-f-]{36}$/.test(sp.cursor) ? sp.cursor : undefined;

  let page: Awaited<ReturnType<typeof listAuditLogs>>;
  try {
    page = await listAuditLogs(viewer.ctx, null, { limit: 50, cursor, category });
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") return <Notice tone="warning">{t("errors.forbidden")}</Notice>;
    throw e;
  }
  const base = `/${locale}/admin/audit`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Button asChild size="sm" variant={category ? "ghost" : "secondary"}>
          <Link href={base}>{t("common.all")}</Link>
        </Button>
        {CATEGORIES.map((c) => (
          <Button key={c} asChild size="sm" variant={category === c ? "secondary" : "ghost"}>
            <Link href={`${base}?category=${c}`}>{t(`admin.audit.categories.${c}`)}</Link>
          </Button>
        ))}
      </div>
      <Card>
        {page.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("admin.audit.empty")}</p>
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
                  <Td className="font-mono text-[11px] text-muted-foreground">{`${a.actorType}${a.actorId ? `:${a.actorId.slice(0, 8)}` : ""}`}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="font-mono text-[11px] text-muted-foreground">{`${a.resourceType}${a.resourceId ? `:${a.resourceId.slice(0, 12)}` : ""}`}</Td>
                  <Td className="max-w-72 truncate text-xs">{a.reason ?? ""}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {page.nextCursor ? (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="secondary">
            <Link href={`${base}?${new URLSearchParams({ ...(category ? { category } : {}), cursor: page.nextCursor })}`}>{t("common.next")}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
