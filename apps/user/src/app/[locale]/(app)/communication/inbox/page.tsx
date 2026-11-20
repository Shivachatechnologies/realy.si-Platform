import type { Metadata } from "next";
import Link from "next/link";
import { Hash, Mail, MessagesSquare, Paperclip } from "lucide-react";
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
import { teamConversations } from "@/server/modules/comms/unified";
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
  const view = sp.view === "email" || sp.view === "team" ? sp.view : "all";
  const [threads, accounts, templates, team] = await Promise.all([
    view === "team" ? Promise.resolve({ data: [], nextCursor: null }) : listThreads(viewer.ctx, org.id, company.id, filters),
    listEmailAccounts(viewer.ctx, org.id, company.id),
    listTemplates(viewer.ctx, org.id, company.id),
    view === "email" || filters.cursor || filters.accountId || filters.contactId ? Promise.resolve([]) : teamConversations(viewer.ctx, org.id, company.id, view === "team" ? 50 : 15),
  ]);
  const connected = accounts.filter((a) => a.connection === "CONNECTED");
  const path = `/${locale}/communication/inbox`;
  const q = filters.q?.toLowerCase();
  const teamItems = team.filter((c) => (!q || c.name.toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q)) && (!filters.unread || c.unread > 0));
  // One timeline: email threads and team conversations ordered by latest activity.
  const items = [
    ...threads.data.map((th) => ({ kind: "email" as const, at: th.lastMessageAt, th })),
    ...teamItems.map((c) => ({ kind: "team" as const, at: c.lastMessageAt, c })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const unreadTeam = team.reduce((n, c) => n + c.unread, 0);
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
        <CardHeader title={t("communication.inbox.title")} description={t("communication.inbox.unified.description")} />
        <nav className="flex gap-1 overflow-x-auto border-b px-3 text-sm" aria-label={t("communication.inbox.unified.views")}>
          {(["all", "email", "team"] as const).map((v) => (
            <Link
              key={v}
              href={hrefWith(path, sp, { view: v === "all" ? undefined : v, cursor: undefined })}
              aria-current={view === v ? "page" : undefined}
              className={cn("-mb-px flex min-h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {v === "email" ? <Mail className="size-3.5" aria-hidden /> : v === "team" ? <MessagesSquare className="size-3.5" aria-hidden /> : null}
              {t(`communication.inbox.unified.${v}`)}
              {v === "team" && unreadTeam ? <Badge tone="accent">{unreadTeam}</Badge> : null}
            </Link>
          ))}
        </nav>
        <form className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,1fr)_14rem_9rem_auto]" action={path}>
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
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
        {items.length === 0 ? (
          <EmptyState>{filters.q || filters.accountId || filters.unread ? t("common.noResults") : view === "team" ? t("communication.inbox.unified.teamEmpty") : t("communication.inbox.empty")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {items.map((it) =>
              it.kind === "email" ? (
                <li key={`e-${it.th.id}`}>
                  <Link href={`${path}/${it.th.id}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-muted/50">
                    <span aria-hidden className="row-span-2 mt-0.5 grid size-7 place-items-center rounded-full bg-info/10 text-info">
                      <Mail className="size-3.5" />
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cn("min-w-0 flex-1 truncate", it.th.unread && "font-semibold")}>{it.th.subject}</span>
                      {it.th.unread ? <Badge tone="accent">{t("communication.new")}</Badge> : null}
                      {it.th.contactId ? <Badge tone="info">{t("communication.inbox.unified.customer")}</Badge> : null}
                      {it.th._count.messages > 1 ? <Badge>{it.th._count.messages}</Badge> : null}
                      <span className="text-xs text-muted-foreground">{formatDateTime(it.th.lastMessageAt, locale, tz)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{it.th.participants.slice(0, 3).join(", ")}</span>
                      <span className="hidden truncate sm:inline">· {it.th.snippet}</span>
                      {it.th.account ? <span className="ms-auto shrink-0">{it.th.account.address}</span> : <span className="ms-auto shrink-0">{t("communication.inbox.platformMailer")}</span>}
                    </div>
                  </Link>
                </li>
              ) : (
                <li key={`t-${it.c.id}`}>
                  <Link href={`/${locale}/communication/${it.c.isDirect ? "messages" : "channels"}/${it.c.id}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-muted/50">
                    <span aria-hidden className="row-span-2 mt-0.5 grid size-7 place-items-center rounded-full bg-primary/10 text-primary">
                      {it.c.isDirect ? <MessagesSquare className="size-3.5" /> : <Hash className="size-3.5" />}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cn("min-w-0 flex-1 truncate", it.c.unread > 0 && "font-semibold")}>{it.c.isDirect ? it.c.name : `#${it.c.name}`}</span>
                      {it.c.unread ? <Badge tone="accent">{it.c.unread}</Badge> : null}
                      <Badge>{t(it.c.isDirect ? "communication.inbox.unified.direct" : "communication.inbox.unified.channel")}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(it.c.lastMessageAt, locale, tz)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{it.c.author ? `${it.c.author}: ` : ""}{it.c.snippet}</p>
                  </Link>
                </li>
              ),
            )}
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
