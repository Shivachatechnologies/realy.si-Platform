import { createHmac } from "node:crypto";
import { hmacSha256, safeEqual } from "@/server/core/crypto";

/**
 * Signature verification of incoming webhooks (pure functions, no I/O). Besides Realy's own TOKEN and HMAC_SHA256 modes,
 * provider presets verify each provider's documented scheme with the signing secret the provider issued:
 *   STRIPE   Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>   (5-minute tolerance)
 *   GITHUB   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, body)>
 *   SHOPIFY  X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256(secret, body)>
 *   SLACK    X-Slack-Signature: v0=<hex HMAC-SHA256(secret, "v0:<ts>:<body>")> with X-Slack-Request-Timestamp (5 minutes)
 *   TWILIO   X-Twilio-Signature: <base64 HMAC-SHA1(authToken, url + sorted form key/value pairs)>   (needs the public URL)
 *   CALENDLY Calendly-Webhook-Signature: t=<unix>,v1=<hex HMAC-SHA256(signingKey, "<t>.<body>")>   (5 minutes)
 *   META     X-Hub-Signature-256: sha256=<hex HMAC-SHA256(appSecret, body)>   (WhatsApp Cloud API, Meta apps)
 *   ELEVENLABS ElevenLabs-Signature: t=<unix>,v0=<hex HMAC-SHA256(secret, "<t>.<body>")>   (30 minutes)
 *   ZENDESK  X-Zendesk-Webhook-Signature: <base64 HMAC-SHA256(secret, timestamp + body)> with ...-Timestamp
 *   INTERCOM X-Hub-Signature: sha1=<hex HMAC-SHA1(clientSecret, body)>
 */

export const HOOK_VERIFICATIONS = ["TOKEN", "HMAC_SHA256", "STRIPE", "GITHUB", "SHOPIFY", "SLACK", "TWILIO", "CALENDLY", "META", "ELEVENLABS", "ZENDESK", "INTERCOM"] as const;
export type HookVerification = (typeof HOOK_VERIFICATIONS)[number];
export const PROVIDER_PRESETS = ["STRIPE", "GITHUB", "SHOPIFY", "SLACK", "TWILIO", "CALENDLY", "META", "ELEVENLABS", "ZENDESK", "INTERCOM"] as const satisfies readonly HookVerification[];
export const isProviderPreset = (v: string): v is (typeof PROVIDER_PRESETS)[number] => (PROVIDER_PRESETS as readonly string[]).includes(v);

/** Header each preset reads (shown in the UI; the stored signatureHeader is used only by HMAC_SHA256). */
export const PRESET_HEADERS: Record<(typeof PROVIDER_PRESETS)[number], string> = {
  STRIPE: "stripe-signature",
  GITHUB: "x-hub-signature-256",
  SHOPIFY: "x-shopify-hmac-sha256",
  SLACK: "x-slack-signature",
  TWILIO: "x-twilio-signature",
  CALENDLY: "calendly-webhook-signature",
  META: "x-hub-signature-256",
  ELEVENLABS: "elevenlabs-signature",
  ZENDESK: "x-zendesk-webhook-signature",
  INTERCOM: "x-hub-signature",
};

const TOLERANCE_S = 5 * 60;

export interface VerifyInput {
  verification: HookVerification;
  secret: string;
  raw: string;
  headers: Headers;
  query: URLSearchParams;
  /** HMAC_SHA256 mode: header carrying the signature. */
  signatureHeader: string;
  nowSeconds?: number;
  /** Public URL the provider called (with query string): required by TWILIO, which signs the URL. */
  url?: string;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const fresh = (ts: number, now: number, tolerance = TOLERANCE_S) => Number.isFinite(ts) && Math.abs(now - ts) <= tolerance;

/** "t=…,v1=…" style headers (Stripe, Calendly, ElevenLabs). */
const kvParts = (header: string) => header.split(",").map((p) => p.trim().split("=")) as [string, string | undefined][];

/** Twilio request signature: base64 HMAC-SHA1 over the full URL followed by the sorted POST parameters (name + value). */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams | Record<string, string>): string {
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params);
  const data = url + entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => k + v).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyHookSignature(i: VerifyInput): VerifyResult {
  const now = i.nowSeconds ?? Math.floor(Date.now() / 1000);
  const h = (name: string) => i.headers.get(name)?.trim() ?? "";
  switch (i.verification) {
    case "TOKEN": {
      const bearer = i.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const token = i.headers.get("x-realy-token") ?? bearer ?? i.query.get("token");
      return token && safeEqual(token, i.secret) ? { ok: true } : { ok: false, reason: "token verification failed" };
    }
    case "HMAC_SHA256": {
      const sig = h(i.signatureHeader).replace(/^sha256=/i, "").toLowerCase();
      return sig && safeEqual(sig, hmacSha256(i.secret, i.raw).toString("hex")) ? { ok: true } : { ok: false, reason: "signature verification failed" };
    }
    case "STRIPE": {
      const parts = h("stripe-signature").split(",").map((p) => p.trim().split("="));
      const t = Number(parts.find(([k]) => k === "t")?.[1]);
      const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => (v ?? "").toLowerCase());
      if (!sigs.length || !Number.isFinite(t)) return { ok: false, reason: "missing Stripe-Signature" };
      if (!fresh(t, now)) return { ok: false, reason: "Stripe signature timestamp outside tolerance" };
      const expected = hmacSha256(i.secret, `${t}.${i.raw}`).toString("hex");
      return sigs.some((s) => safeEqual(s, expected)) ? { ok: true } : { ok: false, reason: "Stripe signature verification failed" };
    }
    case "GITHUB": {
      const sig = h("x-hub-signature-256").replace(/^sha256=/i, "").toLowerCase();
      return sig && safeEqual(sig, hmacSha256(i.secret, i.raw).toString("hex")) ? { ok: true } : { ok: false, reason: "GitHub signature verification failed" };
    }
    case "SHOPIFY": {
      const sig = h("x-shopify-hmac-sha256");
      return sig && safeEqual(sig, hmacSha256(i.secret, i.raw).toString("base64")) ? { ok: true } : { ok: false, reason: "Shopify signature verification failed" };
    }
    case "SLACK": {
      const ts = Number(h("x-slack-request-timestamp"));
      const sig = h("x-slack-signature").toLowerCase();
      if (!sig || !Number.isFinite(ts)) return { ok: false, reason: "missing Slack signature headers" };
      if (!fresh(ts, now)) return { ok: false, reason: "Slack request timestamp outside tolerance" };
      return safeEqual(sig, `v0=${hmacSha256(i.secret, `v0:${ts}:${i.raw}`).toString("hex")}`) ? { ok: true } : { ok: false, reason: "Slack signature verification failed" };
    }
    case "TWILIO": {
      const sig = h("x-twilio-signature");
      if (!sig || !i.url) return { ok: false, reason: "missing X-Twilio-Signature" };
      const ct = i.headers.get("content-type") ?? "";
      const params = ct.includes("application/x-www-form-urlencoded") ? new URLSearchParams(i.raw) : new URLSearchParams();
      return safeEqual(sig, twilioSignature(i.secret, i.url, params)) ? { ok: true } : { ok: false, reason: "Twilio signature verification failed" };
    }
    case "CALENDLY": {
      const parts = kvParts(h("calendly-webhook-signature"));
      const t = Number(parts.find(([k]) => k === "t")?.[1]);
      const sig = (parts.find(([k]) => k === "v1")?.[1] ?? "").toLowerCase();
      if (!sig || !Number.isFinite(t)) return { ok: false, reason: "missing Calendly-Webhook-Signature" };
      if (!fresh(t, now)) return { ok: false, reason: "Calendly signature timestamp outside tolerance" };
      return safeEqual(sig, hmacSha256(i.secret, `${t}.${i.raw}`).toString("hex")) ? { ok: true } : { ok: false, reason: "Calendly signature verification failed" };
    }
    case "META": {
      const sig = h("x-hub-signature-256").replace(/^sha256=/i, "").toLowerCase();
      return sig && safeEqual(sig, hmacSha256(i.secret, i.raw).toString("hex")) ? { ok: true } : { ok: false, reason: "Meta signature verification failed" };
    }
    case "ELEVENLABS": {
      const parts = kvParts(h("elevenlabs-signature"));
      const t = Number(parts.find(([k]) => k === "t")?.[1]);
      const sig = (parts.find(([k]) => k === "v0")?.[1] ?? "").toLowerCase();
      if (!sig || !Number.isFinite(t)) return { ok: false, reason: "missing ElevenLabs-Signature" };
      if (!fresh(t, now, 30 * 60)) return { ok: false, reason: "ElevenLabs signature timestamp outside tolerance" };
      return safeEqual(sig, hmacSha256(i.secret, `${t}.${i.raw}`).toString("hex")) ? { ok: true } : { ok: false, reason: "ElevenLabs signature verification failed" };
    }
    case "ZENDESK": {
      const sig = h("x-zendesk-webhook-signature");
      const ts = h("x-zendesk-webhook-signature-timestamp");
      if (!sig || !ts) return { ok: false, reason: "missing Zendesk signature headers" };
      const tsSeconds = Math.floor(Date.parse(ts) / 1000);
      if (!fresh(tsSeconds, now)) return { ok: false, reason: "Zendesk signature timestamp outside tolerance" };
      return safeEqual(sig, hmacSha256(i.secret, `${ts}${i.raw}`).toString("base64")) ? { ok: true } : { ok: false, reason: "Zendesk signature verification failed" };
    }
    case "INTERCOM": {
      const sig = h("x-hub-signature").replace(/^sha1=/i, "").toLowerCase();
      return sig && safeEqual(sig, createHmac("sha1", i.secret).update(i.raw, "utf8").digest("hex")) ? { ok: true } : { ok: false, reason: "Intercom signature verification failed" };
    }
  }
}
