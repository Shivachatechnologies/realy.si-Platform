import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { UpgradePrompt, type OverviewWire } from "@/components/billing/upgrade-prompt";
import { featureLabelKey } from "@/components/billing/format";
import { getLocale, getT } from "@/i18n/server";
import { safeNext } from "@/lib/safe-next";
import { requireOrgContext } from "@/server/workspace";
import { entitlementOverview } from "@/server/modules/entitlements/offers";
import { isFeatureKey, requiredPlanForFeature } from "@/server/modules/entitlements/service";

const toWire = <T,>(v: T): OverviewWire => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** Where the page guard sends a page whose feature the plan lacks (server/workspace.ts entitlementPageGate). */
export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ feature?: string; from?: string }> }) {
  const locale = await getLocale();
  const t = await getT(locale);
  const { viewer, org } = await requireOrgContext(locale);
  const sp = await searchParams;
  const feature = sp.feature && isFeatureKey(sp.feature) ? sp.feature : null;
  const [overview, requiredPlan] = await Promise.all([entitlementOverview(viewer.ctx, org.id), feature ? requiredPlanForFeature(feature) : null]);
  const unlocked = feature ? overview.features[feature] : false;
  const back = safeNext(sp.from ?? null, `/${locale}`);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader variant="editorial" eyebrow={t("billing.title")} title={t("upgrade.pageTitle")} description={feature ? t(featureLabelKey(feature)) : undefined} illustration={false} />
      {unlocked ? (
        <p className="text-sm text-muted-foreground">
          {t("upgrade.nowIncluded")}{" "}
          <Link href={back} className="text-primary hover:underline">
            {t("upgrade.back")}
          </Link>
        </p>
      ) : (
        <UpgradePrompt orgId={org.id} variant="page" reason={overview.state === "trial_expired" ? "plan_trial_expired" : "plan_feature_locked"} feature={feature} requiredPlan={requiredPlan} initial={toWire(overview)} />
      )}
    </div>
  );
}
