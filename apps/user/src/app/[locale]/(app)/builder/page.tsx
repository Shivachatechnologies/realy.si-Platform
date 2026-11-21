import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { BuilderFrame, RUN_TONE } from "@/components/builder/frame";
import { SmartEmpty } from "@/components/builder/smart-empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { listRuns } from "@/server/modules/builder/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("builder.title") };
}

const STATUSES = ["DRAFT", "RUNNING", "WAITING_INPUT", "FAILED", "COMPLETED", "CANCELLED"] as const;
const SORTS = ["newest", "oldest", "company"] as const;

/** Company Builder: every builder run in the organization's visible companies. */
export default async function BuilderPage({ searchParams }: PageProps<"/[locale]/builder">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, companies, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  const sort = typeof sp.sort === "string" && (SORTS as readonly string[]).includes(sp.sort) ? sp.sort : "newest";
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const PAGE = 20;

  const all = await listRuns(viewer.ctx, org.id, companies.map((c) => c.id));
  const filtered = all
    .filter((r) => (!status || r.status === status) && (!q || r.company.name.toLowerCase().includes(q)))
    .sort((a, b) => (sort === "company" ? a.company.name.localeCompare(b.company.name, locale) : sort === "oldest" ? +a.createdAt - +b.createdAt : +b.createdAt - +a.createdAt));
  const rows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const canManage = company ? await can(viewer.ctx, "companies.manage", await companyChain(db(), org.id, company.id)) : false;
  const activeHere = company ? all.find((r) => r.companyId === company.id && ["DRAFT", "RUNNING", "WAITING_INPUT", "FAILED"].includes(r.status)) : null;
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), sort, page: String(p) })}`;

  return (
    <BuilderFrame
      locale={locale}
      active="runs"
      title={t("builder.title")}
      description={t("builder.subtitle")}
      actions={
        <>
          {canManage && company && !activeHere ? (
            <Button asChild>
              <Link href={`/${locale}/builder/new`}>
                <Plus aria-hidden />
                {t("builder.startFor", { name: company.name })}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="secondary">
            <Link href={`/${locale}/onboarding?step=business`}>{t("builder.addBusiness")}</Link>
          </Button>
        </>
      }
    >
      {activeHere ? (
        <Notice tone={activeHere.status === "WAITING_INPUT" || activeHere.status === "FAILED" ? "warning" : "info"} action={<Button asChild size="sm"><Link href={`/${locale}/builder/${activeHere.id}`}>{t("builder.open")}</Link></Button>}>
          {t(`builder.activeNotice.${activeHere.status}`, { name: activeHere.company.name })}
        </Notice>
      ) : null}
      <Card>
        <CardHeader title={t("builder.card.title")} description={t("builder.card.description", { count: all.length })} />
        <form className="flex flex-wrap items-end gap-2 border-b p-3" method="get">
          <Input name="q" defaultValue={q} placeholder={t("builder.list.search")} aria-label={t("builder.list.search")} className="h-8 max-w-60" />
          <Select name="status" defaultValue={status} aria-label={t("common.status")} className="h-8 max-w-48">
            <option value="">{t("common.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`builder.runStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={sort} aria-label={t("builder.list.sort")} className="h-8 max-w-48">
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`builder.list.sorts.${s}`)}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary">
            {t("builder.list.apply")}
          </Button>
        </form>
        {rows.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("common.company")}</Th>
                <Th>{t("builder.list.mode")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("builder.list.progress")}</Th>
                <Th>{t("builder.list.started")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link className="font-medium hover:underline" href={`/${locale}/builder/${r.id}`}>
                      {r.company.name}
                    </Link>
                  </Td>
                  <Td>{t(`builder.modes.${r.mode}`)}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={RUN_TONE[r.status]}>{t(`builder.runStatus.${r.status}`)}</Badge>
                      {r.openDecisions ? <Badge tone="warning">{t("builder.list.decisions", { count: r.openDecisions })}</Badge> : null}
                    </span>
                  </Td>
                  <Td className="tabular-nums">{t("builder.list.steps", { done: r.completedSteps, total: r.totalSteps })}</Td>
                  <Td>{formatDateTime(r.createdAt, locale, viewer.user.timezone)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        ) : (
          all.length ? (
            <p className="p-4 text-sm text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <SmartEmpty
              title={t("builder.smartEmpty.title")}
              hint={t("builder.list.empty")}
              steps={[t("builder.smartEmpty.step1"), t("builder.smartEmpty.step2"), t("builder.smartEmpty.step3")]}
              help={t("builder.smartEmpty.help")}
              href={`/${locale}/onboarding?new=1`}
            />
          )
        )}
        {filtered.length > PAGE ? (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            {page > 1 ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={qs(page - 1)}>{t("common.previous")}</Link>
              </Button>
            ) : null}
            {page * PAGE < filtered.length ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={qs(page + 1)}>{t("common.next")}</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </BuilderFrame>
  );
}
