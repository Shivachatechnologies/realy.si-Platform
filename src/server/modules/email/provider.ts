import { env } from "@/server/core/env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
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
      const r = await postJson("https://api.resend.com/emails", { authorization: `Bearer ${apiKey}` }, { from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html });
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
        { From: m.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: "outbound" },
      );
      return { messageId: typeof r.MessageID === "string" ? r.MessageID : null };
    },
  };
}

let override: EmailProvider | null | undefined;

/** Test hook: inject a provider double (or null for "not configured"). Pass undefined to restore env-based selection. */
export function setEmailProviderForTests(p: EmailProvider | null | undefined) {
  override = p;
}

/** The configured provider, or null when email delivery is NOT CONFIGURED. */
export function emailProvider(): { provider: EmailProvider; from: string } | null {
  if (override !== undefined) return override ? { provider: override, from: "Realy <test@realy.si>" } : null;
  const e = env();
  if (!e.EMAIL_PROVIDER || !e.EMAIL_API_KEY || !e.EMAIL_FROM) return null;
  const provider = e.EMAIL_PROVIDER === "resend" ? resendProvider(e.EMAIL_API_KEY) : postmarkProvider(e.EMAIL_API_KEY);
  return { provider, from: e.EMAIL_FROM };
}
