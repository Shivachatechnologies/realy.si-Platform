import type { MarketingSocialProvider } from "@/generated/prisma/enums";
import type { ProviderConnection } from "./connections-bridge";
import { bearer, call, cfg, num, ProviderError, str } from "./providers/http";

export { ProviderError } from "./providers/http";

/**
 * Social provider adapters: real HTTP calls with the connection's access token. A publish only counts as done when the
 * provider returned a post id; asynchronous publishes (TikTok, video containers) return `pending` and are verified by
 * `checkPending` before the delivery is marked published.
 */
export const TEXT_LIMITS: Record<MarketingSocialProvider, number> = {
  LINKEDIN: 3000,
  X: 280,
  INSTAGRAM: 2200,
  FACEBOOK: 63206,
  YOUTUBE: 5000,
  TIKTOK: 2200,
  THREADS: 500,
  PINTEREST: 500,
};
/** Platforms that cannot publish text-only posts. */
export const MEDIA_REQUIRED: Record<MarketingSocialProvider, "image" | "video" | "any" | null> = {
  LINKEDIN: null,
  X: null,
  INSTAGRAM: "any",
  FACEBOOK: null,
  YOUTUBE: "video",
  TIKTOK: "any",
  THREADS: null,
  PINTEREST: "image",
};

const GRAPH = "https://graph.facebook.com/v19.0";
const THREADS = "https://graph.threads.net/v1.0";

export interface PublishRequest {
  text: string;
  /** Public https URL of the media (image or video). */
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | null;
  /** Raw bytes (YouTube uploads need the file itself). */
  media?: { bytes: Buffer; mimeType: string } | null;
  /** Title (YouTube, Pinterest). */
  title?: string | null;
  /** Destination link (Pinterest). */
  link?: string | null;
  /** Account-level external id (LinkedIn author URN, page id, IG/Threads user id, Pinterest board id, YouTube channel). */
  externalId?: string | null;
}
export interface PublishResult {
  providerPostId: string;
  url: string | null;
  /** The provider accepted the job but has not confirmed the post yet; call checkPending later. */
  pending?: boolean;
}
export interface Metrics {
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  clicks?: number | null;
}
export interface RemoteComment {
  externalId: string;
  authorName: string | null;
  text: string;
  postedAt: Date | null;
}

type Conn = ProviderConnection & { accessToken: string };
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });
const isVideo = (r: PublishRequest) => r.mediaType === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(r.mediaUrl ?? "");

// ── LinkedIn (UGC posts API) ──

function linkedinAuthor(c: Conn, r: { externalId?: string | null }) {
  const author = r.externalId || cfg(c, "authorUrn", "organizationUrn", "personUrn");
  if (!author || !/^urn:li:(person|organization):[A-Za-z0-9_-]+$/.test(author)) throw new ProviderError("account_not_configured", "LinkedIn author URN missing");
  return author;
}
const LI = (token: string) => bearer(token, { "content-type": "application/json", "x-restli-protocol-version": "2.0.0" });

async function linkedinPublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  const author = linkedinAuthor(c, r);
  const res = await call("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: LI(c.accessToken),
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
  const res = await call(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(id)}`, { headers: LI(token) });
  const likes = res.json.likesSummary as { totalLikes?: number } | undefined;
  const comments = res.json.commentsSummary as { aggregatedTotalComments?: number; totalFirstLevelComments?: number } | undefined;
  return { likes: num(likes?.totalLikes), comments: num(comments?.aggregatedTotalComments ?? comments?.totalFirstLevelComments) };
}

// ── X (API v2) ──

async function xPublish(token: string, r: PublishRequest): Promise<PublishResult> {
  const res = await call("https://api.x.com/2/tweets", {
    method: "POST",
    headers: bearer(token, { "content-type": "application/json" }),
    body: JSON.stringify({ text: r.mediaUrl ? `${r.text}\n${r.mediaUrl}`.slice(0, TEXT_LIMITS.X) : r.text }),
  });
  const id = str((res.json.data as { id?: string } | undefined)?.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://x.com/i/web/status/${id}` };
}

async function xMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`, { headers: bearer(token) });
  const m = (res.json.data as { public_metrics?: Record<string, number> } | undefined)?.public_metrics ?? {};
  return { impressions: num(m.impression_count), likes: num(m.like_count), comments: num(m.reply_count), shares: num((m.retweet_count ?? 0) + (m.quote_count ?? 0)) };
}

// ── Facebook (Graph page feed) ──

const fbPageToken = (c: Conn) => cfg(c, "pageAccessToken") ?? c.accessToken;

async function facebookPublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  const pageId = r.externalId || cfg(c, "pageId");
  if (!pageId || !/^\d+$/.test(pageId)) throw new ProviderError("account_not_configured", "Facebook page id missing");
  const token = fbPageToken(c);
  if (r.mediaUrl && isVideo(r)) {
    const res = await call(`${GRAPH}/${pageId}/videos`, form({ file_url: r.mediaUrl, description: r.text, access_token: token }), 60_000);
    const id = str(res.json.id);
    if (!id) throw new ProviderError("provider_no_id");
    return { providerPostId: id, url: `https://www.facebook.com/${pageId}/videos/${id}` };
  }
  if (r.mediaUrl) {
    const res = await call(`${GRAPH}/${pageId}/photos`, form({ url: r.mediaUrl, caption: r.text, access_token: token }), 60_000);
    const id = str(res.json.post_id) ?? str(res.json.id);
    if (!id) throw new ProviderError("provider_no_id");
    return { providerPostId: id, url: `https://www.facebook.com/${id}` };
  }
  const res = await call(`${GRAPH}/${pageId}/feed`, form({ message: r.text, access_token: token }));
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://www.facebook.com/${id}` };
}

async function facebookMetrics(c: Conn, id: string): Promise<Metrics> {
  const q = new URLSearchParams({ fields: "shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", access_token: fbPageToken(c) });
  const res = await call(`${GRAPH}/${encodeURIComponent(id)}?${q}`);
  const reactions = (res.json.reactions as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  const comments = (res.json.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count;
  const shares = (res.json.shares as { count?: number } | undefined)?.count;
  const base: Metrics = { likes: num(reactions), comments: num(comments), shares: num(shares ?? 0) };
  try {
    const ins = await call(`${GRAPH}/${encodeURIComponent(id)}/insights?${new URLSearchParams({ metric: "post_impressions,post_impressions_unique,post_clicks", access_token: fbPageToken(c) })}`);
    const data = (ins.json.data as { name: string; values?: { value?: number }[] }[] | undefined) ?? [];
    const v = (n: string) => num(data.find((d) => d.name === n)?.values?.[0]?.value);
    return { ...base, impressions: v("post_impressions"), reach: v("post_impressions_unique"), clicks: v("post_clicks") };
  } catch {
    return base;
  }
}

// ── Instagram (Graph content publishing; reels are asynchronous containers) ──

function igUser(c: Conn, r: { externalId?: string | null }) {
  const id = r.externalId || cfg(c, "instagramUserId", "igUserId");
  if (!id || !/^\d+$/.test(id)) throw new ProviderError("account_not_configured", "Instagram user id missing");
  return id;
}

async function igPublishContainer(c: Conn, igUserId: string, creationId: string): Promise<PublishResult> {
  const published = await call(`${GRAPH}/${igUserId}/media_publish`, form({ creation_id: creationId, access_token: c.accessToken }));
  const id = str(published.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  let url: string | null = null;
  try {
    url = str((await call(`${GRAPH}/${id}?${new URLSearchParams({ fields: "permalink", access_token: c.accessToken })}`)).json.permalink);
  } catch {
    url = null;
  }
  return { providerPostId: id, url };
}

async function instagramPublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  const igUserId = igUser(c, r);
  if (!r.mediaUrl) throw new ProviderError("media_required", "Instagram posts need an image or video URL");
  const video = isVideo(r);
  const container = await call(
    `${GRAPH}/${igUserId}/media`,
    form(video ? { media_type: "REELS", video_url: r.mediaUrl, caption: r.text, access_token: c.accessToken } : { image_url: r.mediaUrl, caption: r.text, access_token: c.accessToken }),
  );
  const creationId = str(container.json.id);
  if (!creationId) throw new ProviderError("provider_no_id");
  if (video) return { providerPostId: `container:${creationId}`, url: null, pending: true };
  return igPublishContainer(c, igUserId, creationId);
}

async function instagramMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`${GRAPH}/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "like_count,comments_count", access_token: token })}`);
  const base: Metrics = { likes: num(res.json.like_count), comments: num(res.json.comments_count) };
  try {
    const ins = await call(`${GRAPH}/${encodeURIComponent(id)}/insights?${new URLSearchParams({ metric: "reach,views,shares", access_token: token })}`);
    const data = (ins.json.data as { name: string; values?: { value?: number }[] }[] | undefined) ?? [];
    const v = (n: string) => num(data.find((d) => d.name === n)?.values?.[0]?.value);
    return { ...base, reach: v("reach"), impressions: v("views"), shares: v("shares") };
  } catch {
    return base;
  }
}

// ── Threads (graph.threads.net) ──

const threadsUser = (c: Conn, r: { externalId?: string | null }) => r.externalId || cfg(c, "threadsUserId", "userId") || "me";

async function threadsPublish(c: Conn, r: PublishRequest, replyTo?: string): Promise<PublishResult> {
  const user = threadsUser(c, r);
  const video = !!r.mediaUrl && isVideo(r);
  const params: Record<string, string> = { media_type: r.mediaUrl ? (video ? "VIDEO" : "IMAGE") : "TEXT", text: r.text, access_token: c.accessToken };
  if (r.mediaUrl) params[video ? "video_url" : "image_url"] = r.mediaUrl;
  if (replyTo) params.reply_to_id = replyTo;
  const container = await call(`${THREADS}/${user}/threads`, form(params));
  const creationId = str(container.json.id);
  if (!creationId) throw new ProviderError("provider_no_id");
  if (video) return { providerPostId: `container:${creationId}`, url: null, pending: true };
  return threadsPublishContainer(c, user, creationId);
}

async function threadsPublishContainer(c: Conn, user: string, creationId: string): Promise<PublishResult> {
  const res = await call(`${THREADS}/${user}/threads_publish`, form({ creation_id: creationId, access_token: c.accessToken }));
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  let url: string | null = null;
  try {
    url = str((await call(`${THREADS}/${id}?${new URLSearchParams({ fields: "permalink", access_token: c.accessToken })}`)).json.permalink);
  } catch {
    url = null;
  }
  return { providerPostId: id, url };
}

async function threadsMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`${THREADS}/${encodeURIComponent(id)}/insights?${new URLSearchParams({ metric: "views,likes,replies,reposts,quotes", access_token: token })}`);
  const data = (res.json.data as { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] | undefined) ?? [];
  const v = (n: string) => {
    const d = data.find((x) => x.name === n);
    return num(d?.values?.[0]?.value ?? d?.total_value?.value);
  };
  return { impressions: v("views"), likes: v("likes"), comments: v("replies"), shares: (v("reposts") ?? 0) + (v("quotes") ?? 0) };
}

// ── YouTube (Data API v3 resumable upload) ──

async function youtubePublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  if (!r.media || !r.media.mimeType.startsWith("video/")) throw new ProviderError("media_required", "YouTube needs a video file from the media library");
  const title = (r.title || r.text.split("\n")[0] || "Video").slice(0, 100);
  const tags = [...r.text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]!).slice(0, 15);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: bearer(c.accessToken, { "content-type": "application/json; charset=UTF-8", "x-upload-content-type": r.media.mimeType, "x-upload-content-length": String(r.media.bytes.length) }),
    body: JSON.stringify({ snippet: { title, description: r.text, tags, categoryId: cfg(c, "categoryId") ?? "22" }, status: { privacyStatus: cfg(c, "privacyStatus") ?? "public", selfDeclaredMadeForKids: false } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!init) throw new ProviderError("provider_unreachable");
  if (init.status === 401 || init.status === 403) throw new ProviderError("provider_unauthorized", `HTTP ${init.status}`);
  if (init.status === 429) throw new ProviderError("provider_rate_limited", "HTTP 429");
  const location = init.headers.get("location");
  if (!init.ok || !location) throw new ProviderError("provider_rejected", `HTTP ${init.status}`);
  const res = await call(location, { method: "PUT", headers: { "content-type": r.media.mimeType }, body: new Uint8Array(r.media.bytes) }, 300_000);
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

async function youtubeMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: bearer(token) });
  const s = ((res.json.items as { statistics?: Record<string, string> }[] | undefined)?.[0]?.statistics ?? {}) as Record<string, string>;
  return { impressions: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
}

// ── TikTok (Content Posting API, direct post; asynchronous) ──

async function tiktokPublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  if (!r.mediaUrl) throw new ProviderError("media_required", "TikTok needs a video or photo URL");
  const privacy = cfg(c, "privacyLevel") ?? "SELF_ONLY";
  const headers = bearer(c.accessToken, { "content-type": "application/json; charset=UTF-8" });
  const res = isVideo(r)
    ? await call("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers,
        body: JSON.stringify({ post_info: { title: r.text.slice(0, 2200), privacy_level: privacy, disable_comment: false }, source_info: { source: "PULL_FROM_URL", video_url: r.mediaUrl } }),
      })
    : await call("https://open.tiktokapis.com/v2/post/publish/content/init/", {
        method: "POST",
        headers,
        body: JSON.stringify({
          post_info: { title: (r.title ?? r.text).slice(0, 90), description: r.text.slice(0, 4000), privacy_level: privacy },
          source_info: { source: "PULL_FROM_URL", photo_images: [r.mediaUrl], photo_cover_index: 0 },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
        }),
      });
  const err = res.json.error as { code?: string; message?: string } | undefined;
  if (err?.code && err.code !== "ok") throw new ProviderError("provider_rejected", `${err.code}: ${err.message ?? ""}`.slice(0, 200));
  const publishId = str((res.json.data as { publish_id?: string } | undefined)?.publish_id);
  if (!publishId) throw new ProviderError("provider_no_id");
  return { providerPostId: publishId, url: null, pending: true };
}

async function tiktokStatus(c: Conn, publishId: string): Promise<PublishResult | null> {
  const res = await call("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: bearer(c.accessToken, { "content-type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ publish_id: publishId }),
  });
  const d = (res.json.data ?? {}) as { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] };
  if (d.status === "FAILED") throw new ProviderError("provider_rejected", d.fail_reason ?? "TikTok rejected the post");
  if (d.status !== "PUBLISH_COMPLETE") return null;
  const postId = d.publicaly_available_post_id?.[0];
  const handle = cfg(c, "username");
  return { providerPostId: postId ? String(postId) : publishId, url: postId && handle ? `https://www.tiktok.com/@${handle}/video/${postId}` : null };
}

async function tiktokMetrics(token: string, id: string): Promise<Metrics> {
  const res = await call("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", {
    method: "POST",
    headers: bearer(token, { "content-type": "application/json" }),
    body: JSON.stringify({ filters: { video_ids: [id] } }),
  });
  const v = ((res.json.data as { videos?: Record<string, number>[] } | undefined)?.videos?.[0] ?? {}) as Record<string, number>;
  return { impressions: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) };
}

// ── Pinterest (API v5 pins) ──

async function pinterestPublish(c: Conn, r: PublishRequest): Promise<PublishResult> {
  const boardId = r.externalId || cfg(c, "boardId");
  if (!boardId) throw new ProviderError("account_not_configured", "Pinterest board id missing");
  if (!r.mediaUrl || isVideo(r)) throw new ProviderError("media_required", "Pinterest pins need an image URL");
  const res = await call("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: bearer(c.accessToken, { "content-type": "application/json" }),
    body: JSON.stringify({
      board_id: boardId,
      title: (r.title ?? r.text.split("\n")[0] ?? "").slice(0, 100),
      description: r.text.slice(0, 500),
      ...(r.link ? { link: r.link } : {}),
      media_source: { source_type: "image_url", url: r.mediaUrl },
    }),
  });
  const id = str(res.json.id);
  if (!id) throw new ProviderError("provider_no_id");
  return { providerPostId: id, url: `https://www.pinterest.com/pin/${id}/` };
}

async function pinterestMetrics(token: string, id: string): Promise<Metrics> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  const res = await call(`https://api.pinterest.com/v5/pins/${encodeURIComponent(id)}/analytics?${new URLSearchParams({ start_date: start, end_date: end, metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" })}`, {
    headers: bearer(token),
  });
  const all = ((res.json.all as { lifetime_metrics?: Record<string, number> } | undefined)?.lifetime_metrics ?? {}) as Record<string, number>;
  return { impressions: num(all.IMPRESSION), shares: num(all.SAVE), clicks: (num(all.PIN_CLICK) ?? 0) + (num(all.OUTBOUND_CLICK) ?? 0) };
}

// ── Dispatch ──

export async function publishTo(provider: MarketingSocialProvider, c: Conn, r: PublishRequest): Promise<PublishResult> {
  if (!r.text.trim() && !r.mediaUrl && !r.media) throw new ProviderError("empty_post");
  if (r.text.length > TEXT_LIMITS[provider]) throw new ProviderError("text_too_long");
  switch (provider) {
    case "LINKEDIN":
      return linkedinPublish(c, r);
    case "X":
      return xPublish(c.accessToken, r);
    case "FACEBOOK":
      return facebookPublish(c, r);
    case "INSTAGRAM":
      return instagramPublish(c, r);
    case "THREADS":
      return threadsPublish(c, r);
    case "YOUTUBE":
      return youtubePublish(c, r);
    case "TIKTOK":
      return tiktokPublish(c, r);
    case "PINTEREST":
      return pinterestPublish(c, r);
  }
}

/** Verify an asynchronous publish. Returns the final result, null while still processing, or throws when it failed. */
export async function checkPending(provider: MarketingSocialProvider, c: Conn, providerPostId: string, externalId?: string | null): Promise<PublishResult | null> {
  if (provider === "TIKTOK") return tiktokStatus(c, providerPostId);
  const container = providerPostId.replace(/^container:/, "");
  if (provider === "INSTAGRAM") {
    const s = await call(`${GRAPH}/${container}?${new URLSearchParams({ fields: "status_code", access_token: c.accessToken })}`);
    const code = str(s.json.status_code);
    if (code === "ERROR" || code === "EXPIRED") throw new ProviderError("provider_rejected", `Instagram media ${code}`);
    if (code !== "FINISHED") return null;
    return igPublishContainer(c, igUser(c, { externalId }), container);
  }
  if (provider === "THREADS") {
    const s = await call(`${THREADS}/${container}?${new URLSearchParams({ fields: "status,error_message", access_token: c.accessToken })}`);
    const code = str(s.json.status);
    if (code === "ERROR" || code === "EXPIRED") throw new ProviderError("provider_rejected", str(s.json.error_message) ?? `Threads media ${code}`);
    if (code !== "FINISHED") return null;
    return threadsPublishContainer(c, threadsUser(c, { externalId }), container);
  }
  return { providerPostId, url: null };
}

export async function fetchMetrics(provider: MarketingSocialProvider, c: Conn, providerPostId: string): Promise<Metrics> {
  switch (provider) {
    case "LINKEDIN":
      return linkedinMetrics(c.accessToken, providerPostId);
    case "X":
      return xMetrics(c.accessToken, providerPostId);
    case "FACEBOOK":
      return facebookMetrics(c, providerPostId);
    case "INSTAGRAM":
      return instagramMetrics(c.accessToken, providerPostId);
    case "THREADS":
      return threadsMetrics(c.accessToken, providerPostId);
    case "YOUTUBE":
      return youtubeMetrics(c.accessToken, providerPostId);
    case "TIKTOK":
      return tiktokMetrics(c.accessToken, providerPostId);
    case "PINTEREST":
      return pinterestMetrics(c.accessToken, providerPostId);
  }
}

// ── Community: comments on a published post and replies ──

export const COMMENTS_SUPPORTED: Record<MarketingSocialProvider, boolean> = { LINKEDIN: true, X: true, INSTAGRAM: true, FACEBOOK: true, YOUTUBE: true, THREADS: true, TIKTOK: false, PINTEREST: false };

const asDate = (v: unknown) => {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const rows = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export async function fetchComments(provider: MarketingSocialProvider, c: Conn, providerPostId: string): Promise<RemoteComment[]> {
  switch (provider) {
    case "FACEBOOK": {
      const res = await call(`${GRAPH}/${encodeURIComponent(providerPostId)}/comments?${new URLSearchParams({ fields: "id,message,from,created_time", limit: "50", access_token: fbPageToken(c) })}`);
      return rows(res.json.data).map((x) => ({ externalId: String(x.id), authorName: str((x.from as { name?: string } | undefined)?.name), text: String(x.message ?? ""), postedAt: asDate(x.created_time) }));
    }
    case "INSTAGRAM": {
      const res = await call(`${GRAPH}/${encodeURIComponent(providerPostId)}/comments?${new URLSearchParams({ fields: "id,text,username,timestamp", limit: "50", access_token: c.accessToken })}`);
      return rows(res.json.data).map((x) => ({ externalId: String(x.id), authorName: str(x.username), text: String(x.text ?? ""), postedAt: asDate(x.timestamp) }));
    }
    case "THREADS": {
      const res = await call(`${THREADS}/${encodeURIComponent(providerPostId)}/replies?${new URLSearchParams({ fields: "id,text,username,timestamp", access_token: c.accessToken })}`);
      return rows(res.json.data).map((x) => ({ externalId: String(x.id), authorName: str(x.username), text: String(x.text ?? ""), postedAt: asDate(x.timestamp) }));
    }
    case "YOUTUBE": {
      const res = await call(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=50&videoId=${encodeURIComponent(providerPostId)}`, { headers: bearer(c.accessToken) });
      return rows(res.json.items).map((x) => {
        const top = ((x.snippet as { topLevelComment?: unknown } | undefined)?.topLevelComment ?? {}) as { id?: string; snippet?: Record<string, unknown> };
        return { externalId: String(top.id ?? x.id), authorName: str(top.snippet?.authorDisplayName), text: String(top.snippet?.textOriginal ?? ""), postedAt: asDate(top.snippet?.publishedAt) };
      });
    }
    case "LINKEDIN": {
      const res = await call(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(providerPostId)}/comments`, { headers: LI(c.accessToken) });
      return rows(res.json.elements).map((x) => ({
        externalId: String(x.$URN ?? x.id),
        authorName: str(x.actor),
        text: String((x.message as { text?: string } | undefined)?.text ?? ""),
        postedAt: asDate((x.created as { time?: number } | undefined)?.time),
      }));
    }
    case "X": {
      const q = new URLSearchParams({ query: `conversation_id:${providerPostId}`, "tweet.fields": "author_id,created_at", max_results: "50" });
      const res = await call(`https://api.x.com/2/tweets/search/recent?${q}`, { headers: bearer(c.accessToken) });
      return rows(res.json.data).map((x) => ({ externalId: String(x.id), authorName: str(x.author_id), text: String(x.text ?? ""), postedAt: asDate(x.created_at) }));
    }
    default:
      throw new ProviderError("not_supported");
  }
}

export async function replyToComment(provider: MarketingSocialProvider, c: Conn, args: { postId: string; commentId: string; text: string; externalId?: string | null }): Promise<string> {
  let id: string | null = null;
  switch (provider) {
    case "FACEBOOK":
      id = str((await call(`${GRAPH}/${encodeURIComponent(args.commentId)}/comments`, form({ message: args.text, access_token: fbPageToken(c) }))).json.id);
      break;
    case "INSTAGRAM":
      id = str((await call(`${GRAPH}/${encodeURIComponent(args.commentId)}/replies`, form({ message: args.text, access_token: c.accessToken }))).json.id);
      break;
    case "THREADS":
      id = (await threadsPublish(c, { text: args.text, externalId: args.externalId }, args.commentId)).providerPostId;
      break;
    case "YOUTUBE":
      id = str(
        (
          await call("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
            method: "POST",
            headers: bearer(c.accessToken, { "content-type": "application/json" }),
            body: JSON.stringify({ snippet: { parentId: args.commentId, textOriginal: args.text } }),
          })
        ).json.id,
      );
      break;
    case "LINKEDIN": {
      const res = await call(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(args.postId)}/comments`, {
        method: "POST",
        headers: LI(c.accessToken),
        body: JSON.stringify({ actor: linkedinAuthor(c, { externalId: args.externalId }), message: { text: args.text }, parentComment: args.commentId }),
      });
      id = res.headers.get("x-restli-id") ?? str(res.json.$URN) ?? str(res.json.id);
      break;
    }
    case "X": {
      const res = await call("https://api.x.com/2/tweets", { method: "POST", headers: bearer(c.accessToken, { "content-type": "application/json" }), body: JSON.stringify({ text: args.text, reply: { in_reply_to_tweet_id: args.commentId } }) });
      id = str((res.json.data as { id?: string } | undefined)?.id);
      break;
    }
    default:
      throw new ProviderError("not_supported");
  }
  if (!id) throw new ProviderError("provider_no_id");
  return id;
}
