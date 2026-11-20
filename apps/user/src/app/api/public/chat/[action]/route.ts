import type { NextRequest } from "next/server";
import { notFound } from "@/server/core/errors";
import { getT } from "@/i18n/server";
import { directionOf } from "@/i18n/config";
import { preflight, publicChat, type PublicLimit } from "@/server/modules/livechat/public-http";
import { pickLocale, pollMessages, postVisitorMessage, publicConfig, resolveWidget, startSession, submitContact, visitorCloses, visitorRequestsHuman } from "@/server/modules/livechat/public";

/**
 * Public website chat API used by the embeddable widget (/api/public/chat/widget.js). No cookies; every call carries
 * ?key=<public widget key> and must come from an allowed website origin (CORS). Rate limited per IP, key and visitor.
 *   GET  config            widget settings + localized strings
 *   POST session           start / resume a visitor
 *   POST messages          send a message (returns the AI reply when the AI is in charge)
 *   POST poll              new messages since `after`
 *   POST contact           share name + email with consent
 *   POST handoff | close   ask for a person / end the chat
 */
type P = { action: string };
const MIN = 60_000;
const HOUR = 60 * MIN;
const base: PublicLimit[] = [{ name: "chat:ip", limit: 120, windowMs: MIN, by: "ip" }];
const LIMITS: Record<string, PublicLimit[]> = {
  config: base,
  session: [...base, { name: "chat-session:ip", limit: 20, windowMs: MIN, by: "ip" }, { name: "chat-session:ip-hour", limit: 200, windowMs: HOUR, by: "ip" }],
  poll: [{ name: "chat-poll:ip", limit: 240, windowMs: MIN, by: "ip" }, { name: "chat-poll:visitor", limit: 60, windowMs: MIN, by: "visitor" }],
  messages: [
    ...base,
    { name: "chat-msg:ip", limit: 12, windowMs: MIN, by: "ip" },
    { name: "chat-msg:ip-hour", limit: 120, windowMs: HOUR, by: "ip" },
    { name: "chat-msg:visitor", limit: 8, windowMs: MIN, by: "visitor" },
    // Company-wide ceiling: bounds AI cost if a key is abused from many addresses.
    { name: "chat-msg:key", limit: 600, windowMs: MIN, by: "key" },
  ],
  contact: [...base, { name: "chat-contact:ip", limit: 5, windowMs: 10 * MIN, by: "ip" }],
  handoff: [...base, { name: "chat-handoff:ip", limit: 10, windowMs: 10 * MIN, by: "ip" }],
  close: [...base, { name: "chat-close:ip", limit: 20, windowMs: 10 * MIN, by: "ip" }],
};

const STRING_KEYS = [
  "launcher", "aiBadge", "disclosure", "greeting", "placeholder", "send", "close", "human", "typing", "contactTitle", "contactHint", "contactName",
  "contactEmail", "consent", "privacy", "contactSubmit", "error", "rateLimited", "unavailable", "offline", "newChat", "closed", "teamMember", "you",
  "assistant", "endChat", "unread", "honeypot",
] as const;
const EVENT_KEYS = ["handoff", "handoff_unavailable", "agent_joined", "ai_returned", "closed", "contact_shared", "lead_created", "ticket_created", "meeting_proposed", "meeting_confirmed", "meeting_saved"] as const;

async function strings(locale: ReturnType<typeof pickLocale>, vars: { company: string; name: string }) {
  const t = await getT(locale);
  const s: Record<string, string | Record<string, string>> = {};
  for (const k of STRING_KEYS) s[k] = t(`livechat.widget.${k}`, vars);
  const events: Record<string, string> = {};
  for (const k of EVENT_KEYS) events[k] = t(`livechat.events.${k}`, { number: "{number}" });
  s.events = events;
  return s;
}

export const OPTIONS = (req: NextRequest) => preflight(req);

export async function GET(req: NextRequest, ctx: { params: Promise<P> }) {
  const { action } = await ctx.params;
  if (action !== "config") return publicChat(req, { name: "GET /public/chat/:action", limits: base }, async () => { throw notFound("Endpoint"); });
  return publicChat(req, { name: "GET /public/chat/config", limits: LIMITS.config! }, async ({ key, origin }) => {
    const s = await resolveWidget(key, origin);
    const locale = pickLocale(req.nextUrl.searchParams.get("locale") ?? undefined, s.company.defaultLocale);
    return { config: publicConfig(s), locale, dir: directionOf(locale), strings: await strings(locale, { company: s.company.name, name: s.assistantName }) };
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<P> }) {
  const { action } = await ctx.params;
  const limits = LIMITS[action];
  if (!limits || action === "config") return publicChat(req, { name: "POST /public/chat/:action", limits: base }, async () => { throw notFound("Endpoint"); });
  return publicChat(req, { name: `POST /public/chat/${action}`, limits }, async ({ key, origin, ip, body }) => {
    const s = await resolveWidget(key, origin);
    switch (action) {
      case "session":
        return startSession(s, body, { ip, userAgent: req.headers.get("user-agent") });
      case "messages":
        return postVisitorMessage(s, body as never, typeof body.after === "string" ? body.after : undefined);
      case "poll":
        return pollMessages(s, body as never);
      case "contact":
        return submitContact(s, body as never);
      case "handoff":
        return visitorRequestsHuman(s, body as never);
      case "close":
        return visitorCloses(s, body as never);
    }
    throw notFound("Endpoint");
  });
}
