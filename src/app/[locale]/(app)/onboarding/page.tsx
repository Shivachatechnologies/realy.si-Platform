import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BookOpenText, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { STEP_TONE } from "@/components/builder/frame";
import { LiveRefresh } from "@/components/builder/run-controls";
import { JourneyRail, StageIntro } from "@/components/onboarding/journey-rail";
import { WelcomeStage } from "@/components/onboarding/welcome-stage";
import { VisionStage, type VisionValue } from "@/components/onboarding/vision-stage";
import { AddRunDocuments } from "@/components/onboarding/documents";
import { IntelligenceStage } from "@/components/onboarding/intelligence-stage";
import { BlueprintStage } from "@/components/onboarding/blueprint-stage";
import { WorkforceStage, type RoleOption } from "@/components/onboarding/workforce-stage";
import { LaunchStage } from "@/components/onboarding/launch-stage";
import { StageGo } from "@/components/onboarding/stage-go";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { WORKFLOW_TEMPLATES } from "@/server/modules/automation/templates";
import { getProgress, isJourneyStage, JOURNEY, type JourneyStage } from "@/server/modules/builder/journey";
import { aiAvailability, journeyView, researchProvider } from "@/server/modules/builder/journey-view";
import type { Blueprint, WorkforcePlan } from "@/server/modules/builder/steps";
import { listCompanies } from "@/server/modules/companies/service";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import { defaultLevelFor, departmentOf } from "@/server/modules/workforce/service";
import { getWorkspaceContext, requireViewer } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("onboarding.journey.title") };
}

const DONE = new Set(["COMPLETED", "SKIPPED"]);

/**
 * The onboarding journey (6 stages): welcome → vision → intelligence → company blueprint → AI workforce → launch.
 * New users (no workspace, no company, or an unfinished journey run) land here and resume at their saved stage;
 * returning users and existing companies go straight to the Command Center. `?new=1` (or the legacy `?step=…`)
 * starts the journey for another business.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { org } = await getWorkspaceContext(viewer.user.id);
  const sp = await searchParams;
  const asked = isJourneyStage(sp.stage) ? sp.stage : null;
  const fresh = sp.new === "1" || typeof sp.step === "string";
  const progress = await getProgress(viewer.ctx);
  const companies = org ? (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data : [];

  const saved = progress?.runId && org && !fresh ? await db().builderRun.findFirst({ where: { id: progress.runId, organizationId: org.id }, select: { id: true, companyId: true, journey: true, status: true } }) : null;
  const run = saved && saved.journey && saved.status !== "CANCELLED" ? saved : null;

  // Returning users and members of existing companies never repeat the journey.
  if (!fresh && org && companies.length && !asked && (!run || progress?.completedAt)) redirect(`/${locale}`);

  const chain = run ? await companyChain(db(), org!.id, run.companyId) : null;
  const canRead = chain ? await can(viewer.ctx, "companies.read", chain) : false;
  const view = run && canRead ? await journeyView(viewer.ctx, org!.id, run.companyId, run.id) : null;
  const stepDone = (s: { status: string } | null | undefined) => !!s && DONE.has(s.status);

  // How far the founder can go: setup (1–2) until the run exists, then research and blueprint, then what was approved.
  const reachable = !org ? 1 : !view ? 2 : !stepDone(view.blueprint.step) ? 4 : !stepDone(view.workforce.step) ? 5 : 6;
  const savedStage = isJourneyStage(progress?.journeyStage) && !fresh ? (progress!.journeyStage as JourneyStage) : null;
  const pick = (s: JourneyStage | null) => (s && JOURNEY.indexOf(s) + 1 <= reachable ? s : null);
  const stage: JourneyStage = pick(asked) ?? pick(savedStage) ?? (view ? JOURNEY[reachable <= 4 ? 2 : reachable - 1]! : org ? "vision" : "welcome");
  const n = JOURNEY.indexOf(stage) + 1;
  const labels = JOURNEY.map((k) => t(`onboarding.journey.stages.${k}.short`));
  const base = run ? `/api/v1/organizations/${org!.id}/companies/${run.companyId}/builder/runs/${run.id}` : "";
  const canManage = chain ? await can(viewer.ctx, "companies.manage", chain) : false;
  const intro = (
    <StageIntro
      eyebrow={t("onboarding.journey.stageOf", { n, total: JOURNEY.length, name: labels[n - 1]! })}
      title={t(`onboarding.journey.stages.${stage}.title`)}
      what={t(`onboarding.journey.stages.${stage}.what`)}
      ai={t(`onboarding.journey.stages.${stage}.ai`)}
      next={t(`onboarding.journey.stages.${stage}.next`)}
      labels={{ what: t("onboarding.journey.guide.what"), ai: t("onboarding.journey.guide.ai"), next: t("onboarding.journey.guide.next") }}
    />
  );
  const frame = (body: ReactNode, withIntro = true) => (
    <div className="mx-auto grid w-full max-w-5xl gap-5 pb-8">
      <JourneyRail locale={locale} stages={JOURNEY} current={n} reachable={reachable} labels={labels} label={t("onboarding.journey.progress")} />
      {withIntro ? intro : null}
      {body}
    </div>
  );

  if (run && !canRead) return frame(<Notice tone="warning">{t("onboarding.journey.noAccess")}</Notice>);

  if (stage === "welcome") {
    const options = await companyFormOptions();
    return frame(
      <WelcomeStage
        user={{ name: viewer.user.name, locale: viewer.user.locale, timezone: viewer.user.timezone, countryCode: viewer.user.countryCode }}
        org={org ? { id: org.id, name: org.name } : null}
        countries={options.countries.map((c) => c.code)}
        resumeStage={view ? (savedStage && savedStage !== "welcome" ? savedStage : "intelligence") : null}
      />,
      false,
    );
  }

  if (stage === "vision" && !view) {
    if (!org) redirect(`/${locale}/onboarding?stage=welcome`);
    const options = await companyFormOptions();
    return frame(
      <VisionStage
        org={{ id: org.id, name: org.name }}
        draft={(progress?.draft.vision as VisionValue | undefined) ?? null}
        countries={options.countries.map((c) => ({ code: c.code, defaultCurrency: c.defaultCurrency, defaultTimezone: c.defaultTimezone }))}
        currencies={options.currencies}
        userCountry={viewer.user.countryCode}
      />,
    );
  }

  if (!view) return frame(<Notice tone="info">{t("onboarding.journey.noRun")}</Notice>);
  const ai = await aiAvailability(org!.id);

  if (stage === "vision") {
    const brief = view.run.brief;
    const docs = view.sources.filter((s) => s.kind === "document" || s.kind === "website_page");
    const facts: [string, string | undefined][] = [
      ["builder.brief.industry", brief.industry],
      ["builder.brief.country", brief.countryCode],
      ["builder.brief.website", brief.websiteUrl],
      ["builder.brief.businessModel", brief.businessModel ? t(`builder.models.${brief.businessModel}`) : undefined],
      ["builder.brief.targetMarket", brief.targetMarket],
      ["builder.brief.goals", brief.goals],
    ];
    return frame(
      <div className="grid gap-4">
        <section className="grid gap-3 rounded-[1.75rem] border bg-surface/60 p-4 shadow-elev-2 backdrop-blur sm:p-6">
          <h2 className="font-display text-2xl">{view.run.companyName}</h2>
          <p className="text-sm whitespace-pre-line">{brief.idea || t("onboarding.journey.vision.fromSources")}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="rounded-xl border bg-surface px-3 py-2">
                  <dt className="text-[11px] text-muted-foreground">{t(k)}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="grid gap-3 rounded-2xl border bg-surface/80 p-4">
          <h2 className="text-sm font-semibold">{t("onboarding.journey.vision.docs.title", { count: docs.length })}</h2>
          {docs.length ? (
            <ul className="grid gap-1.5 text-sm">
              {docs.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  {s.kind === "website_page" ? <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <BookOpenText className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  {s.brainDocumentId ? (
                    <Link className="min-w-0 truncate hover:underline" href={`/${locale}/brain/${s.brainDocumentId}`}>
                      {s.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate">{s.title}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{t(`builder.sourceStatus.${s.status}`)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {canManage && view.run.status !== "COMPLETED" ? <AddRunDocuments base={base} /> : null}
        </section>
        <div className="flex justify-end">
          <StageGo to="intelligence">{t("onboarding.journey.toIntelligence")}</StageGo>
        </div>
      </div>,
    );
  }

  if (stage === "intelligence") {
    return frame(<IntelligenceStage t={t} locale={locale} timezone={viewer.user.timezone} v={view} ai={ai} provider={await researchProvider(org!.id, run!.companyId)} base={base} canManage={canManage} />);
  }

  if (stage === "blueprint") {
    const bp = view.blueprint;
    const draft = progress?.draft.blueprint?.runId === run!.id ? progress.draft.blueprint.value : null;
    const manual = sp.manual === "1";
    const mode = bp.approved ? "approved" : draft ? "draft" : bp.proposal ? "proposal" : manual || !ai.ok ? "manual" : "waiting";
    const initial: Blueprint | null = bp.approved ?? draft ?? bp.proposal ?? null;
    const summary = (bp.step?.status === "COMPLETED" ? bp.step.result : null) as Record<string, { created?: number; skipped?: number; forbidden?: string }> | null;
    return frame(
      <>
        <LiveRefresh base={base} active={view.run.status === "RUNNING" && mode === "waiting"} />
        <BlueprintStage
          key={`${mode}:${bp.decisionId ?? ""}`}
          base={base}
          runId={run!.id}
          companyName={view.run.companyName}
          canManage={canManage}
          aiOk={ai.ok}
          mode={mode}
          initial={initial}
          summary={summary}
          decisionId={bp.decisionId}
          stepStatus={bp.step?.status ?? null}
          stepError={bp.step?.errorMessage ?? null}
          stepId={bp.step?.id ?? null}
          templates={WORKFLOW_TEMPLATES.map((x) => ({ key: x.key, trigger: x.definition.trigger.type === "event" ? x.definition.trigger.event : x.definition.trigger.type, name: t(`workflows.templates.${x.key}.name`) }))}
        />
      </>,
    );
  }

  if (stage === "workforce") {
    const wf = view.workforce;
    const canHire = canManage && (await can(viewer.ctx, "agents.manage", chain!));
    const draft = progress?.draft.workforce?.runId === run!.id ? progress.draft.workforce.value : null;
    const done = stepDone(wf.step);
    // After hiring, the chart shows the real AI employees with their reporting lines.
    const keyOf = (id: string) => id.replace(/-/g, "").slice(0, 40);
    const hiredPlan: WorkforcePlan = {
      team: view.employees.map((e) => ({ key: keyOf(e.id), profile: e.profileKey, name: e.name, title: e.jobTitle ?? undefined, level: e.level, reportsTo: e.managerEmployeeId ? keyOf(e.managerEmployeeId) : null, responsibilities: e.responsibilities.slice(0, 10), goals: e.goals.slice(0, 10) })),
    };
    const failed = wf.step?.status === "FAILED" || view.run.status === "FAILED";
    const mode = done ? "approved" : draft ? "draft" : wf.proposal ? "proposal" : !ai.ok || failed ? "starter" : "waiting";
    const initial = done ? hiredPlan : (draft ?? wf.proposal ?? wf.starter);
    const approved = view.blueprint.approved;
    const goals = [...(approved?.goals.map((g) => g.title) ?? []), ...(approved?.objectives.map((o) => o.title) ?? [])];
    const roles: RoleOption[] = AGENT_PROFILES.map((p) => ({ key: p.key, name: t(`profiles.${p.key}.name`), department: departmentOf(p.key), level: defaultLevelFor(p.key) })).sort((a, b) => a.name.localeCompare(b.name, locale));
    const result = (wf.step?.result ?? null) as { aiEmployees?: { created: number; skipped: number } } | null;
    return frame(
      <>
        <LiveRefresh base={base} active={view.run.status === "RUNNING" && mode === "waiting"} />
        <WorkforceStage
          key={`${mode}:${wf.decisionId ?? ""}`}
          base={base}
          runId={run!.id}
          canHire={canHire}
          aiOk={ai.ok}
          mode={mode}
          initial={initial}
          roles={roles}
          goals={goals}
          decisionId={wf.decisionId}
          stepStatus={wf.step?.status ?? null}
          stepError={wf.step?.errorMessage ?? null}
          stepId={wf.step?.id ?? null}
          hired={done ? (result?.aiEmployees ?? null) : null}
        />
      </>,
    );
  }

  return frame(
    <>
      <LiveRefresh base={base} active={view.run.status === "RUNNING"} />
      <LaunchStage
        companyName={view.run.companyName}
        records={view.records}
        employees={view.employees.map((e) => ({ id: e.id, name: e.name, profileKey: e.profileKey, department: e.department, status: e.status }))}
        later={view.later.map((s) => ({ id: s.id, key: s.key, status: s.status as keyof typeof STEP_TONE }))}
      />
      {progress?.completedAt ? (
        <p className="text-center text-xs text-muted-foreground">
          <Button asChild variant="link" size="sm">
            <Link href={`/${locale}/builder/${run!.id}`}>{t("builder.journey.fullWorkspace")}</Link>
          </Button>
        </p>
      ) : null}
    </>,
  );
}
