import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { SupportRequestForm } from "@/components/support/public";
import { PublicShell } from "@/components/support/public-shell";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.public.formTitle") };
}

export default async function SupportFormPage({ params }: PageProps<"/[locale]/support-form/[companyId]">) {
  const { companyId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  const company = await db().company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!company) notFound();
  const settings = await db().supportSettings.findUnique({ where: { companyId }, select: { supportFormEnabled: true, helpCenterEnabled: true, emailChannelEnabled: true, supportEmail: true } });
  const enabled = settings?.supportFormEnabled ?? true;
  return (
    <PublicShell
      title={company.name}
      footer={
        settings?.emailChannelEnabled && settings.supportEmail ? (
          <>
            {t("support.public.emailUs")}{" "}
            <a href={`mailto:${settings.supportEmail}`} className="underline">
              {settings.supportEmail}
            </a>
          </>
        ) : undefined
      }
    >
      <Card>
        <CardHeader title={t("support.public.formTitle")} description={t("support.public.formSubtitle", { company: company.name })} />
        <CardBody>{enabled ? <SupportRequestForm companyId={company.id} /> : <Notice tone="warning">{t("support.public.formDisabled")}</Notice>}</CardBody>
      </Card>
      {settings?.helpCenterEnabled ?? true ? (
        <p className="text-center text-sm">
          <Link href={`/${locale}/help/${company.id}`} className="underline">
            {t("support.public.browseHelp")}
          </Link>
        </p>
      ) : null}
    </PublicShell>
  );
}
