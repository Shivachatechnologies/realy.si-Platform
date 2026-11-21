import { hmacSha256, safeEqual } from "@/server/core/crypto";

/**
 * Signature verification of incoming webhooks (pure functions, no I/O). Besides Realy's own TOKEN and HMAC_SHA256 modes,
 * provider presets verify each provider's documented scheme with the signing secret the provider issued:
 *   STRIPE   Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>   (5-minute tolerance)
 *   GITHUB   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, body)>
 *   SHOPIFY  X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256(secret, body)>
 *   SLACK    X-Slack-Signature: v0=<hex HMAC-SHA256(secret, "v0:<ts>:<body>")> with X-Slack-Request-Timestamp (5 minutes)
 */

export const HOOK_VERIFICATIONS = ["TOKEN", "HMAC_SHA256", "STRIPE", "GITHUB", "SHOPIFY", "SLACK"] as const;
export type HookVerification = (typeof HOOK_VERIFICATIONS)[number];
export const PROVIDER_PRESETS = ["STRIPE", "GITHUB", "SHOPIFY", "SLACK"] as const satisfies readonly HookVerification[];
export const isProviderPreset = (v: string): v is (typeof PROVIDER_PRESETS)[number] => (PROVIDER_PRESETS as readonly string[]).includes(v);

/** Header each preset reads (shown in the UI; the stored signatureHeader is used only by HMAC_SHA256). */
export const PRESET_HEADERS: Record<(typeof PROVIDER_PRESETS)[number], string> = {
  STRIPE: "stripe-signature",
  GITHUB: "x-hub-signature-256",
  SHOPIFY: "x-shopify-hmac-sha256",
  SLACK: "x-slack-signature",
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
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

const fresh = (ts: number, now: number) => Number.isFinite(ts) && Math.abs(now - ts) <= TOLERANCE_S;

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
  }
}
