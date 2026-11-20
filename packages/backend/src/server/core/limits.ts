import type { RouteRateLimit } from "./http";

/**
 * Rate-limit presets (docs/api.md §2, docs/security.md §7). "sensitive" buckets fail closed in
 * production if Redis is unavailable. Per-account keys hash the submitted email.
 */
const MIN = 60_000;
const QUARTER = 15 * MIN;
const HOUR = 60 * MIN;

export const LIMITS = {
  signUp: [{ name: "sign-up:ip", limit: 10, windowMs: HOUR, sensitive: true, by: "ip" }],
  signIn: [
    { name: "sign-in:ip", limit: 20, windowMs: MIN, sensitive: true, by: "ip" },
    { name: "sign-in:account", limit: 10, windowMs: QUARTER, sensitive: true, by: { bodyField: "email" } },
  ],
  mfaVerify: [
    { name: "mfa:ip", limit: 20, windowMs: MIN, sensitive: true, by: "ip" },
    { name: "mfa:session", limit: 10, windowMs: QUARTER, sensitive: true, by: "session" },
  ],
  passwordResetRequest: [
    { name: "pw-reset:ip", limit: 5, windowMs: QUARTER, sensitive: true, by: "ip" },
    { name: "pw-reset:account", limit: 3, windowMs: HOUR, sensitive: true, by: { bodyField: "email" } },
  ],
  passwordResetConfirm: [{ name: "pw-reset-confirm:ip", limit: 10, windowMs: QUARTER, sensitive: true, by: "ip" }],
  emailVerify: [{ name: "email-verify:ip", limit: 20, windowMs: QUARTER, sensitive: true, by: "ip" }],
  emailResend: [{ name: "email-resend:principal", limit: 5, windowMs: HOUR, by: "principal" }],
  oauth: [{ name: "oauth:ip", limit: 30, windowMs: MIN, sensitive: true, by: "ip" }],
  invitationCreate: [{ name: "invite:principal", limit: 30, windowMs: HOUR, by: "principal" }],
  invitationAccept: [
    { name: "invite-accept:principal", limit: 10, windowMs: MIN, sensitive: true, by: "principal" },
    { name: "invite-accept:ip", limit: 30, windowMs: MIN, sensitive: true, by: "ip" },
  ],
  admin: [{ name: "admin:principal", limit: 60, windowMs: MIN, by: "principal" }],
  billing: [{ name: "billing:principal", limit: 20, windowMs: MIN, by: "principal" }],
  tenantWrite: [{ name: "tenant-write:principal", limit: 120, windowMs: MIN, by: "principal" }],
  publicRead: [{ name: "public:ip", limit: 120, windowMs: MIN, by: "ip" }],
} satisfies Record<string, RouteRateLimit[]>;
