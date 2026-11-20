import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { isAppError } from "@/server/core/errors";
import { parseAuditFilters, searchAudit } from "@/server/modules/enterprise/insights";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("enterprise.tabs.audit") };
}

const TONE = {
  TENANT: "neutral",
  ADMIN: "accent",
  SECURITY: "warning",
} as const;

export default async function AuditPage({ searchParams }: PageProps<"/[locale]/settings/audit">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const filters = parseAuditFilters(await searchParams);
  let result: Awaited<ReturnType<typeof searchAudit>>;
  try {
    result = await searchAudit(viewer.ctx, org.id, filters);
  } catch (e) {
    if (isAppError(e) && ["forbidden", "mfa_required"].includes(e.code)) return <Notice tone="warning">{t(`errors.${e.code}`)}</Notice>;
    throw e;
  }
  const members = await db().user.findMany({
    where: { memberships: { some: { organizationId: org.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const params = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      actor: filters.actor,
      action: filters.action,
      resource: filters.resource,
      category: filters.category,
      from: filters.from,
      to: filters.to,
      ...extra,
    }))
      if (v) p.set(k, v);
    return p.toString();
  };
  const tz = viewer.user.timezone;

  return (
    <Card>
      <CardHeader
        title={t("enterprise.audit.title")}
        description={t("enterprise.audit.subtitle")}
        actions={
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/v1/organizations/${org.id}/enterprise/audit/export?${params({})}`} download>
              <Download aria-hidden />
              {t("enterprise.audit.exportCsv")}
            </a>
          </Button>
        }
      />
      <form className="grid gap-2 border-b p-3 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_9rem_9rem_9rem_auto]" action={`/${locale}/settings/audit`}>
        <Select name="actor" defaultValue={filters.actor ?? ""} aria-label={t("enterprise.audit.actor")}>
          <option value="">{t("enterprise.audit.anyActor")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Input name="action" defaultValue={filters.action ?? ""} placeholder={t("enterprise.audit.actionPlaceholder")} aria-label={t("enterprise.audit.action")} maxLength={80} />
        <Select name="resource" defaultValue={filters.resource ?? ""} aria-label={t("enterprise.audit.resource")}>
          <option value="">{t("enterprise.audit.anyResource")}</option>
          {result.resourceTypes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select name="category" defaultValue={filters.category ?? ""} aria-label={t("enterprise.audit.category")}>
          <option value="">{t("enterprise.audit.anyCategory")}</option>
          {(["TENANT", "ADMIN", "SECURITY"] as const).map((c) => (
            <option key={c} value={c}>
              {t(`enterprise.audit.categories.${c}`)}
            </option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={filters.from ?? ""} aria-label={t("enterprise.audit.from")} />
        <Input name="to" type="date" defaultValue={filters.to ?? ""} aria-label={t("enterprise.audit.to")} />
        <Button type="submit" variant="secondary">
          {t("enterprise.access.filter")}
        </Button>
      </form>
      {result.data.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("enterprise.audit.empty")}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("enterprise.audit.when")}</Th>
              <Th>{t("enterprise.audit.actor")}</Th>
              <Th>{t("enterprise.audit.action")}</Th>
              <Th>{t("enterprise.audit.resource")}</Th>
              <Th>{t("enterprise.audit.details")}</Th>
            </Tr>
          </THead>
          <TBody>
            {result.data.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.createdAt, locale, tz)}</Td>
                <Td className="text-sm">
                  {r.actorName ?? t(`enterprise.audit.actorTypes.${r.actorType}`)}
                  {r.ip ? <div className="font-mono text-[11px] text-muted-foreground">{r.ip}</div> : null}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={TONE[r.category]}>{t(`enterprise.audit.categories.${r.category}`)}</Badge>
                    <code className="text-xs">{r.action}</code>
                  </div>
                </Td>
                <Td className="text-xs">
                  {r.resourceType}
                  {r.resourceId ? <div className="font-mono text-[11px] text-muted-foreground">{r.resourceId.slice(0, 13)}</div> : null}
                </Td>
                <Td className="max-w-80 text-xs">
                  {r.reason ? <p>{r.reason}</p> : null}
                  {r.newValue || r.oldValue ? (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">{t("enterprise.audit.changes")}</summary>
                      <pre dir="ltr" className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] whitespace-pre-wrap">
                        {JSON.stringify(
                          {
                            old: r.oldValue ?? undefined,
                            new: r.newValue ?? undefined,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <nav className="flex items-center justify-between gap-2 border-t p-3 text-sm" aria-label={t("marketplace.pagination")}>
        {filters.cursor ? (
          <Link href={`/${locale}/settings/audit?${params({})}`} className="text-primary hover:underline">
            {t("enterprise.audit.newest")}
          </Link>
        ) : (
          <span />
        )}
        {result.nextCursor ? (
          <Link href={`/${locale}/settings/audit?${params({ cursor: result.nextCursor })}`} className="text-primary hover:underline">
            {t("enterprise.audit.older")}
          </Link>
        ) : null}
      </nav>
    </Card>
  );
}
