import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ActionButton, InlineSelect } from "@/components/work/actions";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { IdeaForm, VoteButton } from "@/components/work/product-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { IDEA_STATUSES, listIdeas, parseIdeaFilters } from "@/server/modules/work/product";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.ideas") };
}

const IDEA_TONE = { NEW: "accent", UNDER_REVIEW: "warning", PLANNED: "neutral", DECLINED: "neutral", DONE: "success" } as const;

export default async function IdeasPage({ searchParams }: PageProps<"/[locale]/product/ideas">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const raw = await searchParams;
  const filters = parseIdeaFilters(raw);
  const path = `/${locale}/product/ideas`;
  const list = await listIdeas(viewer.ctx, org.id, company.id, filters);
  return (
    <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="ideas" />
      <Card>
        <CardHeader title={t("work.product.submitIdea")} description={t("work.product.ideasHint")} />
        <IdeaForm base={base} />
      </Card>
      <Card>
        <CardHeader title={t("work.product.tabs.ideas")} description={t("work.product.ideaCount", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.search")} />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label={t("work.task.status")}>
            <option value="">{t("work.allStatuses")}</option>
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`work.ideaStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={filters.sort} aria-label={t("work.sort")}>
            <option value="votes">{t("work.product.sortVotes")}</option>
            <option value="created">{t("work.sortNewest")}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t("work.apply")}
          </Button>
        </form>
        {list.data.length ? (
          <ul className="grid divide-y">
            {list.data.map((i) => (
              <li key={i.id} className="flex gap-3 px-4 py-3">
                <VoteButton base={base} ideaId={i.id} voted={i.voted} count={i.voteCount} />
                <div className="grid min-w-0 flex-1 gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.title}</span>
                    {canManage ? (
                      <InlineSelect url={`${base}/product/ideas/${i.id}`} field="status" value={i.status} label={t("work.task.status")} options={IDEA_STATUSES.map((s) => ({ value: s, label: t(`work.ideaStatus.${s}`) }))} />
                    ) : (
                      <Badge tone={IDEA_TONE[i.status]}>{t(`work.ideaStatus.${i.status}`)}</Badge>
                    )}
                  </div>
                  {i.description ? <p className="whitespace-pre-wrap text-muted-foreground">{i.description}</p> : null}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("work.product.submittedBy", { name: i.submittedByName ?? "—", date: formatDate(i.createdAt, locale, tz) })}</span>
                    {i.feature ? (
                      <Link href={`/${locale}/product/features/${i.feature.id}`} className="hover:underline">
                        → {i.feature.title}
                      </Link>
                    ) : canManage ? (
                      <ActionButton url={`${base}/product/ideas/${i.id}/feature`} variant="ghost">
                        {t("work.product.toFeature")}
                      </ActionButton>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("work.product.noIdeas")}</Empty>
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
