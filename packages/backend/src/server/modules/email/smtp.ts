import nodemailer, { type Transporter } from "nodemailer";
import type { EmailProvider } from "./provider";

/**
 * SMTP delivery for platform (transactional) email: EMAIL_PROVIDER=smtp with SMTP_HOST / SMTP_PORT / SMTP_SECURE /
 * SMTP_USER / SMTP_PASSWORD and EMAIL_FROM (docs/deployment.md "Email through Google Workspace"). Typical setups:
 *  - Gmail / Google Workspace mailbox: smtp.gmail.com:587 (STARTTLS) or :465 (implicit TLS), the mailbox address as
 *    SMTP_USER and an App Password as SMTP_PASSWORD. Gmail only sends as the signed-in user or a verified
 *    "Send mail as" alias.
 *  - Google Workspace SMTP relay: smtp-relay.gmail.com:587 (or 465 / 25), authenticated with a mailbox + App Password
 *    or by the server's IP address (then leave SMTP_USER / SMTP_PASSWORD empty). The From domain must be one of the
 *    Workspace domains.
 * No "server-only" import: the worker sends email too. Values are never logged.
 */

export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS (465). false = plain connection upgraded with STARTTLS (required except for local test servers). */
  secure: boolean;
  user: string | null;
  password: string | null;
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i;
export const isLocalSmtpHost = (host: string) => LOCAL.test(host);
export const isGmailHost = (host: string) => /(^|\.)gmail\.com$/i.test(host) || /(^|\.)googlemail\.com$/i.test(host);

/** Port 465 means implicit TLS; anything else STARTTLS — unless SMTP_SECURE says otherwise. */
export function smtpSecure(port: number, explicit?: string | null): boolean {
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return port === 465;
}

/** SMTP settings from the (overlaid) environment, or null when SMTP_HOST is not set. */
export function smtpSettings(e: { SMTP_HOST?: string; SMTP_PORT?: string; SMTP_SECURE?: string; SMTP_USER?: string; SMTP_PASSWORD?: string }): SmtpSettings | null {
  if (!e.SMTP_HOST) return null;
  const parsed = Number(e.SMTP_PORT);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 587;
  const host = e.SMTP_HOST.trim();
  // Google shows App Passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it.
  const password = e.SMTP_PASSWORD ? (isGmailHost(host) ? e.SMTP_PASSWORD.replace(/\s+/g, "") : e.SMTP_PASSWORD) : null;
  return { host, port, secure: smtpSecure(port, e.SMTP_SECURE), user: e.SMTP_USER?.trim() || null, password };
}

/** The bare address of "Name <email>" or "email". */
export function fromAddress(from: string): string {
  const m = /<([^>]+)>\s*$/.exec(from);
  return (m ? m[1]! : from).trim().toLowerCase();
}

/**
 * Gmail (smtp.gmail.com) sends only as the authenticated mailbox or a verified "Send mail as" alias — anything else is
 * silently rewritten to the mailbox. Returns a warning when EMAIL_FROM differs from SMTP_USER (it may still be a
 * verified alias, which cannot be checked over SMTP), else null.
 */
export function gmailFromWarning(s: SmtpSettings, from: string): string | null {
  if (!isGmailHost(s.host) || s.host.toLowerCase().startsWith("smtp-relay.") || !s.user) return null;
  const addr = fromAddress(from);
  if (addr === s.user.toLowerCase()) return null;
  return `EMAIL_FROM (${addr}) is not SMTP_USER (${s.user}). Gmail only sends as the signed-in user or a verified "Send mail as" alias; add it as an alias in Gmail settings, or Gmail replaces the sender.`;
}

/** Plain-language explanation of an SMTP failure (never includes credentials). */
export function describeSmtpError(err: unknown, s: SmtpSettings): string {
  const e = err as { code?: string; responseCode?: number; response?: string; command?: string; message?: string } | null;
  const response = (e?.response ?? e?.message ?? "").slice(0, 200);
  const code = e?.responseCode;
  if (e?.code === "EAUTH" || code === 535 || code === 534) {
    return isGmailHost(s.host)
      ? "The SMTP server rejected the username or password. For Gmail / Google Workspace use the full mailbox address and an App Password (2-Step Verification must be on)."
      : "The SMTP server rejected the username or password.";
  }
  if (code === 553 || code === 550 || code === 554 || /sender|from address|relay|5\.7\.[01]/i.test(response)) {
    if (e?.command === "MAIL FROM" || /sender|from|relay/i.test(response)) {
      return isGmailHost(s.host)
        ? "The SMTP server refused the From address. Gmail only sends as the authenticated user or a verified alias; the SMTP relay only for your Workspace domains. Check EMAIL_FROM."
        : "The SMTP server refused the From address (EMAIL_FROM).";
    }
  }
  if (e?.code === "ETIMEDOUT" || e?.code === "ECONNECTION" || e?.code === "ESOCKET" || e?.code === "ECONNREFUSED" || e?.code === "EDNS") {
    return `Could not connect to ${s.host}:${s.port} (${s.secure ? "TLS" : "STARTTLS"}). Check SMTP_HOST, SMTP_PORT and SMTP_SECURE.`;
  }
  if (e?.code === "ETLS") return `TLS negotiation with ${s.host}:${s.port} failed. Use port 465 with SMTP_SECURE=true or 587 with STARTTLS.`;
  return code ? `The SMTP server answered ${code}.` : "SMTP delivery failed.";
}

function transportOptions(s: SmtpSettings) {
  const local = isLocalSmtpHost(s.host);
  return {
    host: s.host,
    port: s.port,
    secure: s.secure,
    // STARTTLS is mandatory on non-implicit-TLS ports, except for local test servers.
    requireTLS: !s.secure && !local,
    ignoreTLS: !s.secure && local,
    tls: { rejectUnauthorized: !local, servername: s.host, minVersion: "TLSv1.2" as const },
    ...(s.user && s.password ? { auth: { user: s.user, pass: s.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(s: SmtpSettings): Transporter {
  // Rebuilt when any setting changes (rotated password from Admin → Platform keys).
  const key = JSON.stringify([s.host, s.port, s.secure, s.user, s.password]);
  if (cached?.key !== key) cached = { key, transporter: nodemailer.createTransport(transportOptions(s)) };
  return cached.transporter;
}

export function smtpProvider(s: SmtpSettings): EmailProvider {
  return {
    id: "smtp",
    async send(m) {
      try {
        const info = await transporterFor(s).sendMail({
          from: m.from,
          to: m.to,
          subject: m.subject,
          text: m.text,
          html: m.html,
          ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
        });
        return { messageId: typeof info.messageId === "string" ? info.messageId : null };
      } catch (err) {
        throw new Error(describeSmtpError(err, s));
      }
    },
  };
}

/** Connect, negotiate TLS and authenticate without sending anything (Admin → Platform keys → Test). */
export async function verifySmtp(s: SmtpSettings, from: string | null): Promise<{ ok: boolean; message: string }> {
  try {
    await nodemailer.createTransport(transportOptions(s)).verify();
  } catch (err) {
    return { ok: false, message: describeSmtpError(err, s) };
  }
  const warning = from ? gmailFromWarning(s, from) : null;
  return { ok: true, message: warning ? `Connected and authenticated. Note: ${warning}` : "Connected and authenticated with the SMTP server." };
}
