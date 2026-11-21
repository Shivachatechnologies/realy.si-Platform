import "server-only";
import { providerFetch } from "../client";
import { recordUsage } from "../usage";
import { ensureOk, errorText, usableConnection, type ServiceResult } from "./common";

/**
 * Licensed music for videos. Music comes ONLY from a configured licensed source or the founder's own upload (handled by
 * the creative module with a license attestation) — never scraped.
 *
 *  - `jamendo` (implemented): Jamendo API v3 (api.jamendo.com) with the company's own client id. Only tracks whose
 *    Creative Commons license allows commercial use and adaptation (no -NC, no -ND) are returned, each with its license
 *    URL and the attribution the license requires.
 *  - `epidemic_sound` (adapter awaiting provider docs/credentials): the partner API needs a contract; not callable.
 *
 * Integrations catalog entry needed: `jamendo` (api_key; field apiKey = Jamendo client id; sent as client_id query).
 */

export const MUSIC_ADAPTERS = { jamendo: { status: "implemented" }, epidemic_sound: { status: "awaiting_docs" } } as const;

export interface LicensedTrack {
  source: "jamendo";
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  /** Preview / download URL hosted by the source (download allowed by the source). */
  audioUrl: string;
  licenseUrl: string;
  attribution: string;
  pageUrl: string | null;
}

const COMMERCIAL_OK = (url: string) => /creativecommons\.org\/licenses\/(by|by-sa)\//i.test(url) || /creativecommons\.org\/publicdomain\//i.test(url);

export async function searchLicensedMusic(organizationId: string, companyId: string, query: string, opts: { limit?: number; id?: string } = {}): Promise<ServiceResult<{ tracks: LicensedTrack[] }>> {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 100);
  const conn = await usableConnection(organizationId, companyId, "jamendo");
  if (!conn) return { ok: false, code: "not_connected", error: "No licensed music source connected (connect Jamendo or upload your own licensed track)", providerId: null, attempts: [{ providerId: "jamendo", outcome: "not_connected" }] };
  const limit = Math.min(Math.max(1, opts.limit ?? 12), 30);
  try {
    const url = new URL("https://api.jamendo.com/v3.0/tracks/");
    url.searchParams.set("client_id", conn.accessToken);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(limit * 3));
    url.searchParams.set("audioformat", "mp32");
    url.searchParams.set("include", "licenses");
    url.searchParams.set("order", "popularity_total");
    if (opts.id && /^\d{1,12}$/.test(opts.id)) url.searchParams.set("id", opts.id);
    else if (q) url.searchParams.set("search", q);
    const res = await providerFetch<{ headers?: { status?: string; error_message?: string }; results?: { id?: string; name?: string; artist_name?: string; duration?: number; audio?: string; audiodownload?: string; audiodownload_allowed?: boolean; license_ccurl?: string; shareurl?: string }[] }>(
      conn,
      url.toString(),
      { noAuth: true, retries: 2, timeoutMs: 20_000 },
    );
    ensureOk(res, "Jamendo search");
    if (res.data?.headers?.status && res.data.headers.status !== "success") throw new Error(`Jamendo: ${res.data.headers.error_message ?? res.data.headers.status}`);
    const tracks: LicensedTrack[] = [];
    for (const r of res.data?.results ?? []) {
      const license = r.license_ccurl ?? "";
      const audio = r.audiodownload_allowed && r.audiodownload ? r.audiodownload : null;
      if (!r.id || !audio || !COMMERCIAL_OK(license) || !/^https:\/\//.test(audio)) continue;
      tracks.push({
        source: "jamendo",
        id: String(r.id),
        title: (r.name ?? "Untitled").slice(0, 200),
        artist: (r.artist_name ?? "Unknown artist").slice(0, 200),
        durationSeconds: Number(r.duration ?? 0),
        audioUrl: audio,
        licenseUrl: license,
        attribution: `"${r.name ?? "Untitled"}" by ${r.artist_name ?? "Unknown artist"} (Jamendo) — ${license}`,
        pageUrl: r.shareurl ?? null,
      });
      if (tracks.length >= limit) break;
    }
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "jamendo", operation: "music.search", units: 1, unit: "request", estimatedCostMicros: 0, status: "SUCCEEDED", meta: { results: tracks.length } });
    return { ok: true, providerId: "jamendo", attempts: [{ providerId: "jamendo", outcome: "ok" }], data: { tracks } };
  } catch (err) {
    await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "jamendo", operation: "music.search", units: 0, unit: "request", estimatedCostMicros: 0, status: "FAILED", error: errorText(err) });
    return { ok: false, code: "provider_error", error: errorText(err), providerId: "jamendo", attempts: [{ providerId: "jamendo", outcome: "error", error: errorText(err) }] };
  }
}
