import { JourneyRail } from "@/components/builder/journey-rail";
import { JourneyStageView } from "@/components/builder/journey-stage";
import { getProgress, JOURNEY, SETUP_STEPS } from "@/server/modules/builder/journey";
import { companyChain } from "@/server/modules/rbac/scope";
import { OnboardingWizard, WIZARD_STEPS, type PlanOption, type WizardStep } from "@/components/builder/onboarding-wizard";
import { getLocale, getT } from "@/i18n/server";
import { db } from "@/server/core/db";
import { getActiveSubscription } from "@/server/modules/billing/service";
import { listCompanies } from "@/server/modules/companies/service";
import { companyFormOptions } from "@/server/modules/globalization/options";
import { getPublicPricing } from "@/server/modules/pricing/service";
import { can } from "@/server/modules/rbac/service";
import { orgChain } from "@/server/modules/rbac/scope";
import { getWorkspaceContext, requireViewer } from "@/server/session";

/** Signup onboarding wizard (profile → workspace → plan → business → questions) that ends in the AI Company Builder. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const viewer = await requireViewer(locale);
  const { org, preferredCompanyId } = await getWorkspaceContext(viewer.user.id);
  const sp = await searchParams;
  const progress = await getProgress(viewer.ctx);
  const labels = JOURNEY.map((k) => t(`builder.journey.stages.${k}.short`));
  const header = (current: number, reachable: number) => (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{t("builder.onboarding.title")}</h1>
        <p className="text-muted-foreground">{t("builder.onboarding.subtitle")}</p>
      </div>
      <JourneyRail locale={locale} stages={JOURNEY} current={current} reachable={reachable} labels={labels} progressLabel={t("builder.onboarding.progress")} />
    </div>
  );

  // Stages 3–10 follow the founder's builder run (resume at the saved stage unless a stage or setup step is asked for).
  const run = org && progress?.runId ? await db().builderRun.findFirst({ where: { id: progress.runId, organizationId: org.id }, select: { id: true, companyId: true } }) : null;
  const askedStage = typeof sp.stage === "string" ? Number(sp.stage) : NaN;
  if (run && typeof sp.step !== "string") {
    const stage = Math.min(JOURNEY.length, Math.max(3, Number.isInteger(askedStage) ? askedStage : (progress?.stage ?? 3)));
    const chain = await companyChain(db(), org!.id, run.companyId);
    if (await can(viewer.ctx, "companies.read", chain)) {
      return (
        <div className="mx-auto grid max-w-4xl gap-4">
          {header(stage, JOURNEY.length)}
          <JourneyStageView ctx={viewer.ctx} t={t} locale={locale} organizationId={org!.id} companyId={run.companyId} runId={run.id} stage={stage} canManage={await can(viewer.ctx, "companies.manage", chain)} />
        </div>
      );
    }
  }
  const options = await companyFormOptions();

  const companies = org ? (await listCompanies(viewer.ctx, org.id, { limit: 200 })).data : [];
  const runs = org && companies.length
    ? await db().builderRun.findMany({ where: { organizationId: org.id, companyId: { in: companies.map((c) => c.id) } }, select: { companyId: true }, distinct: ["companyId"] })
    : [];
  const withRun = new Set(runs.map((r) => r.companyId));
  const current = companies.find((c) => c.id === preferredCompanyId) ?? companies[0] ?? null;

  const canSeeBilling = org ? await can(viewer.ctx, "billing.read", orgChain(org.id)) : false;
  const subscription = org && canSeeBilling ? await getActiveSubscription(viewer.ctx, org.id) : null;
  const billingCountry = org ? ((await db().billingProfile.findUnique({ where: { organizationId: org.id }, select: { billingCountryCode: true } }))?.billingCountryCode ?? null) : null;
  const pricing = await getPublicPricing(billingCountry ?? viewer.user.countryCode ?? "US", "MONTH");
  const plans: PlanOption[] = pricing.map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description ?? null,
    price: p.resolution.available
      ? { amountMinor: p.resolution.price.money.amountMinor.toString(), currency: p.resolution.price.money.currency, interval: p.resolution.price.interval, trialDays: p.resolution.price.trialDays }
      : null,
  }));

  const asked = typeof sp.step === "string" && (WIZARD_STEPS as readonly string[]).includes(sp.step) ? (sp.step as WizardStep) : null;
  // A fresh signup starts at the profile; members who already have a workspace jump to choosing a business.
  // Returning users skip the setup steps they finished.
  const done = new Set(progress?.done ?? []);
  const firstOpen = SETUP_STEPS.find((x) => !done.has(x) && !(x === "workspace" && org)) ?? "business";
  let initialStep: WizardStep = asked ?? (progress?.wizardStep && !done.has(progress.wizardStep) ? (progress.wizardStep as WizardStep) : firstOpen);
  if (!org && initialStep !== "profile") initialStep = "workspace";

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      {header(initialStep === "business" || initialStep === "questions" ? 2 : 1, run ? JOURNEY.length : 2)}
      <OnboardingWizard
        initialStep={initialStep}
        user={{ name: viewer.user.name, locale: viewer.user.locale, timezone: viewer.user.timezone, countryCode: viewer.user.countryCode }}
        org={org ? { id: org.id, name: org.name } : null}
        companies={companies.map((c) => ({ id: c.id, name: c.name, hasRun: withRun.has(c.id) }))}
        currentCompany={current ? { id: current.id, name: current.name } : null}
        countries={options.countries.map((c) => ({ code: c.code, defaultCurrency: c.defaultCurrency, defaultTimezone: c.defaultTimezone }))}
        currencies={options.currencies}
        plans={plans}
        subscription={
          subscription
            ? { planName: subscription.plan.name, status: subscription.status, trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null, currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null }
            : null
        }
        canSeeBilling={canSeeBilling}
      />
    </div>
  );
}
