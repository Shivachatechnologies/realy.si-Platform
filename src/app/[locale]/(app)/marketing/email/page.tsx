import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NewEmailCampaignForm, TemplateForm } from "@/components/marketing/email-forms";
import { MarketingShell, Pager, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { EMAIL_CAMPAIGN_STATUSES, listEmailCampaigns, listTemplates, parseEmailFilters, emailDeliveryReady } from "@/server/modules/marketing/email";
import { listSegments } from "@/server/modules/marketing/segments";
import { listSuppressions } from "@/server/modules/marketing/deliverability";
import { SuppressionForm } from "@/components/marketing/studio-forms";
import { InfoStrip } from "@/components/marketing/studio";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.email") };
}

export default async function EmailPage({ searchParams }: PageProps<"/[locale]/marketing/email">) {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "email" as const, title: t("marketing.email.title"), subtitle: t("marketing.email.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const f = parseEmailFilters(await searchParams);
  const suppressions = await listSuppressions(viewer.ctx, org.id, company.id);
  const [list, templates, segments, campaigns] = await Promise.all([
    listEmailCampaigns(viewer.ctx, org.id, company.id, f),
    listTemplates(viewer.ctx, org.id, company.id),
    listSegments(viewer.ctx, org.id, company.id),
    campaignOptions(viewer.ctx, org.id, company.id),
  ]);
  const path = `/${locale}/marketing/email`;
  const filtered = !!(f.q || f.status);

  return (
    <MarketingShell {...shell}>
      <InfoStrip t={t} k="email" />
      {!(await emailDeliveryReady(org.id, company.id)) ? <Notice tone="warning">{t("marketing.email.notConfigured")}</Notice> : null}
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.email.createCampaign")}</summary>
            <NewEmailCampaignForm base={base} locale={locale} templates={templates} segments={segments.map((s) => ({ id: s.id, name: s.name }))} campaigns={campaigns} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.email.campaigns")} description={t("marketing.common.count", { count: list.total })} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={f.q ?? ""} maxLength={200} aria-label={t("marketing.common.search")} placeholder={t("marketing.email.searchPlaceholder")} />
          <Select name="status" defaultValue={f.status ?? ""} aria-label={t("common.status")}>
            <option value="">{t("marketing.common.allStatuses")}</option>
            {EMAIL_CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.emailStatus.${s}`)}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary">
              {t("marketing.common.apply")}
            </Button>
            {filtered ? (
              <Link href={path} className="text-xs text-muted-foreground hover:underline">
                {t("marketing.common.clear")}
              </Link>
            ) : null}
          </div>
        </form>
        {list.data.length === 0 ? (
          <p className="p-4 text-muted-foreground">{filtered ? t("common.noResults") : t("marketing.email.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.email.campaignName")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.email.segment")}</Th>
                <Th>{t("marketing.content.when")}</Th>
                <Th className="text-end">{t("marketing.email.sentFailed")}</Th>
              </Tr>
            </THead>
            <TBody>
              {list.data.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`${path}/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="max-w-md truncate text-xs text-muted-foreground">{c.subject}</p>
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} label={t(`marketing.emailStatus.${c.status}`)} />
                  </Td>
                  <Td className="text-xs">{c.segment?.name ?? "—"}</Td>
                  <Td className="text-xs text-muted-foreground">{c.finishedAt ? formatDateTime(c.finishedAt, locale, tz) : c.scheduledAt ? formatDateTime(c.scheduledAt, locale, tz) : "—"}</Td>
                  <Td className="text-end tabular-nums">
                    {c.sentCount} / {c.failedCount + c.notConfiguredCount}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <Pager path={path} params={{ q: f.q, status: f.status }} page={f.page} total={list.total} pageSize={list.pageSize} t={t} />
      </Card>
      <Card>
        <CardHeader title={t("marketing.email.templates")} description={t("marketing.email.templatesHint")} />
        {templates.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("marketing.email.noTemplates")}</p> : null}
        <ul className="grid divide-y">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="font-medium">{tpl.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{tpl.subject}</span>
                </summary>
                {canManage ? (
                  <>
                    <TemplateForm base={base} initial={{ id: tpl.id, name: tpl.name, subject: tpl.subject, body: tpl.body }} />
                    <div className="px-4 pb-3">
                      <ActionButton path={`${base}/email/templates/${tpl.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} />
                    </div>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap px-4 pb-3 font-sans text-xs">{tpl.body}</pre>
                )}
              </details>
            </li>
          ))}
        </ul>
        {canManage ? (
          <details className="border-t">
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.email.createTemplate")}</summary>
            <TemplateForm base={base} />
          </details>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={t("marketing.studio.email.suppressions")} description={t("marketing.studio.email.suppressionsHint", { count: suppressions.total })} />
        {canManage ? <SuppressionForm base={base} /> : null}
        <ul className="grid divide-y text-sm">
          {suppressions.data.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0 truncate">{x.emailNormalized}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {t(`marketing.studio.email.reason.${["bounce", "complaint", "unsubscribe", "manual"].includes(x.reason) ? x.reason : "other"}`)}
                {canManage ? <ActionButton path={`${base}/suppressions/${x.id}`} method="DELETE" variant="ghost" label={t("marketing.common.delete")} confirm={t("marketing.common.confirmDelete")} /> : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t p-3 text-[11px] text-muted-foreground">{t("marketing.studio.email.webhooks", { url: `/api/public/marketing/email-events/{sendgrid|mailchimp}/${company.id}` })}</p>
      </Card>
    </MarketingShell>
  );
}
