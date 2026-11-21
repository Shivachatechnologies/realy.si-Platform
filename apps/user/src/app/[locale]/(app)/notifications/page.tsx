import type { Metadata } from "next";
import Link from "next/link";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import { hrefWith, Pager } from "@/components/comms/bits";
import { MarkAllRead, NotificationLink } from "@/components/comms/notifications";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { introLabels } from "@/components/guide-kit/server";
import { dayKey, moduleVisual } from "@/components/timeline/day-timeline";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { formatRelativeTime } from "@/i18n/format";
import { cn } from "@/lib/utils";
import { actionableNotifications, isActionable } from "@/server/modules/cockpit/inbox";
import { listNotificationCenter } from "@/server/modules/comms/notifications";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("communication.notifications.title") };
}

const KINDS = ["comms", "support", "approval", "crm", "finance", "hr", "marketing", "work", "automation", "integrations"] as const;

type Row = Awaited<ReturnType<typeof listNotificationCenter>>["data"][number];

export default async function NotificationsPage({ searchParams }: PageProps<"/[locale]/notifications">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const sp = await searchParams;
  const unread = sp.filter === "unread";
  const kind = typeof sp.kind === "string" && (KINDS as readonly string[]).includes(sp.kind) ? sp.kind : undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const [list, actionable] = await Promise.all([listNotificationCenter(viewer.ctx, org.id, { unread, kind, cursor }), cursor ? Promise.resolve([]) : actionableNotifications(viewer.ctx, org.id)]);
  const shownActionable = kind ? actionable.filter((n) => n.type.startsWith(`${kind}.`)) : actionable;
  const actionIds = new Set(shownActionable.map((n) => n.id));
  const path = `/${locale}/notifications`;
  const tz = viewer.user.timezone;
  const text = (type: string, payload: { title?: string; summary?: string }) => {
    if (type === "approval.requested") return t("notifications.approvalRequested", { summary: payload.summary ?? "" });
    const key = `notifications.kinds.${type}`;
    const s = t(key, { title: payload.title ?? "" });
    return s === key ? `${payload.title ?? type}` : s;
  };
  const moduleOf = (type: string) => {
    const k = type.split(".")[0]!;
    return (KINDS as readonly string[]).includes(k) ? k : "other";
  };
  const hrefOf = (n: Row) => {
    const payload = (n.payload ?? {}) as { href?: string };
    return n.type === "approval.requested" ? "/approvals" : payload.href?.startsWith("/") ? payload.href : "/notifications";
  };
  const chip = (label: string, href: string, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-accent font-medium" : "hover:bg-muted")}>
      {label}
    </Link>
  );
  const item = (n: Row, emphasis = false) => {
    const payload = (n.payload ?? {}) as { title?: string; summary?: string };
    const v = moduleVisual(n.type);
    return (
      <li key={n.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", emphasis && "bg-warning/5")}>
        <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5", v.tone)}>
          {v.icon}
        </span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
        <NotificationLink organizationId={org.id} id={n.id} href={`/${locale}${hrefOf(n)}`} text={text(n.type, payload)} unread={!n.readAt} />
        {isActionable(n.type) && !n.readAt ? (
          <Badge tone="warning" className="hidden sm:inline-flex">
            {t("inbox.needsAction")}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(n.createdAt, locale)}</span>
      </li>
    );
  };

  // Day → module groups (the page is already newest first).
  const rest = list.data.filter((n) => !actionIds.has(n.id));
  const today = dayKey(new Date(), tz);
  const yesterday = dayKey(new Date(new Date().getTime() - 86_400_000), tz);
  const days = new Map<string, Map<string, Row[]>>();
  for (const n of rest) {
    const d = dayKey(n.createdAt, tz);
    const m = moduleOf(n.type);
    const byModule = days.get(d) ?? new Map<string, Row[]>();
    byModule.set(m, [...(byModule.get(m) ?? []), n]);
    days.set(d, byModule);
  }
  const dayLabel = (d: string) => (d === today ? t("timeline.today") : d === yesterday ? t("timeline.yesterday") : new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)));

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader
        icon={<Bell />}
        eyebrow={t("inbox.eyebrow")}
        title={t("communication.notifications.title")}
        description={t("communication.notifications.subtitle", { count: list.unreadCount })}
        actions={list.unreadCount ? <MarkAllRead organizationId={org.id} /> : null}
      />
      <PageIntro
        labels={introLabels(t)}
        accent="info"
        what={t("inbox.intro.what")}
        why={t("inbox.intro.why")}
        can={t("inbox.intro.can")}
        next={shownActionable[0] ? { label: t("inbox.intro.next"), href: `/${locale}${hrefOf(shownActionable[0])}` } : { label: t("inbox.intro.nextDone"), href: `/${locale}/activity` }}
      />
      <div className="flex flex-wrap gap-2">
        {chip(t("common.all"), hrefWith(path, sp, { filter: undefined, cursor: undefined }), !unread)}
        {chip(t("communication.notifications.unread"), hrefWith(path, sp, { filter: "unread", cursor: undefined }), unread)}
        <span className="mx-1 w-px bg-border" aria-hidden />
        {chip(t("communication.notifications.allKinds"), hrefWith(path, sp, { kind: undefined, cursor: undefined }), !kind)}
        {KINDS.map((k) => chip(t(`communication.notifications.kinds.${k}`), hrefWith(path, sp, { kind: k, cursor: undefined }), kind === k))}
      </div>

      {shownActionable.length ? (
        <Card variant="highlight">
          <CardHeader icon={<BellRing />} title={t("inbox.actionTitle")} description={t("inbox.actionHint", { count: shownActionable.length })} />
          <ul className="grid divide-y">{shownActionable.map((n) => item(n, true))}</ul>
        </Card>
      ) : null}

      {rest.length === 0 && !shownActionable.length ? (
        <Card>
          {unread || kind ? (
            <CardBody className="text-sm text-muted-foreground">{t("communication.notifications.noneFiltered")}</CardBody>
          ) : (
            <SmartEmpty
              icon={<CheckCheck />}
              title={t("inbox.empty.title")}
              body={t("inbox.empty.body")}
              primary={
                <Link href={`/${locale}/activity`} className="text-sm font-medium text-primary hover:underline">
                  {t("inbox.intro.nextDone")}
                </Link>
              }
            />
          )}
        </Card>
      ) : null}

      {[...days.entries()].map(([d, byModule]) => (
        <Card key={d}>
          <CardHeader title={dayLabel(d)} description={t("inbox.dayCount", { count: [...byModule.values()].reduce((a, r) => a + r.length, 0) })} />
          <div className="grid divide-y">
            {[...byModule.entries()].map(([m, rows]) => (
              <section key={m} aria-label={t(`communication.notifications.kinds.${m}`)}>
                <h3 className="flex items-center gap-2 bg-surface-2/60 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {t(`communication.notifications.kinds.${m}`)}
                  <span className="tabular-nums">· {rows.length}</span>
                </h3>
                <ul className="grid divide-y">{rows.map((n) => item(n))}</ul>
              </section>
            ))}
          </div>
        </Card>
      ))}

      <Pager labels={{ prev: t("communication.newest"), next: t("communication.older") }} prevHref={cursor ? hrefWith(path, sp, { cursor: undefined }) : null} nextHref={list.nextCursor ? hrefWith(path, sp, { cursor: list.nextCursor }) : null} />
    </div>
  );
}
