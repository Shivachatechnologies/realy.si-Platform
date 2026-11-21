import "server-only";
import { providerFetch } from "../client";
import { shotstackBase } from "../providers";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, usableConnection, withFallback, type ServiceResult } from "./common";

/**
 * Template / timeline video rendering: Creatomate (template + modifications, or a full source) and Shotstack (edit
 * timeline JSON). startRender returns "<provider>:<id>"; pollRender reports the provider's real status and output URL.
 * Completion callbacks go to the connection's provider-webhook URL when `callbackUrl` is passed.
 */

export const RENDER_PROVIDERS = ["creatomate", "shotstack"] as const;
type RenderProvider = (typeof RENDER_PROVIDERS)[number];

export interface StartRenderInput {
  /** Creatomate: template id + modifications (element name → value), or `source` (full RenderScript JSON). */
  templateId?: string;
  modifications?: Record<string, string | number | boolean | null>;
  source?: Record<string, unknown>;
  /** Shotstack: the Edit API body ({ timeline, output, merge? }). */
  edit?: { timeline: Record<string, unknown>; output: Record<string, unknown>; merge?: { find: string; replace: string }[] };
  /** Expected output length (seconds), used for the cost estimate only. */
  estimatedSeconds?: number;
  callbackUrl?: string;
  providers?: readonly RenderProvider[];
}

export type RenderStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface RenderJob {
  jobId: string;
  status: RenderStatus;
  url: string | null;
  error: string | null;
  estimatedCostMicros?: number | null;
}

const CREATOMATE = "https://api.creatomate.com/v1";

export async function startRender(organizationId: string, companyId: string, input: StartRenderInput): Promise<ServiceResult<RenderJob>> {
  const order = input.providers ?? (input.edit ? (["shotstack"] as const) : input.templateId || input.source ? (["creatomate"] as const) : RENDER_PROVIDERS);
  if (!input.edit && !input.templateId && !input.source) return { ok: false, code: "invalid_input", error: "Provide a Creatomate template/source or a Shotstack edit", providerId: null, attempts: [] };
  if (input.templateId && !/^[A-Za-z0-9-]{8,64}$/.test(input.templateId)) return { ok: false, code: "invalid_input", error: "Invalid template id", providerId: null, attempts: [] };
  const callback = input.callbackUrl && /^https:\/\//.test(input.callbackUrl) ? input.callbackUrl : undefined;
  const secs = Math.max(1, Math.min(600, Math.round(input.estimatedSeconds ?? 30)));
  return withFallback(organizationId, companyId, order, async (conn) => {
    const provider = conn.provider as RenderProvider;
    const est = FLAT_COST_MICROS[`${provider}.second`]! * secs;
    try {
      let id: string;
      if (provider === "creatomate") {
        if (!input.templateId && !input.source) throw new Error("Creatomate needs a template id or source");
        const res = await providerFetch<{ id?: string; status?: string }[] | { id?: string }>(conn, `${CREATOMATE}/renders`, {
          json: { ...(input.templateId ? { template_id: input.templateId, modifications: input.modifications ?? {} } : { source: input.source }), ...(callback ? { webhook_url: callback } : {}) },
          retries: 1,
          timeoutMs: 30_000,
        });
        ensureOk(res, "Creatomate render");
        const first = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!first?.id) throw new Error("Creatomate returned no render id");
        id = first.id;
      } else {
        if (!input.edit) throw new Error("Shotstack needs an edit timeline");
        const res = await providerFetch<{ success?: boolean; response?: { id?: string } }>(conn, `${shotstackBase(conn.config)}/render`, { json: { ...input.edit, ...(callback ? { callback } : {}) }, retries: 1, timeoutMs: 30_000 });
        ensureOk(res, "Shotstack render");
        if (!res.data?.response?.id) throw new Error("Shotstack returned no render id");
        id = res.data.response.id;
      }
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.render", units: secs, unit: "second", estimatedCostMicros: est, status: "SUCCEEDED", meta: { renderId: id } });
      return { jobId: `${provider}:${id}`, status: "PENDING" as const, url: null, error: null, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider, operation: "video.render", units: 0, unit: "second", estimatedCostMicros: 0, status: "FAILED", error: errorText(err) });
      throw err;
    }
  });
}

const CREATOMATE_STATUS: Record<string, RenderStatus> = { planned: "PENDING", waiting: "PENDING", transcribing: "RUNNING", rendering: "RUNNING", succeeded: "SUCCEEDED", failed: "FAILED" };
const SHOTSTACK_STATUS: Record<string, RenderStatus> = { queued: "PENDING", fetching: "RUNNING", preprocessing: "RUNNING", rendering: "RUNNING", saving: "RUNNING", done: "SUCCEEDED", failed: "FAILED" };

export async function pollRender(organizationId: string, companyId: string, jobId: string): Promise<ServiceResult<RenderJob>> {
  const m = /^(creatomate|shotstack):([A-Za-z0-9-]{8,64})$/.exec(jobId);
  if (!m) return { ok: false, code: "invalid_input", error: "Unknown render id", providerId: null, attempts: [] };
  const [, provider, id] = m as unknown as [string, RenderProvider, string];
  const conn = await usableConnection(organizationId, companyId, provider);
  if (!conn) return { ok: false, code: "not_connected", error: `${provider} is not connected`, providerId: provider, attempts: [{ providerId: provider, outcome: "not_connected" }] };
  try {
    if (provider === "creatomate") {
      const res = await providerFetch<{ status?: string; url?: string; error_message?: string }>(conn, `${CREATOMATE}/renders/${encodeURIComponent(id)}`, { retries: 2 });
      ensureOk(res, "Creatomate render status");
      const d = res.data ?? {};
      return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: CREATOMATE_STATUS[d.status ?? ""] ?? "PENDING", url: d.status === "succeeded" ? (d.url ?? null) : null, error: d.error_message ?? null } };
    }
    const res = await providerFetch<{ response?: { status?: string; url?: string; error?: string } }>(conn, `${shotstackBase(conn.config)}/render/${encodeURIComponent(id)}`, { retries: 2 });
    ensureOk(res, "Shotstack render status");
    const d = res.data?.response ?? {};
    return { ok: true, providerId: provider, attempts: [{ providerId: provider, outcome: "ok" }], data: { jobId, status: SHOTSTACK_STATUS[d.status ?? ""] ?? "PENDING", url: d.status === "done" ? (d.url ?? null) : null, error: d.error ?? null } };
  } catch (err) {
    return { ok: false, code: "provider_error", error: errorText(err), providerId: provider, attempts: [{ providerId: provider, outcome: "error", error: errorText(err) }] };
  }
}
