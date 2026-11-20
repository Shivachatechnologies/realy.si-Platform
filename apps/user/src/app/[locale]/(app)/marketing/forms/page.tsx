import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormBuilder } from "@/components/marketing/form-builder";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { campaignOptions } from "@/server/modules/marketing/campaigns";
import { DEFAULT_FIELDS, listForms } from "@/server/modules/marketing/forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.forms") };
}

export default async function FormsPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "forms" as const, title: t("marketing.forms.title"), subtitle: t("marketing.forms.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage, tz } = m;
  const [forms, campaigns] = await Promise.all([listForms(viewer.ctx, org.id, company.id), campaignOptions(viewer.ctx, org.id, company.id)]);
  const defaults = DEFAULT_FIELDS.map((f) => ({ ...f, label: t(`marketing.forms.defaultFields.${f.key}`) }));
  return (
    <MarketingShell {...shell}>
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.forms.create")}</summary>
            <FormBuilder
              base={base}
              locale={locale}
              campaigns={campaigns}
              initial={{ name: "", title: "", description: "", submitLabel: "", successMessage: "", followUpHours: "24", campaignId: "", fields: defaults }}
            />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.forms.title")} description={t("marketing.common.count", { count: forms.length })} />
        {forms.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.forms.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.forms.name")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.campaigns.campaign")}</Th>
                <Th className="text-end">{t("marketing.forms.submissions")}</Th>
                <Th>{t("marketing.common.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {forms.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <Link href={`/${locale}/marketing/forms/${f.id}`} className="font-medium hover:underline">
                      {f.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{f.title}</p>
                  </Td>
                  <Td>
                    <StatusBadge status={f.active ? "ACTIVE" : "PAUSED"} label={f.active ? t("marketing.forms.live") : t("marketing.forms.off")} />
                  </Td>
                  <Td className="text-xs">{f.campaign ? `${f.campaign.name} (${f.campaign.code})` : "—"}</Td>
                  <Td className="text-end tabular-nums">{f.submissionCount}</Td>
                  <Td className="text-xs text-muted-foreground">{formatDate(f.createdAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </MarketingShell>
  );
}
