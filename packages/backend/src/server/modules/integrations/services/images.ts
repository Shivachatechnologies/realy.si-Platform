import "server-only";
import { guardedFetch } from "@/server/core/outbound";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, recordUsage } from "../usage";
import { ensureOk, errorText, spendBlocked, str, withFallback, type ServiceResult } from "./common";
import { newObjectKey, putObject, type StoredObject } from "./storage";

/**
 * Image generation with provider fallback OpenAI Images → Stability AI → Replicate. Every image is stored through the
 * storage service (company S3 bucket, or the database fallback) and returned with a signed URL.
 */

export const IMAGE_PROVIDERS = ["openai", "stability", "replicate"] as const;
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface GenerateImageInput {
  prompt: string;
  size?: ImageSize;
  n?: number;
  providers?: readonly (typeof IMAGE_PROVIDERS)[number][];
}

export interface GeneratedImages {
  images: StoredObject[];
  model: string;
  /** Estimated cost of this call in micro-USD (same value as its usage record); null when the price is unknown. */
  estimatedCostMicros: number | null;
}

const ASPECT: Record<ImageSize, string> = { "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Download a provider-hosted output (Replicate delivery URLs) with a size cap. */
async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!/^https:\/\//.test(url)) throw new Error("provider returned a non-HTTPS output URL");
  // The URL comes from a provider response: every hop is checked (core/outbound), the body is capped.
  const res = await guardedFetch(url, { signal: AbortSignal.timeout(60_000) }, { maxBytes: 50 * 1024 * 1024 });
  if (!res.ok) throw new Error(`output download failed (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 50 * 1024 * 1024) throw new Error("output too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType: (res.headers.get("content-type") ?? "image/png").split(";")[0]!.trim() };
}

const extOf = (contentType: string) => (contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png");

export async function generateImage(organizationId: string, companyId: string, input: GenerateImageInput): Promise<ServiceResult<GeneratedImages>> {
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 4000) return { ok: false, code: "invalid_input", error: prompt ? "Prompt is too long" : "Prompt is empty", providerId: null, attempts: [] };
  const size: ImageSize = input.size && (IMAGE_SIZES as readonly string[]).includes(input.size) ? input.size : "1024x1024";
  const n = Math.min(Math.max(1, Math.floor(input.n ?? 1)), 4);

  const blocked = await spendBlocked(organizationId, companyId, (FLAT_COST_MICROS["openai.image"] ?? 0) * n);
  if (blocked) return blocked;

  return withFallback(organizationId, companyId, input.providers ?? IMAGE_PROVIDERS, async (conn) => {
    let model = "";
    try {
      const outputs: { bytes: Uint8Array; contentType: string }[] = [];
      if (conn.provider === "openai") {
        model = "gpt-image-1";
        const res = await providerFetch<{ data?: { b64_json?: string; url?: string }[] }>(conn, "https://api.openai.com/v1/images/generations", { json: { model, prompt, size, n }, timeoutMs: 180_000, retries: 1, costCents: (FLAT_COST_MICROS["openai.image"]! * n) / 10_000 });
        ensureOk(res, "OpenAI image generation");
        for (const d of res.data?.data ?? []) {
          if (d.b64_json) outputs.push({ bytes: new Uint8Array(Buffer.from(d.b64_json, "base64")), contentType: "image/png" });
          else if (d.url) outputs.push(await download(d.url));
        }
      } else if (conn.provider === "stability") {
        model = "stable-image-core";
        for (let i = 0; i < n; i++) {
          const form = new FormData();
          form.set("prompt", prompt);
          form.set("aspect_ratio", ASPECT[size]);
          form.set("output_format", "png");
          const res = await providerFetch<{ image?: string; finish_reason?: string }>(conn, "https://api.stability.ai/v2beta/stable-image/generate/core", { raw: form, timeoutMs: 120_000, retries: 1, costCents: FLAT_COST_MICROS["stability.image"]! / 10_000 });
          ensureOk(res, "Stability image generation");
          if (res.data?.finish_reason === "CONTENT_FILTERED") throw new Error("Stability filtered the image (content policy)");
          if (res.data?.image) outputs.push({ bytes: new Uint8Array(Buffer.from(res.data.image, "base64")), contentType: "image/png" });
        }
      } else {
        model = str(conn.config.imageModel) ?? "black-forest-labs/flux-schnell";
        const res = await providerFetch<{ id?: string; status?: string; output?: string[] | string; error?: string; urls?: { get?: string } }>(
          conn,
          `https://api.replicate.com/v1/models/${model}/predictions`,
          { json: { input: { prompt, num_outputs: n, aspect_ratio: ASPECT[size], output_format: "png" } }, headers: { prefer: "wait=60" }, timeoutMs: 90_000, retries: 1, costCents: (FLAT_COST_MICROS["replicate.image"]! * n) / 10_000 },
        );
        ensureOk(res, "Replicate prediction");
        let pred = res.data;
        // Poll briefly if the synchronous wait was not enough.
        for (let i = 0; i < 20 && pred?.id && pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled"; i++) {
          await sleep(3000);
          const p = await providerFetch<typeof pred>(conn, `https://api.replicate.com/v1/predictions/${encodeURIComponent(pred.id)}`, { retries: 1 });
          ensureOk(p, "Replicate prediction status");
          pred = p.data;
        }
        if (pred?.status !== "succeeded") throw new Error(`Replicate prediction ${pred?.status ?? "failed"}${pred?.error ? `: ${String(pred.error).slice(0, 160)}` : ""}`);
        const urls = Array.isArray(pred.output) ? pred.output : pred.output ? [pred.output] : [];
        for (const u of urls.slice(0, n)) outputs.push(await download(u));
      }
      if (!outputs.length) throw new Error(`${conn.provider} returned no image`);
      const images: StoredObject[] = [];
      for (const o of outputs) {
        const stored = await putObject(organizationId, companyId, { key: newObjectKey("generated-images", extOf(o.contentType)), body: o.bytes, contentType: o.contentType });
        if (!stored.ok) throw new Error(`image generated but could not be stored: ${stored.error}`);
        images.push(stored.data);
      }
      const unit = FLAT_COST_MICROS[`${conn.provider}.image`] ?? null;
      const estimatedCostMicros = unit === null ? null : unit * images.length;
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "images.generate", units: images.length, unit: "image", estimatedCostMicros, status: "SUCCEEDED", meta: { model, size } });
      return { images, model, estimatedCostMicros };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: conn.provider, operation: "images.generate", units: 0, unit: "image", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model, size } });
      throw err;
    }
  });
}
