import Link from "next/link";
import { BarChart3, History, KeyRound, Network, NotebookPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Facts } from "@/components/admin/kit";
import { EditOrganization, NotesPanel } from "@/components/admin/people-actions";
import { getT } from "@/i18n/server";
import { formatMoney, formatNumber, formatRelativeTime } from "@/i18n/format";
import { canPlatform } from "@/server/modules/admin/access";
import { listNotes, userInsights } from "@/server/modules/admin/people";
import type { RequestContext } from "@/server/core/context";

/** Extra admin sections on the user detail page (Activity tab): usage, notes, activity timeline, login history. */
export async function UserAdminExtras({ ctx, locale, user }: { ctx: RequestContext; locale: string; user: { id: string; name: string; email: string; locale: string; timezone: string } }) {
  const t = await getT(locale as Parameters<typeof getT>[0]);
  const [ins, notes, canNote] = await Promise.all([
    userInsights(ctx, user.id),
    listNotes(ctx, "user", user.id),
    Promise.all([canPlatform(ctx, "platform.support.manage"), canPlatform(ctx, "platform.users.manage")]).then((x) => x.some(Boolean)),
  ]);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<BarChart3 />} title={t("admin.people.usage")} />
          <Facts
            rows={[
              [t("admin.people.aiTasksMonth"), formatNumber(ins.ai.tasksMonth, locale)],
              [t("admin.people.aiTasks30"), formatNumber(ins.ai.tasks30d, locale)],
              [t("admin.people.tokens30"), formatNumber(ins.ai.tokens30d, locale)],
              [t("admin.people.organizations"), String(ins.organizations.length)],
            ]}
          />
          <ul className="divide-y border-t">
            {ins.subscriptions.length === 0 ? <li className="p-3 text-xs text-muted-foreground">{t("admin.organizations.noSubscription")}</li> : null}
            {ins.subscriptions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <Link href={`/${locale}/organizations/${s.organizationId}`} className="truncate font-medium hover:underline">
                  {s.organizationName}
                </Link>
                <span className="flex items-center gap-2">
                  {s.plan.name}
                  <Badge tone={s.status === "ACTIVE" ? "success" : s.status === "PAST_DUE" ? "warning" : "neutral"}>{t(`admin.subscriptions.status.${s.status}`)}</Badge>
                  <span className="tabular-nums">{s.items.length ? formatMoney({ amountMinor: s.items.reduce((a, i) => a + i.unitAmountMinor * BigInt(i.quantity), 0n), currency: s.currency }, locale) : "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<NotebookPen />} title={t("admin.people.notes")} description={t("admin.people.notesHint")} />
          <NotesPanel target="user" targetId={user.id} canWrite={canNote} notes={notes.map((n) => ({ id: n.id, body: n.body, pinned: n.pinned, author: n.author, createdAt: n.createdAt.toISOString() }))} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<History />} title={t("admin.people.timeline")} description={t("admin.people.timelineHint")} />
          {ins.activity.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t("admin.roles.viewAs.none")}</p>
          ) : (
            <ol className="relative grid gap-0 px-4 py-2">
              {ins.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 border-s ps-3 pb-2 text-xs">
                  <span className={`-ms-[17px] mt-1 size-2 shrink-0 rounded-full ${a.category === "SECURITY" ? "bg-warning" : a.category === "ADMIN" ? "bg-primary" : "bg-border-strong"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono">{a.action}</span>
                    {a.actorName ? <span className="text-muted-foreground"> · {t("admin.people.by", { name: a.actorName })}</span> : null}
                    {a.reason ? <div className="truncate text-muted-foreground">“{a.reason}”</div> : null}
                  </div>
                  <time className="shrink-0 text-muted-foreground" dateTime={a.createdAt.toISOString()}>
                    {formatRelativeTime(a.createdAt, locale)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.people.loginHistory")} description={t("admin.people.loginHistoryHint")} />
          <ul className="divide-y">
            {ins.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs">
                <span className="min-w-0 truncate">
                  <span className="font-mono">{s.ip ?? "—"}</span> <span className="text-muted-foreground">{s.userAgent?.slice(0, 60)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {s.revokedAt ? <Badge>{t("admin.securityAccess.state.revoked")}</Badge> : s.expiresAt < new Date() ? <Badge>{t("admin.securityAccess.state.expired")}</Badge> : <Badge tone="success">{t("admin.securityAccess.state.active")}</Badge>}
                  {formatRelativeTime(s.createdAt, locale)}
                </span>
              </li>
            ))}
            {ins.logins.map((l) => (
              <li key={l.id} className="flex justify-between px-4 py-1.5 text-xs">
                <span className={`font-mono ${l.action === "auth.sign_in_failed" ? "text-danger" : ""}`}>{l.action}</span>
                <span className="text-muted-foreground">{formatRelativeTime(l.createdAt, locale)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/** Tabs of the organization detail area (overview, members, activity, entitlements — the latter owned by Plans). */
export async function OrgTabs({ locale, orgId, active }: { locale: string; orgId: string; active: "overview" | "members" | "activity" | "integrations" | "security" | "ai" | "access" }) {
  const t = await getT(locale as Parameters<typeof getT>[0]);
  const base = `/${locale}/organizations/${orgId}`;
  const tabs = [
    { key: "overview", href: base, label: t("admin.people.tabs.overview") },
    { key: "members", href: `${base}/members`, label: t("admin.people.tabs.members") },
    { key: "activity", href: `${base}/activity`, label: t("admin.people.tabs.activity") },
    { key: "security", href: `${base}/security`, label: t("admin.access.org.tabs.security") },
    { key: "ai", href: `${base}/ai`, label: t("admin.access.org.tabs.ai") },
    { key: "access", href: `${base}/access`, label: t("admin.access.org.tabs.access") },
    { key: "entitlements", href: `/${locale}/plans/organizations/${orgId}`, label: t("admin.people.tabs.entitlements") },
    // The organization's own payment / WhatsApp / Mailchimp accounts (status, Realy-team setup) and a link to all of
    // its connections on the Integrations & API page.
    { key: "integrations", href: `${base}/integrations`, label: t("admin.people.tabs.integrations") },
  ];
  return (
    <nav aria-label={t("admin.people.tabs.label")} className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-medium ${tab.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {tab.key === "entitlements" ? <Network className="size-3.5" aria-hidden /> : null}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Org edit button + notes card used on the organization overview. */
export async function OrgAdminExtras({ ctx, locale, org }: { ctx: RequestContext; locale: string; org: { id: string; name: string; slug: string; defaultLocale: string } }) {
  const t = await getT(locale as Parameters<typeof getT>[0]);
  const [notes, canManage, canNote] = await Promise.all([
    listNotes(ctx, "organization", org.id),
    canPlatform(ctx, "platform.organizations.manage"),
    Promise.all([canPlatform(ctx, "platform.support.manage"), canPlatform(ctx, "platform.organizations.manage")]).then((x) => x.some(Boolean)),
  ]);
  return (
    <Card>
      <CardHeader icon={<NotebookPen />} title={t("admin.people.notes")} description={t("admin.people.notesHint")} actions={canManage ? <EditOrganization organizationId={org.id} initial={{ name: org.name, slug: org.slug, defaultLocale: org.defaultLocale }} /> : null} />
      <NotesPanel target="organization" targetId={org.id} canWrite={canNote} notes={notes.map((n) => ({ id: n.id, body: n.body, pinned: n.pinned, author: n.author, createdAt: n.createdAt.toISOString() }))} />
    </Card>
  );
}
