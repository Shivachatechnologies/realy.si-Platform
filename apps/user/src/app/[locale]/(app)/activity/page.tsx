import type { Metadata } from "next";
import Link from "next/link";
import { History, SlidersHorizontal, Sparkles } from "lucide-react";
import { HelpMeButton } from "@/components/guide-kit/help-me";
import { PageIntro } from "@/components/guide-kit/page-intro";
import { SmartEmpty } from "@/components/guide-kit/smart-empty";
import { introLabels, latestSubjectTask } from "@/components/guide-kit/server";
import { ActivityBars } from "@/components/timeline/activity-bars";
import { DayTimeline, dayKey, moduleVisual, type TimelineEntry } from "@/components/timeline/day-timeline";
import { Pager, qs } from "@/components/workforce/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { getLocale, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { db } from "@/server/core/db";
import { aiConfigured } from "@/server/modules/agents/runtime";
import { activityByDay, activityFacets, activityFilters, listActivity, listDomainEvents, resourceHref } from "@/server/modules/activity/service";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.activity.title") };
}

/** A short, human label for an audited record from its stored values. */
function recordLabel(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of ["name", "title", "summary", "key", "email"]) if (typeof o[k] === "string" && o[k]) return String(o[k]).slice(0, 120);
  return null;
}

const RANGES = [
  { key: "today", days: 0 },
  { key: "week", days: 6 },
  { key: "month", days: 29 },
] as const;

export default async function ActivityPage({ searchParams }: PageProps<"/[locale]/activity">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const f = activityFilters.parse(sp);
  const facets = await activityFacets(viewer.ctx, org.id);
  const tz = viewer.user.timezone;
  const header = <PageHeader icon={<History />} eyebrow={t("timeline.eyebrow")} title={t("modules.activity.title")} description={facets.all ? t("activity.subtitleAll") : t("activity.subtitleOwn")} />;
  const view = facets.all && f.view === "events" && company ? "events" : "audit";
  const label = (key: string, fallback: string) => (t(key) === key ? fallback : t(key));
  const actorLabel = (type: string, id: string | null, names: Map<string, string>) =>
    id && names.has(id) ? names.get(id)! : type === "SYSTEM" ? t("activity.system") : type === "SERVICE_ACCOUNT" ? t("activity.integration") : type === "AGENT" ? t("activity.agent") : t("activity.unknownActor");
  const filterParams = { view: view === "events" ? "events" : undefined, actor: f.actor, module: f.module, resource: f.resource, from: f.from, to: f.to, company: f.company, type: f.type };
  const filtered = !!(f.actor || f.module || f.resource || f.from || f.to || f.company || f.type);
  const path = `/${locale}/activity`;
  const today = dayKey(new Date(), tz);
  const dayLabels = { today: t("timeline.today"), yesterday: t("timeline.yesterday") };
  const nowMs = new Date().getTime();
  const rangeFrom = (days: number) => dayKey(new Date(nowMs - days * 86_400_000), tz);
  const activeRange = RANGES.find((r) => f.from === rangeFrom(r.days) && !f.to)?.key;
  const chip = (text: string, params: Record<string, string | undefined>, active: boolean, key: string) => (
    <Link key={key} href={`${path}${qs({ ...filterParams, cursor: undefined, ...params })}`} aria-current={active ? "true" : undefined} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", active ? "border-primary bg-accent font-medium" : "hover:bg-muted")}>
      {text}
    </Link>
  );

  const tabs = facets.all ? (
    <nav className="flex gap-1 border-b text-sm" aria-label={t("modules.activity.title")}>
      {(["audit", "events"] as const).map((v) => (
        <Link
          key={v}
          href={`${path}${v === "events" ? "?view=events" : ""}`}
          aria-current={view === v ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`activity.views.${v}`)}
        </Link>
      ))}
    </nav>
  ) : null;

  const chips = (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("timeline.when")}>
        {chip(t("timeline.anyTime"), { from: undefined, to: undefined }, !f.from && !f.to, "any")}
        {RANGES.map((r) => chip(t(`timeline.ranges.${r.key}`), { from: rangeFrom(r.days), to: undefined }, activeRange === r.key, r.key))}
      </div>
      {view === "audit" && facets.modules.length ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("activity.filters.module")}>
          {chip(t("timeline.allAreas"), { module: undefined }, !f.module, "all-modules")}
          {facets.modules.map((m) => {
            const v = moduleVisual(m);
            return (
              <Link
                key={m}
                href={`${path}${qs({ ...filterParams, cursor: undefined, module: m })}`}
                aria-current={f.module === m ? "true" : undefined}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", f.module === m ? "border-primary bg-accent font-medium" : "hover:bg-muted")}
              >
                <span aria-hidden className={cn("grid size-4 place-items-center rounded-full [&_svg]:size-2.5", v.tone)}>
                  {v.icon}
                </span>
                {label(`activity.modules.${m}`, label(`timeline.modules.${m}`, m.replace(/_/g, " ")))}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const advanced = (
    <details className="rounded-lg border bg-surface px-3 py-2" open={!!(f.actor || f.resource || f.type || f.to || f.company)}>
      <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {t("timeline.advanced")}
      </summary>
      <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
        {view === "events" ? <input type="hidden" name="view" value="events" /> : null}
        {f.module ? <input type="hidden" name="module" value={f.module} /> : null}
        {facets.all ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("activity.filters.actor")}
            <Select name="actor" defaultValue={f.actor ?? ""} className="h-8 w-44">
              <option value="">{t("common.all")}</option>
              {facets.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {view === "audit" ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("activity.filters.resource")}
            <Select name="resource" defaultValue={f.resource ?? ""} className="h-8 w-44">
              <option value="">{t("common.all")}</option>
              {facets.resources.map((r) => (
                <option key={r} value={r}>
                  {label(`activity.resources.${r}`, r.replace(/_/g, " "))}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("activity.filters.eventType")}
            <Input name="type" defaultValue={f.type ?? ""} placeholder="invoice.paid" className="h-8 w-44" />
          </label>
        )}
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("activity.filters.from")}
          <Input type="date" name="from" defaultValue={f.from ?? ""} className="h-8 w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("activity.filters.to")}
          <Input type="date" name="to" defaultValue={f.to ?? ""} className="h-8 w-40" />
        </label>
        {view === "audit" && company ? (
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" name="company" value={company.id} defaultChecked={f.company === company.id} />
            {t("activity.filters.thisCompany", { company: company.name })}
          </label>
        ) : null}
        <Button type="submit" size="sm" variant="secondary">
          {t("workforce.filters.apply")}
        </Button>
        {filtered ? (
          <Link href={`${path}${view === "events" ? "?view=events" : ""}`} className="text-sm text-muted-foreground hover:underline">
            {t("workforce.filters.clear")}
          </Link>
        ) : null}
      </form>
    </details>
  );

  // "What happened today": a real AI task reads today's log (passed in its brief) and writes a plain summary.
  const chain = company ? await companyChain(db(), org.id, company.id) : null;
  const canRun = chain ? await can(viewer.ctx, "agents.run", chain) : false;
  let summaryCard: React.ReactNode = null;
  if (company && canRun) {
    const [todays, helpTask] = await Promise.all([
      listActivity(viewer.ctx, org.id, { from: today, limit: 100 }),
      latestSubjectTask(viewer.ctx, org.id, company.id, "activity_digest", company.id),
    ]);
    const lines = todays.data.map((a) => `- ${a.createdAt.toISOString().slice(11, 16)} ${actorLabel(a.actorType, a.actorId, todays.actors)}: ${a.action}${recordLabel(a.newValue) ? ` "${recordLabel(a.newValue)}"` : ""}`);
    summaryCard = (
      <Card variant="glass">
        <CardHeader icon={<Sparkles />} title={t("timeline.digest.title")} description={t("timeline.digest.hint", { count: todays.data.length })} />
        <CardBody>
          <HelpMeButton
            base={`/api/v1/organizations/${org.id}/companies/${company.id}`}
            aiReady={aiConfigured()}
            profile="chief_of_staff"
            subject={{ type: "activity_digest", id: company.id }}
            title={`What happened today (${today})`}
            label={t("timeline.digest.button")}
            instructions={`Write a short, friendly "what happened today" summary for a non-technical founder of ${company.name}, in plain words, grouped by area (sales, money, people, marketing, support, operations, AI work). Mention the most important 5-8 things, anything that looks risky or needs their attention, and one suggested next step. Use only this activity log from today (times in UTC); do not invent anything:\n${lines.join("\n") || "- nothing was logged today yet"}`}
            initial={helpTask}
          />
        </CardBody>
      </Card>
    );
  }

  const bars = await activityByDay(viewer.ctx, org.id, 14, f.company);
  const overview = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title={t("timeline.bars.title")} description={t("timeline.bars.hint", { count: bars.reduce((a, b) => a + b.count, 0) })} />
        <CardBody>
          <ActivityBars data={bars} locale={locale} label={t("timeline.bars.title")} />
        </CardBody>
      </Card>
      {summaryCard}
    </div>
  );
  const intro = (
    <PageIntro
      labels={introLabels(t)}
      accent="info"
      what={t("timeline.intro.what")}
      why={t("timeline.intro.why")}
      can={t("timeline.intro.can")}
      next={{ label: t("timeline.intro.next"), href: `${path}${qs({ from: today })}` }}
    />
  );

  if (view === "events" && company) {
    const events = await listDomainEvents(viewer.ctx, org.id, company.id, { ...sp, limit: 50 });
    const entries: TimelineEntry[] = events.data.map((e) => {
      const data = ((e.payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
      const href = resourceHref(e.aggregateType, e.aggregateId);
      const rec = recordLabel(data) ?? label(`activity.resources.${e.aggregateType}`, e.aggregateType.replace(/_/g, " "));
      return {
        id: e.id,
        at: e.occurredAt,
        module: e.type,
        actor: actorLabel(e.actorType, e.actorId, events.actors),
        text: label(`timeline.events.${e.type.replace(/\./g, "_")}`, e.type),
        record: { label: rec, href: href ? `/${locale}${href}` : null },
        danger: /failed|lost|overdue/.test(e.type),
      };
    });
    return (
      <div className="mx-auto grid max-w-[1200px] gap-4">
        {header}
        {intro}
        {tabs}
        {chips}
        {advanced}
        <Card>
          <CardBody>{entries.length === 0 ? <p className="text-sm text-muted-foreground">{filtered ? t("common.noResults") : t("activity.empty")}</p> : <DayTimeline entries={entries} locale={locale} timeZone={tz} labels={dayLabels} />}</CardBody>
          <Pager
            prevHref={sp.cursor ? `${path}${qs(filterParams)}` : null}
            nextHref={events.nextCursor ? `${path}${qs({ ...filterParams, cursor: events.nextCursor })}` : null}
            labels={{ previous: t("activity.newest"), next: t("activity.older") }}
          />
        </Card>
      </div>
    );
  }

  const page = await listActivity(viewer.ctx, org.id, { ...sp, limit: 50 });
  const entries: TimelineEntry[] = page.data.map((a) => {
    const href = resourceHref(a.resourceType, a.resourceId);
    const record = recordLabel(a.newValue) ?? recordLabel(a.oldValue);
    const resource = label(`activity.resources.${a.resourceType}`, a.resourceType.replace(/_/g, " "));
    return {
      id: a.id,
      at: a.createdAt,
      module: a.action,
      actor: actorLabel(a.actorType, a.actorId, page.actors),
      text: label(`activity.actions.${a.action}`, t("activity.genericAction", { action: a.action })),
      record: href ? { label: record ?? resource, href: `/${locale}${href}` } : record ? { label: record, href: null } : null,
      tags: [{ label: resource }, ...(a.category === "SECURITY" ? [{ label: t("activity.security"), tone: "warning" as const }] : []), ...(a.reason ? [{ label: t("activity.reason", { reason: a.reason }) }] : [])],
      danger: a.action.includes("deleted") || a.action.includes("failed"),
    };
  });

  return (
    <div className="mx-auto grid max-w-[1200px] gap-4">
      {header}
      {intro}
      {overview}
      {tabs}
      {chips}
      {advanced}
      <Card>
        <CardBody>
          {entries.length === 0 ? (
            filtered ? (
              <p className="text-sm text-muted-foreground">{t("common.noResults")}</p>
            ) : (
              <SmartEmpty
                icon={<History />}
                title={t("timeline.empty.title")}
                body={t("timeline.empty.body")}
                primary={
                  <Button asChild size="sm">
                    <Link href={`/${locale}/tasks#composer`}>{t("missionControl.intro.next")}</Link>
                  </Button>
                }
              />
            )
          ) : (
            <DayTimeline entries={entries} locale={locale} timeZone={tz} labels={dayLabels} />
          )}
        </CardBody>
        <Pager
          prevHref={sp.cursor ? `${path}${qs(filterParams)}` : null}
          nextHref={page.nextCursor ? `${path}${qs({ ...filterParams, cursor: page.nextCursor })}` : null}
          labels={{ previous: t("activity.newest"), next: t("activity.older") }}
        />
      </Card>
    </div>
  );
}
