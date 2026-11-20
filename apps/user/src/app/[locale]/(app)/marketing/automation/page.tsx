import type { Metadata } from "next";
import { emailDeliveryReady } from "@/server/modules/marketing/email";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SequenceForm } from "@/components/marketing/sequence-forms";
import { MarketingShell, StatusBadge, loadMarketing } from "@/components/marketing/shell";
import { getT } from "@/i18n/server";
import { listForms } from "@/server/modules/marketing/forms";
import { listSequences } from "@/server/modules/marketing/sequences";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("marketing.tabs.automation") };
}

export default async function AutomationPage() {
  const m = await loadMarketing();
  const { locale, t } = m;
  const shell = { locale, t, tab: "automation" as const, title: t("marketing.automation.title"), subtitle: t("marketing.automation.subtitle") };
  if (m.blocked) return <MarketingShell {...shell} blocked={m.blocked} />;
  const { org, company, viewer, base, canManage } = m;
  const [sequences, forms] = await Promise.all([listSequences(viewer.ctx, org.id, company.id), listForms(viewer.ctx, org.id, company.id)]);
  return (
    <MarketingShell {...shell}>
      {!(await emailDeliveryReady(org.id, company.id)) ? <Notice tone="warning">{t("marketing.automation.emailNotConfigured")}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm font-medium">{t("marketing.automation.nurtureTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("marketing.automation.nurtureBody")}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium">{t("marketing.automation.distributionTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("marketing.automation.distributionBody")}</p>
          <Link href={`/${locale}/marketing/content?status=APPROVED`} className="mt-2 inline-block text-xs underline">
            {t("marketing.automation.approvedContent")}
          </Link>
        </Card>
        <Card className="p-4">
          <p className="text-sm font-medium">{t("marketing.automation.followUpTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("marketing.automation.followUpBody")}</p>
          <Link href={`/${locale}/marketing/forms`} className="mt-2 inline-block text-xs underline">
            {t("marketing.tabs.forms")}
          </Link>
        </Card>
      </div>
      {canManage ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-3 text-sm font-medium">{t("marketing.automation.create")}</summary>
            <SequenceForm base={base} locale={locale} forms={forms.map((f) => ({ id: f.id, name: f.name }))} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("marketing.automation.sequences")} description={t("marketing.common.count", { count: sequences.length })} />
        {sequences.length === 0 ? (
          <p className="p-4 text-muted-foreground">{t("marketing.automation.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("marketing.automation.name")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("marketing.automation.trigger")}</Th>
                <Th className="text-end">{t("marketing.automation.steps")}</Th>
                <Th className="text-end">{t("marketing.automation.activeEnrollments")}</Th>
              </Tr>
            </THead>
            <TBody>
              {sequences.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/${locale}/marketing/automation/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={s.status} label={t(`marketing.automation.status.${s.status}`)} />
                  </Td>
                  <Td className="text-xs">
                    {t(`marketing.automation.triggers.${s.trigger}`)}
                    {s.triggerForm ? ` · ${s.triggerForm.name}` : ""}
                  </Td>
                  <Td className="text-end tabular-nums">{s._count.steps}</Td>
                  <Td className="text-end tabular-nums">
                    {s.active} / {s.total}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </MarketingShell>
  );
}
