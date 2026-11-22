import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PlaidLinkButton, PlaidLinkCompletion, RemoveBankButton } from "@/components/integrations/bank-link";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/format";
import type { getT } from "@/i18n/server";

type T = Awaited<ReturnType<typeof getT>>;

/**
 * Server-rendered panels of the integration page: the provider events log and the read-only bank feed. (Provider
 * webhook URLs are not shown to customers: webhooks are managed by Realy.)
 */

interface EventRow {
  id: string;
  eventType: string;
  status: string;
  resultRef: string | null;
  error: string | null;
  receivedAt: Date;
}

const EVENT_TONE: Record<string, "success" | "danger" | "neutral" | "info"> = { processed: "success", failed: "danger", ignored: "neutral", stored: "info" };

export function ProviderEventsCard({ t, rows, locale, tz }: { t: T; rows: EventRow[]; locale: string; tz: string }) {
  return (
    <Card>
      <CardHeader title={t("integrations.providerEvents.title")} description={t("integrations.providerEvents.help")} />
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("integrations.providerEvents.empty")}</p>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs" dir="ltr">
                  {r.eventType}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.receivedAt, locale, tz)}
                  {r.resultRef?.startsWith("crm_meeting:") ? ` · ${t("integrations.providerEvents.meeting")}` : ""}
                  {r.error ? ` · ${r.error}` : ""}
                </p>
              </div>
              <Badge tone={EVENT_TONE[r.status] ?? "neutral"}>{t(`integrations.providerEvents.status.${r.status in EVENT_TONE ? r.status : "stored"}`)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface BankFeed {
  items: { itemId: string; institution: string | null; linkedAt: string }[];
  accounts: { id: string; name: string; institution: string | null; mask: string | null; type: string | null; currency: string; currentMinor: bigint | null; availableMinor: bigint | null; balanceAt: Date | null }[];
  transactions: { id: string; bookedOn: Date; description: string; merchantName: string | null; amountMinor: bigint; currency: string; pending: boolean; category: string | null }[];
  pendingLink: boolean;
}

export function BankFeedCard({ t, provider, feed, base, locale, tz, canManage, returned }: { t: T; provider: "plaid" | "wise"; feed: BankFeed; base: string; locale: string; tz: string; canManage: boolean; returned: boolean }) {
  return (
    <Card>
      <CardHeader title={t("integrations.bank.title")} description={t(`integrations.bank.help.${provider}`)} actions={canManage && provider === "plaid" ? <PlaidLinkButton base={base} locale={locale} relink={feed.items.length > 0} /> : null} />
      <CardBody className="grid gap-4 text-sm">
        {provider === "plaid" && canManage && returned ? <PlaidLinkCompletion base={base} pending={feed.pendingLink} /> : null}
        {provider === "plaid" ? (
          feed.items.length ? (
            <ul className="divide-y rounded-2xl border">
              {feed.items.map((i) => (
                <li key={i.itemId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div>
                    <p className="font-medium">{i.institution ?? t("integrations.bank.unknownBank")}</p>
                    <p className="text-xs text-muted-foreground">{t("integrations.bank.linkedOn", { date: formatDate(i.linkedAt, locale, tz) })}</p>
                  </div>
                  {canManage ? <RemoveBankButton base={base} itemId={i.itemId} name={i.institution ?? t("integrations.bank.unknownBank")} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t("integrations.bank.noBanks")}</p>
          )
        ) : null}
        {feed.accounts.length ? (
          <div className="grid gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("integrations.bank.accounts")}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {feed.accounts.map((a) => (
                <li key={a.id} className="rounded-2xl border p-3">
                  <p className="truncate font-medium">
                    {a.name}
                    {a.mask ? <span className="text-muted-foreground"> ··{a.mask}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{[a.institution, a.type].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 font-display text-lg tabular-nums">{a.currentMinor !== null ? formatMoney({ amountMinor: a.currentMinor, currency: a.currency }, locale) : "—"}</p>
                  {a.availableMinor !== null ? <p className="text-xs text-muted-foreground">{t("integrations.bank.available", { amount: formatMoney({ amountMinor: a.availableMinor, currency: a.currency }, locale) })}</p> : null}
                  {a.balanceAt ? <p className="text-xs text-muted-foreground">{t("integrations.bank.asOf", { time: formatDateTime(a.balanceAt, locale, tz) })}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {provider === "plaid" ? (
          <div className="grid gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("integrations.bank.transactions")}</h3>
            {feed.transactions.length ? (
              <ul className="divide-y rounded-2xl border">
                {feed.transactions.slice(0, 20).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate">{x.merchantName ?? x.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(x.bookedOn, locale, "UTC")}
                        {x.pending ? ` · ${t("integrations.bank.pending")}` : ""}
                        {x.category ? ` · ${x.category.toLowerCase().replace(/_/g, " ")}` : ""}
                      </p>
                    </div>
                    <span className={x.amountMinor < 0n ? "shrink-0 tabular-nums" : "shrink-0 tabular-nums text-success"}>{formatMoney({ amountMinor: x.amountMinor, currency: x.currency }, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t("integrations.bank.noTransactions")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t("integrations.bank.reconcileHint")}{" "}
              <Link href={`/${locale}/finance/transactions`} className="text-primary hover:underline">
                {t("integrations.bank.openFinance")}
              </Link>
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
