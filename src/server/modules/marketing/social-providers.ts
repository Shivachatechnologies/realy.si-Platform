import type { MarketingSocialProvider } from "@/generated/prisma/enums";
import type { ProviderConnection } from "./connections-bridge";

/**
 * Provider adapters: real HTTP calls with the connection's access token. A publish only counts as done when the
 * provider returned a post id; anything else throws a ProviderError with a short, user-safe reason code.
 */
export class ProviderError extends Error {
  constructor(
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

export const TEXT_LIMITS: Record<MarketingSocialProvider, number> = { LINKEDIN: 3000, X: 280, INSTAGRAM: 2200, FACEBOOK: 63206 };
const TIMEOUT_MS = 15_000;
const GRAPH = "https://graph.facebook.com/v19.0";

export interface PublishRequest {
  text: string;
  mediaUrl?: string | null;
  /** Account-level external id (LinkedIn author URN, Facebook page id, Instagram user id). */
  externalId?: string | null;
}
export interface PublishResult {
  providerPostId: string;
  url: string | null;
}
export interface Metrics {
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  clicks?: number | null;
}

async function call(url: string, init: RequestInit): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ProviderError("provider_unreachable");
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_unauthorized", `HTTP ${res.status}`);
  if (res.status === 429) throw new ProviderError("provider_rate_limited", "HTTP 429");
  if (!res.ok) {
    const err = json.error as { message?: string } | string | undefined;
    const detail = typeof err === "string" ? err : (err?.message ?? (json.detail as string | undefined) ?? (json.message as string | undefined) ?? "");
    throw new ProviderError("provider_rejected", `HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
  }
  return { status: res.status, headers: res.headers, json };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const configStr = (c: ProviderConnection, key: string) => str(c.config[key]);

// ── LinkedIn (UGC posts API) ──

async function linkedinPublish(c: ProviderConnection, token: string, r: PublishRequest): Promise<PublishResult> {
  const author = r.externalId || configStr(c, "authorUrn") || configStr(c, "organizationUrn") || configStr(c, "personUrn");
  if (!author || !/^urn:li:(person|organization):[A-Za-z0-9_-]+$/.test(author)) throw new ProviderError("account_not_configured", "LinkedIn author URN missing");
  const res = await call("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: r.text },
          shareMediaCategory: r.mediaUrl ? "ARTICLE" : "NONE",
          ...(r.mediaUrl ? { media: [{ status: "READY", originalUrl: r.mediaUrl }] } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  const id = res.headers.get("x-restli-id") ?? str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` };
}

async function linkedinMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}`, "x-restli-protocol-version": "2.0.0" },
  });
  const likes = res.json.likesSummary as { totalLikes?: number } | undefined;
  const comments = res.json.commentsSummary as { aggregatedTotalComments?: number; totalFirstLevelComments?: number } | undefined;
  return { likes: num(likes?.totalLikes), comments: num(comments?.aggregatedTotalComments ?? comments?.totalFirstLevelComments) };
}

// ── X (API v2) ──

async function xPublish(token: string, r: PublishRequest): Promise<PublishResult> {
  const res = await call("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ text: r.mediaUrl ? `${r.text}\n${r.mediaUrl}`.slice(0, TEXT_LIMITS.X) : r.text }),
  });
  const id = str((res.json.data as { id?: string } | undefined)?.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://x.com/i/web/status/${id}` };
}

async function xMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`, { headers: { authorization: `Bearer ${token}` } });
  const m = (res.json.data as { public_metrics?: Record<string, number> } | undefined)?.public_metrics ?? {};
  return { impressions: num(m.impression_count), likes: num(m.like_count), comments: num(m.reply_count), shares: num((m.retweet_count ?? 0) + (m.quote_count ?? 0)) };
}

// ── Facebook (Graph page feed) ──

async function facebookPublish(c: ProviderConnection, token: string, r: PublishRequest): Promise<PublishResult> {
  const pageId = r.externalId || configStr(c, "pageId");
  if (!pageId || !/^\d+$/.test(pageId)) throw new ProviderError("account_not_configured", "Facebook page id missing");
  const pageToken = configStr(c, "pageAccessToken") ?? token;
  const form = new URLSearchParams({ message: r.text, access_token: pageToken });
  if (r.mediaUrl) form.set("link", r.mediaUrl);
  const res = await call(`${GRAPH}/${pageId}/feed`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://www.facebook.com/${id}` };
}

async function facebookMetrics(c: ProviderConnection, token: string, id: string): Promise<Metrics> {
  const pageToken = configStr(c, "pageAccessToken") ?? token;
  const q = new URLSearchParams({ fields: "shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", access_token: pageToken });
  const res = await call(`${GRAPH}/${encodeURIComponent(id)}?${q}`, {});
  const reactions = (res.json.reactions as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  const comments = (res.json.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  const shares = (res.json.shares as { count?: number } | undefined)?.count;
  return { likes: num(reactions), comments: num(comments), shares: num(shares ?? 0) };
}

// ── Instagram (Graph content publishing) ──

async function instagramPublish(c: ProviderConnection, token: string, r: PublishRequest): Promise<PublishResult> {
  const igUserId = r.externalId || configStr(c, "instagramUserId") || configStr(c, "igUserId");
  if (!igUserId || !/^\d+$/.test(igUserId)) throw new ProviderError("account_not_configured", "Instagram user id missing");
  if (!r.mediaUrl) throw new ProviderError("media_required", "Instagram posts need an image URL");
  const container = await call(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: r.mediaUrl, caption: r.text, access_token: token }),
  });
  const creationId = str(container.json.id);
  if (!creationId) throw new ProviderError("provider_no_id");
  const published = await call(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  });
  const id = str(published.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  let url: string | null = null;
  try {
    url = str((await call(`${GRAPH}/${id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`, {})).json.permalink);
  } catch {
    url = null;
  }
  return { providerPostId: id, url };
}

async function instagramMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`${GRAPH}/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "like_count,comments_count", access_token: token })}`, {});
  return { likes: num(res.json.like_count), comments: num(res.json.comments_count) };
}

export async function publishTo(provider: MarketingSocialProvider, c: ProviderConnection & { accessToken: string }, r: PublishRequest): Promise<PublishResult> {
  if (!r.text.trim() && !r.mediaUrl) throw new ProviderError("empty_post");
  if (r.text.length > TEXT_LIMITS[provider]) throw new ProviderError("text_too_long");
  switch (provider) {
    case "LINKEDIN":
      return linkedinPublish(c, c.accessToken, r);
    case "X":
      return xPublish(c.accessToken, r);
    case "FACEBOOK":
      return facebookPublish(c, c.accessToken, r);
    case "INSTAGRAM":
      return instagramPublish(c, c.accessToken, r);
  }
}

export async function fetchMetrics(provider: MarketingSocialProvider, c: ProviderConnection & { accessToken: string }, providerPostId: string): Promise<Metrics> {
  switch (provider) {
    case "LINKEDIN":
      return linkedinMetrics(c.accessToken, providerPostId);
    case "X":
      return xMetrics(c.accessToken, providerPostId);
    case "FACEBOOK":
      return facebookMetrics(c, c.accessToken, providerPostId);
    case "INSTAGRAM":
      return instagramMetrics(c.accessToken, providerPostId);
  }
}
