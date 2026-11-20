import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/workforce/page-header";
import { PageState, Pager, qs } from "@/components/workforce/states";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getLocale, getT } from "@/i18n/server";
import { formatDateTime, formatRelativeTime } from "@/i18n/format";
import { activityFacets, activityFilters, listActivity, listDomainEvents, resourceHref } from "@/server/modules/activity/service";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

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

export default async function ActivityPage({ searchParams }: PageProps<"/[locale]/activity">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const f = activityFilters.parse(sp);
  const facets = await activityFacets(viewer.ctx, org.id);
  const header = <PageHeader title={t("modules.activity.title")} subtitle={facets.all ? t("activity.subtitleAll") : t("activity.subtitleOwn")} />;
  const view = facets.all && f.view === "events" && company ? "events" : "audit";
  const tz = viewer.user.timezone;
  const label = (key: string, fallback: string) => (t(key) === key ? fallback : t(key));
  const actorLabel = (type: string, id: string | null, names: Map<string, string>) =>
    id && names.has(id) ? names.get(id)! : type === "SYSTEM" ? t("activity.system") : type === "SERVICE_ACCOUNT" ? t("activity.integration") : type === "AGENT" ? t("activity.agent") : t("activity.unknownActor");
  const filterParams = { view: view === "events" ? "events" : undefined, actor: f.actor, module: f.module, resource: f.resource, from: f.from, to: f.to, company: f.company, type: f.type };
  const filtered = !!(f.actor || f.module || f.resource || f.from || f.to || f.company || f.type);

  const tabs = facets.all ? (
    <nav className="flex gap-1 border-b text-sm" aria-label={t("modules.activity.title")}>
      {(["audit", "events"] as const).map((v) => (
        <Link
          key={v}
          href={`/${locale}/activity${v === "events" ? "?view=events" : ""}`}
          aria-current={view === v ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2", view === v ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t(`activity.views.${v}`)}
        </Link>
      ))}
    </nav>
  ) : null;

  const filters = (
    <form method="get" className="flex flex-wrap items-end gap-2">
      {view === "events" ? <input type="hidden" name="view" value="events" /> : null}
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
        <>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("activity.filters.module")}
            <Select name="module" defaultValue={f.module ?? ""} className="h-8 w-40">
              <option value="">{t("common.all")}</option>
              {facets.modules.map((m) => (
                <option key={m} value={m}>
                  {label(`activity.modules.${m}`, m)}
                </option>
              ))}
            </Select>
          </label>
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
        </>
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
        <Link href={`/${locale}/activity${view === "events" ? "?view=events" : ""}`} className="text-sm text-muted-foreground hover:underline">
          {t("workforce.filters.clear")}
        </Link>
      ) : null}
    </form>
  );

  if (view === "events" && company) {
    const events = await listDomainEvents(viewer.ctx, org.id, company.id, { ...sp, limit: 50 });
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        {tabs}
        {filters}
        <Card>
          {events.data.length === 0 ? (
            <CardBody className="text-sm text-muted-foreground">{filtered ? t("common.noResults") : t("activity.empty")}</CardBody>
          ) : (
            <ol className="divide-y">
              {events.data.map((e) => {
                const data = ((e.payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<string, unknown>;
                const href = resourceHref(e.aggregateType, e.aggregateId);
                return (
                  <li key={e.id} className="grid gap-1 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <span className="font-mono text-xs">{e.type}</span>
                      <span className="ms-2 text-muted-foreground">{actorLabel(e.actorType, e.actorId, events.actors)}</span>
                      {href ? (
                        <Link className="ms-2 text-primary hover:underline" href={`/${locale}${href}`}>
                          {recordLabel(data) ?? label(`activity.resources.${e.aggregateType}`, e.aggregateType.replace(/_/g, " "))}
                        </Link>
                      ) : recordLabel(data) ? (
                        <span className="ms-2">{recordLabel(data)}</span>
                      ) : null}
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={e.occurredAt.toISOString()} title={formatDateTime(e.occurredAt, locale, tz)}>
                      {formatRelativeTime(e.occurredAt, locale)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
          <Pager
            prevHref={sp.cursor ? `/${locale}/activity${qs(filterParams)}` : null}
            nextHref={events.nextCursor ? `/${locale}/activity${qs({ ...filterParams, cursor: events.nextCursor })}` : null}
            labels={{ previous: t("activity.newest"), next: t("activity.older") }}
          />
        </Card>
      </div>
    );
  }

  const page = await listActivity(viewer.ctx, org.id, { ...sp, limit: 50 });
  if (!company && !page.data.length && !filtered) return <PageState header={header} kind="empty" message={t("activity.empty")} />;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      {tabs}
      {filters}
      <Card>
        {page.data.length === 0 ? (
          <CardBody className="text-sm text-muted-foreground">{filtered ? t("common.noResults") : t("activity.empty")}</CardBody>
        ) : (
          <ol className="divide-y">
            {page.data.map((a) => {
              const actor = actorLabel(a.actorType, a.actorId, page.actors);
              const actionText = label(`activity.actions.${a.action}`, t("activity.genericAction", { action: a.action }));
              const record = recordLabel(a.newValue) ?? recordLabel(a.oldValue);
              const href = resourceHref(a.resourceType, a.resourceId);
              const resource = label(`activity.resources.${a.resourceType}`, a.resourceType.replace(/_/g, " "));
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                  <span className="mt-1.5">
                    <StatusDot tone={a.category === "SECURITY" ? "warning" : a.action.includes("deleted") || a.action.includes("failed") ? "danger" : "neutral"} />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="break-words">
                      <span className="font-medium">{actor}</span> {actionText}
                      {href ? (
                        <>
                          {" · "}
                          <Link className="text-primary hover:underline" href={`/${locale}${href}`}>
                            {record ?? resource}
                          </Link>
                        </>
                      ) : record ? (
                        <span className="text-muted-foreground"> · {record}</span>
                      ) : null}
                    </p>
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge>{resource}</Badge>
                      {a.category === "SECURITY" ? <Badge tone="warning">{t("activity.security")}</Badge> : null}
                      {a.reason ? <span>{t("activity.reason", { reason: a.reason })}</span> : null}
                    </span>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()} title={formatDateTime(a.createdAt, locale, tz)}>
                    {formatRelativeTime(a.createdAt, locale)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
        <Pager
          prevHref={sp.cursor ? `/${locale}/activity${qs(filterParams)}` : null}
          nextHref={page.nextCursor ? `/${locale}/activity${qs({ ...filterParams, cursor: page.nextCursor })}` : null}
          labels={{ previous: t("activity.newest"), next: t("activity.older") }}
        />
      </Card>
    </div>
  );
}
