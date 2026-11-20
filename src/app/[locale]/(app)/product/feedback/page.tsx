import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ActionButton, InlineSelect } from "@/components/work/actions";
import { ProductTabs } from "@/components/work/area-tabs";
import { workContext } from "@/components/work/context";
import { FeedbackForm } from "@/components/work/product-forms";
import { Empty, Pagination } from "@/components/work/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { feedbackPickers, listFeedback } from "@/server/modules/work/product";
import { param } from "@/server/modules/work/shared";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.feedback") };
}

export default async function FeedbackPage({ searchParams }: PageProps<"/[locale]/product/feedback">) {
  const t = await getT();
  const w = await workContext("projects", t("work.product.title"), t("work.product.subtitle"));
  if (w.gate) return w.gate;
  const { locale, viewer, org, company, canManage, base, tz } = w;
  const raw = await searchParams;
  const path = `/${locale}/product/feedback`;
  const [list, pickers] = await Promise.all([listFeedback(viewer.ctx, org.id, company.id, raw), feedbackPickers(viewer.ctx, org.id, company.id)]);
  const featureOptions = [{ value: "", label: t("work.product.noFeatureLinked") }, ...pickers.features.map((f) => ({ value: f.id, label: f.title }))];
  return (
    <div className="mx-auto grid max-w-[1200px] min-w-0 gap-4">
      {w.header}
      <ProductTabs t={t} locale={locale} active="feedback" />
      <Card>
        <CardHeader title={t("work.product.tabs.feedback")} description={t("work.product.feedbackCount", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={param(raw, "q") ?? ""} maxLength={200} aria-label={t("work.search")} placeholder={t("work.search")} />
          <Select name="source" defaultValue={param(raw, "source") ?? ""} aria-label={t("work.product.source")}>
            <option value="">{t("work.product.allSources")}</option>
            {list.sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select name="feature" defaultValue={param(raw, "feature") ?? ""} aria-label={t("work.product.feature")}>
            <option value="">{t("work.product.anyFeature")}</option>
            <option value="none">{t("work.product.noFeatureLinked")}</option>
            {pickers.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("work.apply")}
          </Button>
        </form>
        {canManage ? (
          <details className="border-b">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.product.addFeedback")}</summary>
            <FeedbackForm base={base} accounts={pickers.accounts} contacts={pickers.contacts} features={pickers.features.map((f) => ({ id: f.id, name: f.title }))} sources={list.sources} />
          </details>
        ) : null}
        {list.data.length ? (
          <ul className="grid divide-y">
            {list.data.map((f) => (
              <li key={f.id} className="grid gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge>{f.source}</Badge>
                  {f.accountName ? <span className="font-medium text-foreground">{f.accountName}</span> : null}
                  {f.contactName ? <span>{f.contactName}</span> : null}
                  <span>{formatDateTime(f.createdAt, locale, tz)}</span>
                </div>
                <p className="whitespace-pre-wrap">{f.body}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {canManage ? (
                    <>
                      <InlineSelect url={`${base}/product/feedback/${f.id}`} field="featureId" value={f.featureId ?? ""} label={t("work.product.feature")} options={featureOptions} />
                      <ActionButton url={`${base}/product/feedback/${f.id}`} method="PATCH" body={{ archived: true }} variant="ghost" confirm={t("work.confirmArchive")}>
                        {t("work.archive")}
                      </ActionButton>
                    </>
                  ) : f.feature ? (
                    <Link href={`/${locale}/product/features/${f.feature.id}`} className="hover:underline">
                      → {f.feature.title}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("work.product.noFeedback")}</Empty>
        )}
        <Pagination path={path} params={raw} page={list.page} pageSize={list.pageSize} total={list.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: list.page, pages: Math.max(1, Math.ceil(list.total / list.pageSize)) }) }} />
      </Card>
    </div>
  );
}
