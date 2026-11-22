import Link from "next/link";
import { Flag, Skull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FlagCard } from "@/components/admin/flags";
import { AdminHeader, EmptyState, QuickFilters, StatGrid, StatTile, guard, sp } from "@/components/admin/kit";
import { ActionButton } from "@/components/admin/action-dialog";
import { AdminBreadcrumbs } from "@/components/admin/nav/breadcrumbs";
import { Timestamp } from "@/components/admin/timestamp";
import { CreateFlag, RolloutEditor } from "@/components/admin/security/actions";
import { SourceNote } from "@/components/admin/security/page-kit";
import { getLocale, getT } from "@/i18n/server";
import { canPlatform } from "@/server/modules/admin/access";
import { currentEnvironment, isStaleFlag, listFlags } from "@/server/modules/flags/service";
import { requireViewer } from "@/server/session";

/** Feature flags v2: create / delete, targeting rules, percentage rollouts, environments, schedule, kill switch, history. */
export default async function FlagsPage({ searchParams }: PageProps<"/[locale]/flags">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const view = sp((await searchParams).view);
  const r = await guard(Promise.all([listFlags(viewer.ctx), canPlatform(viewer.ctx, "flags.manage")]), t("errors.forbidden"));
  if (!r.ok) return r.node;
  const [all, editable] = r.value;
  const env = currentEnvironment();
  const stale = all.filter((f) => isStaleFlag(f));
  const flags = view === "stale" ? stale : view === "killed" ? all.filter((f) => f.rollout?.killedAt) : view === "rollout" ? all.filter((f) => f.rollout?.percentage !== null && f.rollout?.percentage !== undefined) : all;
  const base = `/${locale}/flags`;
  return (
    <div className="grid gap-4">
      <AdminBreadcrumbs />
      <AdminHeader
        icon={<Flag />}
        title={t("admin.nav.flags")}
        description={t("admin.flags.subtitle")}
        why={t("admin.flags.why")}
        actions={editable ? <CreateFlag /> : null}
        meta={<SourceNote source="feature_flags · feature_flag_rules · feature_flag_rollouts · feature_flag_versions" label={{ source: t("admin.settings.kit.source"), updated: t("admin.settings.kit.updated") }} extra={<Badge tone={env === "production" ? "danger" : "info"}>{t("admin.flags.thisEnvironment", { env: t(`admin.flags.env.${env}`) })}</Badge>} />}
      />
      <StatGrid>
        <StatTile label={t("admin.flags.total")} value={all.length} href={base} />
        <StatTile label={t("admin.flags.inRollout")} value={all.filter((f) => f.rollout?.percentage !== null && f.rollout?.percentage !== undefined).length} href={`${base}?view=rollout`} />
        <StatTile icon={<Skull />} label={t("admin.flags.killed")} value={all.filter((f) => f.rollout?.killedAt).length} tone={all.some((f) => f.rollout?.killedAt) ? "danger" : undefined} href={`${base}?view=killed`} />
        <StatTile label={t("admin.flags.stale")} value={stale.length} hint={t("admin.flags.staleHint")} href={`${base}?view=stale`} />
      </StatGrid>
      <QuickFilters base={base} name="view" value={view} params={{}} label={t("admin.flags.views")} options={[{ value: "", label: t("admin.common.all") }, { value: "rollout", label: t("admin.flags.inRollout") }, { value: "killed", label: t("admin.flags.killed") }, { value: "stale", label: t("admin.flags.stale") }]} />
      {flags.length === 0 ? <EmptyState icon={<Flag />} title={t("admin.flags.emptyTitle")} body={t("admin.flags.emptyBody")} /> : null}
      <div className="stagger grid gap-4 lg:grid-cols-2">
        {flags.map((f) => {
          const ro = f.rollout;
          const api = `/api/v1/admin/feature-flags/${f.id}`;
          const extra = (
            <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {ro?.killedAt ? <Badge tone="danger">{t("admin.flags.killedBadge")}</Badge> : null}
                <Badge tone={ro?.percentage !== null && ro?.percentage !== undefined ? "info" : "neutral"}>{ro?.percentage !== null && ro?.percentage !== undefined ? t("admin.flags.rolloutPct", { pct: ro.percentage }) : t("admin.flags.noRollout")}</Badge>
                <Badge tone="neutral">{ro?.environments.length ? ro.environments.map((e) => t(`admin.flags.env.${e}`)).join(", ") : t("admin.flags.allEnvironments")}</Badge>
                {ro?.startsAt || ro?.endsAt ? (
                  <span className="text-muted-foreground">
                    {ro.startsAt ? <Timestamp value={ro.startsAt} mode="absolute" /> : "…"} → {ro.endsAt ? <Timestamp value={ro.endsAt} mode="absolute" /> : "…"}
                  </span>
                ) : null}
                {isStaleFlag(f) ? <Badge tone="warning">{t("admin.flags.staleBadge")}</Badge> : null}
                <span className="ms-auto text-muted-foreground">
                  v{f.version} · <Timestamp value={f.lastChangedAt} mode="relative" />
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {editable ? <RolloutEditor flagId={f.id} flagKey={f.key} rollout={ro ? { percentage: ro.percentage, environments: ro.environments, startsAt: ro.startsAt?.toISOString() ?? null, endsAt: ro.endsAt?.toISOString() ?? null } : null} /> : null}
                {editable ? <ActionButton label={ro?.killedAt ? t("admin.flags.restore") : t("admin.flags.kill")} title={ro?.killedAt ? t("admin.flags.restoreTitle", { key: f.key }) : t("admin.flags.killTitle", { key: f.key })} description={ro?.killedAt ? undefined : t("admin.flags.killHint")} path={`${api}/kill`} method="PUT" body={{ killed: !ro?.killedAt }} danger={!ro?.killedAt} /> : null}
                <Link href={`${base}/${f.id}`} className="self-center text-primary hover:underline">{t("admin.flags.history")}</Link>
                {editable ? <ActionButton label={t("admin.flags.delete")} title={t("admin.flags.deleteTitle", { key: f.key })} description={t("admin.flags.deleteHint")} path={api} method="DELETE" phrase={f.key} danger variant="ghost" /> : null}
              </div>
            </div>
          );
          return <FlagCard key={f.id} editable={editable} extra={extra} flag={{ id: f.id, key: f.key, description: f.description, defaultEnabled: f.defaultEnabled, rules: f.rules }} />;
        })}
      </div>
    </div>
  );
}
