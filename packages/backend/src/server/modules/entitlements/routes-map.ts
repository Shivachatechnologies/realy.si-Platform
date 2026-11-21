/**
 * Which plan feature an API route or app page needs (central enforcement in core/http.ts route() and
 * server/workspace.ts requireOrgContext). Pure: no imports besides the catalog types.
 *
 * Paths not listed here need no plan feature (their count limits are enforced at the creation points instead).
 * Billing, settings and entitlement routes are never mapped, so an organization can always upgrade.
 */
import type { FeatureKey } from "./catalog";

/** Org-scoped API path after /api/v1/organizations/:orgId/ (and optional companies/:companyId/). */
const API_RULES: [RegExp, FeatureKey][] = [
  [/^finance(\/|$)/, "feature.finance"],
  [/^hr(\/|$)/, "feature.hr"],
  [/^work\/(operations|projects|sprints|milestones|deliverables|kickoffs|retro|risks)(\/|$)/, "feature.projects_operations"],
  [/^support(\/|$)/, "feature.support_automation"],
  [/^voice(\/|$)/, "feature.voice_agent"],
  [/^(livechat|live-chat)(\/|$)/, "feature.live_chat"],
  [/^marketing\/(autopilots|autopilot-items)(\/|$)/, "feature.marketing_autopilot"],
  [/^marketing\/seo\/projects\/[^/]+\/autopilot(\/|$)/, "feature.marketing_autopilot"],
  [/^marketing\/(campaigns|ads)(\/|$)/, "feature.ai_campaigns"],
  [/^(marketing|crm)\/sequences(\/|$)/, "feature.email_automation"],
  [/^crm\/(discover|prospects)(\/|$)/, "feature.lead_generation"],
  [/^crm\/intel(\/|$)/, "feature.sales_intelligence"],
  [/^(crm\/)?follow-ups(\/|$)/, "feature.deal_followups"],
  [/^workflows\/(compose|describe)(\/|$)/, "feature.workflow_builder"],
  [/^analytics\/(dashboards|reports)(\/|$)/, "feature.advanced_analytics"],
  [/^growth(\/|$)/, "feature.growth_insights"],
  [/^intelligence(\/|$)/, "feature.executive_team"],
  [/^(crm|enterprise)\/export(\/|$)/, "feature.data_exports"],
  [/^sites(\/|$)/, "feature.website_builder"],
];

/** App page path after /:locale/. */
const PAGE_RULES: [RegExp, FeatureKey][] = [
  [/^finance(\/|$)/, "feature.finance"],
  [/^(hr|people)(\/|$)/, "feature.hr"],
  [/^(projects|operations)(\/|$)/, "feature.projects_operations"],
  [/^support(\/|$)/, "feature.support_automation"],
  [/^voice(\/|$)/, "feature.voice_agent"],
  [/^(livechat|live-chat)(\/|$)/, "feature.live_chat"],
  [/^marketing\/autopilot(\/|$)/, "feature.marketing_autopilot"],
  [/^marketing\/(campaigns|ads)(\/|$)/, "feature.ai_campaigns"],
  [/^marketing\/automation(\/|$)/, "feature.email_automation"],
  [/^crm\/sequences(\/|$)/, "feature.email_automation"],
  [/^crm\/discover(\/|$)/, "feature.lead_generation"],
  [/^analytics\/(dashboards|reports)(\/|$)/, "feature.advanced_analytics"],
  [/^intelligence(\/|$)/, "feature.executive_team"],
  [/^website(\/|$)/, "feature.website_builder"],
];

const ORG_API = /^\/api\/v1\/organizations\/([0-9a-f-]{36})(?:\/companies\/[0-9a-f-]{36})?\/(.+)$/;

/** { organizationId, feature } for an org-scoped API path that needs a plan feature, else null. */
export function featureForApiPath(pathname: string): { organizationId: string; feature: FeatureKey } | null {
  const m = ORG_API.exec(pathname);
  if (!m) return null;
  const rest = m[2]!;
  const hit = API_RULES.find(([re]) => re.test(rest));
  return hit ? { organizationId: m[1]!, feature: hit[1] } : null;
}

/** Feature an app page needs ("/en-US/finance/invoices" → feature.finance), else null. */
export function featureForPagePath(pathname: string): FeatureKey | null {
  const rest = pathname.split("/").filter(Boolean).slice(1).join("/");
  if (!rest) return null;
  return PAGE_RULES.find(([re]) => re.test(rest))?.[1] ?? null;
}
