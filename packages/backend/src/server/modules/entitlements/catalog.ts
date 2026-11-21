/**
 * Realy plan catalog — the single source of truth for plans, feature keys and limit keys (docs/entitlements.md).
 *
 * Pure data, no imports: safe for server code, the seed, the worker and client components (pricing comparison).
 * The database (Plan / PlanEntitlement / Price / PriceVersion) is seeded from this file and can then be edited by
 * administrators; resolution (./service.ts) reads the database first and falls back to these defaults.
 */

export const PLAN_KEYS = ["starter", "growth", "scale"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const planRank = (k: string): number => (PLAN_KEYS as readonly string[]).indexOf(k);
export const isPlanKey = (k: string): k is PlanKey => planRank(k) >= 0;

/** Plans that existed before this catalog (dev seed / early customers) resolve to the nearest catalog plan. */
export const LEGACY_PLAN_MAP: Record<string, PlanKey> = { founder: "starter", enterprise: "scale" };
export const catalogPlanOf = (planKey: string | null | undefined): PlanKey =>
  planKey && isPlanKey(planKey) ? planKey : (planKey && LEGACY_PLAN_MAP[planKey]) || "starter";

/** Annual billing = 2 months free. */
export const ANNUAL_MONTHS_CHARGED = 10;

/** Monthly list prices in minor units. Seeded for USD (GLOBAL) and EUR (REGION EU); annual = 10× monthly. */
export const PLAN_PRICES: Record<PlanKey, { USD: number; EUR: number }> = {
  starter: { USD: 9900, EUR: 9900 },
  growth: { USD: 19900, EUR: 19900 },
  scale: { USD: 99900, EUR: 99900 },
};

export const PLAN_META: Record<PlanKey, { sortOrder: number; highlight: boolean; name: string; description: string }> = {
  starter: { sortOrder: 10, highlight: false, name: "Starter", description: "For solo founders validating and launching a company." },
  growth: { sortOrder: 20, highlight: true, name: "Growth", description: "For operating businesses that want an AI leadership team." },
  scale: { sortOrder: 30, highlight: false, name: "Scale", description: "For established businesses running a complete AI company OS." },
};

/** No-card trial for organizations without a subscription (docs/entitlements.md §Trial). */
export const TRIAL_DAYS = 7;
export const TRIAL_PLAN: PlanKey = "growth";
/** After the trial without a subscription: Starter features, read-only (no new usage) until a plan is chosen. */
export const EXPIRED_PLAN: PlanKey = "starter";

/** Bumped when the catalog's plan values change; the seed re-applies catalog values to plans at an older version. */
export const CATALOG_VERSION = 1;
export const CATALOG_VERSION_KEY = "catalog.version";

// ───────────── Features ─────────────

export const FEATURE_GROUPS = ["workforce", "control", "company", "sales", "marketing", "automation", "operations", "analytics", "platform", "support"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

interface FeatureDef {
  group: FeatureGroup;
  /** Cheapest plan that includes the feature (and every plan above it). */
  minPlan: PlanKey;
}

export const FEATURES = {
  // Workforce
  "feature.founder_assistant": { group: "workforce", minPlan: "starter" },
  "feature.ai_task_execution": { group: "workforce", minPlan: "starter" },
  "feature.executive_team": { group: "workforce", minPlan: "growth" },
  "feature.department_delegation": { group: "workforce", minPlan: "growth" },
  "feature.performance_monitoring": { group: "workforce", minPlan: "growth" },
  "feature.full_departments": { group: "workforce", minPlan: "scale" },
  "feature.workforce_management": { group: "workforce", minPlan: "scale" },
  // Approvals & autonomy
  "feature.human_approvals": { group: "control", minPlan: "starter" },
  "feature.autonomy_auto": { group: "control", minPlan: "growth" },
  "feature.autonomy_custom": { group: "control", minPlan: "scale" },
  "feature.advanced_approvals": { group: "control", minPlan: "scale" },
  // Company
  "feature.company_builder": { group: "company", minPlan: "starter" },
  "feature.business_plan": { group: "company", minPlan: "starter" },
  "feature.website_builder": { group: "company", minPlan: "starter" },
  "feature.company_builder_advanced": { group: "company", minPlan: "growth" },
  "feature.company_os": { group: "company", minPlan: "scale" },
  // Sales
  "feature.crm": { group: "sales", minPlan: "starter" },
  "feature.sales_pipeline": { group: "sales", minPlan: "starter" },
  "feature.deal_followups": { group: "sales", minPlan: "growth" },
  "feature.lead_generation": { group: "sales", minPlan: "growth" },
  "feature.advanced_prospecting": { group: "sales", minPlan: "scale" },
  "feature.sales_intelligence": { group: "sales", minPlan: "scale" },
  // Marketing
  "feature.email_marketing": { group: "marketing", minPlan: "starter" },
  "feature.ai_campaigns": { group: "marketing", minPlan: "growth" },
  "feature.email_automation": { group: "marketing", minPlan: "growth" },
  "feature.marketing_autopilot": { group: "marketing", minPlan: "scale" },
  "feature.multichannel_campaigns": { group: "marketing", minPlan: "scale" },
  // Automation
  "feature.automations": { group: "automation", minPlan: "starter" },
  "feature.workflow_builder": { group: "automation", minPlan: "growth" },
  "feature.agent_chains": { group: "automation", minPlan: "scale" },
  // Operations
  "feature.voice_agent": { group: "operations", minPlan: "scale" },
  "feature.live_chat": { group: "operations", minPlan: "scale" },
  "feature.finance": { group: "operations", minPlan: "scale" },
  "feature.hr": { group: "operations", minPlan: "scale" },
  "feature.projects_operations": { group: "operations", minPlan: "scale" },
  "feature.support_automation": { group: "operations", minPlan: "scale" },
  // Analytics
  "feature.basic_analytics": { group: "analytics", minPlan: "starter" },
  "feature.advanced_analytics": { group: "analytics", minPlan: "growth" },
  "feature.growth_insights": { group: "analytics", minPlan: "growth" },
  "feature.advanced_bi": { group: "analytics", minPlan: "scale" },
  "feature.roi_monitoring": { group: "analytics", minPlan: "scale" },
  // Platform & integrations
  "feature.integrations_ads": { group: "platform", minPlan: "growth" },
  "feature.integrations_accounting": { group: "platform", minPlan: "scale" },
  "feature.integrations_developer": { group: "platform", minPlan: "scale" },
  "feature.advanced_integrations": { group: "platform", minPlan: "scale" },
  "feature.data_exports": { group: "platform", minPlan: "scale" },
  // Support
  "feature.standard_support": { group: "support", minPlan: "starter" },
  "feature.priority_support": { group: "support", minPlan: "growth" },
  "feature.priority_onboarding": { group: "support", minPlan: "scale" },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const isFeatureKey = (k: string): k is FeatureKey => Object.hasOwn(FEATURES, k);

/** Integration provider categories that need a plan feature; every other category is available on all plans. */
export const INTEGRATION_CATEGORY_FEATURES: Partial<Record<string, FeatureKey>> = {
  ads: "feature.integrations_ads",
  accounting: "feature.integrations_accounting",
  developer: "feature.integrations_developer",
};

/** Provider categories that count as a connected social/marketing channel (limit channels.max). */
export const CHANNEL_CATEGORIES = ["social", "ads", "email", "messaging"] as const;

// ───────────── Limits ─────────────

export type LimitUnit = "count" | "credits" | "mb" | "minutes" | "cents";

interface LimitDef {
  group: FeatureGroup;
  unit: LimitUnit;
  /** Metered limits are summed from UsageRecord per monthly window; the others are counted live from real tables. */
  meter: string | null;
  /** Default value per plan; null = unlimited (never allowed for high-cost limits). */
  values: Record<PlanKey, number | null>;
  /** High-cost usage: always a finite quota, raised only by an upgrade or a purchasable add-on. */
  highCost?: boolean;
}

export const LIMITS = {
  "companies.max": { group: "company", unit: "count", meter: null, values: { starter: 1, growth: 1, scale: 5 } },
  "agents.max": { group: "workforce", unit: "count", meter: null, values: { starter: 3, growth: 10, scale: 50 } },
  "seats.max": { group: "support", unit: "count", meter: null, values: { starter: 1, growth: 3, scale: 10 } },
  "crm.contacts.max": { group: "sales", unit: "count", meter: null, values: { starter: 1_000, growth: 10_000, scale: 100_000 } },
  "content.generations.month": { group: "marketing", unit: "count", meter: "content.generations", highCost: true, values: { starter: 30, growth: 250, scale: 1_000 } },
  "channels.max": { group: "marketing", unit: "count", meter: null, values: { starter: 2, growth: 5, scale: 15 } },
  "automations.active.max": { group: "automation", unit: "count", meter: null, values: { starter: 5, growth: 25, scale: 100 } },
  "ai.credits.month": { group: "workforce", unit: "credits", meter: "ai.credits", highCost: true, values: { starter: 10_000, growth: 50_000, scale: 300_000 } },
  "voice.minutes.month": { group: "operations", unit: "minutes", meter: "voice.minutes", highCost: true, values: { starter: 0, growth: 0, scale: 500 } },
  "email.sends.month": { group: "marketing", unit: "count", meter: "email.sends", highCost: true, values: { starter: 2_000, growth: 20_000, scale: 100_000 } },
  /** Pass-through cap for paid external APIs (research, enrichment, generation providers), in USD cents. */
  "api.cost.month": { group: "platform", unit: "cents", meter: "api.cost_cents", highCost: true, values: { starter: 2_000, growth: 10_000, scale: 50_000 } },
  /** Ad spend the AI may commit on connected ad accounts, in USD cents (spend is paid to the ad platform). */
  "ads.spend.month": { group: "marketing", unit: "cents", meter: "ads.spend_cents", highCost: true, values: { starter: 0, growth: 200_000, scale: 2_000_000 } },
  "storage.mb": { group: "platform", unit: "mb", meter: null, values: { starter: 5 * 1024, growth: 25 * 1024, scale: 250 * 1024 } },
  /** Website pages (sites module, kind PAGE) and standalone landing pages (kind LANDING), counted live. */
  "sites.pages.max": { group: "company", unit: "count", meter: null, values: { starter: 10, growth: 50, scale: 250 } },
  "sites.landing_pages.max": { group: "company", unit: "count", meter: null, values: { starter: 3, growth: 25, scale: null } },
} as const satisfies Record<string, LimitDef>;

export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];
export const isLimitKey = (k: string): k is LimitKey => Object.hasOwn(LIMITS, k);

export type MeterKey = "ai.credits" | "content.generations" | "voice.minutes" | "email.sends" | "api.cost_cents" | "ads.spend_cents";
export const METER_LIMIT: Record<MeterKey, LimitKey> = {
  "ai.credits": "ai.credits.month",
  "content.generations": "content.generations.month",
  "voice.minutes": "voice.minutes.month",
  "email.sends": "email.sends.month",
  "api.cost_cents": "api.cost.month",
  "ads.spend_cents": "ads.spend.month",
};
export const isMeterKey = (k: string): k is MeterKey => Object.hasOwn(METER_LIMIT, k);
export const isHighCostLimit = (k: LimitKey) => "highCost" in LIMITS[k] && LIMITS[k].highCost === true;

// ───────────── Add-ons ─────────────

interface AddonDef {
  /** The limit one pack raises for the current monthly usage window. */
  limit: LimitKey;
  quantity: number;
  /** One-time price per pack in minor units. */
  prices: { USD: number; EUR: number };
  /** Plan feature the add-on needs (e.g. voice minutes need the Voice Agent). */
  requires?: FeatureKey;
  maxPacks: number;
}

/**
 * Purchasable add-ons (docs/entitlements.md §Add-ons). A pack raises its limit until the end of the organization's
 * current monthly usage window; Stripe one-time checkout when billing is configured, admin grants otherwise.
 */
export const ADDONS = {
  "addon.ai_credits_10k": { limit: "ai.credits.month", quantity: 10_000, prices: { USD: 2_000, EUR: 2_000 }, maxPacks: 50 },
  "addon.ai_credits_50k": { limit: "ai.credits.month", quantity: 50_000, prices: { USD: 9_000, EUR: 9_000 }, maxPacks: 20 },
  "addon.content_100": { limit: "content.generations.month", quantity: 100, prices: { USD: 2_500, EUR: 2_500 }, maxPacks: 20 },
  "addon.voice_minutes_250": { limit: "voice.minutes.month", quantity: 250, prices: { USD: 5_000, EUR: 5_000 }, requires: "feature.voice_agent", maxPacks: 40 },
  "addon.email_sends_10k": { limit: "email.sends.month", quantity: 10_000, prices: { USD: 1_000, EUR: 1_000 }, maxPacks: 50 },
  "addon.api_cost_cap_50": { limit: "api.cost.month", quantity: 5_000, prices: { USD: 5_000, EUR: 5_000 }, maxPacks: 20 },
  "addon.ad_spend_cap_5000": { limit: "ads.spend.month", quantity: 500_000, prices: { USD: 4_900, EUR: 4_900 }, requires: "feature.ai_campaigns", maxPacks: 20 },
} as const satisfies Record<string, AddonDef>;

export type AddonKey = keyof typeof ADDONS;
export const ADDON_KEYS = Object.keys(ADDONS) as AddonKey[];
export const isAddonKey = (k: string): k is AddonKey => Object.hasOwn(ADDONS, k);
export const addonsForLimit = (limit: LimitKey): AddonKey[] => ADDON_KEYS.filter((k) => ADDONS[k].limit === limit);

/** 1 AI credit = 100 model tokens (input + output). Agents runtime meters credits with creditsForTokens(). */
export const TOKENS_PER_CREDIT = 100;
export const creditsForTokens = (tokens: number) => Math.max(0, Math.ceil(tokens / TOKENS_PER_CREDIT));

/** Highest autonomy each plan allows for AI employees (docs/entitlements.md §Autonomy). */
export const AUTONOMY_CEILING: Record<PlanKey, "approval_required" | "auto_low_medium" | "custom"> = {
  starter: "approval_required",
  growth: "auto_low_medium",
  scale: "custom",
};

// ───────────── Defaults per plan ─────────────

export const featureDefault = (plan: PlanKey, key: FeatureKey) => planRank(plan) >= planRank(FEATURES[key].minPlan);
export const limitDefault = (plan: PlanKey, key: LimitKey): number | null => LIMITS[key].values[plan];

/** Entitlement rows a plan is seeded with (PlanEntitlement.featureKey / enabled / limitValue). */
export function catalogEntitlementRows(plan: PlanKey): { featureKey: string; enabled: boolean; limitValue: bigint | null }[] {
  return [
    ...FEATURE_KEYS.map((k) => ({ featureKey: k as string, enabled: featureDefault(plan, k), limitValue: null })),
    ...LIMIT_KEYS.map((k) => {
      const v = limitDefault(plan, k);
      return { featureKey: k as string, enabled: true, limitValue: v === null ? null : BigInt(v) };
    }),
    { featureKey: CATALOG_VERSION_KEY, enabled: true, limitValue: BigInt(CATALOG_VERSION) },
  ];
}

/** Integration restrictions by plan (admin integrations page, upgrade prompts): category → cheapest plan + channel. */
export function integrationCategoryAccess(category: string): { minPlan: PlanKey; feature: FeatureKey | null; countsAsChannel: boolean } {
  const feature = INTEGRATION_CATEGORY_FEATURES[category] ?? null;
  return { minPlan: feature ? FEATURES[feature].minPlan : "starter", feature, countsAsChannel: (CHANNEL_CATEGORIES as readonly string[]).includes(category) };
}
