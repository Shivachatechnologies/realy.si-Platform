import type { Metadata } from "next";
import Link from "next/link";
import { PipelineBoard } from "@/components/crm/kanban";
import { AiActions } from "@/components/crm/kit";
import { CrmFrame, Stat, SubjectTasks, crmContext } from "@/components/crm/shell";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { getT } from "@/i18n/server";
import { formatDate, formatMoney } from "@/i18n/format";
import { isUuid } from "@/server/modules/crm/common";
import { pipelineBoard } from "@/server/modules/crm/deals";
import { listOwners } from "@/server/modules/crm/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.pipeline") };
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  if (!c.company || !c.canRead) return <CrmFrame active="pipeline">{null}</CrmFrame>;
  const { t, locale, base, org, company, viewer } = c;
  const one = (k: string) => (typeof query[k] === "string" ? (query[k] as string) : undefined);
  const owner = one("owner");
  const q = one("q")?.slice(0, 200);
  const [board, owners] = await Promise.all([
    pipelineBoard(viewer.ctx, org.id, company.id, isUuid(one("pipeline")) ? one("pipeline") : undefined, { owner: owner === "me" || isUuid(owner) ? owner : undefined, q }),
    listOwners(viewer.ctx, org.id, company.id),
  ]);
  const money = (m: bigint, cur = board.currency) => formatMoney({ amountMinor: m, currency: cur }, locale);
  const today = new Date();
  const open = board.stages.filter((s) => s.type === "OPEN");
  const won = board.stages.filter((s) => s.type === "WON");
  return (
    <CrmFrame
      active="pipeline"
      subtitle={t("crm.pipeline.subtitle")}
      actions={
        c.canManage ? (
          <Button asChild size="sm">
            <Link href={`/${locale}/crm/deals?new=1`}>{t("crm.deals.add")}</Link>
          </Button>
        ) : null
      }
    >
      <form className="grid gap-2 sm:grid-cols-[14rem_12rem_minmax(0,1fr)_auto]" action={`/${locale}/crm/pipeline`}>
        <Select name="pipeline" defaultValue={board.pipeline.id} aria-label={t("crm.fields.pipeline")}>
          {board.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select name="owner" defaultValue={owner ?? ""} aria-label={t("crm.owner")}>
          <option value="">{t("crm.allOwners")}</option>
          <option value="me">{t("crm.mine")}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Input name="q" type="search" defaultValue={q ?? ""} maxLength={200} aria-label={t("crm.search")} placeholder={t("crm.deals.searchPlaceholder")} />
        <Button type="submit" variant="secondary">
          {t("crm.applyFilters")}
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("crm.pipeline.openDeals")} value={open.reduce((n, s) => n + s.deals.length, 0)} />
        <Stat label={t("crm.pipelineValue")} value={money(open.reduce((n, s) => n + s.totalMinor, 0n))} />
        <Stat label={t("crm.weightedPipeline")} value={money(open.reduce((n, s) => n + s.weightedMinor, 0n))} />
        <Stat label={t("crm.pipeline.won30")} value={money(won.reduce((n, s) => n + s.totalMinor, 0n))} />
      </div>
      <PipelineBoard
        base={base}
        locale={locale}
        canManage={c.canManage}
        columns={board.stages.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          probability: s.probability,
          total: money(s.totalMinor),
          weighted: money(s.weightedMinor),
          deals: s.deals.map((d) => ({
            id: d.id,
            name: d.name,
            accountName: d.accountName,
            ownerName: d.ownerName,
            amount: money(d.amountMinor, d.currency),
            weighted: money(d.weightedMinor, d.currency),
            probability: d.probability,
            close: d.expectedCloseDate ? formatDate(d.expectedCloseDate, locale, "UTC") : null,
            overdue: d.status === "OPEN" && !!d.expectedCloseDate && d.expectedCloseDate < today,
            stale: d.stale,
          })),
        }))}
      />
      <p className="text-xs text-muted-foreground">{t("crm.pipeline.hint", { days: board.pipeline.staleDays })}</p>
      <SubjectTasks
        subjectType="crm_pipeline"
        subjectId={board.pipeline.id}
        actions={<AiActions url={`${base}/crm/pipelines/review`} locale={locale} extra={{ pipelineId: board.pipeline.id }} actions={[{ mode: "", label: t("crm.ai.pipelineReview") }]} />}
      />
    </CrmFrame>
  );
}
