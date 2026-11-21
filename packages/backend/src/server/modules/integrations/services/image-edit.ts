import "server-only";
import { providerFetch } from "../client";
import { FLAT_COST_MICROS, estimateTokenCostMicros, recordUsage } from "../usage";
import { ensureOk, errorText, withFallback, type ServiceResult } from "./common";
import { newObjectKey, putObject, type StoredObject } from "./storage";
import type { ImageSize } from "./images";

/**
 * Image editing, upscaling and visual review for the creative studio:
 *  - editImage: OpenAI Images edits (gpt-image-1) — changes an existing image from an instruction;
 *  - upscaleImage: Stability AI fast upscaler (4×);
 *  - reviewImage: OpenAI vision (chat completions with image input) answering a JSON checklist (logo usage, text
 *    legibility, brand fit). Results are stored through the storage service; nothing is returned without a provider result.
 */

const UPSCALE_COST_MICROS = 20_000;
const extOf = (ct: string) => (ct.includes("jpeg") ? "jpg" : ct.includes("webp") ? "webp" : "png");

export interface ImageBytes {
  bytes: Uint8Array;
  contentType: string;
}

export interface EditedImage {
  image: StoredObject;
  model: string;
  estimatedCostMicros: number | null;
}

export async function editImage(organizationId: string, companyId: string, input: ImageBytes & { prompt: string; size?: ImageSize }): Promise<ServiceResult<EditedImage>> {
  const prompt = input.prompt.trim();
  if (prompt.length < 3 || prompt.length > 4000) return { ok: false, code: "invalid_input", error: "Describe the change (3–4000 characters)", providerId: null, attempts: [] };
  if (input.bytes.length > 25 * 1024 * 1024) return { ok: false, code: "invalid_input", error: "Image too large to edit", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["openai"], async (conn) => {
    const model = "gpt-image-1";
    const est = FLAT_COST_MICROS["openai.image"] ?? null;
    try {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("n", "1");
      if (input.size) form.set("size", input.size);
      form.set("image", new Blob([Buffer.from(input.bytes)], { type: input.contentType }), `source.${extOf(input.contentType)}`);
      const res = await providerFetch<{ data?: { b64_json?: string }[] }>(conn, "https://api.openai.com/v1/images/edits", { raw: form, timeoutMs: 180_000, retries: 1, costCents: est === null ? undefined : est / 10_000 });
      ensureOk(res, "OpenAI image edit");
      const b64 = res.data?.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI returned no edited image");
      const stored = await putObject(organizationId, companyId, { key: newObjectKey("creative-images", "png"), body: new Uint8Array(Buffer.from(b64, "base64")), contentType: "image/png" });
      if (!stored.ok) throw new Error(`edited image could not be stored: ${stored.error}`);
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "openai", operation: "images.edit", units: 1, unit: "image", estimatedCostMicros: est, status: "SUCCEEDED", meta: { model } });
      return { image: stored.data, model, estimatedCostMicros: est };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "openai", operation: "images.edit", units: 0, unit: "image", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}

export async function upscaleImage(organizationId: string, companyId: string, input: ImageBytes): Promise<ServiceResult<EditedImage>> {
  if (input.bytes.length > 10 * 1024 * 1024) return { ok: false, code: "invalid_input", error: "Image too large to upscale", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["stability"], async (conn) => {
    const model = "stable-fast-upscale";
    try {
      const form = new FormData();
      form.set("image", new Blob([Buffer.from(input.bytes)], { type: input.contentType }), `source.${extOf(input.contentType)}`);
      form.set("output_format", "png");
      const res = await providerFetch<{ image?: string; finish_reason?: string }>(conn, "https://api.stability.ai/v2beta/stable-image/upscale/fast", { raw: form, timeoutMs: 120_000, retries: 1, costCents: UPSCALE_COST_MICROS / 10_000 });
      ensureOk(res, "Stability upscale");
      if (res.data?.finish_reason === "CONTENT_FILTERED") throw new Error("Stability filtered the image (content policy)");
      if (!res.data?.image) throw new Error("Stability returned no image");
      const stored = await putObject(organizationId, companyId, { key: newObjectKey("creative-images", "png"), body: new Uint8Array(Buffer.from(res.data.image, "base64")), contentType: "image/png" });
      if (!stored.ok) throw new Error(`upscaled image could not be stored: ${stored.error}`);
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "stability", operation: "images.upscale", units: 1, unit: "image", estimatedCostMicros: UPSCALE_COST_MICROS, status: "SUCCEEDED", meta: { model } });
      return { image: stored.data, model, estimatedCostMicros: UPSCALE_COST_MICROS };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "stability", operation: "images.upscale", units: 0, unit: "image", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}

export interface ImageReview {
  answer: Record<string, unknown>;
  model: string;
  estimatedCostMicros: number | null;
}

/** Ask a vision model a checklist about one or more images (HTTPS URLs); returns its parsed JSON answer. */
export async function reviewImage(organizationId: string, companyId: string, input: { imageUrls: string[]; question: string }): Promise<ServiceResult<ImageReview>> {
  const urls = input.imageUrls.filter((u) => /^https:\/\//.test(u)).slice(0, 3);
  if (!urls.length) return { ok: false, code: "invalid_input", error: "No image to review", providerId: null, attempts: [] };
  return withFallback(organizationId, companyId, ["openai"], async (conn) => {
    const model = "gpt-4.1-mini";
    try {
      const res = await providerFetch<{ choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }>(conn, "https://api.openai.com/v1/chat/completions", {
        json: {
          model,
          response_format: { type: "json_object" },
          max_completion_tokens: 600,
          messages: [
            { role: "system", content: "You are a meticulous brand designer reviewing creative assets. Answer only with a JSON object. Be factual about what is visible; never guess." },
            { role: "user", content: [{ type: "text", text: input.question.slice(0, 4000) }, ...urls.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } }))] },
          ],
        },
        timeoutMs: 60_000,
        retries: 1,
      });
      ensureOk(res, "OpenAI vision review");
      const text = res.data?.choices?.[0]?.message?.content ?? "";
      let answer: Record<string, unknown>;
      try {
        answer = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error("vision model returned no JSON");
      }
      const cost = estimateTokenCostMicros(model, res.data?.usage?.prompt_tokens ?? 0, res.data?.usage?.completion_tokens ?? 0);
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "openai", operation: "images.review", units: (res.data?.usage?.prompt_tokens ?? 0) + (res.data?.usage?.completion_tokens ?? 0), unit: "token", estimatedCostMicros: cost, status: "SUCCEEDED", meta: { model } });
      return { answer, model, estimatedCostMicros: cost };
    } catch (err) {
      await recordUsage({ organizationId, companyId, connectionId: conn.id, provider: "openai", operation: "images.review", units: 0, unit: "token", estimatedCostMicros: 0, status: "FAILED", error: errorText(err), meta: { model } });
      throw err;
    }
  });
}
