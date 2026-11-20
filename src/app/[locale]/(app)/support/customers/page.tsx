import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { listCustomers } from "@/server/modules/support/tickets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.customers.title") };
}

export default async function SupportCustomersPage({ searchParams }: PageProps<"/[locale]/support/customers">) {
  const p = await areaPage("support", "customers");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, wrap } = p;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const page = Math.max(Number(sp.page) || 1, 1);
  const list = await listCustomers(viewer.ctx, org.id, company.id, { q: q || undefined, page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const path = `/${locale}/support/customers`;
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.customers.what")} why={t("support.intro.customers.why")} can={t("support.intro.customers.can")} next={{ label: t("support.intro.customers.next"), href: `/${locale}/support` }} accent="warning" />
    <Card>
      <CardHeader title={t("support.customers.title")} description={t("support.customers.description")} />
      <form className="flex gap-2 border-b p-3" action={path}>
        <Input name="q" type="search" defaultValue={q} maxLength={100} placeholder={t("support.customers.search")} aria-label={t("support.customers.search")} />
        <Button type="submit" variant="secondary">
          {t("support.apply")}
        </Button>
      </form>
      {list.data.length === 0 ? (
        <EmptyState>{q ? t("common.noResults") : t("support.customers.empty")}</EmptyState>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t("support.customers.name")}</Th>
              <Th className="hidden sm:table-cell">{t("support.customers.email")}</Th>
              <Th className="hidden md:table-cell">{t("support.ticket.account")}</Th>
              <Th>{t("support.customers.tickets")}</Th>
            </Tr>
          </THead>
          <TBody>
            {list.data.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <Link href={`${path}/contact/${c.id}`} className="font-medium hover:underline">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                  </Link>
                </Td>
                <Td className="hidden sm:table-cell">{c.email ?? "—"}</Td>
                <Td className="hidden md:table-cell">
                  {c.account ? (
                    <Link href={`${path}/account/${c.account.id}`} className="hover:underline">
                      {c.account.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <span className="tabular-nums">{c.ticketCount}</span>
                  {c.openCount ? <Badge tone="accent" className="ms-2">{t("support.customers.open", { count: c.openCount })}</Badge> : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager labels={{ prev: t("common.previous"), next: t("common.next") }} info={t("support.pageInfo", { page, pages, total: list.total })} prevHref={page > 1 ? hrefWith(path, sp, { page: page - 1 }) : null} nextHref={page < pages ? hrefWith(path, sp, { page: page + 1 }) : null} />
    </Card>
    </>,
  );
}
