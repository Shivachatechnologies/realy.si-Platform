/**
 * Central plan enforcement for API routes (core/http.ts route(), after the platform-controls gate) and app pages
 * (server/workspace.ts requireOrgContext). Paths are mapped to features in ./routes-map.ts.
 */
import { featureForApiPath, featureForPagePath } from "./routes-map";
import { featureLockedError, getEntitlements, requiredPlanForFeature, type FeatureKey } from "./service";
import { EXPIRED_PLAN } from "./catalog";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Throws plan_feature_locked when the route needs a feature the organization's plan lacks, and plan_trial_expired
 * for writes to a plan feature after the no-card trial ended without a subscription (read-only until a plan is chosen).
 */
export async function entitlementApiGate(req: { pathname: string; method: string }): Promise<void> {
  const hit = featureForApiPath(req.pathname);
  if (!hit) return;
  const ent = await getEntitlements(hit.organizationId);
  if (!ent.enforced) return;
  if (!ent.features[hit.feature]) throw featureLockedError(ent, hit.feature, await requiredPlanForFeature(hit.feature));
  if (ent.state === "trial_expired" && MUTATING.has(req.method)) throw featureLockedError(ent, hit.feature, EXPIRED_PLAN, "plan_trial_expired");
}

/** Feature an app page needs that the organization lacks (the page guard redirects to /upgrade), else null. */
export async function lockedFeatureForPage(organizationId: string, pathname: string): Promise<FeatureKey | null> {
  const feature = featureForPagePath(pathname);
  if (!feature) return null;
  const ent = await getEntitlements(organizationId);
  return ent.enforced && !ent.features[feature] ? feature : null;
}
