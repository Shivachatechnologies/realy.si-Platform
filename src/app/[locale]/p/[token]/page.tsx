import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/finance/billing-actions";
import { ProposalDocument, ProposalPrintStyles } from "@/components/crm/proposal-document";
import { ProposalDecisionForm } from "@/components/crm/proposals";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { viewPublicProposal } from "@/server/modules/crm/proposals";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.publicProposal.title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Public, login-free proposal page via its unguessable share token: review, print, accept or decline. */
export default async function PublicProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const p = await viewPublicProposal(token);
  if (!p) notFound();
  const tz = p.company.timezone ?? "UTC";
  const companyName = p.company.legalName || p.company.name;
  const contact = p.contact ? [p.contact.firstName, p.contact.lastName].filter(Boolean).join(" ") : null;
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-8">
      <ProposalPrintStyles />
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-xs text-muted-foreground">{t("crm.publicProposal.from", { company: companyName })}</p>
          <PrintButton />
        </div>
        {p.status === "ACCEPTED" ? <Notice tone="success">{t("crm.publicProposal.accepted", { name: p.decisionName ?? "—", date: p.decidedAt ? formatDateTime(p.decidedAt, locale, tz) : "—" })}</Notice> : null}
        {p.status === "DECLINED" ? <Notice tone="warning">{t("crm.publicProposal.declined", { name: p.decisionName ?? "—", date: p.decidedAt ? formatDateTime(p.decidedAt, locale, tz) : "—" })}</Notice> : null}
        {p.status === "EXPIRED" ? <Notice tone="warning">{t("crm.publicProposal.expired")}</Notice> : null}
        <ProposalDocument t={t} locale={locale} doc={{ ...p, companyName, customerName: p.account?.name ?? null, customerAddress: p.account?.address ?? null, contactName: contact }} />
        {p.status === "VIEWED" ? (
          <Card className="print:hidden">
            <CardHeader title={t("crm.publicProposal.decide")} description={t("crm.publicProposal.decideHint")} />
            <CardBody>
              <ProposalDecisionForm token={token} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
