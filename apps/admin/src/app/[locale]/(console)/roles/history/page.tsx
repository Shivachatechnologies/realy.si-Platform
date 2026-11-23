import Link from "next/link";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AdminHeader, EmptyState, NextPage, SectionLink, guard, sp } from "@/components/admin/kit";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { permissionHistory } from "@/server/modules/admin/roles";
import { requireViewer } from "@/server/session";

/** Platform permission history: grants, revocations, expiries, role edits, break-glass and review decisions. */
export default async function AdminPermissionHistoryPage({ searchParams }: PageProps<"/[locale]/roles/history">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const q = await searchParams;
  const r = await guard(permissionHistory(viewer.ctx, { cursor: sp(q.cursor) }), t("errors.forbidden"));
  if (!r.ok) return r.node;
  return (
    <div className="grid gap-4">
      <AdminHeader icon={<History />} title={t("admin.access.history.title")} description={t("admin.access.history.subtitle")} actions={<SectionLink href={`/${locale}/audit?category=SECURITY`}>{t("admin.access.common.openAudit")}</SectionLink>} />
      <Card>
        {r.value.data.length === 0 ? (
          <EmptyState icon={<History />} title={t("admin.access.common.noEvents")} />
        ) : (
          <Table density="compact">
            <THead>
              <Tr>
                <Th>{t("admin.access.history.when")}</Th>
                <Th>{t("admin.access.history.action")}</Th>
                <Th>{t("admin.access.history.by")}</Th>
                <Th>{t("admin.access.history.subject")}</Th>
                <Th>{t("admin.access.history.detail")}</Th>
              </Tr>
            </THead>
            <TBody>
              {r.value.data.map((h) => {
                const v = { ...((h.oldValue ?? {}) as Record<string, unknown>), ...((h.newValue ?? {}) as Record<string, unknown>) };
                const detail = [v.roleKey, v.key, v.decision, v.expiresAt ? `→ ${String(v.expiresAt).slice(0, 16)}` : null].filter(Boolean).join(" · ");
                return (
                  <Tr key={h.id}>
                    <Td className="text-xs">
                      <Timestamp value={h.createdAt} />
                    </Td>
                    <Td>
                      <Badge tone="warning" className="font-mono">
                        {h.action}
                      </Badge>
                    </Td>
                    <Td className="text-xs">{h.actor?.email ?? h.actorType}</Td>
                    <Td className="text-xs">
                      {h.subject ? (
                        <Link href={`/${locale}/users/${h.subject.id}`} className="hover:underline">
                          {h.subject.email}
                        </Link>
                      ) : h.resourceType === "role" && h.resourceId ? (
                        <Link href={`/${locale}/roles/${h.resourceId}`} className="font-mono hover:underline">
                          {h.resourceId.slice(0, 8)}
                        </Link>
                      ) : h.resourceType === "access_review" && h.resourceId ? (
                        <Link href={`/${locale}/roles/reviews/${h.resourceId}`} className="hover:underline">
                          {t("admin.access.nav.reviews")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="max-w-80 truncate text-xs" title={h.reason ?? undefined}>
                      <span className="font-mono">{detail || "—"}</span>
                      {h.reason ? <span className="ms-1 text-muted-foreground">“{h.reason}”</span> : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
        <NextPage base={`/${locale}/roles/history`} params={{}} cursor={r.value.nextCursor} label={t("common.next")} />
      </Card>
    </div>
  );
}
