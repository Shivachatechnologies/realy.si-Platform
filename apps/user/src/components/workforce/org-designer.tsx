"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Play, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { FormError } from "@/components/form-error";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { useI18n } from "@/i18n/client";
import { formatMoney, formatNumber } from "@/i18n/format";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { BUSINESS_MODELS, DESIGN_GOALS, SIZE_PRESETS, WORKLOAD_KEYS, type DesignGroup, type DesignProposal, type RoleReason, type SizePreset, type WorkloadKey } from "@/server/modules/workforce/org-presets";

export interface PlanWire {
  toCreate: number;
  adopt: number;
  used: number;
  limit: number | null;
  fits: boolean;
  currentPlan: string;
  requiredPlan: string | null;
  addons: string[];
  executiveTeam: { needed: boolean; allowed: boolean };
}

export interface SavedDesignWire {
  id: string;
  name: string;
  status: "DRAFT" | "APPLYING" | "APPLIED" | "FAILED";
  proposal: DesignProposal;
  refinedProposal: DesignProposal | null;
  refineStatus: string;
  refineError: string | null;
  refineTaskId: string | null;
  appliedVariant: string | null;
  plan: PlanWire;
  refinedPlan: PlanWire | null;
  job: { id: string; status: string; total: number; created: number; skipped: number; failed: number; cursor: number; lastError: string | null } | null;
}

const PRESET_SIZE: Record<Exclude<SizePreset, "custom">, string> = { solo: "1", "5": "5", "10": "10", "25": "25", "50": "50", "100": "100", "250": "250", "500": "500", "1000": "1,000+" };

function usePrinters() {
  const { t, locale } = useI18n();
  const usd = (cents: number) => formatMoney({ amountMinor: BigInt(Math.round(cents)), currency: "USD" }, locale);
  const num = (n: number) => formatNumber(n, locale);
  const dept = (k: string) => t(`workforce.departments.${k}`);
  const role = (k: string) => t(`profiles.${k}.name`);
  const reason = (r: RoleReason) => {
    const p = r.params ?? {};
    const params: Record<string, string | number> = { ...p };
    if (typeof p.driver === "string") params.driver = t(`workforce.designer.workload.${p.driver}`);
    if (typeof p.goal === "string") params.goal = t(`workforce.designer.goals.${p.goal}`);
    for (const k of ["volume", "capacity", "people", "specialists", "span", "heads"]) if (typeof p[k] === "number") params[k] = num(p[k] as number);
    return t(`workforce.designer.reasons.${r.code}`, params);
  };
  return { t, locale, usd, num, dept, role, reason };
}

/** Organization designer: size preset + company facts → a justified org proposal; save, refine with AI, apply. */
export function OrgDesigner({ apiBase, orgId, canManage, canRun, saved }: { apiBase: string; orgId: string; canManage: boolean; canRun: boolean; saved: SavedDesignWire | null }) {
  const { t } = usePrinters();
  const router = useRouter();
  const [preset, setPreset] = useState<SizePreset>("10");
  const [custom, setCustom] = useState(15);
  const [industry, setIndustry] = useState("");
  const [model, setModel] = useState<(typeof BUSINESS_MODELS)[number]>("b2b_saas");
  const [goals, setGoals] = useState<string[]>(["grow_revenue", "customer_support"]);
  const [workload, setWorkload] = useState<Partial<Record<WorkloadKey, string>>>({});
  const [budget, setBudget] = useState("");
  const [revenue, setRevenue] = useState("");
  const [showWorkload, setShowWorkload] = useState(false);
  const [preview, setPreview] = useState<{ proposal: DesignProposal; plan: PlanWire } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const body = () => ({
    preset,
    ...(preset === "custom" ? { customHeadcount: custom } : {}),
    industry: industry.trim() || t("workforce.designer.industryDefault"),
    businessModel: model,
    goals,
    workload: Object.fromEntries(Object.entries(workload).flatMap(([k, v]) => (v && Number(v) > 0 ? [[k, Math.round(Number(v))]] : []))),
    monthlyBudgetCents: budget && Number(budget) > 0 ? Math.round(Number(budget) * 100) : null,
    monthlyRevenueTarget: revenue && Number(revenue) > 0 ? Math.round(Number(revenue)) : null,
  });

  async function run(kind: "preview" | "save", e?: FormEvent) {
    e?.preventDefault();
    setBusy(kind);
    setError(null);
    try {
      if (kind === "preview") setPreview(await api<{ proposal: DesignProposal; plan: PlanWire }>(`${apiBase}/workforce/designs/preview`, { body: body() }));
      else {
        const d = await api<{ id: string }>(`${apiBase}/workforce/designs`, { body: body() });
        setPreview(null);
        router.push(`?design=${d.id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      <Card variant="immersive">
        <CardHeader icon={<Building2 />} title={t("workforce.designer.formTitle")} description={t("workforce.designer.formHint")} />
        <CardBody>
          <form className="grid gap-5" onSubmit={(e) => run("preview", e)}>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t("workforce.designer.size")}</legend>
              <div className="flex flex-wrap gap-2">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={preset === p}
                    onClick={() => setPreset(p)}
                    className={cn("min-h-10 rounded-full border px-3.5 text-sm transition-colors", preset === p ? "border-primary bg-primary text-primary-foreground" : "bg-surface hover:bg-muted")}
                  >
                    {p === "solo" ? t("workforce.designer.presets.solo") : p === "custom" ? t("workforce.designer.presets.custom") : PRESET_SIZE[p]}
                  </button>
                ))}
              </div>
              {preset === "custom" ? (
                <Field label={t("workforce.designer.customHeadcount")} htmlFor="od-custom" className="max-w-xs">
                  <Input id="od-custom" type="number" min={1} max={5000} value={custom} onChange={(e) => setCustom(Number(e.target.value))} />
                </Field>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("workforce.designer.sizeHint")}</p>
            </fieldset>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("workforce.designer.industry")} htmlFor="od-industry" hint={t("workforce.designer.industryHint")}>
                <Input id="od-industry" value={industry} maxLength={120} onChange={(e) => setIndustry(e.target.value)} placeholder={t("workforce.designer.industryPlaceholder")} />
              </Field>
              <Field label={t("workforce.designer.businessModel")} htmlFor="od-model">
                <Select id="od-model" value={model} onChange={(e) => setModel(e.target.value as (typeof BUSINESS_MODELS)[number])}>
                  {BUSINESS_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {t(`workforce.designer.models.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("workforce.designer.revenueTarget")} htmlFor="od-revenue" hint={t("workforce.designer.revenueHint")}>
                <Input id="od-revenue" type="number" min={0} inputMode="numeric" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
              </Field>
              <Field label={t("workforce.designer.budget")} htmlFor="od-budget" hint={t("workforce.designer.budgetHint")}>
                <Input id="od-budget" type="number" min={0} inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">{t("workforce.designer.goalsLabel")}</legend>
              <div className="flex flex-wrap gap-2">
                {DESIGN_GOALS.map((g) => {
                  const on = goals.includes(g);
                  return (
                    <button key={g} type="button" aria-pressed={on} onClick={() => setGoals((list) => (on ? list.filter((x) => x !== g) : [...list, g]))} className={cn("min-h-9 rounded-md border px-3 text-sm", on ? "border-primary bg-accent text-accent-foreground" : "bg-surface hover:bg-muted")}>
                      {t(`workforce.designer.goals.${g}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-3">
              <button type="button" className="inline-flex min-h-9 items-center gap-1 justify-self-start text-sm font-medium text-primary" aria-expanded={showWorkload} onClick={() => setShowWorkload((v) => !v)}>
                <ChevronDown aria-hidden className={cn("size-4 transition-transform", showWorkload && "rotate-180")} />
                {t("workforce.designer.workloadTitle")}
              </button>
              {showWorkload ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {WORKLOAD_KEYS.map((k) => (
                    <Field key={k} label={t(`workforce.designer.workload.${k}`)} htmlFor={`od-w-${k}`}>
                      <Input id={`od-w-${k}`} type="number" min={0} inputMode="numeric" value={workload[k] ?? ""} onChange={(e) => setWorkload((w) => ({ ...w, [k]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("workforce.designer.workloadHint")}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!!busy}>
                <Wand2 aria-hidden />
                {busy === "preview" ? t("common.loading") : t("workforce.designer.preview")}
              </Button>
              {canManage ? (
                <Button type="button" variant="secondary" disabled={!!busy} onClick={() => run("save")}>
                  {busy === "save" ? t("common.saving") : t("workforce.designer.save")}
                </Button>
              ) : null}
            </div>
            <FormError error={error} />
          </form>
        </CardBody>
      </Card>
      {preview ? <ProposalView proposal={preview.proposal} plan={preview.plan} orgId={orgId} title={t("workforce.designer.previewTitle")} /> : null}
      {saved ? <SavedDesign apiBase={apiBase} orgId={orgId} design={saved} canManage={canManage} canRun={canRun} /> : null}
      {!preview && !saved ? <p className="text-sm text-muted-foreground">{t("workforce.designer.startHint")}</p> : null}
    </div>
  );
}

function SavedDesign({ apiBase, orgId, design, canManage, canRun }: { apiBase: string; orgId: string; design: SavedDesignWire; canManage: boolean; canRun: boolean }) {
  const { t, num } = usePrinters();
  const router = useRouter();
  const [variant, setVariant] = useState<"deterministic" | "refined">(design.appliedVariant === "refined" ? "refined" : "deterministic");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const proposal = variant === "refined" && design.refinedProposal ? design.refinedProposal : design.proposal;
  const plan = variant === "refined" && design.refinedPlan ? design.refinedPlan : design.plan;
  const editable = design.status === "DRAFT" || design.status === "FAILED";

  async function call(path: string, key: string, payload: unknown = {}) {
    setBusy(key);
    setError(null);
    try {
      await api(`${apiBase}/workforce/designs/${design.id}/${path}`, { body: payload });
      router.refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const job = design.job;
  const progress = job && job.total ? Math.round((job.cursor / job.total) * 100) : 0;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl">{design.name}</h2>
        <Badge tone={design.status === "APPLIED" ? "success" : design.status === "FAILED" ? "danger" : design.status === "APPLYING" ? "info" : "neutral"}>{t(`workforce.designer.status.${design.status}`)}</Badge>
        {design.refinedProposal ? (
          <div className="ms-auto flex gap-1" role="group" aria-label={t("workforce.designer.variant")}>
            {(["deterministic", "refined"] as const).map((v) => (
              <Button key={v} type="button" size="sm" variant={variant === v ? "default" : "secondary"} aria-pressed={variant === v} onClick={() => setVariant(v)}>
                {t(`workforce.designer.variants.${v}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {design.refineStatus === "running" ? <Notice tone="info">{t("workforce.designer.refining")}</Notice> : null}
      {design.refineStatus === "failed" ? <Notice tone="warning">{t("workforce.designer.refineFailed", { error: design.refineError ?? "" })}</Notice> : null}
      {job ? (
        <Card>
          <CardBody className="grid gap-2">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium">{t(`workforce.designer.job.${job.status}`)}</span>
              <span className="text-muted-foreground">{t("workforce.designer.job.counts", { created: num(job.created), skipped: num(job.skipped), failed: num(job.failed), total: num(job.total) })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t("workforce.designer.job.progress")}>
              <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
            {job.lastError ? <p className="text-xs text-danger">{t("workforce.designer.job.lastError", { error: t(`errors.reasons.${job.lastError}`) === `errors.reasons.${job.lastError}` ? job.lastError : t(`errors.reasons.${job.lastError}`) })}</p> : null}
            <p className="text-xs text-muted-foreground">{t("workforce.designer.job.hint")}</p>
          </CardBody>
        </Card>
      ) : null}
      {canManage && editable ? (
        <div className="flex flex-wrap gap-2">
          {job?.status === "FAILED" ? (
            <Button type="button" disabled={!!busy} onClick={() => call("resume", "resume")}>
              <RotateCcw aria-hidden />
              {t("workforce.designer.resume")}
            </Button>
          ) : (
            <Button type="button" disabled={!!busy || (plan.executiveTeam.needed && !plan.executiveTeam.allowed) || !plan.fits} onClick={() => window.confirm(t("workforce.designer.confirmApply", { count: proposal.total })) && call("apply", "apply", { variant })}>
              <Play aria-hidden />
              {busy === "apply" ? t("workforce.designer.applying") : t("workforce.designer.apply", { count: proposal.total })}
            </Button>
          )}
          {canRun && design.refineStatus !== "running" ? (
            <Button type="button" variant="secondary" disabled={!!busy} onClick={() => call("refine", "refine")}>
              <Sparkles aria-hidden />
              {t("workforce.designer.refine")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <FormError error={error} />
      <ProposalView proposal={proposal} plan={plan} orgId={orgId} />
    </div>
  );
}

/** A proposal: totals, plan fit (with upgrade path), departments with budgets and every role group with its reason. */
export function ProposalView({ proposal, plan, orgId, title }: { proposal: DesignProposal; plan: PlanWire; orgId: string; title?: string }) {
  const { t, usd, num, dept, role, reason } = usePrinters();
  const byDept = new Map<string, DesignGroup[]>();
  for (const g of proposal.groups) byDept.set(g.department, [...(byDept.get(g.department) ?? []), g]);
  const levels = { EXECUTIVE: 0, MANAGER: 0, SPECIALIST: 0 };
  for (const g of proposal.groups) levels[g.level] += g.count;
  return (
    <section className="grid gap-4" aria-label={title ?? t("workforce.designer.proposal")}>
      {title ? <h2 className="font-display text-xl">{title}</h2> : null}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("workforce.designer.tiles.roles")} value={num(proposal.total)} hint={t("workforce.org.summary.levels", { executives: levels.EXECUTIVE, managers: levels.MANAGER, specialists: levels.SPECIALIST })} />
        <Tile label={t("workforce.designer.tiles.cap")} value={num(proposal.cap)} hint={t("workforce.designer.tiles.demand", { demand: num(proposal.demand) })} />
        <Tile label={t("workforce.designer.tiles.cost")} value={usd(proposal.monthlyCostCents)} hint={t("workforce.designer.tiles.costHint", { perTask: usd(proposal.costPerTaskMicros / 10_000) })} />
        <Tile label={t("workforce.designer.tiles.departments")} value={num(proposal.departments.length)} hint={proposal.departments.map((d) => dept(d.key)).join(" · ")} />
      </dl>
      {proposal.notes.map((n) => (
        <Notice key={n} tone={n === "trimmed_to_preset" || n === "trimmed_for_budget" ? "warning" : "info"}>
          {t(`workforce.designer.notes.${n}`, { total: num(proposal.total), cap: num(proposal.cap), demand: num(proposal.demand) })}
        </Notice>
      ))}
      {proposal.assumptions.length ? (
        <Notice tone="info" title={t("workforce.designer.assumptionsTitle")}>
          <ul className="list-disc ps-4">
            {proposal.assumptions.map((a) => (
              <li key={a.key}>{t("workforce.designer.assumption", { what: t(`workforce.designer.workload.${a.key}`), value: num(a.value) })}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {plan.fits ? (
        <Notice tone="success">{t("workforce.designer.planFits", { create: num(plan.toCreate), adopt: num(plan.adopt), used: num(plan.used), limit: plan.limit === null ? "∞" : num(plan.limit) })}</Notice>
      ) : (
        <div className="grid gap-2">
          <Notice tone="warning">{t("workforce.designer.planExceeds", { create: num(plan.toCreate), used: num(plan.used), limit: plan.limit === null ? "∞" : num(plan.limit) })}</Notice>
          <UpgradePrompt orgId={orgId} reason="plan_limit_reached" limitKey="agents.max" used={plan.used + plan.toCreate} limit={plan.limit} requiredPlan={plan.requiredPlan} feature={null} />
        </div>
      )}
      {plan.executiveTeam.needed && !plan.executiveTeam.allowed ? <UpgradePrompt orgId={orgId} reason="plan_feature_locked" feature="feature.executive_team" limitKey={null} used={null} limit={null} requiredPlan="growth" /> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {proposal.departments.map((d) => (
          <Card key={d.key}>
            <CardHeader title={dept(d.key)} description={t("workforce.designer.deptLine", { count: num(d.headcount), cost: usd(d.monthlyCostCents) })} />
            <CardBody className="grid gap-2">
              {(byDept.get(d.key) ?? []).map((g) => (
                <div key={`${g.profileKey}-${g.level}`} className="grid gap-0.5 rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{role(g.profileKey)}</span>
                    {g.count > 1 ? <Badge tone="accent">×{num(g.count)}</Badge> : null}
                    <Badge>{t(`workforce.levels.${g.level}.name`)}</Badge>
                    <span className="ms-auto text-xs tabular-nums text-muted-foreground">{usd(g.monthlyCostCents)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{reason(g.reason)}</p>
                  {g.reason.text ? <p className="text-xs italic text-muted-foreground">“{g.reason.text}”</p> : null}
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-surface p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-display text-2xl tabular-nums">{value}</dd>
      {hint ? <dd className="truncate text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
