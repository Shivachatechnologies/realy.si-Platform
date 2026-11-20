import type { Metadata } from "next";
import Link from "next/link";
import { Network } from "lucide-react";
import { AccountsList } from "@/components/crm/accounts-list";
import { PageFrame, crmContext } from "@/components/crm/shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.customers.title") };
}

/** Customers: CRM accounts of type CUSTOMER (the Company Graph view stays one click away). */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const { t, locale } = c;
  const query = await searchParams;
  return (
    <PageFrame
      title={t("modules.customers.title")}
      subtitle={t("crm.customers.subtitle")}
      actions={
        <>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/crm/accounts`}>{t("crm.customers.allAccounts")}</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/${locale}/graph`}>
              <Network aria-hidden />
              {t("crm.customers.graph")}
            </Link>
          </Button>
        </>
      }
    >
      {!c.company ? (
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      ) : !c.canRead ? (
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      ) : (
        <AccountsList path={`/${locale}/customers`} query={query} fixedType="CUSTOMER" />
      )}
    </PageFrame>
  );
}
