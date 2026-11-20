// Uses integrations services when available — thin Paid Ads adapters (Meta Marketing API, Google Ads REST, LinkedIn
// Marketing API, TikTok Business API). Writes are only called from the SUPERVISED HIGH tools after a cap check.
import type { ProviderConnection } from "../connections-bridge";
import { bearer, call, cfg, num, ProviderError, str } from "./http";

export const AD_PROVIDERS = ["meta_ads", "google_ads", "linkedin_ads", "tiktok_ads"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

type Conn = ProviderConnection & { accessToken: string };

export interface RemoteAdAccount {
  externalId: string;
  name: string;
  currency: string;
}
export interface RemoteCampaign {
  externalId: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudgetMinor: bigint | null;
}
export interface RemoteDailyMetric {
  campaignExternalId: string;
  date: string;
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueMinor: bigint;
}
export interface CampaignDraft {
  name: string;
  objective: string;
  dailyBudgetMinor: bigint;
  currency: string;
}

const minor = (major: unknown) => BigInt(Math.round((num(major) ?? 0) * 100));
const META = "https://graph.facebook.com/v19.0";
const GADS = "https://googleads.googleapis.com/v17";
const TT = "https://business-api.tiktok.com/open_api/v1.3";
const LIA = "https://api.linkedin.com/rest";

const day = (d: Date) => d.toISOString().slice(0, 10);

// ── Meta ──

const actId = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

async function metaAccounts(c: Conn): Promise<RemoteAdAccount[]> {
  const res = await call(`${META}/me/adaccounts?${new URLSearchParams({ fields: "id,name,currency", limit: "100", access_token: c.accessToken })}`);
  return ((res.json.data as Record<string, unknown>[] | undefined) ?? []).map((a) => ({ externalId: String(a.id), name: String(a.name ?? a.id), currency: String(a.currency ?? "USD") }));
}
async function metaCampaigns(c: Conn, account: string): Promise<RemoteCampaign[]> {
  const res = await call(`${META}/${actId(account)}/campaigns?${new URLSearchParams({ fields: "id,name,status,objective,daily_budget", limit: "200", access_token: c.accessToken })}`);
  return ((res.json.data as Record<string, unknown>[] | undefined) ?? []).map((x) => ({
    externalId: String(x.id),
    name: String(x.name ?? ""),
    status: String(x.status ?? ""),
    objective: str(x.objective),
    dailyBudgetMinor: x.daily_budget != null ? BigInt(String(x.daily_budget)) : null,
  }));
}
async function metaInsights(c: Conn, account: string, since: Date): Promise<RemoteDailyMetric[]> {
  const q = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,spend,impressions,clicks,actions,action_values",
    time_increment: "1",
    time_range: JSON.stringify({ since: day(since), until: day(new Date()) }),
    limit: "500",
    access_token: c.accessToken,
  });
  const res = await call(`${META}/${actId(account)}/insights?${q}`);
  return ((res.json.data as Record<string, unknown>[] | undefined) ?? []).map((r) => {
    const actions = (r.actions as { action_type: string; value: string }[] | undefined) ?? [];
    const values = (r.action_values as { action_type: string; value: string }[] | undefined) ?? [];
    const conv = actions.filter((a) => /purchase|lead|complete_registration/.test(a.action_type)).reduce((s, a) => s + Number(a.value), 0);
    const rev = values.filter((a) => /purchase/.test(a.action_type)).reduce((s, a) => s + Number(a.value), 0);
    return { campaignExternalId: String(r.campaign_id), date: String(r.date_start), spendMinor: minor(r.spend), impressions: num(r.impressions) ?? 0, clicks: num(r.clicks) ?? 0, conversions: conv, revenueMinor: minor(rev) };
  });
}

// ── Google Ads ──

function gadsHeaders(c: Conn) {
  const dev = cfg(c, "developerToken");
  if (!dev) throw new ProviderError("account_not_configured", "Google Ads developer token missing");
  const login = cfg(c, "loginCustomerId");
  return bearer(c.accessToken, { "developer-token": dev, "content-type": "application/json", ...(login ? { "login-customer-id": login.replace(/-/g, "") } : {}) });
}
const cid = (id: string) => id.replace(/-/g, "");
async function gadsSearch(c: Conn, customer: string, query: string) {
  const res = await call(`${GADS}/customers/${cid(customer)}/googleAds:search`, { method: "POST", headers: gadsHeaders(c), body: JSON.stringify({ query }) });
  return (res.json.results as Record<string, Record<string, unknown>>[] | undefined) ?? [];
}
async function gadsAccounts(c: Conn): Promise<RemoteAdAccount[]> {
  const res = await call(`${GADS}/customers:listAccessibleCustomers`, { headers: gadsHeaders(c) });
  const names = (res.json.resourceNames as string[] | undefined) ?? [];
  const out: RemoteAdAccount[] = [];
  for (const rn of names.slice(0, 20)) {
    const id = rn.split("/")[1]!;
    try {
      const r = await gadsSearch(c, id, "SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
      const cu = r[0]?.customer ?? {};
      out.push({ externalId: id, name: String(cu.descriptiveName ?? id), currency: String(cu.currencyCode ?? "USD") });
    } catch {
      out.push({ externalId: id, name: id, currency: "USD" });
    }
  }
  return out;
}
async function gadsCampaigns(c: Conn, customer: string): Promise<RemoteCampaign[]> {
  const rows = await gadsSearch(c, customer, "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign");
  return rows.map((r) => ({
    externalId: String(r.campaign?.id),
    name: String(r.campaign?.name ?? ""),
    status: String(r.campaign?.status ?? ""),
    objective: str(r.campaign?.advertisingChannelType),
    dailyBudgetMinor: r.campaignBudget?.amountMicros != null ? BigInt(String(r.campaignBudget.amountMicros)) / 10_000n : null,
  }));
}
async function gadsInsights(c: Conn, customer: string, since: Date): Promise<RemoteDailyMetric[]> {
  const rows = await gadsSearch(
    c,
    customer,
    `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${day(since)}' AND '${day(new Date())}'`,
  );
  return rows.map((r) => ({
    campaignExternalId: String(r.campaign?.id),
    date: String(r.segments?.date),
    spendMinor: BigInt(String(r.metrics?.costMicros ?? "0")) / 10_000n,
    impressions: num(r.metrics?.impressions) ?? 0,
    clicks: num(r.metrics?.clicks) ?? 0,
    conversions: num(r.metrics?.conversions) ?? 0,
    revenueMinor: minor(r.metrics?.conversionsValue),
  }));
}

// ── LinkedIn Ads ──

const liHeaders = (c: Conn) => bearer(c.accessToken, { "linkedin-version": cfg(c, "apiVersion") ?? "202405", "x-restli-protocol-version": "2.0.0", "content-type": "application/json" });
async function liAccounts(c: Conn): Promise<RemoteAdAccount[]> {
  const res = await call(`${LIA}/adAccounts?q=search&search=(status:(values:List(ACTIVE)))`, { headers: liHeaders(c) });
  return ((res.json.elements as Record<string, unknown>[] | undefined) ?? []).map((a) => ({ externalId: String(a.id), name: String(a.name ?? a.id), currency: String(a.currency ?? "USD") }));
}
async function liCampaigns(c: Conn, account: string): Promise<RemoteCampaign[]> {
  const res = await call(`${LIA}/adAccounts/${encodeURIComponent(account)}/adCampaigns?q=search`, { headers: liHeaders(c) });
  return ((res.json.elements as Record<string, unknown>[] | undefined) ?? []).map((x) => ({
    externalId: String(x.id),
    name: String(x.name ?? ""),
    status: String(x.status ?? ""),
    objective: str(x.objectiveType),
    dailyBudgetMinor: (x.dailyBudget as { amount?: string } | undefined)?.amount ? minor((x.dailyBudget as { amount: string }).amount) : null,
  }));
}
async function liInsights(c: Conn, account: string, since: Date): Promise<RemoteDailyMetric[]> {
  const now = new Date();
  const dr = `(start:(year:${since.getUTCFullYear()},month:${since.getUTCMonth() + 1},day:${since.getUTCDate()}),end:(year:${now.getUTCFullYear()},month:${now.getUTCMonth() + 1},day:${now.getUTCDate()}))`;
  const url = `${LIA}/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=${dr}&accounts=List(${encodeURIComponent(`urn:li:sponsoredAccount:${account}`)})&fields=pivotValues,dateRange,costInLocalCurrency,impressions,clicks,externalWebsiteConversions,conversionValueInLocalCurrency`;
  const res = await call(url, { headers: liHeaders(c) });
  return ((res.json.elements as Record<string, unknown>[] | undefined) ?? []).map((e) => {
    const start = ((e.dateRange as { start?: { year: number; month: number; day: number } } | undefined)?.start ?? { year: 1970, month: 1, day: 1 }) as { year: number; month: number; day: number };
    const urn = ((e.pivotValues as string[] | undefined) ?? [""])[0]!;
    return {
      campaignExternalId: urn.split(":").pop() ?? urn,
      date: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`,
      spendMinor: minor(e.costInLocalCurrency),
      impressions: num(e.impressions) ?? 0,
      clicks: num(e.clicks) ?? 0,
      conversions: num(e.externalWebsiteConversions) ?? 0,
      revenueMinor: minor(e.conversionValueInLocalCurrency),
    };
  });
}

// ── TikTok Ads ──

const ttHeaders = (c: Conn) => ({ "access-token": c.accessToken, "content-type": "application/json" });
function ttData(json: Record<string, unknown>) {
  if (num(json.code) !== 0) throw new ProviderError("provider_rejected", String(json.message ?? "TikTok error").slice(0, 200));
  return (json.data ?? {}) as Record<string, unknown>;
}
async function ttAccounts(c: Conn): Promise<RemoteAdAccount[]> {
  const appId = cfg(c, "appId");
  const secret = cfg(c, "appSecret");
  if (!appId || !secret) throw new ProviderError("account_not_configured", "TikTok app id/secret missing");
  const res = await call(`${TT}/oauth2/advertiser/get/?${new URLSearchParams({ app_id: appId, secret })}`, { headers: ttHeaders(c) });
  return ((ttData(res.json).list as Record<string, unknown>[] | undefined) ?? []).map((a) => ({ externalId: String(a.advertiser_id), name: String(a.advertiser_name ?? a.advertiser_id), currency: "USD" }));
}
async function ttCampaigns(c: Conn, advertiser: string): Promise<RemoteCampaign[]> {
  const res = await call(`${TT}/campaign/get/?${new URLSearchParams({ advertiser_id: advertiser, page_size: "200" })}`, { headers: ttHeaders(c) });
  return ((ttData(res.json).list as Record<string, unknown>[] | undefined) ?? []).map((x) => ({
    externalId: String(x.campaign_id),
    name: String(x.campaign_name ?? ""),
    status: String(x.operation_status ?? x.secondary_status ?? ""),
    objective: str(x.objective_type),
    dailyBudgetMinor: x.budget != null ? minor(x.budget) : null,
  }));
}
async function ttInsights(c: Conn, advertiser: string, since: Date): Promise<RemoteDailyMetric[]> {
  const q = new URLSearchParams({
    advertiser_id: advertiser,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
    metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion", "total_complete_payment_rate"]),
    start_date: day(since),
    end_date: day(new Date()),
    page_size: "1000",
  });
  const res = await call(`${TT}/report/integrated/get/?${q}`, { headers: ttHeaders(c) });
  return ((ttData(res.json).list as { dimensions: Record<string, string>; metrics: Record<string, string> }[] | undefined) ?? []).map((r) => ({
    campaignExternalId: r.dimensions.campaign_id!,
    date: r.dimensions.stat_time_day!.slice(0, 10),
    spendMinor: minor(r.metrics.spend),
    impressions: num(r.metrics.impressions) ?? 0,
    clicks: num(r.metrics.clicks) ?? 0,
    conversions: num(r.metrics.conversion) ?? 0,
    revenueMinor: 0n,
  }));
}

// ── Dispatch: reads ──

export async function listAdAccounts(provider: AdProvider, c: Conn): Promise<RemoteAdAccount[]> {
  if (provider === "meta_ads") return metaAccounts(c);
  if (provider === "google_ads") return gadsAccounts(c);
  if (provider === "linkedin_ads") return liAccounts(c);
  return ttAccounts(c);
}
export async function listRemoteCampaigns(provider: AdProvider, c: Conn, account: string): Promise<RemoteCampaign[]> {
  if (provider === "meta_ads") return metaCampaigns(c, account);
  if (provider === "google_ads") return gadsCampaigns(c, account);
  if (provider === "linkedin_ads") return liCampaigns(c, account);
  return ttCampaigns(c, account);
}
export async function fetchDailyMetrics(provider: AdProvider, c: Conn, account: string, since: Date): Promise<RemoteDailyMetric[]> {
  if (provider === "meta_ads") return metaInsights(c, account, since);
  if (provider === "google_ads") return gadsInsights(c, account, since);
  if (provider === "linkedin_ads") return liInsights(c, account, since);
  return ttInsights(c, account, since);
}

// ── Dispatch: writes (supervised) ──

/** Creates the campaign PAUSED at the provider; returns its provider id. */
export async function createRemoteCampaign(provider: AdProvider, c: Conn, account: string, d: CampaignDraft): Promise<string> {
  if (provider === "meta_ads") {
    const res = await call(`${META}/${actId(account)}/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: d.name, objective: d.objective || "OUTCOME_TRAFFIC", status: "PAUSED", special_ad_categories: "[]", daily_budget: d.dailyBudgetMinor.toString(), access_token: c.accessToken }),
    });
    const id = str(res.json.id);
    if (!id) throw new ProviderError("provider_no_id");
    return id;
  }
  if (provider === "google_ads") {
    const budget = await call(`${GADS}/customers/${cid(account)}/campaignBudgets:mutate`, {
      method: "POST",
      headers: gadsHeaders(c),
      body: JSON.stringify({ operations: [{ create: { name: `${d.name} budget ${Date.now()}`, amountMicros: (d.dailyBudgetMinor * 10_000n).toString(), deliveryMethod: "STANDARD" } }] }),
    });
    const budgetName = str((budget.json.results as { resourceName?: string }[] | undefined)?.[0]?.resourceName);
    if (!budgetName) throw new ProviderError("provider_no_id");
    const res = await call(`${GADS}/customers/${cid(account)}/campaigns:mutate`, {
      method: "POST",
      headers: gadsHeaders(c),
      body: JSON.stringify({ operations: [{ create: { name: d.name, status: "PAUSED", advertisingChannelType: d.objective || "SEARCH", campaignBudget: budgetName, manualCpc: {}, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true } } }] }),
    });
    const rn = str((res.json.results as { resourceName?: string }[] | undefined)?.[0]?.resourceName);
    if (!rn) throw new ProviderError("provider_no_id");
    return rn.split("/").pop()!;
  }
  if (provider === "linkedin_ads") {
    const group = cfg(c, "campaignGroupId");
    if (!group) throw new ProviderError("account_not_configured", "LinkedIn campaign group id missing");
    const res = await call(`${LIA}/adAccounts/${encodeURIComponent(account)}/adCampaigns`, {
      method: "POST",
      headers: liHeaders(c),
      body: JSON.stringify({
        account: `urn:li:sponsoredAccount:${account}`,
        campaignGroup: `urn:li:sponsoredCampaignGroup:${group}`,
        name: d.name,
        type: "SPONSORED_UPDATES",
        costType: "CPM",
        objectiveType: d.objective || "WEBSITE_VISIT",
        status: "PAUSED",
        locale: { country: "US", language: "en" },
        dailyBudget: { amount: (Number(d.dailyBudgetMinor) / 100).toFixed(2), currencyCode: d.currency },
        unitCost: { amount: "10.00", currencyCode: d.currency },
        runSchedule: { start: Date.now() + 3_600_000 },
        targetingCriteria: { include: { and: [{ or: { "urn:li:adTargetingFacet:locations": ["urn:li:geo:103644278"] } }] } },
      }),
    });
    const id = res.headers.get("x-restli-id") ?? str(res.json.id);
    if (!id) throw new ProviderError("provider_no_id");
    return id;
  }
  const res = await call(`${TT}/campaign/create/`, {
    method: "POST",
    headers: ttHeaders(c),
    body: JSON.stringify({ advertiser_id: account, campaign_name: d.name, objective_type: d.objective || "TRAFFIC", budget_mode: "BUDGET_MODE_DAY", budget: Number(d.dailyBudgetMinor) / 100, operation_status: "DISABLE" }),
  });
  const id = str(String((ttData(res.json) as { campaign_id?: string | number }).campaign_id ?? ""));
  if (!id) throw new ProviderError("provider_no_id");
  return id;
}

export async function updateRemoteBudget(provider: AdProvider, c: Conn, account: string, campaignExternalId: string, dailyBudgetMinor: bigint, currency: string): Promise<void> {
  if (provider === "meta_ads") {
    await call(`${META}/${encodeURIComponent(campaignExternalId)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ daily_budget: dailyBudgetMinor.toString(), access_token: c.accessToken }) });
    return;
  }
  if (provider === "google_ads") {
    const rows = await gadsSearch(c, account, `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${Number(campaignExternalId)}`);
    const budget = str(rows[0]?.campaign?.campaignBudget);
    if (!budget) throw new ProviderError("provider_rejected", "Campaign budget not found");
    await call(`${GADS}/customers/${cid(account)}/campaignBudgets:mutate`, {
      method: "POST",
      headers: gadsHeaders(c),
      body: JSON.stringify({ operations: [{ update: { resourceName: budget, amountMicros: (dailyBudgetMinor * 10_000n).toString() }, updateMask: "amount_micros" }] }),
    });
    return;
  }
  if (provider === "linkedin_ads") {
    await call(`${LIA}/adAccounts/${encodeURIComponent(account)}/adCampaigns/${encodeURIComponent(campaignExternalId)}`, {
      method: "POST",
      headers: { ...liHeaders(c), "x-restli-method": "PARTIAL_UPDATE" },
      body: JSON.stringify({ patch: { $set: { dailyBudget: { amount: (Number(dailyBudgetMinor) / 100).toFixed(2), currencyCode: currency } } } }),
    });
    return;
  }
  const res = await call(`${TT}/campaign/update/`, { method: "POST", headers: ttHeaders(c), body: JSON.stringify({ advertiser_id: account, campaign_id: campaignExternalId, budget: Number(dailyBudgetMinor) / 100 }) });
  ttData(res.json);
}

export async function setRemoteStatus(provider: AdProvider, c: Conn, account: string, campaignExternalId: string, active: boolean): Promise<void> {
  if (provider === "meta_ads") {
    await call(`${META}/${encodeURIComponent(campaignExternalId)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ status: active ? "ACTIVE" : "PAUSED", access_token: c.accessToken }) });
    return;
  }
  if (provider === "google_ads") {
    await call(`${GADS}/customers/${cid(account)}/campaigns:mutate`, {
      method: "POST",
      headers: gadsHeaders(c),
      body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cid(account)}/campaigns/${campaignExternalId}`, status: active ? "ENABLED" : "PAUSED" }, updateMask: "status" }] }),
    });
    return;
  }
  if (provider === "linkedin_ads") {
    await call(`${LIA}/adAccounts/${encodeURIComponent(account)}/adCampaigns/${encodeURIComponent(campaignExternalId)}`, {
      method: "POST",
      headers: { ...liHeaders(c), "x-restli-method": "PARTIAL_UPDATE" },
      body: JSON.stringify({ patch: { $set: { status: active ? "ACTIVE" : "PAUSED" } } }),
    });
    return;
  }
  const res = await call(`${TT}/campaign/status/update/`, { method: "POST", headers: ttHeaders(c), body: JSON.stringify({ advertiser_id: account, campaign_ids: [campaignExternalId], operation_status: active ? "ENABLE" : "DISABLE" }) });
  ttData(res.json);
}
