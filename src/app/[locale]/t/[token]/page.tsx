import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Markdownish } from "@/components/comms/markdownish";
import { PublicReplyForm } from "@/components/support/public";
import { PublicShell } from "@/components/support/public-shell";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { isAppError } from "@/server/core/errors";
import { getPublicTicket } from "@/server/modules/support/tickets";
import { safeTimeZone } from "@/server/modules/comms/time";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("support.public.ticketTitle"), robots: { index: false, follow: false } };
}

export default async function PublicTicketPage({ params }: PageProps<"/[locale]/t/[token]">) {
  const { token } = await params;
  const locale = await getLocale();
  const t = await getT(locale);
  const tk = await getPublicTicket(token).catch((err) => {
    if (isAppError(err) && err.code === "not_found") notFound();
    throw err;
  });
  const tz = safeTimeZone(tk.timeZone);
  return (
    <PublicShell title={tk.companyName} footer={t("support.public.tokenNote")}>
      <Card>
        <CardHeader title={`#${tk.number} ${tk.subject}`} description={formatDateTime(tk.createdAt, locale, tz)} actions={<Badge tone={tk.status === "SOLVED" || tk.status === "CLOSED" ? "success" : "accent"}>{t(`support.public.statuses.${tk.status}`)}</Badge>} />
        {tk.description ? (
          <CardBody>
            <Markdownish text={tk.description} />
          </CardBody>
        ) : null}
      </Card>
      <ul className="grid gap-3">
        {tk.messages.map((m) => (
          <li key={m.id} className={cn("grid gap-1 rounded-lg border p-4", m.fromCustomer ? "ms-8 bg-accent/30" : "me-8 bg-surface")}>
            <p className="text-xs text-muted-foreground">
              {m.fromCustomer ? (tk.requesterName ?? t("support.public.you")) : t("support.public.agent", { name: m.authorName ?? tk.companyName })} · {formatDateTime(m.createdAt, locale, tz)}
            </p>
            <Markdownish text={m.body} />
          </li>
        ))}
      </ul>
      {tk.status === "CLOSED" ? (
        <Notice>{t("support.public.closed")}</Notice>
      ) : (
        <Card>
          <CardHeader title={t("support.public.reply")} />
          <CardBody>
            <PublicReplyForm token={token} />
          </CardBody>
        </Card>
      )}
    </PublicShell>
  );
}
