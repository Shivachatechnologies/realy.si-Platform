import { env } from "@/server/core/env";
import { providerFetch } from "@/server/modules/integrations/client";
import { getConnection, type Connection } from "@/server/modules/integrations/connections";
import { recordUsage } from "@/server/modules/integrations/usage";
import { smtpProvider, smtpSettings } from "./smtp";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra MIME headers (e.g. List-Unsubscribe). Names are passed through as given. */
  headers?: Record<string, string>;
  /** Provider-side metadata echoed in delivery event webhooks (SendGrid custom_args), e.g. a send id. Not secret. */
  customArgs?: Record<string, string>;
}

export interface EmailProvider {
  id: string;
  send(message: OutboundEmail & { from: string }): Promise<{ messageId: string | null }>;
}

const TIMEOUT_MS = 10_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Resend (https://resend.com) HTTP API. */
export function resendProvider(apiKey: string): EmailProvider {
  return {
    id: "resend",
    async send(m) {
      const r = await postJson("https://api.resend.com/emails", { authorization: `Bearer ${apiKey}` }, {
        from: m.from,
        to: [m.to],
        subject: m.subject,
        text: m.text,
        html: m.html,
        ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
      });
      return { messageId: typeof r.id === "string" ? r.id : null };
    },
  };
}

/** Postmark (https://postmarkapp.com) HTTP API. */
export function postmarkProvider(serverToken: string): EmailProvider {
  return {
    id: "postmark",
    async send(m) {
      const r = await postJson(
        "https://api.postmarkapp.com/email",
        { "x-postmark-server-token": serverToken },
        {
          From: m.from,
          To: m.to,
          Subject: m.subject,
          TextBody: m.text,
          HtmlBody: m.html,
          MessageStream: "outbound",
          ...(m.headers && Object.keys(m.headers).length ? { Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
        },
      );
      return { messageId: typeof r.MessageID === "string" ? r.MessageID : null };
    },
  };
}

/** SendGrid v3 Mail Send with a company's own connected API key (request log, rate limit, retries and health via providerFetch). */
export function sendgridProvider(conn: Connection & { accessToken: string }): EmailProvider {
  return {
    id: "sendgrid",
    async send(m) {
      const custom = m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {};
      const res = await providerFetch(conn, "https://api.sendgrid.com/v3/mail/send", {
        json: {
          personalizations: [{ to: [{ email: m.to }], ...(m.customArgs && Object.keys(m.customArgs).length ? { custom_args: m.customArgs } : {}) }],
          from: parseFrom(m.from),
          subject: m.subject,
          content: [
            { type: "text/plain", value: m.text },
            { type: "text/html", value: m.html },
          ],
          ...custom,
        },
        retries: 2,
        timeoutMs: TIMEOUT_MS,
      });
      const ok = res.status === 202 || res.ok;
      if (conn.organizationId && conn.companyId) {
        await recordUsage({ organizationId: conn.organizationId, companyId: conn.companyId, connectionId: conn.id, provider: "sendgrid", operation: "email.send", unit: "message", estimatedCostMicros: ok ? 1_000 : 0, status: ok ? "SUCCEEDED" : "FAILED", error: ok ? null : `SendGrid responded ${res.status}` });
      }
      if (!ok) throw new Error(`email provider responded ${res.status}`);
      // SendGrid returns the message id in the X-Message-Id header.
      return { messageId: res.headers?.get("x-message-id") ?? null };
    },
  };
}

/** "Name <email>" → { email, name } (SendGrid wants them separately). */
function parseFrom(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { email: m[2]!, ...(m[1] ? { name: m[1].replace(/^"|"$/g, "") } : {}) } : { email: from.trim() };
}

/**
 * Email provider for a company's own sends (campaigns, invoices, notifications to its customers): the company's
 * connected SendGrid account when present (from its configured sender), else the platform provider (Resend, Postmark
 * or SMTP from env / Admin → Platform keys), else null = NOT CONFIGURED.
 */
export async function companyEmailProvider(organizationId: string, companyId: string): Promise<{ provider: EmailProvider; from: string; scope: "company" | "platform" } | null> {
  if (override !== undefined) return override ? { provider: override, from: "Realy <test@realy.si>", scope: "platform" } : null;
  const conn = await getConnection(organizationId, companyId, "sendgrid");
  const fromEmail = conn && typeof conn.config.fromEmail === "string" ? conn.config.fromEmail : null;
  if (conn && conn.accessToken && conn.status !== "DISCONNECTED" && fromEmail) {
    const name = typeof conn.config.fromName === "string" && conn.config.fromName ? conn.config.fromName.replace(/[<>"\r\n]/g, "") : null;
    // SendGrid is platform-managed (Realy's account, Admin → Platform keys) and serves as the sending channel for the
    // company's customer email (campaigns, outreach, support), metered per company: it keeps the "company" scope so
    // companyOnly sends still use it rather than Realy's transactional provider.
    return { provider: sendgridProvider(conn as Connection & { accessToken: string }), from: name ? `${name} <${fromEmail}>` : fromEmail, scope: "company" };
  }
  const platform = emailProvider();
  return platform ? { ...platform, scope: "platform" } : null;
}

let override: EmailProvider | null | undefined;

/** Test hook: inject a provider double (or null for "not configured"). Pass undefined to restore env-based selection. */
export function setEmailProviderForTests(p: EmailProvider | null | undefined) {
  override = p;
}

/** The configured provider, or null when email delivery is NOT CONFIGURED. */
export function emailProvider(): { provider: EmailProvider; from: string } | null {
  if (override !== undefined) return override ? { provider: override, from: "Realy <test@realy.si>" } : null;
  return selectEmailProvider(env());
}

type EmailEnv = Partial<Pick<ReturnType<typeof env>, "EMAIL_PROVIDER" | "EMAIL_API_KEY" | "EMAIL_FROM" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASSWORD">>;

/**
 * Provider selection from settings (exported for tests): resend / postmark need EMAIL_API_KEY; smtp needs SMTP_HOST
 * (SMTP_USER + SMTP_PASSWORD unless the relay authenticates by IP). EMAIL_FROM is always required.
 */
export function selectEmailProvider(e: EmailEnv): { provider: EmailProvider; from: string } | null {
  if (!e.EMAIL_PROVIDER || !e.EMAIL_FROM) return null;
  if (e.EMAIL_PROVIDER === "smtp") {
    const s = smtpSettings(e);
    // Half-configured credentials (user without password or the reverse) never fall back to an unauthenticated send.
    if (!s || !!s.user !== !!s.password) return null;
    return { provider: smtpProvider(s), from: e.EMAIL_FROM };
  }
  if (!e.EMAIL_API_KEY) return null;
  const provider = e.EMAIL_PROVIDER === "resend" ? resendProvider(e.EMAIL_API_KEY) : postmarkProvider(e.EMAIL_API_KEY);
  return { provider, from: e.EMAIL_FROM };
}
