import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Handshake, LifeBuoy, Mail, UserRound } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatMoney, formatRelativeTime } from "@/i18n/format";
import type { CustomerContext } from "@/server/modules/comms/customer-context";

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Who this conversation is with, from the CRM: contact, company, deals, open support tickets and other conversations.
 * Server component; sections the viewer can't read (no sales / support permission) are simply not shown.
 */
export function CustomerPanel({ ctx, t, locale, linker }: { ctx: CustomerContext; t: T; locale: string; linker?: ReactNode }) {
  const row = (icon: ReactNode, children: ReactNode) => (
    <li className="flex items-start gap-2.5 text-sm">
      <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground [&_svg]:size-3.5">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
  return (
    <Card>
      <CardHeader title={t("communication.inbox.customer.title")} description={ctx.contact ? t("communication.inbox.customer.hint") : t("communication.inbox.noContact")} />
      <CardBody className="grid gap-4">
        {ctx.contact ? (
          <ul className="grid gap-3">
            {row(
              <UserRound />,
              <>
                <p className="font-medium">{ctx.contact.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[ctx.contact.title, ctx.contact.email].filter(Boolean).join(" · ")}</p>
              </>,
            )}
            {ctx.account
              ? row(
                  <Building2 />,
                  <Link href={`/${locale}/crm/accounts/${ctx.account.id}`} className="font-medium hover:underline">
                    {ctx.account.name}
                  </Link>,
                )
              : null}
            {ctx.deals?.length
              ? row(
                  <Handshake />,
                  <ul className="grid gap-1">
                    {ctx.deals.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <Link href={`/${locale}/crm/deals/${d.id}`} className="min-w-0 truncate hover:underline">
                          {d.name}
                        </Link>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {d.status === "OPEN" ? d.stage : t(`communication.inbox.customer.dealStatus.${d.status}`)} · {formatMoney({ amountMinor: d.amountMinor, currency: d.currency }, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>,
                )
              : null}
            {ctx.tickets?.length
              ? row(
                  <LifeBuoy />,
                  <ul className="grid gap-1">
                    {ctx.tickets.map((x) => (
                      <li key={x.id}>
                        <Link href={`/${locale}/support/tickets/${x.id}`} className="hover:underline">
                          #{x.number} {x.subject}
                        </Link>
                      </li>
                    ))}
                  </ul>,
                )
              : null}
            {ctx.threads.length
              ? row(
                  <Mail />,
                  <ul className="grid gap-1">
                    {ctx.threads.map((th) => (
                      <li key={th.id} className="flex items-baseline justify-between gap-2">
                        <Link href={`/${locale}/communication/inbox/${th.id}`} className={th.unread ? "min-w-0 truncate font-medium hover:underline" : "min-w-0 truncate hover:underline"}>
                          {th.subject}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(th.lastMessageAt, locale)}</span>
                      </li>
                    ))}
                  </ul>,
                )
              : null}
          </ul>
        ) : null}
        {linker}
      </CardBody>
    </Card>
  );
}
