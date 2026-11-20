import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/finance/billing-actions";
import { ProposalDocument, ProposalPrintStyles } from "@/components/crm/proposal-document";
import { crmContext } from "@/components/crm/shell";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";
import { AppError } from "@/server/core/errors";
import { contactName } from "@/server/modules/crm/contacts";
import { getProposal } from "@/server/modules/crm/proposals";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.proposals.printable") };
}

/** Printable proposal: only the document is printed (see ProposalPrintStyles). */
export default async function ProposalPrintPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  const c = await crmContext();
  if (!c.company) notFound();
  if (!c.canRead) return <Notice tone="warning">{c.t("errors.forbidden")}</Notice>;
  const { t, locale, org, company, viewer } = c;
  const p = await getProposal(viewer.ctx, org.id, company.id, proposalId).catch((err) => {
    if (err instanceof AppError && err.code === "not_found") notFound();
    throw err;
  });
  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <ProposalPrintStyles />
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/${locale}/crm/proposals/${p.id}`} className="text-sm text-muted-foreground hover:underline">
          ← {p.number}
        </Link>
        <PrintButton />
      </div>
      <ProposalDocument
        t={t}
        locale={locale}
        doc={{ ...p, companyName: company.name, customerName: p.account?.name ?? null, customerAddress: p.account?.address ?? null, contactName: p.contact ? contactName(p.contact) : null }}
      />
    </div>
  );
}
