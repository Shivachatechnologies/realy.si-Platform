import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Brain, Building2, Clock, Database, FileText, Search, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { BrainTabs } from "@/components/brain/brain-tabs";
import { MemoryForm, MemoryItem } from "@/components/brain/memory-form";
import { MemoryGovernance } from "@/components/brain/memory-governance";
import { RetentionSettings } from "@/components/brain/retention-settings";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { db } from "@/server/core/db";
import { searchMemory } from "@/server/modules/brain/context";
import { getMemory, listMemories, type MemoryRow } from "@/server/modules/brain/memory";
import { MEMORY_LAYERS, MEMORY_SCOPES, MEMORY_SENSITIVITIES, READ_PERMISSIONS, type MemoryLayerKey, type MemoryScopeKey } from "@/server/modules/brain/memory-policy";
import { listRetention, memoryOverview, memoryStatus } from "@/server/modules/brain/memory-store";
import { listDepartments } from "@/server/modules/brain/service";
import { can, effectivePermissions } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("brain.memory.title") };
}

const PAGE = 50;
const KEYS = ["q", "layer", "scope", "sensitivity", "departmentId", "pinned", "cursor", "focus"] as const;
const LAYER_ICON: Partial<Record<string, typeof Brain>> = { COMPANY: Building2, KNOWLEDGE: BookOpen, DOCUMENT: FileText, EMPLOYEE: UserRound, CONVERSATION: Sparkles };
const chip = (active: boolean) =>
  `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${active ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:text-foreground"}`;

export default async function CompanyMemoryPage({ searchParams }: PageProps<"/[locale]/brain/memory">) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org, company } = await requireOrgContext(locale);
  const sp = await searchParams;
  const values = Object.fromEntries(KEYS.map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string).slice(0, 200) : undefined])) as Record<(typeof KEYS)[number], string | undefined>;

  const header = <PageHeader variant="editorial" world="brain" eyebrow={t("dna.worlds.brain")} title={t("modules.brain.title")} description={t("brain.memory.subtitle")} />;
  if (!company) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <Card>
          <p className="p-4 text-muted-foreground">{t("company.empty")}</p>
        </Card>
      </div>
    );
  }
  const chain = await companyChain(db(), org.id, company.id);
  const [canRead, canManage] = await Promise.all([can(viewer.ctx, "brain.read", chain), can(viewer.ctx, "brain.manage", chain)]);
  if (!canRead) {
    return (
      <div className="mx-auto grid max-w-[1400px] gap-4">
        {header}
        <BrainTabs locale={locale} active="memory" />
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </div>
    );
  }

  const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const layer = (MEMORY_LAYERS as readonly string[]).includes(values.layer ?? "") ? (values.layer as MemoryLayerKey) : undefined;
  const scope = (MEMORY_SCOPES as readonly string[]).includes(values.scope ?? "") ? (values.scope as MemoryScopeKey) : undefined;
  const sensitivity = (MEMORY_SENSITIVITIES as readonly string[]).includes(values.sensitivity ?? "") ? values.sensitivity : undefined;
  const cursor = isUuid(values.cursor);
  const focusId = isUuid(values.focus);
  const q = values.q?.trim() ?? "";
  const filters = { layer, scope, sensitivity, departmentId: isUuid(values.departmentId), pinned: values.pinned === "1" || values.pinned === "0" ? values.pinned : undefined };

  const [page, departments, overview, status, retention, perms, employees, focused, search] = await Promise.all([
    layer === "DOCUMENT" ? null : listMemories(viewer.ctx, org.id, company.id, { ...filters, cursor, limit: PAGE }),
    listDepartments(viewer.ctx, org.id, company.id),
    memoryOverview(viewer.ctx, org.id, company.id),
    memoryStatus(viewer.ctx, org.id, company.id),
    listRetention(viewer.ctx, org.id, company.id),
    effectivePermissions(viewer.ctx, chain),
    db().aiEmployee.findMany({ where: { organizationId: org.id, companyId: company.id }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
    focusId ? getMemory(viewer.ctx, org.id, company.id, focusId).catch(() => null) : Promise.resolve(null),
    q ? searchMemory(viewer.ctx, org.id, company.id, q, { layers: layer ? [layer] : undefined, scopes: scope ? [scope] : undefined }) : Promise.resolve(null),
  ]);
  const accounts =
    canManage && perms.includes("sales.read")
      ? await db().account.findMany({ where: { organizationId: org.id, companyId: company.id, archivedAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } })
      : [];
  const employeeName = new Map(employees.map((e) => [e.id, e.name]));
  const totalMemories = Object.entries(overview.layers).reduce((s, [k, n]) => (k === "DOCUMENT" ? s : s + n), 0);
  const keep = Object.fromEntries(Object.entries({ ...filters, q: q || undefined }).filter(([, v]) => v)) as Record<string, string>;
  const href = (patch: Record<string, string | undefined>) => {
    const next = Object.fromEntries(Object.entries({ ...keep, ...patch }).filter(([, v]) => v)) as Record<string, string>;
    const qs = new URLSearchParams(next).toString();
    return `/${locale}/brain/memory${qs ? `?${qs}` : ""}`;
  };
  const view = (m: MemoryRow) => ({
    id: m.id,
    title: m.title,
    fact: m.fact,
    source: m.source,
    departmentId: m.departmentId,
    pinned: m.pinned,
    layer: m.layer,
    scope: m.scope,
    sensitivity: m.sensitivity,
    readPermission: m.readPermission,
    expiresOn: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : null,
  });
  const meta = (m: MemoryRow) =>
    [
      m.scope === "EMPLOYEE" && m.aiEmployeeId ? (employeeName.get(m.aiEmployeeId) ?? t("brain.memory.scopes.EMPLOYEE")) : (m.department?.name ?? t("brain.memory.companyWide")),
      m.authorKind === "AI" ? t("brain.memory.byAi") : m.authorKind === "SYSTEM" ? t("brain.memory.bySystem") : t("brain.memory.byHuman"),
      t(`brain.memory.sourceKinds.${m.sourceKind}`),
      formatDate(m.updatedAt, locale, viewer.user.timezone),
    ].join(" · ");
  const readPermissions = canManage ? READ_PERMISSIONS.filter((p) => p !== "brain.read") : [];
  const semantic = status.mode === "hybrid";
  const { coverage } = status;
  const embedded = coverage.embeddedChunks + coverage.embeddedMemories;
  const embeddable = coverage.chunks + coverage.memories;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4">
      {header}
      <BrainTabs locale={locale} active="memory" />

      {/* Retrieval status — honest: full-text only unless an embedding provider and pgvector are both available. */}
      <Card>
        <CardHeader
          icon={<Search />}
          title={t("brain.memory.status.title")}
          description={semantic ? t("brain.memory.status.hybrid", { provider: status.provider ?? "", model: status.model ?? "" }) : t("brain.memory.status.fts")}
          actions={
            <Badge tone={semantic ? "success" : "neutral"} shape="pill">
              <StatusDot tone={semantic ? "success" : "neutral"} />
              {semantic ? t("brain.memory.status.hybridBadge") : t("brain.memory.status.ftsBadge")}
            </Badge>
          }
        />
        <CardBody className="grid gap-3">
          {status.reason === "no_provider" ? (
            <p className="text-sm text-muted-foreground">
              {t("brain.memory.status.noProvider")}{" "}
              <Link className="font-medium text-foreground underline underline-offset-2" href={`/${locale}/integrations`}>
                {t("brain.memory.status.connect")}
              </Link>
            </p>
          ) : null}
          {status.reason === "no_pgvector" ? <Notice tone="warning">{t("brain.memory.status.noPgvector", { provider: status.provider ?? "" })}</Notice> : null}
          {semantic ? (
            <div className="grid gap-1.5">
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>{t("brain.memory.status.coverage")}</span>
                <span className="tabular-nums">{t("brain.memory.status.coverageCount", { done: embedded, total: embeddable })}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={embeddable} aria-valuenow={embedded} aria-label={t("brain.memory.status.coverage")}>
                <div className="h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${embeddable ? Math.round((embedded / embeddable) * 100) : 100}%` }} />
              </div>
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [t("brain.memory.stats.facts"), totalMemories],
              [t("brain.memory.stats.documents"), overview.layers.DOCUMENT],
              [t("brain.memory.stats.private"), overview.scopes.EMPLOYEE + overview.scopes.TASK],
              [t("brain.memory.stats.expiring"), overview.expiringSoon],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      {/* Layers */}
      <nav aria-label={t("brain.memory.layersTitle")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={href({ layer: undefined, cursor: undefined })} aria-current={!layer ? "page" : undefined} className={chip(!layer)}>
          {t("brain.memory.allLayers")} <span className="tabular-nums">{totalMemories}</span>
        </Link>
        {MEMORY_LAYERS.map((l) => {
          const Icon = LAYER_ICON[l] ?? Database;
          return (
            <Link key={l} href={l === "DOCUMENT" ? `/${locale}/documents` : href({ layer: l, cursor: undefined })} aria-current={layer === l ? "page" : undefined} className={chip(layer === l)}>
              <Icon aria-hidden className="size-3.5" />
              {t(`brain.memory.layers.${l}`)}
              <span className="tabular-nums">{overview.layers[l]}</span>
            </Link>
          );
        })}
      </nav>

      {/* Search + filters */}
      <Card>
        <form role="search" action={`/${locale}/brain/memory`} className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end">
          {layer ? <input type="hidden" name="layer" value={layer} /> : null}
          <Field label={t("brain.memory.searchLabel")} htmlFor="m-q" hint={t("brain.memory.searchHint")}>
            <Input id="m-q" name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("brain.memory.searchPlaceholder")} />
          </Field>
          <Field label={t("brain.memory.scopeLabel")} htmlFor="m-scope">
            <Select id="m-scope" name="scope" defaultValue={scope ?? ""}>
              <option value="">{t("brain.memory.allScopes")}</option>
              {MEMORY_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`brain.memory.scopes.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("brain.department")} htmlFor="m-department">
            <Select id="m-department" name="departmentId" defaultValue={filters.departmentId ?? ""}>
              <option value="">{t("brain.filters.allDepartments")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("brain.memory.sensitivityLabel")} htmlFor="m-sensitivity">
            <Select id="m-sensitivity" name="sensitivity" defaultValue={sensitivity ?? ""}>
              <option value="">{t("brain.filters.all")}</option>
              {MEMORY_SENSITIVITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`brain.memory.sensitivity.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("brain.memory.pinned")} htmlFor="m-pinned">
            <Select id="m-pinned" name="pinned" defaultValue={filters.pinned ?? ""}>
              <option value="">{t("brain.filters.all")}</option>
              <option value="1">{t("brain.memory.pinnedOnly")}</option>
              <option value="0">{t("brain.memory.unpinnedOnly")}</option>
            </Select>
          </Field>
          <Button type="submit">
            <Search aria-hidden />
            {t("brain.filters.apply")}
          </Button>
        </form>
      </Card>

      {focused ? (
        <Card>
          <CardHeader title={t("brain.memory.cited")} />
          <ul>
            <MemoryItem organizationId={org.id} companyId={company.id} departments={departments} readPermissions={readPermissions} canManage={canManage} focused memory={view(focused)} meta={meta(focused)} />
          </ul>
        </Card>
      ) : null}

      {search ? (
        <Card>
          <CardHeader
            icon={<Search />}
            title={t("brain.memory.resultsTitle")}
            description={t("brain.memory.resultCount", { count: search.results.length, query: q })}
            actions={<Badge tone={search.mode === "hybrid" ? "success" : "neutral"}>{search.mode === "hybrid" ? t("brain.memory.status.hybridBadge") : t("brain.memory.status.ftsBadge")}</Badge>}
          />
          {search.results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("brain.memory.noResults")}</p>
          ) : (
            <ol className="divide-y">
              {search.results.map((r) => (
                <li key={`${r.citation.type}:${r.citation.id}`} className="grid gap-1 px-4 py-3">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="font-mono text-xs text-muted-foreground">[{r.ref}]</span>
                    <span className="min-w-0 break-words">{r.title}</span>
                    <Badge>{t(`brain.memory.layers.${r.layer}`)}</Badge>
                    {r.scope !== "COMPANY" ? <Badge tone="info">{t(`brain.memory.scopes.${r.scope}`)}</Badge> : null}
                    <Badge tone={r.matchedBy === "fts" ? "neutral" : "accent"}>{t(`brain.memory.matchedBy.${r.matchedBy}`)}</Badge>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">{r.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("brain.source")}{" "}
                    <Link className="hover:underline" href={`/${locale}${r.citation.href}`}>
                      {r.citation.type === "brain_document" ? `${r.citation.title} · ${t("brain.passage", { n: r.citation.passage ?? 1 })}` : (r.citation.source ?? r.citation.title)}
                    </Link>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader icon={<Brain />} title={t("brain.memory.new")} description={t("brain.memory.promptNote")} />
          <CardBody>
            <MemoryForm organizationId={org.id} companyId={company.id} departments={departments} readPermissions={readPermissions} />
          </CardBody>
        </Card>
      ) : (
        <Notice>{t("brain.memory.promptNote")}</Notice>
      )}

      {page ? (
        <Card>
          <CardHeader title={layer ? t(`brain.memory.layers.${layer}`) : t("brain.memory.title")} description={t("brain.memory.count", { count: page.data.length })} />
          {page.data.length === 0 ? (
            <p className="p-4 text-muted-foreground">{Object.values(filters).some(Boolean) ? t("brain.noMatches") : t("brain.memory.empty")}</p>
          ) : (
            <ul className="divide-y">
              {page.data.map((m) => (
                <MemoryItem key={m.id} organizationId={org.id} companyId={company.id} departments={departments} readPermissions={readPermissions} canManage={canManage} memory={view(m)} meta={meta(m)} />
              ))}
            </ul>
          )}
          {cursor || page.nextCursor ? (
            <div className="flex justify-between gap-2 border-t p-3">
              {cursor ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={href({ cursor: undefined })}>{t("brain.firstPage")}</Link>
                </Button>
              ) : (
                <span />
              )}
              {page.nextCursor ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={href({ cursor: page.nextCursor })}>{t("brain.nextPage")}</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Clock />} title={t("brain.memory.retention.title")} description={t("brain.memory.retention.description")} />
          <CardBody>
            <RetentionSettings organizationId={org.id} companyId={company.id} rows={retention} canManage={canManage} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<ShieldCheck />} title={t("brain.memory.forget.title")} description={t("brain.memory.forget.description")} />
          <CardBody>
            {canManage ? (
              <MemoryGovernance organizationId={org.id} companyId={company.id} accounts={accounts} employees={employees} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("brain.memory.forget.managersOnly")}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
