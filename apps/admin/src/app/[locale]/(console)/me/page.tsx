import Link from "next/link";
import { Bookmark, History, KeyRound, MonitorSmartphone, Settings2, ShieldCheck, Star, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { AdminHeader, Empty } from "@/components/admin/kit";
import { ClearHistory, FavoriteRemove, PreferencesForm, SavedViewActions } from "@/components/admin/me/preferences-form";
import { navEntryFor } from "@/components/admin/nav/registry";
import { Timestamp } from "@/components/admin/timestamp";
import { getLocale, getT } from "@/i18n/server";
import { notificationTypes } from "@/server/modules/admin/notifications";
import { myConsoleProfile } from "@/server/modules/admin/preferences";
import { requireViewer } from "@/server/session";

/** Personal settings (stream A): preferences, favorites, saved views, history, your platform roles, sessions and actions. */
export default async function MePage() {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const [me, types] = await Promise.all([myConsoleProfile(viewer.ctx), notificationTypes(viewer.ctx)]);
  const base = `/${locale}`;
  const p = me.preferences;
  const label = (key: string) => (/^admin\.[\w.]+$/.test(key) ? t(key) : key);

  return (
    <div className="grid gap-4">
      <AdminHeader icon={<UserCog />} title={t("admin.me.title")} description={t("admin.me.subtitle", { name: viewer.user.name })} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={<Settings2 />} title={t("admin.me.preferences")} description={t("admin.me.preferencesHint")} />
          <PreferencesForm initial={{ density: p.density, timeRange: p.timeRange, collapsed: p.sidebar.collapsed, minSeverity: p.notificationPrefs.minSeverity, muted: p.notificationPrefs.muted }} types={types} />
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader icon={<ShieldCheck />} title={t("admin.me.roles")} description={t("admin.me.rolesHint")} />
            {me.roles.length === 0 ? (
              <Empty>{t("admin.me.noRoles")}</Empty>
            ) : (
              <ul className="divide-y">
                {me.roles.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                    <Badge tone="accent" className="font-mono">
                      {r.key}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {r.scopeType}
                      {r.scopeType !== "PLATFORM" ? `: ${r.scopeId}` : ""}
                    </span>
                    <span className="ms-auto text-xs text-muted-foreground">
                      {r.expiresAt ? (
                        <>
                          {t("admin.me.expires")} <Timestamp value={r.expiresAt} mode="relative" />
                        </>
                      ) : (
                        <>
                          {t("admin.me.since")} <Timestamp value={r.since} mode="absolute" />
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<Star />} title={t("admin.me.favorites")} description={t("admin.me.favoritesHint")} />
            {p.favorites.length === 0 ? (
              <Empty>{t("admin.me.noFavorites")}</Empty>
            ) : (
              <ul className="divide-y">
                {p.favorites.map((href) => {
                  const entry = navEntryFor(href === "/" ? "" : href);
                  const name = entry ? t(entry.item.label) : href;
                  return (
                    <li key={href} className="flex items-center gap-2 px-4 py-1.5 text-sm">
                      <Link href={`${base}${href === "/" ? "" : href}`} className="min-w-0 flex-1 truncate hover:underline">
                        {name}
                      </Link>
                      <FavoriteRemove href={href} name={name} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader icon={<Bookmark />} title={t("admin.me.savedViews")} description={t("admin.me.savedViewsHint")} />
        {me.savedViews.length === 0 ? (
          <Empty>{t("admin.me.noSavedViews")}</Empty>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>{t("admin.me.viewName")}</Th>
                <Th>{t("admin.me.viewTable")}</Th>
                <Th>{t("admin.me.viewFilters")}</Th>
                <Th>{t("admin.me.viewUpdated")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </Tr>
            </THead>
            <TBody>
              {me.savedViews.map((v) => (
                <Tr key={v.id}>
                  <Td className="font-medium">
                    {v.name}
                    {v.shared ? (
                      <Badge tone="info" className="ms-2">
                        {t("admin.shell.views.shared")}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-xs">{v.page}</Td>
                  <Td className="max-w-80 truncate font-mono text-[11px] text-muted-foreground">{new URLSearchParams(v.query).toString() || "—"}</Td>
                  <Td>
                    <Timestamp value={v.updatedAt} mode="relative" />
                  </Td>
                  <Td className="text-end">
                    <SavedViewActions id={v.id} name={v.name} shared={v.shared} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<MonitorSmartphone />} title={t("admin.me.sessions")} description={t("admin.me.sessionsHint")} />
          {me.sessions.length === 0 ? (
            <Empty>{t("admin.me.noSessions")}</Empty>
          ) : (
            <ul className="divide-y">
              {me.sessions.map((s) => (
                <li key={s.id} className="grid gap-0.5 px-4 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate">{s.userAgent ?? t("admin.me.unknownDevice")}</span>
                    {s.current ? <Badge tone="success">{t("admin.me.thisSession")}</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.ip ?? "—"} · {t("admin.me.lastSeen")} <Timestamp value={s.lastSeenAt} mode="relative" /> · {t("admin.me.signedIn")} <Timestamp value={s.createdAt} mode="absolute" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<KeyRound />} title={t("admin.me.myActions")} description={t("admin.me.myActionsHint")} />
          {me.actions.length === 0 ? (
            <Empty>{t("admin.me.noActions")}</Empty>
          ) : (
            <ul className="divide-y">
              {me.actions.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Badge tone={a.category === "SECURITY" ? "warning" : "accent"} className="font-mono">
                    {a.action}
                  </Badge>
                  {a.reason ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">“{a.reason}”</span> : <span className="flex-1" />}
                  <Timestamp value={a.createdAt} mode="relative" className="text-xs text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={<History />} title={t("admin.me.history")} description={t("admin.me.historyHint")} actions={<ClearHistory />} />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("admin.shell.groups.recents")}</h3>
            {p.recents.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("admin.me.noRecents")}</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {p.recents.map((r) => (
                  <li key={r.href} className="flex items-center gap-2">
                    <Link href={`${base}${r.href === "/" ? "" : r.href}`} className="truncate hover:underline">
                      {label(r.label)}
                    </Link>
                    <Timestamp value={r.at} mode="relative" className="ms-auto text-xs text-muted-foreground" />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t("admin.palette.groups.recent")}</h3>
            {p.recentSearches.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("admin.me.noSearches")}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {p.recentSearches.map((s) => (
                  <li key={s}>
                    <Link href={`${base}/search?q=${encodeURIComponent(s)}`} className="rounded-md border px-2 py-0.5 text-xs hover:border-border-strong">
                      {s}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
