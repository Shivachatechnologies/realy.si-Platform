import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, hrefWith, PageHeader, Pager } from "@/components/comms/bits";
import { MarkAllRead, NotificationLink } from "@/components/comms/notifications";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { listNotificationCenter } from "@/server/modules/comms/notifications";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.notifications.title") };
}

const KINDS = ["comms", "support", "approval", "crm", "finance", "hr", "marketing", "work", "automation", "integrations"] as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/[locale]/notifications">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const sp = await searchParams;
  const unread = sp.filter === "unread";
  const kind = typeof sp.kind === "string" && (KINDS as readonly string[]).includes(sp.kind) ? sp.kind : undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const list = await listNotificationCenter(viewer.ctx, org.id, { unread, kind, cursor });
  const path = `/${locale}/notifications`;
  const text = (type: string, payload: { title?: string; summary?: string }) => {
    if (type === "approval.requested") return t("notifications.approvalRequested", { summary: payload.summary ?? "" });
    const key = `notifications.kinds.${type}`;
    const s = t(key, { title: payload.title ?? "" });
    return s === key ? `${payload.title ?? type}` : s;
  };
  const chip = (label: string, href: string, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-accent font-medium" : "hover:bg-muted")}>
      {label}
    </Link>
  );
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title={t("communication.notifications.title")} subtitle={t("communication.notifications.subtitle", { count: list.unreadCount })} actions={list.unreadCount ? <MarkAllRead organizationId={org.id} /> : null} />
      <div className="flex flex-wrap gap-2">
        {chip(t("common.all"), hrefWith(path, sp, { filter: undefined, cursor: undefined }), !unread)}
        {chip(t("communication.notifications.unread"), hrefWith(path, sp, { filter: "unread", cursor: undefined }), unread)}
        <span className="mx-1 w-px bg-border" aria-hidden />
        {chip(t("communication.notifications.allKinds"), hrefWith(path, sp, { kind: undefined, cursor: undefined }), !kind)}
        {KINDS.map((k) => chip(t(`communication.notifications.kinds.${k}`), hrefWith(path, sp, { kind: k, cursor: undefined }), kind === k))}
      </div>
      <Card>
        <CardHeader title={unread ? t("communication.notifications.unread") : t("common.all")} />
        {list.data.length === 0 ? (
          <EmptyState>{unread || kind ? t("communication.notifications.noneFiltered") : t("notifications.empty")}</EmptyState>
        ) : (
          <ul className="grid divide-y">
            {list.data.map((n) => {
              const payload = (n.payload ?? {}) as { title?: string; summary?: string; href?: string };
              const href = n.type === "approval.requested" ? "/approvals" : payload.href?.startsWith("/") ? payload.href : "/notifications";
              return (
                <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <NotificationLink organizationId={org.id} id={n.id} href={`/${locale}${href}`} text={text(n.type, payload)} unread={!n.readAt} />
                  <Badge className="hidden sm:inline-flex">{t(`communication.notifications.kinds.${(KINDS as readonly string[]).includes(n.type.split(".")[0]!) ? n.type.split(".")[0] : "other"}`)}</Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(n.createdAt, locale)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={cursor ? hrefWith(path, sp, { cursor: undefined }) : null} nextHref={list.nextCursor ? hrefWith(path, sp, { cursor: list.nextCursor }) : null} />
      </Card>
    </div>
  );
}
