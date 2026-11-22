import { afterEach, describe, expect, it } from "vitest";
import { customerConnectMode, isPlatformManaged, PLATFORM_MANAGED_PROVIDERS, platformCredentialFields, providerInfo } from "@/server/modules/integrations/catalog";
import { isPlatformKey, PLATFORM_KEYS, platformKeyDef } from "@/server/core/platform-secrets-catalog";
import { isPlatformProviderConfigured, platformConnection, platformConnectionId } from "@/server/modules/integrations/platform-managed";

const ORG = "00000000-0000-4000-8000-000000000001";
const CO = "00000000-0000-4000-8000-000000000002";
const set: string[] = [];
const setEnv = (k: string, v: string) => {
  set.push(k);
  process.env[k] = v;
};

afterEach(() => {
  for (const k of set.splice(0)) delete process.env[k];
});

describe("platform-managed providers", () => {
  it("covers every Realy-account provider, not customer accounts", () => {
    for (const p of ["openai", "gemini", "openrouter", "openai_compatible", "tavily", "exa", "serpapi", "apollo", "hunter", "pdl", "stability", "replicate", "runway", "elevenlabs", "deepgram", "jamendo", "luma", "kling", "shotstack", "creatomate", "twilio_voice", "sip_trunk", "vapi", "retell"]) {
      expect(isPlatformManaged(p)).toBe(true);
    }
    // Email, messaging, storage and payments also run on Realy's accounts.
    for (const p of ["sendgrid", "mailchimp", "twilio", "whatsapp", "s3", "cloudflare", "stripe", "razorpay"]) expect(isPlatformManaged(p)).toBe(true);
    // The customer's OWN accounts are not platform-managed.
    for (const p of ["google", "slack", "hubspot", "quickbooks", "notion", "shopify", "webhook"]) expect(isPlatformManaged(p)).toBe(false);
  });

  it("lets customers connect only their own accounts through OAuth", () => {
    expect(customerConnectMode(providerInfo("slack")!)).toBe("oauth");
    expect(customerConnectMode(providerInfo("google_ads")!)).toBe("oauth");
    expect(customerConnectMode(providerInfo("openai")!)).toBe("platform");
    expect(customerConnectMode(providerInfo("mailchimp")!)).toBe("platform");
    expect(customerConnectMode(providerInfo("notion")!)).toBe("unavailable");
    expect(customerConnectMode(providerInfo("custom_api")!)).toBe("unavailable");
  });

  it("gives every credential field of every provider a write-only (secret) or plain platform key", () => {
    for (const p of PLATFORM_MANAGED_PROVIDERS) {
      const info = providerInfo(p)!;
      const fields = platformCredentialFields(info);
      expect(fields.length).toBeGreaterThan(0);
      for (const f of fields) {
        const def = platformKeyDef(f.envKey);
        expect(def, f.envKey).toBeDefined();
        expect(isPlatformKey(f.envKey)).toBe(true);
        expect(def!.kind).toBe(f.secret ? "secret" : "plain");
        expect(def!.provider).toBe(p);
      }
    }
    expect(platformKeyDef("OPENAI_API_KEY")?.group).toBe("ai");
    expect(platformKeyDef("TWILIO_VOICE_AUTH_TOKEN")?.group).toBe("telephony");
    expect(platformKeyDef("KLING_SECRET_KEY")?.kind).toBe("secret");
    expect(new Set(PLATFORM_KEYS.map((k) => k.key)).size).toBe(PLATFORM_KEYS.length);
  });

  it("validates values with the integration's own format rules", () => {
    expect(platformKeyDef("OPENAI_API_KEY")!.validate("sk-" + "a".repeat(30), () => undefined)).toBeNull();
    expect(platformKeyDef("OPENAI_API_KEY")!.validate("not-a-key", () => undefined)).not.toBeNull();
  });

  it("builds a tenant-scoped connection from platform keys only when configured", () => {
    expect(platformConnection(ORG, CO, "openai")).toBeNull();
    expect(isPlatformProviderConfigured("openai")).toBe(false);
    setEnv("OPENAI_API_KEY", "sk-" + "b".repeat(30));
    setEnv("OPENAI_MODEL", "gpt-4.1-mini");
    const c = platformConnection(ORG, CO, "openai")!;
    expect(c).toMatchObject({ provider: "openai", accessToken: "sk-" + "b".repeat(30), organizationId: ORG, companyId: CO, platform: true, status: "CONNECTED" });
    expect(c.config).toEqual({ model: "gpt-4.1-mini" });
    expect(c.id).toBe(platformConnectionId("openai", CO));
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(platformConnectionId("gemini", CO)).not.toBe(c.id);
    expect(platformConnection(ORG, CO, "slack")).toBeNull();
  });

  it("needs every required key (Twilio Voice: account SID and auth token)", () => {
    setEnv("TWILIO_VOICE_AUTH_TOKEN", "a".repeat(32));
    expect(isPlatformProviderConfigured("twilio_voice")).toBe(false);
    setEnv("TWILIO_VOICE_ACCOUNT_SID", "AC" + "0".repeat(32));
    expect(platformConnection(ORG, CO, "twilio_voice")?.config).toMatchObject({ accountSid: "AC" + "0".repeat(32) });
  });
});
