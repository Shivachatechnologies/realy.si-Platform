import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { encryptSecret } from "@/server/core/crypto";
import { env } from "@/server/core/env";
import { invalid, notFound } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { hostEnvValue, isOverridden, loadPlatformSecrets, markPlatformSecretsStale, PLATFORM_SECRET_PURPOSE } from "@/server/core/platform-secrets";
import { isPlatformKey, PLATFORM_KEY_GROUPS, PLATFORM_KEYS, platformKeyDef, type PlatformFeature, type PlatformKeyDef, type PlatformKeyGroup } from "@/server/core/platform-secrets-catalog";
import { emailProvider } from "@/server/modules/email/provider";
import { smtpSettings, verifySmtp } from "@/server/modules/email/smtp";
import { platformCredentialFields, providerInfo } from "@/server/modules/integrations/catalog";
import { ProviderError, testConnection } from "@/server/modules/integrations/providers";
import { writeAudit } from "@/server/modules/audit/service";
import { reasonSchema, requireAnyPlatform, canPlatform } from "./access";

/**
 * Admin → Settings → Platform keys (docs/platform-keys.md). Secret values are write-only: no function here returns,
 * logs or audits a secret value — only the key name, its source and the last 4 characters. Plain (non-secret)
 * settings such as AGENT_MODEL show their current value.
 *
 * Writes need platform.controls.manage or platform.security.manage (SUPER_ADMIN / SECURITY_ADMIN); both are MFA-gated,
 * so requirePermission also enforces a fresh MFA verification.
 */

const READ = ["platform.controls.manage", "platform.security.manage", "platform.security.read"];
const MANAGE = ["platform.controls.manage", "platform.security.manage"];

export type PlatformKeySource = "admin" | "host" | "missing";

export interface PlatformKeyStatus {
  key: string;
  group: PlatformKeyGroup;
  kind: "secret" | "plain";
  label: string;
  help: string;
  docsUrl: string | null;
  placeholder: string | null;
  register: { kind: "redirect" | "webhook"; urls: string[] } | null;
  blocks: PlatformFeature[];
  restart: boolean;
  testable: boolean;
  /** Platform-managed integration provider of this key (grouping on the page). */
  provider: string | null;
  providerName: string | null;
  source: PlatformKeySource;
  /** Host env has a value too (shown when the admin value overrides it). */
  hostSet: boolean;
  /** Last 4 characters of the active value (secrets: only when ≥ 12 characters long). */
  last4: string | null;
  /** Current value — plain settings only, never for secrets. */
  value: string | null;
  note: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string; email: string } | null;
}

const appBase = () => (env().USER_APP_URL ?? env().APP_URL).replace(/\/+$/, "");

function lastFour(def: PlatformKeyDef, value: string | undefined): string | null {
  if (!value) return null;
  if (def.kind === "secret" && value.length < 12) return null;
  return value.slice(-4);
}

/** Every allow-listed key with its status. Never includes a secret value. */
export async function listPlatformSecrets(ctx: RequestContext) {
  await requireAnyPlatform(ctx, READ);
  const [rows, canManage] = await Promise.all([
    db().platformSecret.findMany({ select: { key: true, last4: true, note: true, updatedAt: true, updatedById: true } }),
    canPlatform(ctx, MANAGE[0]!).then(async (a) => a || (await canPlatform(ctx, MANAGE[1]!))),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const userIds = [...new Set(rows.map((r) => r.updatedById).filter((v): v is string => !!v))];
  const users = userIds.length ? await db().user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const base = appBase();
  const items: PlatformKeyStatus[] = PLATFORM_KEYS.map((def) => {
    const row = byKey.get(def.key);
    const host = hostEnvValue(def.key);
    // A row exists but this instance has not applied it yet (refresh pending) — still report it as the admin value.
    const source: PlatformKeySource = row || isOverridden(def.key) ? "admin" : host ? "host" : "missing";
    const active = source === "admin" ? process.env[def.key] : host;
    return {
      key: def.key,
      group: def.group,
      kind: def.kind,
      label: def.label,
      help: def.help,
      docsUrl: def.docsUrl ?? null,
      placeholder: def.placeholder ?? null,
      register: def.register ? { kind: def.register.kind, urls: def.register.paths.map((p) => `${base}${p}`) } : null,
      // A key that does not apply to the current configuration (SMTP_* without EMAIL_PROVIDER=smtp) blocks nothing.
      blocks: def.appliesWhen && !def.appliesWhen(effective) ? [] : (def.blocks ?? []),
      restart: !!def.restart,
      testable: !!def.testable,
      provider: def.provider ?? null,
      providerName: def.provider ? (providerInfo(def.provider)?.name ?? def.provider) : null,
      source,
      hostSet: !!host,
      last4: source === "admin" && row ? row.last4 || null : lastFour(def, active),
      value: def.kind === "plain" ? (active ?? null) : null,
      note: row?.note ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedById ? (userById.get(row.updatedById) ?? null) : null,
    };
  });
  return { groups: PLATFORM_KEY_GROUPS, items, canManage };
}

export const setPlatformSecretInput = z.object({
  value: z.string().max(4096),
  note: z.string().trim().max(200).optional(),
  reason: reasonSchema,
});

function requireKey(key: string): PlatformKeyDef {
  if (!isPlatformKey(key)) throw notFound("Platform key");
  return platformKeyDef(key)!;
}

/** Look up the effective value of another key for cross-field validation (EMAIL_API_KEY vs EMAIL_PROVIDER). */
const effective = (k: string) => process.env[k];

function validateValue(def: PlatformKeyDef, raw: string): string {
  const value = raw.trim();
  const problem = def.validate(value, effective);
  // The problem text describes the expected format; it never echoes the value.
  if (problem) throw invalid(`${def.key}: ${problem}`, { key: def.key, reason: "invalid_format" });
  return value;
}

async function reloadAfterChange() {
  markPlatformSecretsStale();
  await loadPlatformSecrets().catch((err: unknown) => logger.warn({ err: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "platform keys reload after change failed"));
}

/** Store (or replace) an admin value for an allow-listed key. Audited; other super admins are notified. */
export async function setPlatformSecret(ctx: RequestContext, key: string, raw: z.input<typeof setPlatformSecretInput>) {
  const def = requireKey(key);
  const input = setPlatformSecretInput.parse(raw);
  await requireAnyPlatform(ctx, MANAGE); // MFA-gated permissions: also enforces a fresh MFA verification
  const value = validateValue(def, input.value);
  const valueEncrypted = encryptSecret(value, PLATFORM_SECRET_PURPOSE);
  const last4 = lastFour(def, value) ?? "";
  const replaced = await transaction(async (tx) => {
    const before = await tx.platformSecret.findUnique({ where: { key }, select: { id: true } });
    await tx.platformSecret.upsert({
      where: { key },
      create: { key, valueEncrypted, last4, note: input.note ?? null, updatedById: ctx.actor.id },
      update: { valueEncrypted, last4, note: input.note ?? null, updatedById: ctx.actor.id },
    });
    // Key name and source only — never the value (not even last4 for secrets).
    await writeAudit(tx, ctx, {
      category: "SECURITY",
      action: "platform.secret.set",
      resourceType: "platform_secret",
      resourceId: key,
      oldValue: { key, source: before ? "admin" : hostEnvValue(key) ? "host" : "missing" },
      newValue: { key, source: "admin", kind: def.kind },
      reason: input.reason,
    });
    return !!before;
  });
  await reloadAfterChange();
  await notifySuperAdmins(ctx, key, replaced ? "replaced" : "set");
  return { key, source: "admin" as const, last4: last4 || null };
}

export const clearPlatformSecretInput = z.object({ reason: reasonSchema });

/** Remove the admin value: the key falls back to the host env value (or becomes missing). */
export async function clearPlatformSecret(ctx: RequestContext, key: string, raw: z.input<typeof clearPlatformSecretInput>) {
  requireKey(key);
  const input = clearPlatformSecretInput.parse(raw);
  await requireAnyPlatform(ctx, MANAGE);
  const removed = await transaction(async (tx) => {
    const r = await tx.platformSecret.deleteMany({ where: { key } });
    if (r.count) {
      await writeAudit(tx, ctx, {
        category: "SECURITY",
        action: "platform.secret.cleared",
        resourceType: "platform_secret",
        resourceId: key,
        oldValue: { key, source: "admin" },
        newValue: { key, source: hostEnvValue(key) ? "host" : "missing" },
        reason: input.reason,
      });
    }
    return r.count > 0;
  });
  await reloadAfterChange();
  if (removed) await notifySuperAdmins(ctx, key, "cleared");
  return { key, source: (hostEnvValue(key) ? "host" : "missing") as PlatformKeySource };
}

// ───────────── Provider checks ─────────────

export const testPlatformSecretInput = z.object({
  /** Candidate value to check before saving; omitted = check the active value. */
  value: z.string().max(4096).optional(),
});

export interface PlatformKeyTestResult {
  key: string;
  ok: boolean;
  /** provider: an API call was made; format: only the format could be checked. */
  kind: "provider" | "format";
  status: number | null;
  message: string;
}

const TEST_TIMEOUT_MS = 10_000;

async function probe(url: string, headers: Record<string, string>): Promise<{ status: number }> {
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(TEST_TIMEOUT_MS), redirect: "error" });
  await res.body?.cancel().catch(() => undefined); // never read or relay provider bodies
  return { status: res.status };
}

function describe(status: number): { ok: boolean; message: string } {
  if (status >= 200 && status < 300) return { ok: true, message: "Provider accepted the key." };
  if (status === 401) return { ok: false, message: "Provider rejected the key (401 unauthorized)." };
  if (status === 403) return { ok: false, message: "Key is valid but lacks permission for this check (403)." };
  if (status === 429) return { ok: false, message: "Provider rate-limited the check (429). Try again shortly." };
  return { ok: false, message: `Provider answered ${status}.` };
}

/**
 * Platform-managed integration providers: reuse the integration's own connection test (a read-only identity / list
 * call) with the candidate value and the provider's other saved platform keys.
 */
async function platformProviderCheck(def: PlatformKeyDef, value: string): Promise<PlatformKeyTestResult> {
  const provider = def.provider!;
  const info = providerInfo(provider);
  const fields = info ? platformCredentialFields(info) : [];
  const values: Record<string, string> = {};
  for (const f of fields) {
    const v = f.envKey === def.key ? value : process.env[f.envKey]?.trim();
    if (v) values[f.key] = v;
  }
  const missing = fields.filter((f) => f.required && !values[f.key]).map((f) => f.envKey);
  if (missing.length) return { key: def.key, ok: false, kind: "format", status: null, message: `Set ${missing.join(", ")} first, then test again.` };
  const { apiKey, ...config } = values;
  try {
    const r = await testConnection({ provider, token: apiKey ?? "", config });
    // The account label can name the provider account: report only that the provider accepted the key.
    void r;
    return { key: def.key, ok: true, kind: info?.verification === "config_only" ? "format" : "provider", status: 200, message: info?.verification === "config_only" ? "Configuration looks valid (this provider has no API to prove the password)." : "Provider accepted the key." };
  } catch (err) {
    const status = err instanceof ProviderError ? (err.status ?? null) : null;
    return { key: def.key, ok: false, kind: "provider", status, message: status ? describe(status).message : "Could not reach the provider or it rejected the configuration." };
  }
}

/** SMTP: connect, negotiate TLS and authenticate with the candidate and the other saved SMTP settings (nothing is sent). */
async function smtpCheck(key: "SMTP_HOST" | "SMTP_PASSWORD", value: string): Promise<PlatformKeyTestResult> {
  const get = (k: string) => (k === key ? value : process.env[k]?.trim() || undefined);
  const settings = smtpSettings({ SMTP_HOST: get("SMTP_HOST"), SMTP_PORT: get("SMTP_PORT"), SMTP_SECURE: get("SMTP_SECURE"), SMTP_USER: get("SMTP_USER"), SMTP_PASSWORD: get("SMTP_PASSWORD") });
  if (!settings) return { key, ok: false, kind: "format", status: null, message: "Set SMTP_HOST first, then test again." };
  if (!!settings.user !== !!settings.password) return { key, ok: false, kind: "format", status: null, message: "Set both SMTP_USER and SMTP_PASSWORD (or neither, for an SMTP relay that authenticates by IP address)." };
  const r = await verifySmtp(settings, get("EMAIL_FROM") ?? null);
  return { key, ok: r.ok, kind: "provider", status: null, message: r.message };
}

/** Free, side-effect-free provider call per key (no tokens generated, no money moved). */
async function providerCheck(key: string, value: string): Promise<{ status: number } | null> {
  switch (key) {
    case "ANTHROPIC_API_KEY":
      return probe("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": value, "anthropic-version": "2023-06-01" });
    case "EMAIL_API_KEY": {
      const resend = value.startsWith("re_") || effective("EMAIL_PROVIDER") === "resend";
      return resend
        ? probe("https://api.resend.com/domains", { authorization: `Bearer ${value}` })
        : probe("https://api.postmarkapp.com/server", { "x-postmark-server-token": value });
    }
    case "STRIPE_SECRET_KEY":
      return probe("https://api.stripe.com/v1/balance", { authorization: `Bearer ${value}` });
    default:
      return null;
  }
}

/** Check a candidate or the active value. Audited (`platform.secret.tested`, key + outcome only). */
export async function testPlatformSecret(ctx: RequestContext, key: string, raw: z.input<typeof testPlatformSecretInput>) {
  const def = requireKey(key);
  const input = testPlatformSecretInput.parse(raw);
  await requireAnyPlatform(ctx, MANAGE);
  const candidate = input.value?.trim() ? input.value.trim() : process.env[key]?.trim();
  let result: PlatformKeyTestResult;
  if (!candidate) {
    result = { key, ok: false, kind: "format", status: null, message: "No value to test: enter one or set it first." };
  } else {
    const problem = def.validate(candidate, effective);
    if (problem) {
      result = { key, ok: false, kind: "format", status: null, message: problem };
    } else {
      if (def.provider) {
        result = await platformProviderCheck(def, candidate);
      } else if (key === "SMTP_HOST" || key === "SMTP_PASSWORD") {
        result = await smtpCheck(key, candidate);
      } else {
        try {
          const r = await providerCheck(key, candidate);
          result = r ? { key, kind: "provider", status: r.status, ...describe(r.status) } : { key, ok: true, kind: "format", status: null, message: "Format looks right. This key is verified when the feature first uses it." };
        } catch (err) {
          const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          result = { key, ok: false, kind: "provider", status: null, message: timeout ? "Provider did not answer in time." : "Could not reach the provider." };
        }
      }
    }
  }
  await transaction((tx) =>
    writeAudit(tx, ctx, {
      category: "SECURITY",
      action: "platform.secret.tested",
      resourceType: "platform_secret",
      resourceId: key,
      newValue: { key, candidate: !!input.value?.trim(), ok: result.ok, kind: result.kind, status: result.status },
    }),
  );
  return result;
}

// ───────────── Notifications ─────────────

/** Email every other SUPER_ADMIN that a platform key changed (key name and actor only). Best effort. */
async function notifySuperAdmins(ctx: RequestContext, key: string, change: "set" | "replaced" | "cleared") {
  try {
    const configured = emailProvider();
    if (!configured) return;
    const assignments = await db().roleAssignment.findMany({
      where: { principalType: "USER", scopeType: "PLATFORM", role: { key: "SUPER_ADMIN", organizationId: null } },
      select: { principalId: true },
    });
    const ids = [...new Set(assignments.map((a) => a.principalId))].filter((id) => id !== ctx.actor.id);
    if (!ids.length) return;
    const [recipients, actor] = await Promise.all([
      db().user.findMany({ where: { id: { in: ids } }, select: { email: true } }),
      ctx.actor.id ? db().user.findUnique({ where: { id: ctx.actor.id }, select: { email: true } }) : null,
    ]);
    const verb = change === "cleared" ? "removed (reverted to the hosting environment)" : change === "replaced" ? "replaced" : "set";
    const when = new Date().toISOString();
    const text = `The platform key ${key} was ${verb} in the Realy Control Center by ${actor?.email ?? "an administrator"} at ${when}.\n\nIf you did not expect this change, review Admin → Audit log and rotate the key with the provider.`;
    const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5"><p>${text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n\n/g, "</p><p>")}</p></body></html>`;
    await Promise.allSettled(recipients.map((r) => configured.provider.send({ to: r.email, from: configured.from, subject: `Realy: platform key ${key} ${change}`, text, html })));
  } catch (err) {
    logger.warn({ key, err: err instanceof Error ? err.message.slice(0, 200) : "unknown" }, "platform key change notification failed");
  }
}
