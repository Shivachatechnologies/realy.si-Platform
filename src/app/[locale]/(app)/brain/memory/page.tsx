import type { Metadata } from "next";
import Link from "next/link";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { FilterBar } from "@/components/brain/filter-bar";
import { MemoryForm, MemoryItem } from "@/components/brain/memory-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listMemories } from "@/server/modules/brain/memory";
import { listDepartments } from "@/server/modules/brain/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("brain.memory.title") };
}

const PAGE = 50;

export default async function CompanyMemoryPage({ searchParams }: PageProps<"/[locale]/brain/memory">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const values = Object.fromEntries(["q", "departmentId", "pinned", "cursor"].map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : undefined])) as Record<string, string | undefined>;

  const header = (
    <div className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{t("modules.brain.title")}</h1>
      <p className="text-muted-foreground">{t("brain.memory.subtitle")}</p>
    </div>
  );
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "brain.read", chain), can(viewer.ctx, "brain.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }
  const cursor = values.cursor && /^[0-9a-f-]{36}$/i.test(values.cursor) ? values.cursor : undefined;
  const [page, departments] = await Promise.all([listMemories(viewer.ctx, org.id, company.id, { ...values, cursor, limit: PAGE }), listDepartments(viewer.ctx, org.id, company.id)]);
  const filtered = Boolean(values.q || values.departmentId || values.pinned);
  const keep = Object.fromEntries(Object.entries(values).filter(([k, v]) => v && k !== "cursor")) as Record<string, string>;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <BrainTabs locale={locale} active="memory" />
      <Notice>{t("brain.memory.promptNote")}</Notice>
      {canManage ? (
        <Card>
          <CardHeader title={t("brain.memory.new")} />
          <CardBody>
            <MemoryForm organizationId={org.id} companyId={company.id} departments={departments} />
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <div className="border-b p-4">
          <FilterBar action={`/${locale}/brain/memory`} t={t} values={values} departments={departments} show={{ pinned: true }} qLabel={t("brain.memory.search")} />
        </div>
        <CardHeader title={t("brain.memory.title")} description={t("brain.memory.count", { count: page.data.length })} />
        {page.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("brain.noMatches") : t("brain.memory.empty")}</p>
        ) : (
          <ul className="divide-y">
            {page.data.map((m) => (
              <MemoryItem
                key={m.id}
                organizationId={org.id}
                companyId={company.id}
                departments={departments}
                canManage={canManage}
                memory={{ id: m.id, title: m.title, fact: m.fact, source: m.source, departmentId: m.departmentId, pinned: m.pinned }}
                meta={[
                  m.department?.name ?? t("brain.memory.companyWide"),
                  m.authorKind === "AI" ? t("brain.memory.byAi") : t("brain.memory.byHuman"),
                  formatDate(m.updatedAt, locale, viewer.user.timezone),
                ].join(" · ")}
              />
            ))}
          </ul>
        )}
        {cursor || page.nextCursor ? (
          <div className="flex justify-between gap-2 border-t p-3">
            {cursor ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/${locale}/brain/memory?${new URLSearchParams(keep)}`}>{t("brain.firstPage")}</Link>
              </Button>
            ) : (
              <span />
            )}
            {page.nextCursor ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/${locale}/brain/memory?${new URLSearchParams({ ...keep, cursor: page.nextCursor })}`}>{t("brain.nextPage")}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
