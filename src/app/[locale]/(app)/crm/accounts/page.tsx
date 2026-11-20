import type { Metadata } from "next";
import { AccountsList } from "@/components/crm/accounts-list";
import { CrmFrame, crmContext } from "@/components/crm/shell";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.tabs.accounts") };
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await crmContext();
  const query = await searchParams;
  return (
    <CrmFrame active="accounts" subtitle={c.t("crm.accounts.subtitle")}>
      {c.company && c.canRead ? <AccountsList path={`/${c.locale}/crm/accounts`} query={query} /> : null}
    </CrmFrame>
  );
}
