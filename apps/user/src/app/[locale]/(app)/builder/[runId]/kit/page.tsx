import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BrainCircuit, Briefcase, Compass, Rocket, Palette } from "lucide-react";
import { BuilderFrame } from "@/components/builder/frame";
import { LiveRefresh } from "@/components/builder/run-controls";
import { ExportKitButton, KIT_TONE, KitItemPanel, StartKitButton, type KitItemProps } from "@/components/builder/kit/kit-item";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { assetFileUrl } from "@/server/modules/assets/presets";
import { getKitView } from "@/server/modules/builder/kit";
import { KIT_KEYS, PRICE_INTERVALS, REVENUE_TYPES } from "@/server/modules/builder/kit-defs";
import { ORG_LEVELS } from "@/server/modules/builder/steps";
import { CHANNELS } from "@/server/modules/marketing/common";
import { PRIORITIES } from "@/server/modules/marketplace/manifest";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { requireOrgContext } from "@/server/workspace";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("builder.kit.title") };
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const CHAPTERS = [
  { key: "understand", icon: Compass, items: ["idea_refinement", "market_research", "competitor_research", "customer_personas"] },
  { key: "business", icon: Briefcase, items: ["business_model_canvas", "revenue_model", "pricing", "financial_forecast", "business_plan"] },
  { key: "brand", icon: Palette, items: ["brand_positioning", "name_ideas", "logo", "website_structure"] },
  { key: "launch", icon: Rocket, items: ["marketing_strategy", "sales_strategy", "launch_roadmap", "ai_workforce"] },
] as const;

/** Permission each "Turn this into action" needs (the owning service checks it again). */
const ACTION_PERMISSION: Record<string, string> = {
  create_project: "projects.manage",
  create_objectives: "objectives.manage",
  create_campaigns: "marketing.manage",
  save_icp: "sales.manage",
  save_strategy: "objectives.manage",
  create_budgets: "finance.manage",
  create_products: "graph.manage",
  use_workforce: "companies.manage",
  use_name: "companies.manage",
  pin_logo: "brain.manage",
};

/** /builder/[runId]/kit — the Founder Kit: every deliverable with its progress, review (edit, regenerate, approve) and actions. */
export default async function FounderKitPage({ params, searchParams }: PageProps<"/[locale]/builder/[runId]/kit">) {
  const { runId } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  if (!isUuid(runId)) notFound();
  const row = await db().builderRun.findFirst({ where: { id: runId, organizationId: org.id }, select: { companyId: true } });
  if (!row) notFound();
  const chain = await companyChain(db(), org.id, row.companyId);
  const perms = [...new Set(["companies.read", "companies.manage", ...Object.values(ACTION_PERMISSION)])];
  const allowed = new Map(await Promise.all(perms.map(async (p) => [p, await can(viewer.ctx, p, chain)] as const)));
  if (!allowed.get("companies.read")) {
    return (
      <BuilderFrame locale={locale} active="run" title={t("builder.kit.title")}>
        <Notice tone="warning">{t("errors.forbidden")}</Notice>
      </BuilderFrame>
    );
  }
  const canManage = !!allowed.get("companies.manage");
  const gates = Object.fromEntries(Object.entries(ACTION_PERMISSION).map(([a, p]) => [a, !!allowed.get(p)]));
  const v = await getKitView(viewer.ctx, org.id, row.companyId, runId);
  const base = `/api/v1/organizations/${org.id}/companies/${row.companyId}/builder/runs/${runId}`;
  const items = v.items;
  const readyCount = items.filter((i) => i.status === "READY").length;
  const approvedCount = items.filter((i) => i.approvedAt).length;
  const live = items.some((i) => i.status === "PENDING" || i.status === "GENERATING");
  const pct = items.length ? Math.round((readyCount / items.length) * 100) : 0;
  const label = (k: string) => t(`builder.kit.items.${k}.title`);
  const requested = typeof sp.item === "string" ? sp.item : null;
  const selected = items.find((i) => i.key === requested) ?? items.find((i) => i.status === "READY" && !i.approvedAt) ?? items.find((i) => i.status === "GENERATING") ?? items[0] ?? null;
  const backLink = (
    <Button asChild size="sm" variant="ghost">
      <Link href={`/${locale}/builder/${runId}`}>
        <ArrowLeft aria-hidden className="rtl:rotate-180" />
        {t("builder.kit.backToRun")}
      </Link>
    </Button>
  );

  const frame = (children: React.ReactNode, actions?: React.ReactNode) => (
    <BuilderFrame
      locale={locale}
      active="run"
      title={t("builder.kit.titleFor", { name: v.run.companyName })}
      description={t("builder.kit.description")}
      meta={
        items.length ? (
          <>
            <Badge tone={readyCount === items.length ? "success" : "info"} pulse={live}>
              {t("builder.kit.readyCount", { ready: readyCount, total: items.length })}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">{t("builder.kit.approvedCount", { count: approvedCount })}</span>
          </>
        ) : null
      }
      actions={actions ?? backLink}
    >
      {children}
    </BuilderFrame>
  );

  const availability = (
    <>
      {!v.availability.ai ? <Notice tone="warning" title={t("builder.kit.availability.aiTitle")}>{t("builder.kit.availability.ai")}</Notice> : null}
      {v.availability.aiRefusal ? <Notice tone="warning" title={t("builder.kit.availability.aiOffTitle")}>{t(`errors.reasons.${v.availability.aiRefusal}`)}</Notice> : null}
      {!v.availability.research && items.some((i) => (i.key === "competitor_research" || i.key === "market_research") && i.status !== "READY") ? (
        <Notice tone="info" action={<Button asChild size="sm" variant="secondary"><Link href={`/${locale}/integrations`}>{t("builder.kit.connect")}</Link></Button>}>
          {t("builder.kit.availability.research")}
        </Notice>
      ) : null}
    </>
  );

  if (!v.started) {
    return frame(
      <Card variant="highlight" className="overflow-hidden">
        <CardBody className="grid gap-5 p-6 sm:p-8">
          <div className="grid gap-2">
            <h2 className="font-display text-2xl">{t("builder.kit.empty.title")}</h2>
            <p className="max-w-2xl text-muted-foreground">{t("builder.kit.empty.description")}</p>
          </div>
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {KIT_KEYS.map((k) => (
              <li key={k} className="flex items-center gap-2 rounded-md border bg-surface-2/50 px-3 py-2">
                <StatusDot tone="neutral" />
                {label(k)}
              </li>
            ))}
          </ul>
          {availability}
          {canManage ? <StartKitButton base={base} /> : <Notice tone="info">{t("builder.kit.empty.noPermission")}</Notice>}
        </CardBody>
      </Card>,
    );
  }

  const exportText = [
    `# ${v.run.companyName} — Founder Kit`,
    "",
    ...items.filter((i) => i.status === "READY" && i.content && i.key !== "logo").flatMap((i) => [`\n---\n\n# ${label(i.key)}`, "", i.content!]),
  ].join("\n");

  const logoIds = ((selected?.key === "logo" ? (selected.data as { assetIds?: string[] } | null)?.assetIds : null) ?? []).filter((x) => typeof x === "string");
  const ringR = 26;
  const ringC = 2 * Math.PI * ringR;

  return frame(
    <>
      <LiveRefresh base={`${base}/kit`} active={live} />
      <section className="grid gap-4 rounded-2xl border bg-surface p-4 sm:grid-cols-[auto_1fr] sm:items-center sm:p-5">
        <div className="relative grid size-20 place-items-center" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={readyCount} aria-label={t("builder.kit.progress")}>
          <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="32" cy="32" r={ringR} fill="none" strokeWidth="6" className="stroke-muted" />
            <circle cx="32" cy="32" r={ringR} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-[var(--primary)] transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - pct / 100)} />
          </svg>
          <span className="font-display text-lg tabular-nums">{pct}%</span>
        </div>
        <div className="grid gap-2">
          <p className="text-sm">{live ? t("builder.kit.liveNote") : readyCount === items.length ? t("builder.kit.doneNote") : t("builder.kit.stuckNote")}</p>
          <div className="flex flex-wrap gap-1" aria-hidden>
            {items.map((i) => (
              <span key={i.key} className={cn("h-1.5 w-6 rounded-full", i.status === "READY" ? (i.approvedAt ? "bg-success" : "bg-primary") : i.status === "GENERATING" ? "animate-pulse bg-info motion-reduce:animate-none" : i.status === "FAILED" ? "bg-danger" : i.status === "NEEDS_SETUP" ? "bg-warning" : "bg-muted")} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {readyCount ? <ExportKitButton filename={`${v.run.companyName.replace(/[^\p{L}\p{N}]+/gu, "-")}-founder-kit.md`} text={exportText} /> : null}
            {v.run.journey ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/${locale}/onboarding`}>{t("builder.kit.toJourney")}</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${locale}/brain?tag=founder-kit`}>
                <BrainCircuit aria-hidden />
                {t("builder.kit.allInBrain")}
              </Link>
            </Button>
          </div>
        </div>
      </section>
      {availability}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
        <nav aria-label={t("builder.kit.title")} className="grid gap-3 rounded-2xl border bg-surface p-3 lg:sticky lg:top-4">
          {CHAPTERS.map((c) => {
            const Icon = c.icon;
            const chapterItems = items.filter((i) => (c.items as readonly string[]).includes(i.key));
            return (
              <div key={c.key} className="grid gap-1">
                <div className="flex items-center gap-2 px-2 pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <Icon className="size-3.5" aria-hidden />
                  {t(`builder.kit.chapters.${c.key}`)}
                  <span className="ms-auto tabular-nums">
                    {chapterItems.filter((i) => i.status === "READY").length}/{chapterItems.length}
                  </span>
                </div>
                <ul className="grid">
                  {chapterItems.map((i) => (
                    <li key={i.key}>
                      <Link
                        href={`/${locale}/builder/${runId}/kit?item=${i.key}`}
                        scroll={false}
                        aria-current={selected?.key === i.key ? "page" : undefined}
                        className={cn("flex min-h-10 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted", selected?.key === i.key && "bg-accent/60 font-medium")}
                      >
                        <StatusDot tone={i.approvedAt ? "success" : KIT_TONE[i.status] === "success" ? "info" : KIT_TONE[i.status]} pulse={i.status === "GENERATING"} />
                        <span className="min-w-0 flex-1 truncate">{label(i.key)}</span>
                        <span className="text-[11px] text-muted-foreground">{i.approvedAt ? t("builder.kit.approvedShort") : t(`builder.kit.statusShort.${i.status}`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <Card>
          <CardBody className="p-4 sm:p-6">
            {selected ? (
              <KitItemPanel
                key={selected.key}
                item={
                  {
                    key: selected.key,
                    kind: selected.kind,
                    deps: selected.deps,
                    actions: selected.actions,
                    hasSchema: selected.hasSchema,
                    status: selected.status,
                    content: selected.content,
                    data: selected.data,
                    edited: selected.edited,
                    approved: !!selected.approvedAt,
                    feedback: selected.feedback,
                    brainDocumentId: selected.brainDocumentId,
                    records: selected.records,
                    errorCode: selected.errorCode,
                    errorMessage: selected.errorMessage,
                    errorIssues: selected.errorIssues,
                    taskId: selected.task?.id ?? null,
                    taskStatus: selected.task?.status ?? null,
                  } satisfies KitItemProps
                }
                base={base}
                canManage={canManage}
                gates={gates}
                enums={{ type: REVENUE_TYPES, interval: PRICE_INTERVALS, priority: PRIORITIES, level: ORG_LEVELS, channels: CHANNELS }}
                companyName={v.run.companyName}
                logoUrls={logoIds.map((id) => ({ id, url: assetFileUrl(org.id, row.companyId, id) }))}
                depLabels={selected.deps.map((d) => ({ key: d, label: label(d), ready: items.find((i) => i.key === d)?.status === "READY" }))}
                journey={v.run.journey}
              />
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>,
  );
}
