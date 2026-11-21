import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState, MEETING_TONE } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { AvailabilityPanel } from "@/components/comms/meeting-intel";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { db } from "@/server/core/db";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { listCustomerMeetings } from "@/server/modules/crm/meeting-intel";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.intel.customerTitle") };
}

/** Customer (CRM) meetings with their intelligence state: prep, transcript, summary, follow-up. */
export default async function CustomerMeetingsPage({ searchParams }: PageProps<"/[locale]/communication/meetings/customer">) {
  const p = await areaPage("communication", "meetings", {});
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, wrap } = p;
  const sp = await searchParams;
  const scope = sp.scope === "past" ? "past" : "upcoming";
  const salesRead = await can(viewer.ctx, "sales.read", await companyChain(db(), org.id, company.id));
  if (!salesRead) return wrap(<Notice tone="warning">{t("communication.intel.noSales")}</Notice>);
  const rows = await listCustomerMeetings(viewer.ctx, org.id, company.id, { scope });
  const path = `/${locale}/communication/meetings/customer`;
  return wrap(
    <div className="grid gap-4">
      <Link href={`/${locale}/communication/meetings`} className="text-sm text-muted-foreground hover:text-foreground">← {t("communication.meetings.back")}</Link>
      <AvailabilityPanel base={base} locale={locale} />
      <Card>
        <CardHeader
          title={t("communication.intel.customerTitle")}
          description={t("communication.intel.customerHint")}
          actions={
            <nav className="flex gap-1" aria-label={t("communication.meetings.scope")}>
              {(["upcoming", "past"] as const).map((s) => (
                <Link key={s} href={`${path}?scope=${s}`} aria-current={s === scope ? "page" : undefined} className={cn("rounded-md px-2.5 py-1 text-xs", s === scope ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>
                  {t(`communication.meetings.scopes.${s}`)}
                </Link>
              ))}
            </nav>
          }
        />
        {rows.length ? (
          <Table>
            <THead>
              <Tr>
                <Th>{t("communication.meetings.titleLabel")}</Th>
                <Th>{t("communication.meetings.when")}</Th>
                <Th className="hidden md:table-cell">{t("communication.intel.with")}</Th>
                <Th>{t("communication.intel.state")}</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((m) => {
                const i = m.intel;
                const state = i?.appliedAt ? "applied" : i?.summary ? "summarized" : i?.transcriptAt ? "transcript" : i?.prepBuiltAt ? "prepared" : i?.prepTaskId ? "preparing" : "none";
                return (
                  <Tr key={m.id}>
                    <Td>
                      <Link href={`${path}/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                      <Badge tone={MEETING_TONE[m.status]} className="ms-2">{t(`communication.meetings.statuses.${m.status}`)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{formatDateTime(m.startsAt, locale, tz)}</Td>
                    <Td className="hidden md:table-cell text-sm">{m.attendeeName ?? m.attendeeEmail ?? "—"}</Td>
                    <Td><Badge tone={state === "none" ? "neutral" : state === "applied" ? "success" : "info"}>{t(`communication.intel.states.${state}`)}</Badge></Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState>{t(scope === "past" ? "communication.intel.emptyPast" : "communication.intel.emptyUpcoming")}</EmptyState>
        )}
      </Card>
    </div>,
  );
}
