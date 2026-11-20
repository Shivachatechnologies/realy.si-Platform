import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ComposeForm } from "@/components/comms/inbox";
import { EmptyState, hrefWith, Pager } from "@/components/comms/bits";
import { areaPage } from "@/components/comms/context";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";
import { listEmailAccounts, listTemplates, listThreads, parseThreadFilters } from "@/server/modules/comms/email";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.inbox.title") };
}

export default async function InboxPage({ searchParams }: PageProps<"/[locale]/communication/inbox">) {
  const p = await areaPage("communication", "inbox");
  if (p.gate) return p.gate;
  const { locale, t, viewer, org, company, tz, base, perms, wrap } = p;
  const sp = await searchParams;
  const filters = parseThreadFilters(sp);
  const [threads, accounts, templates] = await Promise.all([listThreads(viewer.ctx, org.id, company.id, filters), listEmailAccounts(viewer.ctx, org.id, company.id), listTemplates(viewer.ctx, org.id, company.id)]);
  const connected = accounts.filter((a) => a.connection === "CONNECTED");
  const path = `/${locale}/communication/inbox`;
  return wrap(
    <div className="grid gap-4">
      {!connected.length ? (
        <Notice tone="warning">
          {accounts.length ? t("communication.inbox.mailboxNotConnected") : t("communication.inbox.noMailbox")}{" "}
          <Link className="underline" href={`/${locale}/integrations`}>
            {t("communication.connectIntegrations")}
          </Link>
          {perms.manage ? (
            <>
              {" · "}
              <Link className="underline" href={`/${locale}/communication/settings`}>
                {t("communication.inbox.manageMailboxes")}
              </Link>
            </>
          ) : null}
        </Notice>
      ) : null}
      {perms.post ? (
        <Card>
          <details>
            <summary className="cursor-pointer p-4 text-sm font-medium">{t("communication.inbox.compose")}</summary>
            <ComposeForm base={base} locale={locale} templates={templates} mailboxes={accounts.map((a) => ({ id: a.id, address: a.address, provider: a.provider, connected: a.connection === "CONNECTED" }))} />
          </details>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("communication.inbox.title")} description={t("communication.inbox.description")} />
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_14rem_9rem_auto]" action={path}>
          <Input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} placeholder={t("communication.inbox.search")} aria-label={t("communication.inbox.search")} />
          <Select name="account" defaultValue={filters.accountId ?? ""} aria-label={t("communication.inbox.mailbox")}>
            <option value="">{t("communication.inbox.allMailboxes")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.address}
              </option>
            ))}
            <option value="none">{t("communication.inbox.platformMailer")}</option>
          </Select>
          <Select name="unread" defaultValue={filters.unread ? "1" : ""} aria-label={t("communication.inbox.unreadOnly")}>
            <option value="">{t("communication.inbox.allThreads")}</option>
            <option value="1">{t("communication.inbox.unreadOnly")}</option>
          </Select>
          <Button type="submit" variant="secondary">
            {t("communication.search")}
          </Button>
        </form>
        {threads.data.length === 0 ? (
          <EmptyState>{filters.q || filters.accountId || filters.unread ? t("common.noResults") : t("communication.inbox.empty")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {threads.data.map((th) => (
              <li key={th.id}>
                <Link href={`${path}/${th.id}`} className="grid gap-0.5 px-4 py-2.5 hover:bg-muted/50">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={cn("min-w-0 flex-1 truncate", th.unread && "font-semibold")}>{th.subject}</span>
                    {th.unread ? <Badge tone="accent">{t("communication.new")}</Badge> : null}
                    {th._count.messages > 1 ? <Badge>{th._count.messages}</Badge> : null}
                    <span className="text-xs text-muted-foreground">{formatDateTime(th.lastMessageAt, locale, tz)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{th.participants.slice(0, 3).join(", ")}</span>
                    <span className="hidden truncate sm:inline">· {th.snippet}</span>
                    {th.account ? <span className="ms-auto shrink-0">{th.account.address}</span> : <span className="ms-auto shrink-0">{t("communication.inbox.platformMailer")}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={filters.cursor ? hrefWith(path, sp, { cursor: undefined }) : null} nextHref={threads.nextCursor ? hrefWith(path, sp, { cursor: threads.nextCursor }) : null} />
      </Card>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Paperclip className="size-3" aria-hidden /> {t("communication.inbox.syncNote")}
      </p>
    </div>,
  );
}
