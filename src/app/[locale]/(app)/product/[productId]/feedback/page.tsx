import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InlineSelect } from "@/components/work/actions";
import { FeedbackForm } from "@/components/work/product-forms";
import { productWorkspace, SENTIMENT_TONE } from "@/components/work/product-ui";
import { Empty, Pagination } from "@/components/work/ui";
import { formatDateTime } from "@/i18n/format";
import { getT } from "@/i18n/server";
import { feedbackPickers, SENTIMENTS } from "@/server/modules/work/product";
import { productFeedback } from "@/server/modules/work/product-delivery";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("work.product.tabs.feedback") };
}

export default async function ProductFeedbackPage({ params, searchParams }: PageProps<"/[locale]/product/[productId]/feedback">) {
  const { productId } = await params;
  const w = await productWorkspace(productId, "feedback");
  if (w.gate) return w.gate;
  const { t, locale, viewer, org, company, base, tz, canEdit } = w;
  const raw = await searchParams;
  const path = `/${locale}/product/${productId}/feedback`;
  const [fb, pickers] = await Promise.all([productFeedback(viewer.ctx, org.id, company.id, productId, raw), canEdit ? feedbackPickers(viewer.ctx, org.id, company.id) : null]);
  const q = typeof raw.q === "string" ? raw.q : "";
  return (
    <div className="mx-auto grid max-w-[1400px] min-w-0 gap-4">
      {w.header}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("work.product.tabs.feedback")} description={t("work.product.feedbackCount", { count: fb.total })} />
          <form className="flex gap-2 border-b p-3" action={path}>
            <Input name="q" type="search" defaultValue={q} maxLength={200} aria-label={t("work.search")} placeholder={t("product.feedback.search")} />
            <Button type="submit" variant="secondary">
              {t("work.apply")}
            </Button>
          </form>
          {pickers ? (
            <details className="border-b">
              <summary className="cursor-pointer p-3 text-sm font-medium">{t("work.product.addFeedback")}</summary>
              <FeedbackForm
                base={base}
                productId={productId}
                accounts={pickers.accounts}
                contacts={pickers.contacts}
                features={pickers.features.map((f) => ({ id: f.id, name: f.title }))}
                sources={[]}
              />
            </details>
          ) : null}
          {fb.data.length ? (
            <ul className="grid divide-y">
              {fb.data.map((x) => (
                <li key={x.id} className="grid gap-1 px-4 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge>{x.source}</Badge>
                    {canEdit ? (
                      <InlineSelect
                        url={`${base}/product/feedback/${x.id}`}
                        field="sentiment"
                        value={x.sentiment ?? ""}
                        label={t("product.feedback.sentiment")}
                        options={[{ value: "", label: t("product.feedback.unrated") }, ...SENTIMENTS.map((s) => ({ value: s, label: t(`product.sentiment.${s}`) }))]}
                      />
                    ) : x.sentiment ? (
                      <Badge tone={SENTIMENT_TONE[x.sentiment]}>{t(`product.sentiment.${x.sentiment}`)}</Badge>
                    ) : null}
                    {x.accountName ? (
                      <Link href={`/${locale}/crm/accounts/${x.accountId}`} className="hover:underline">
                        {x.accountName}
                      </Link>
                    ) : null}
                    {x.feature ? (
                      <Link href={`/${locale}/product/features/${x.feature.id}`} className="hover:underline">
                        {x.feature.title}
                      </Link>
                    ) : null}
                    <span>{formatDateTime(x.createdAt, locale, tz)}</span>
                  </span>
                  <p className="whitespace-pre-wrap">{x.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{q ? t("common.noResults") : t("work.product.noFeedback")}</Empty>
          )}
          <Pagination path={path} params={raw} page={fb.page} pageSize={fb.pageSize} total={fb.total} labels={{ prev: t("common.previous"), next: t("common.next"), summary: t("work.pageOf", { page: fb.page, pages: Math.max(1, Math.ceil(fb.total / fb.pageSize)) }) }} />
        </Card>
        <div className="grid content-start gap-4">
          {fb.support ? (
            <Card>
              <CardHeader title={t("product.feedback.tickets")} description={t("product.feedback.ticketsHint", { total: fb.support.total, open: fb.support.open })} />
              {fb.support.tickets.length ? (
                <ul className="grid divide-y text-sm">
                  {fb.support.tickets.map((x) => (
                    <li key={x.id} className="grid gap-0.5 px-4 py-2">
                      <Link href={`/${locale}/support/tickets/${x.id}`} className="hover:underline">
                        #{x.number} {x.subject}
                      </Link>
                      <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge>{t(`support.statuses.${x.status}`)}</Badge>
                        {x.accountName ?? ""}
                        <span>{formatDateTime(x.createdAt, locale, tz)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{t("product.feedback.noTickets")}</Empty>
              )}
            </Card>
          ) : null}
          {fb.accounts ? (
            <Card>
              <CardHeader title={t("product.feedback.accounts")} description={t("product.feedback.accountsHint")} />
              {fb.accounts.length ? (
                <ul className="grid divide-y text-sm">
                  {fb.accounts.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                      <Link href={`/${locale}/crm/accounts/${a.id}`} className="min-w-0 flex-1 truncate hover:underline">
                        {a.name ?? "—"}
                      </Link>
                      <span className="text-xs text-muted-foreground">{t("product.feedback.accountCounts", { feedback: a.feedback, tickets: a.tickets })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{t("product.feedback.noAccounts")}</Empty>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
