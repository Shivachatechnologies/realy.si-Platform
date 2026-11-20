import type { ProviderConnection } from "./connections-bridge";

/**
 * Provider adapters (real HTTP calls with the connection's OAuth access token). Each function takes the connection
 * object; callers resolve it through ./connections-bridge and handle "not connected" themselves.
 */

type Conn = ProviderConnection & { accessToken: string };

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

async function call<T>(provider: string, conn: Conn, url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json; charset=utf-8" } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ProviderError(provider, 0, err instanceof Error ? err.message : "network error");
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(provider, res.status, `${provider} ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ─── Email ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FetchedEmail {
  providerMessageId: string;
  providerThreadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  sentAt: Date;
  attachments: { name: string; contentType: string; size: number }[];
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const b64urlEncode = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const splitAddresses = (v: string | undefined) => (v ? v.split(",").map((a) => a.trim()).filter(Boolean) : []);
const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

function gmailText(part: GmailPart): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;
  const walk = (p: GmailPart) => {
    if (p.mimeType === "text/plain" && p.body?.data && !p.filename && text === null) text = b64urlDecode(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !p.filename && html === null) html = b64urlDecode(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return { text, html };
}

function gmailAttachments(part: GmailPart) {
  const out: FetchedEmail["attachments"] = [];
  const walk = (p: GmailPart) => {
    if (p.filename && p.body?.attachmentId) out.push({ name: p.filename, contentType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0 });
    p.parts?.forEach(walk);
  };
  walk(part);
  return out;
}

/** Gmail API: users.messages.list + users.messages.get (format=full). */
export async function gmailFetchRecent(conn: Conn, max = 25): Promise<FetchedEmail[]> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const list = await call<{ messages?: { id: string; threadId: string }[] }>("gmail", conn, `${base}/messages?maxResults=${max}&q=${encodeURIComponent("newer_than:30d -in:chats")}`);
  const out: FetchedEmail[] = [];
  for (const ref of list.messages ?? []) {
    const m = await call<{ id: string; threadId: string; internalDate?: string; payload?: GmailPart }>("gmail", conn, `${base}/messages/${ref.id}?format=full`);
    const headers = new Map((m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
    const { text, html } = m.payload ? gmailText(m.payload) : { text: null, html: null };
    out.push({
      providerMessageId: m.id,
      providerThreadId: m.threadId,
      from: headers.get("from") ?? "",
      to: splitAddresses(headers.get("to")),
      cc: splitAddresses(headers.get("cc")),
      subject: headers.get("subject") ?? "",
      bodyText: (text ?? (html ? stripHtml(html) : "")).slice(0, 100_000),
      sentAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
      attachments: m.payload ? gmailAttachments(m.payload) : [],
    });
  }
  return out;
}

const header = (v: string) => v.replace(/[\r\n]+/g, " ");
const encodeSubject = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Gmail API: users.messages.send with an RFC 822 message (optionally in an existing thread). */
export async function gmailSend(conn: Conn, msg: { from: string; to: string[]; cc?: string[]; subject: string; text: string; threadId?: string | null; inReplyTo?: string | null }) {
  const lines = [
    `From: ${header(msg.from)}`,
    `To: ${header(msg.to.join(", "))}`,
    ...(msg.cc?.length ? [`Cc: ${header(msg.cc.join(", "))}`] : []),
    `Subject: ${encodeSubject(header(msg.subject))}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${header(msg.inReplyTo)}`, `References: ${header(msg.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    msg.text,
  ];
  const r = await call<{ id: string; threadId: string }>("gmail", conn, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    body: { raw: b64urlEncode(lines.join("\r\n")), ...(msg.threadId ? { threadId: msg.threadId } : {}) },
  });
  return { providerMessageId: r.id, providerThreadId: r.threadId };
}

interface GraphAddress {
  emailAddress?: { address?: string; name?: string };
}
const graphAddr = (a?: GraphAddress) => (a?.emailAddress ? (a.emailAddress.name ? `${a.emailAddress.name} <${a.emailAddress.address ?? ""}>` : (a.emailAddress.address ?? "")) : "");

/** Microsoft Graph: GET /me/messages (+ attachment metadata when present). */
export async function outlookFetchRecent(conn: Conn, max = 25): Promise<FetchedEmail[]> {
  const select = "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments";
  const r = await call<{
    value: { id: string; conversationId: string; subject?: string; from?: GraphAddress; toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; receivedDateTime?: string; body?: { contentType?: string; content?: string }; hasAttachments?: boolean }[];
  }>("outlook", conn, `https://graph.microsoft.com/v1.0/me/messages?$top=${max}&$orderby=receivedDateTime%20desc&$select=${select}`, { headers: { prefer: 'outlook.body-content-type="text"' } });
  const out: FetchedEmail[] = [];
  for (const m of r.value ?? []) {
    let attachments: FetchedEmail["attachments"] = [];
    if (m.hasAttachments) {
      const a = await call<{ value: { name: string; contentType?: string; size?: number }[] }>("outlook", conn, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(m.id)}/attachments?$select=name,contentType,size`);
      attachments = (a.value ?? []).map((x) => ({ name: x.name, contentType: x.contentType ?? "application/octet-stream", size: x.size ?? 0 }));
    }
    const content = m.body?.content ?? "";
    out.push({
      providerMessageId: m.id,
      providerThreadId: m.conversationId,
      from: graphAddr(m.from),
      to: (m.toRecipients ?? []).map(graphAddr).filter(Boolean),
      cc: (m.ccRecipients ?? []).map(graphAddr).filter(Boolean),
      subject: m.subject ?? "",
      bodyText: (m.body?.contentType === "html" ? stripHtml(content) : content).slice(0, 100_000),
      sentAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
      attachments,
    });
  }
  return out;
}

/** Microsoft Graph: reply to a message (POST /me/messages/{id}/reply) or send a new one (POST /me/sendMail). */
export async function outlookSend(conn: Conn, msg: { to: string[]; cc?: string[]; subject: string; text: string; replyToMessageId?: string | null }) {
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  if (msg.replyToMessageId) {
    await call("outlook", conn, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(msg.replyToMessageId)}/reply`, {
      body: { message: { toRecipients: recipients(msg.to), ...(msg.cc?.length ? { ccRecipients: recipients(msg.cc) } : {}) }, comment: msg.text },
    });
  } else {
    await call("outlook", conn, "https://graph.microsoft.com/v1.0/me/sendMail", {
      body: { message: { subject: msg.subject, body: { contentType: "Text", content: msg.text }, toRecipients: recipients(msg.to), ...(msg.cc?.length ? { ccRecipients: recipients(msg.cc) } : {}) }, saveToSentItems: true },
    });
  }
  // Graph returns 202 without the new message id.
  return { providerMessageId: null as string | null, providerThreadId: null as string | null };
}

// ─── Chat ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Slack Web API chat.postMessage to the connection's configured channel. */
export async function slackPost(conn: Conn, text: string) {
  const channel = String(conn.config.channel ?? conn.config.channelId ?? "");
  if (!channel) throw new ProviderError("slack", 400, "No Slack channel configured on the connection");
  const r = await call<{ ok: boolean; ts?: string; error?: string }>("slack", conn, "https://slack.com/api/chat.postMessage", { body: { channel, text, mrkdwn: true } });
  if (!r.ok) throw new ProviderError("slack", 400, `slack: ${r.error ?? "rejected"}`);
  return { externalId: r.ts ?? null };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Microsoft Graph: POST /teams/{teamId}/channels/{channelId}/messages. */
export async function teamsPost(conn: Conn, title: string, text: string) {
  const teamId = String(conn.config.teamId ?? "");
  const channelId = String(conn.config.channelId ?? "");
  if (!teamId || !channelId) throw new ProviderError("microsoft_teams", 400, "No Teams channel configured on the connection");
  const html = `<h3>${escapeHtml(title)}</h3>${text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("")}`;
  const r = await call<{ id?: string }>("microsoft_teams", conn, `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`, {
    body: { body: { contentType: "html", content: html } },
  });
  return { externalId: r.id ?? null };
}

// ─── Calendar ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CalendarEventData {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
  cancelled: boolean;
}

export interface OutgoingEvent {
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
}

/** Google Calendar API: events.list on the primary calendar. */
export async function googleListEvents(conn: Conn, from: Date, to: Date): Promise<CalendarEventData[]> {
  const r = await call<{
    items?: { id: string; status?: string; summary?: string; description?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; attendees?: { email?: string }[] }[];
  }>("google_calendar", conn, `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`);
  return (r.items ?? [])
    .filter((e) => e.start?.dateTime || e.start?.date)
    .map((e) => ({
      externalId: e.id,
      title: e.summary || "(no title)",
      description: e.description ?? null,
      location: e.location ?? null,
      startsAt: new Date(e.start!.dateTime ?? `${e.start!.date}T00:00:00Z`),
      endsAt: new Date(e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : e.start!.dateTime ?? `${e.start!.date}T23:59:00Z`)),
      attendeeEmails: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
      cancelled: e.status === "cancelled",
    }));
}

const googleBody = (e: OutgoingEvent) => ({
  summary: e.title,
  description: e.description ?? undefined,
  location: e.location ?? undefined,
  start: { dateTime: e.startsAt.toISOString() },
  end: { dateTime: e.endsAt.toISOString() },
  attendees: e.attendeeEmails.map((email) => ({ email })),
});

/** Google Calendar API: events.insert / events.patch. */
export async function googleUpsertEvent(conn: Conn, e: OutgoingEvent, externalId?: string | null) {
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const r = externalId
    ? await call<{ id: string }>("google_calendar", conn, `${base}/${encodeURIComponent(externalId)}`, { method: "PATCH", body: googleBody(e) })
    : await call<{ id: string }>("google_calendar", conn, base, { body: googleBody(e) });
  return r.id;
}

/** Microsoft Graph: GET /me/calendarView. */
export async function outlookListEvents(conn: Conn, from: Date, to: Date): Promise<CalendarEventData[]> {
  const r = await call<{
    value?: { id: string; isCancelled?: boolean; subject?: string; bodyPreview?: string; location?: { displayName?: string }; start?: { dateTime: string; timeZone?: string }; end?: { dateTime: string; timeZone?: string }; attendees?: GraphAddress[] }[];
  }>("outlook_calendar", conn, `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=250`, {
    headers: { prefer: 'outlook.timezone="UTC"' },
  });
  const utc = (s?: string) => new Date(s ? (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`) : Date.now());
  return (r.value ?? []).map((e) => ({
    externalId: e.id,
    title: e.subject || "(no title)",
    description: e.bodyPreview ?? null,
    location: e.location?.displayName || null,
    startsAt: utc(e.start?.dateTime),
    endsAt: utc(e.end?.dateTime),
    attendeeEmails: (e.attendees ?? []).map((a) => a.emailAddress?.address ?? "").filter(Boolean),
    cancelled: !!e.isCancelled,
  }));
}

const outlookBody = (e: OutgoingEvent) => ({
  subject: e.title,
  body: { contentType: "Text", content: e.description ?? "" },
  location: e.location ? { displayName: e.location } : undefined,
  start: { dateTime: e.startsAt.toISOString().replace("Z", ""), timeZone: "UTC" },
  end: { dateTime: e.endsAt.toISOString().replace("Z", ""), timeZone: "UTC" },
  attendees: e.attendeeEmails.map((address) => ({ emailAddress: { address }, type: "required" })),
});

/** Microsoft Graph: POST /me/events or PATCH /me/events/{id}. */
export async function outlookUpsertEvent(conn: Conn, e: OutgoingEvent, externalId?: string | null) {
  const r = externalId
    ? await call<{ id: string }>("outlook_calendar", conn, `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalId)}`, { method: "PATCH", body: outlookBody(e) })
    : await call<{ id: string }>("outlook_calendar", conn, "https://graph.microsoft.com/v1.0/me/events", { body: outlookBody(e) });
  return r.id;
}
