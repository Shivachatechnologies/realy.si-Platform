import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { listMyPlatformTickets, myTicketOrganizations } from "@/server/modules/admin/support";
import { requireViewer } from "@/server/session";
import { NewTicketForm } from "./_components/support-forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("platformSupport.title") };
}

const TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "info"> = { NEW: "accent", OPEN: "info", PENDING_CUSTOMER: "warning", ON_HOLD: "neutral", SOLVED: "success", CLOSED: "neutral" };

/** Contact Realy support: open a ticket to the Realy team and follow your tickets. */
export default async function ContactRealyPage({ searchParams }: PageProps<"/[locale]/help/contact-realy">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const sp = await searchParams;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const [tickets, orgs] = await Promise.all([listMyPlatformTickets(viewer.ctx, { cursor }), myTicketOrganizations(viewer.ctx)]);
  const base = `/${locale}/help/contact-realy`;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <PageHeader icon={<LifeBuoy />} title={t("platformSupport.title")} description={t("platformSupport.subtitle")} />
      <Card>
        <CardHeader title={t("platformSupport.newTicket")} description={t("platformSupport.newTicketHint")} />
        <CardBody>
          <NewTicketForm organizations={orgs} locale={locale} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("platformSupport.myTickets")} />
        {tickets.data.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("platformSupport.noTickets")}</p>
        ) : (
          <ul className="divide-y">
            {tickets.data.map((tk) => (
              <li key={tk.id}>
                <Link href={`${base}/${tk.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">#{tk.number}</span> <span className="font-medium">{tk.subject}</span>
                    <span className="block text-xs text-muted-foreground">{t("platformSupport.updated", { when: formatRelativeTime(tk.updatedAt, locale) })}</span>
                  </span>
                  <Badge tone={TONE[tk.status] ?? "neutral"}>{t(`platformSupport.statuses.${tk.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {tickets.nextCursor ? (
          <div className="flex justify-end border-t p-3">
            <Link href={`${base}?cursor=${tickets.nextCursor}`} className="text-sm text-primary hover:underline">
              {t("common.next")}
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
