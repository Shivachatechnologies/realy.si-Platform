/**
 * Recognizes values that look like provider credentials (API keys, tokens, signing secrets, private keys) in free text
 * and tool inputs. Pure, no I/O. Used by the AI tool gateway (modules/tools/gateway.ts): Realy never accepts keys or
 * tokens through chat — the customer connects their own accounts with "Connect with X" (docs/integrations.md §7), or
 * the Realy team sets them up in the admin app. Only high-confidence, provider-specific shapes are matched so ordinary
 * text (ids, URLs, phone numbers, prose about "passwords") is never refused.
 */

export interface SecretMatch {
  /** Provider / kind of credential, e.g. "stripe_secret_key". Never the value. */
  kind: string;
}

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "stripe_secret_key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { kind: "stripe_webhook_secret", re: /\bwhsec_[A-Za-z0-9+/=]{10,}/ },
  { kind: "razorpay_key", re: /\brzp_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { kind: "meta_access_token", re: /\bEAA[A-Za-z0-9]{60,}/ },
  { kind: "mailchimp_api_key", re: /\b[a-f0-9]{32}-(?:us|eu|uk|au|ca|jp|de|fr)\d{1,3}\b/ },
  { kind: "anthropic_api_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "openai_api_key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/ },
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "twilio_api_key", re: /\bSK[0-9a-f]{32}\b/ },
  { kind: "sendgrid_api_key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { kind: "private_key", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

/** The first credential-looking value in `text`, or null. */
export function detectSecret(text: string): SecretMatch | null {
  if (!text || text.length < 16) return null;
  for (const p of PATTERNS) if (p.re.test(text)) return { kind: p.kind };
  return null;
}

/** Scan every string inside a JSON-like value (tool input), depth- and size-limited. */
export function detectSecretIn(value: unknown, depth = 0): SecretMatch | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") return detectSecret(value.slice(0, 100_000));
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 500)) {
      const m = detectSecretIn(v, depth + 1);
      if (m) return m;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>).slice(0, 500)) {
      const m = detectSecretIn(v, depth + 1);
      if (m) return m;
    }
  }
  return null;
}

/** What the assistant tells the person instead of storing a pasted credential. */
export const SECRET_REFUSAL =
  "This looks like an API key, token or password, so it was not used or stored. Realy never takes keys or tokens in chat. Ask the person to remove it from the conversation (and rotate it at the provider if it was a real key), then connect the account with the \"Connect\" button on the Integrations page, or ask the Realy team to set it up.";
