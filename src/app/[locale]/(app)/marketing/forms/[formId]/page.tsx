import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormBuilder } from "@/components/marketing/form-builder";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { ActionButton } from "@/components/marketing/ui";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { env } from "@/server/core/env";
import { AppError } from "@/server/core/errors";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { getForm } from "@/server/modules/marketing/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.forms") };
}

export default async function FormPage({ params }: PageProps<"/[locale]/marketing/forms/[formId]">) {
  const { formId } = await params;
  const m = await loadMarketing();
  const { locale, t } = m;
  const back = { href: `/${locale}/marketing/forms`, label: t("marketing.forms.title") };
  if (m.blocked) return <MarketingShell locale={locale} t={t} tab="forms" title={t("marketing.forms.title")} back={back} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const { form: f, submissions } = await getForm(viewer.ctx, org.id, company.id, formId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  const manage = canManage && !f.archivedAt;
  const campaigns = manage ? await campaignOptions(viewer.ctx, org.id, company.id) : [];
  const publicUrl = `${env().APP_URL.replace(/\/$/, "")}/${company.defaultLocale ?? locale}/f/${f.id}`;
  const linkWithUtm = f.campaign ? `${publicUrl}?utm_campaign=${f.campaign.code}` : publicUrl;
  const snippet = `<a href="${linkWithUtm}" target="_blank" rel="noopener">${f.title}</a>`;

  return (
    <MarketingShell
      locale={locale}
      t={t}
      tab="forms"
      back={back}
      title={f.name}
      subtitle={<StatusBadge status={f.active ? "ACTIVE" : "PAUSED"} label={f.active ? t("marketing.forms.live") : t("marketing.forms.off")} />}
      actions={
        manage ? (
          <>
            <ActionButton path={`${base}/forms/${f.id}`} method="PATCH" body={{ active: !f.active }} label={f.active ? t("marketing.forms.turnOff") : t("marketing.forms.turnOn")} />
            <ActionButton path={`${base}/forms/${f.id}`} method="DELETE" variant="ghost" label={t("marketing.common.archive")} confirm={t("marketing.common.confirmArchive")} redirectTo={back.href} />
          </>
        ) : null
      }
    >
      <Card>
        <CardHeader title={t("marketing.forms.share")} description={t("marketing.forms.shareHint")} />
        <div className="grid gap-3 p-4 text-sm">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("marketing.forms.publicLink")}</span>
            <Link href={`/${company.defaultLocale ?? locale}/f/${f.id}`} target="_blank" className="break-all font-mono text-xs hover:underline">
              {linkWithUtm}
            </Link>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">{t("marketing.forms.embedSnippet")}</span>
            <code className="break-all rounded-md bg-surface-2 p-2 text-xs">{snippet}</code>
          </div>
          <p className="text-xs text-muted-foreground">{t("marketing.forms.utmNote")}</p>
          {f.sequences.length ? (
            <p className="text-xs">
              {t("marketing.forms.nurture")}{" "}
              {f.sequences.map((s) => (
                <Link key={s.id} href={`/${locale}/marketing/automation/${s.id}`} className="me-2 underline">
                  {s.name}
                </Link>
              ))}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("marketing.forms.noNurture")}{" "}
              <Link href={`/${locale}/marketing/automation`} className="underline">
                {t("marketing.tabs.automation")}
              </Link>
            </p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title={t("marketing.forms.submissions")} description={t("marketing.common.count", { count: f.submissionCount })} />
        {submissions.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.forms.noSubmissions")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.forms.received")}</Th>
                <Th>{t("marketing.forms.data")}</Th>
                <Th>{t("marketing.forms.attribution")}</Th>
                <Th>{t("marketing.audience.consent")}</Th>
                <Th>{t("marketing.forms.lead")}</Th>
              </Tr>
            </THead>
            <TBody>
              {submissions.map((s) => {
                const data = (s.data ?? {}) as Record<string, string>;
                return (
                  <Tr key={s.id}>
                    <Td className="text-xs text-muted-foreground">{formatDateTime(s.createdAt, locale, tz)}</Td>
                    <Td className="max-w-md text-xs">
                      {f.fields
                        .filter((x) => data[x.key])
                        .map((x) => (
                          <div key={x.key} className="truncate">
                            <span className="text-muted-foreground">{x.label}:</span> {data[x.key]}
                          </div>
                        ))}
                    </Td>
                    <Td className="text-xs">{[s.campaignCode, s.utmSource, s.utmMedium].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td className="text-xs">{s.consent ? t("common.yes") : t("common.no")}</Td>
                    <Td>
                      {s.leadId ? (
                        <Link href={`/${locale}/crm/${s.leadId}`} className="text-xs hover:underline">
                          {t("marketing.forms.openLead")}
                        </Link>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      {manage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.forms.edit")}</summary>
            <FormBuilder
              base={base}
              locale={locale}
              campaigns={campaigns}
              initial={{
                id: f.id,
                name: f.name,
                title: f.title,
                description: f.description ?? "",
                submitLabel: f.submitLabel ?? "",
                successMessage: f.successMessage ?? "",
                followUpHours: f.followUpHours?.toString() ?? "",
                campaignId: f.campaignId ?? "",
                fields: f.fields,
              }}
            />
          </details>
        </Card>
      ) : null}
    </MarketingShell>
  );
}
