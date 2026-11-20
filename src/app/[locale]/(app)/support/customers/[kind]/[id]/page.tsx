import type { Metadata } from "next";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { introLabels } from "@/components/guide-kit/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState, Stat } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { PriorityBadge, StatusBadge } from "@/components/support/bits";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { customerRecord } from "@/server/modules/support/tickets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.customers.title") };
}

export default async function CustomerRecordPage({ params }: PageProps<"/[locale]/support/customers/[kind]/[id]">) {
  const { kind, id } = await params;
  if (kind !== "contact" && kind !== "account") notFound();
  const p = await areaPage("support", "customers");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, wrap } = p;
  const c = await customerRecord(viewer.ctx, org.id, company.id, kind, id).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const open = c.tickets.filter((x) => !["SOLVED", "CLOSED"].includes(x.status)).length;
  return wrap(
    <>
    <PageIntro labels={introLabels(t)} what={t("support.intro.customer.what")} why={t("support.intro.customer.why")} can={t("support.intro.customer.can")} accent="warning" />
    <div className="grid gap-4">
      <Card>
        <CardHeader title={c.name} description={[t(`support.customers.kinds.${kind}`), c.email, c.phone, c.title].filter(Boolean).join(" · ")} />
        <CardBody className="grid gap-2 text-sm">
          {c.account ? (
            <p>
              {t("support.ticket.account")}:{" "}
              <Link href={`/${locale}/support/customers/account/${c.account.id}`} className="hover:underline">
                {c.account.name}
              </Link>
            </p>
          ) : null}
          {c.contacts.length ? (
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="text-muted-foreground">{t("support.customers.people")}:</span>
              {c.contacts.map((x) => (
                <Link key={x.id} href={`/${locale}/support/customers/contact/${x.id}`} className="hover:underline">
                  {x.name}
                </Link>
              ))}
            </p>
          ) : null}
        </CardBody>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("support.customers.tickets")} value={c.tickets.length} />
        <Stat label={t("support.views.open")} value={open} tone={open ? "warning" : undefined} />
        <Stat label={t("support.views.solved")} value={c.tickets.length - open} />
      </div>
      <Card>
        <CardHeader title={t("support.customers.allTickets")} />
        {c.tickets.length === 0 ? (
          <EmptyState>{t("support.customers.noTickets")}</EmptyState>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                <Th>{t("support.ticket.subject")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="hidden sm:table-cell">{t("support.ticket.priority")}</Th>
                <Th className="hidden md:table-cell">{t("support.ticket.assignee")}</Th>
                <Th className="hidden md:table-cell">{t("support.created")}</Th>
              </Tr>
            </THead>
            <TBody>
              {c.tickets.map((x) => (
                <Tr key={x.id}>
                  <Td className="tabular-nums text-muted-foreground">{x.number}</Td>
                  <Td>
                    <Link href={`/${locale}/support/tickets/${x.id}`} className="font-medium hover:underline">
                      {x.subject}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge t={t} status={x.status} />
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <PriorityBadge t={t} priority={x.priority} />
                  </Td>
                  <Td className="hidden md:table-cell">{x.assigneeName ?? "—"}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{formatDate(x.createdAt, locale, tz)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
    </>,
  );
}
