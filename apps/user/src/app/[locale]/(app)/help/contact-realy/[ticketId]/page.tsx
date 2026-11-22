import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { isAppError } from "@/server/core/errors";
import { getMyPlatformTicket } from "@/server/modules/admin/support";
import { requireViewer } from "@/server/session";
import { TicketReply } from "../_components/support-forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("platformSupport.title") };
}

/** One of my tickets to Realy support: the conversation (internal staff notes are never shown) and a reply box. */
export default async function MyTicketPage({ params }: PageProps<"/[locale]/help/contact-realy/[ticketId]">) {
  const { ticketId } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  let data;
  try {
    data = await getMyPlatformTicket(viewer.ctx, ticketId);
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
  const { ticket, messages } = data;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <Link href={`/${locale}/help/contact-realy`} className="text-sm text-primary hover:underline">
        ← {t("platformSupport.back")}
      </Link>
      <PageHeader icon={<LifeBuoy />} title={ticket.subject} description={t("platformSupport.ticketMeta", { number: ticket.number, created: formatDateTime(ticket.createdAt, locale, viewer.user.timezone) })} actions={<Badge>{t(`platformSupport.statuses.${ticket.status}`)}</Badge>} />
      <Card>
        <CardHeader title={t("platformSupport.conversation")} />
        <ol className="grid gap-3 p-4">
          {messages.map((m) => (
            <li key={m.id} className={cn("rounded-lg border p-3 text-sm", m.authorType === "system" ? "border-dashed text-xs text-muted-foreground" : m.mine ? "bg-surface" : "border-primary/30 bg-accent/40")}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{m.mine ? t("platformSupport.you") : m.authorType === "system" ? t("platformSupport.system") : t("platformSupport.realyTeam")}</span>
                <time dateTime={m.createdAt.toISOString()}>{formatDateTime(m.createdAt, locale, viewer.user.timezone)}</time>
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <CardBody>
          <TicketReply ticketId={ticket.id} status={ticket.status} />
        </CardBody>
      </Card>
    </div>
  );
}
