import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { customerConnectMode, isOwnAccountProvider, isSetUpByRealy, OWN_ACCOUNT_PROVIDERS, PROVIDERS } from "./catalog";
import { listIntegrations, listSyncRuns } from "./service";
import { webSearch } from "./services/research";

/** Providers a customer connects to their OWN account with "Connect with X" (own-account providers + OAuth providers). */
export const CONNECTABLE_PROVIDERS = PROVIDERS.filter((p) => customerConnectMode(p) === "oauth").map((p) => p.key);

/** Plain-language steps of each own-account "Connect with X" login (what the person sees at the provider). */
const OWN_ACCOUNT_STEPS: Record<(typeof OWN_ACCOUNT_PROVIDERS)[number], string[]> = {
  stripe: [
    "Open Integrations → Stripe in Realy.",
    "Click \"Connect with Stripe\". Stripe opens in the same window.",
    "Sign in to your own Stripe account (or create one) and approve Realy's access.",
    "Stripe sends you back to Realy. Payment links and invoices are then paid into your own Stripe account; Realy never holds your money.",
  ],
  razorpay: [
    "Open Integrations → Razorpay in Realy.",
    "Click \"Connect with Razorpay\" and sign in to your own Razorpay account.",
    "Review and allow the access Realy asks for.",
    "Razorpay sends you back to Realy. Payment links are then paid into your own Razorpay account.",
  ],
  whatsapp: [
    "Open Integrations → WhatsApp Business in Realy.",
    "Click \"Connect with WhatsApp Business\". Facebook opens; log in with the Facebook account that manages your business.",
    "Choose (or create) your Meta business portfolio and WhatsApp Business account, then add the phone number you want to use and confirm it with the code Meta sends by SMS or call.",
    "Approve the access. Realy then sends and receives WhatsApp messages from that number in your own WhatsApp Business account.",
  ],
  mailchimp: [
    "Open Integrations → Mailchimp in Realy.",
    "Click \"Connect with Mailchimp\" and log in to your own Mailchimp account.",
    "Click \"Allow\". Mailchimp sends you back to Realy and your audiences appear there.",
  ],
};

const activeName = (config: unknown): string | null => {
  const c = (config && typeof config === "object" ? config : {}) as { accounts?: { id: string; name: string }[]; activeAccountId?: string };
  return c.accounts?.find((a) => a.id === c.activeAccountId)?.name ?? null;
};

/** AI tools of the integrations module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const INTEGRATIONS_TOOLS: Record<string, ToolDefinition> = {
  read_integrations: def({
    name: "read_integrations",
    version: 1,
    description: "Lists the company's integrations (AI, research, creative, social, ads, search, CMS, email, messaging, payments, storage, CRM, accounting, productivity, webhooks) with their connection status, connected account, active sub-account, health and last sync. Never returns credentials.",
    input: z.object({}).strict(),
    modelSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    permissions: ["integrations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read integrations",
    async execute(_input, { ctx, organizationId, companyId }) {
      const list = await listIntegrations(ctx, organizationId, companyId);
      const hooks = await db().integrationHook.findMany({ where: { organizationId, companyId, active: true }, select: { id: true, name: true } });
      const lines = list.map(
        (i) =>
          `- ${i.info.key} (${i.info.name}, ${i.info.category}): ${i.status ?? "not connected"}${i.connection?.externalAccount ? `, account ${i.connection.externalAccount}` : ""}${activeName(i.connection?.config) ? `, active ${activeName(i.connection?.config)}` : ""}${i.connection?.errorStreak ? `, ${i.connection.errorStreak} failed calls in a row` : ""}${i.connection?.lastSyncAt ? `, last sync ${i.connection.lastSyncAt.toISOString()}` : ""}${i.connection?.lastError ? `, error: ${i.connection.lastError}` : ""}${i.info.authType === "oauth2" && !i.configured ? " (OAuth app not configured by the platform admin)" : ""}`,
      );
      const hookLines = hooks.map((h) => `- incoming webhook "${h.name}" id ${h.id}`);
      return { content: `Integrations:\n${lines.join("\n")}\n\nIncoming webhooks:\n${hookLines.length ? hookLines.join("\n") : "(none)"}`, count: list.length };
    },
  }),
  read_sync_runs: def({
    name: "read_sync_runs",
    version: 1,
    description: "Lists recent integration sync runs (provider, kind, status, items read/created/updated, errors), newest first.",
    input: z.object({ provider: z.string().max(40).optional(), status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { provider: { type: "string", description: "Provider key, e.g. stripe, hubspot" }, status: { type: "string", enum: ["SUCCEEDED", "PARTIAL", "FAILED"] } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["integrations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ provider }) => `Read sync runs${provider ? ` for ${provider}` : ""}`,
    async execute({ provider, status }, { ctx, organizationId, companyId }) {
      const { data } = await listSyncRuns(ctx, organizationId, companyId, { provider, status, limit: 30 });
      if (!data.length) return { content: "No sync runs.", count: 0 };
      const lines = data.map((r) => `- ${r.startedAt.toISOString()} ${r.provider} ${r.kind} ${r.status}: read ${r.itemsRead}, created ${r.itemsCreated}, updated ${r.itemsUpdated}, errors ${r.errorCount}${r.errorCount ? ` (${JSON.stringify(r.errors).slice(0, 300)})` : ""}`);
      return { content: lines.join("\n"), count: data.length, records: data.map((r) => `integration_sync_run:${r.id}`) };
    },
  }),
  guide_account_connection: def({
    name: "guide_account_connection",
    version: 1,
    description:
      "Guides the person through connecting the company's OWN accounts (Stripe, Razorpay, WhatsApp Business, Mailchimp, and other accounts with a Connect button such as Google, Slack or HubSpot). Reports which accounts are connected (and whether the Realy team set one up), explains the steps in plain words, and returns the in-app page and \"Connect with X\" button to use, or says the Realy team can set it up instead. It never takes, asks for or stores keys, tokens or passwords: connecting is the person's own action through the Connect button.",
    input: z.object({ provider: z.enum(CONNECTABLE_PROVIDERS as [string, ...string[]]).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { provider: { type: "string", enum: CONNECTABLE_PROVIDERS, description: "The account to connect, e.g. stripe, razorpay, whatsapp, mailchimp. Omit for an overview." } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["integrations.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ provider }) => (provider ? `Guide connecting ${provider}` : "Guide connecting the company's accounts"),
    async execute({ provider }, { ctx, organizationId, companyId }) {
      const list = await listIntegrations(ctx, organizationId, companyId);
      const rules =
        "Rules: never ask for, accept, repeat or store API keys, tokens, passwords or secrets in chat. If the person pastes one, say it was not stored, ask them to delete it and rotate it at the provider, and point them to the Connect button. You cannot connect or disconnect accounts yourself: the person clicks the button and signs in at the provider.";
      const stateOf = (i: (typeof list)[number]) =>
        i.status === "CONNECTED" || i.status === "ERROR"
          ? `${i.status === "ERROR" ? "connected but failing" : "connected"}${i.connection?.externalAccount ? ` (${i.connection.externalAccount})` : ""}${isSetUpByRealy(i.connection?.config) ? ", set up by the Realy team" : ""}`
          : "not connected";
      if (!provider) {
        const own = list.filter((i) => isOwnAccountProvider(i.info.key)).map((i) => `- ${i.info.name} (${i.info.key}): ${stateOf(i)}`);
        const other = list.filter((i) => !isOwnAccountProvider(i.info.key) && customerConnectMode(i.info) === "oauth" && i.status).map((i) => `- ${i.info.name} (${i.info.key}): ${stateOf(i)}`);
        return {
          content: [
            "The company's own payment, messaging and email-marketing accounts:",
            ...own,
            other.length ? "\nOther accounts connected with Connect:" : "",
            ...other,
            "\nTo connect one, the person opens Integrations → <provider> (page path /integrations/<provider>) and clicks \"Connect with <provider>\". If they cannot, the Realy team can set the account up for them from Realy's admin: they contact Realy support.",
            rules,
          ]
            .filter(Boolean)
            .join("\n"),
          count: own.length + other.length,
        };
      }
      const item = list.find((i) => i.info.key === provider);
      if (!item) return { content: `Unknown account "${provider}".\n${rules}`, count: 0 };
      const name = item.info.name;
      const connected = item.status === "CONNECTED" || item.status === "ERROR";
      const available = !item.disabled && item.oauthAvailable && !item.plan.locked;
      const steps = isOwnAccountProvider(provider)
        ? OWN_ACCOUNT_STEPS[provider]
        : [`Open Integrations → ${name} in Realy.`, `Click "Connect with ${name}" and sign in to your own ${name} account.`, "Approve the access Realy asks for; you are sent back to Realy."];
      const lines = [
        `${name}: ${stateOf(item)}.`,
        connected && item.status === "ERROR" ? `The connection reports a problem${item.connection?.lastError ? ` (${item.connection.lastError})` : ""}. ${isSetUpByRealy(item.connection?.config) ? "The Realy team set it up; they can fix it, or the person can connect again with the button." : "Connecting again with the button usually fixes it."}` : "",
        `In-app page: /integrations/${provider} (Integrations → ${name}).`,
        available
          ? `Button: "${connected ? "Reconnect" : `Connect with ${name}`}" on that page (it opens /api/v1/integrations/oauth/${provider}/start?orgId=${organizationId}&companyId=${companyId}). Only a person who can manage integrations sees it.`
          : item.disabled
            ? `${name} is turned off on the platform right now, so the Connect button is not shown.`
            : item.plan.locked
              ? `${name} needs a higher plan (${item.plan.minPlan}) before it can be connected.`
              : `The "Connect with ${name}" sign-in is not switched on by Realy yet.`,
        connected ? "" : `Steps:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        isOwnAccountProvider(provider) ? `Alternative: the Realy team can set up ${name} for the company from Realy's admin (useful when the sign-in is not available or does not work). The person contacts Realy support; they never send keys through chat or email.` : "",
        rules,
      ];
      return { content: lines.filter(Boolean).join("\n"), count: 1 };
    },
  }),
  web_research: def({
    name: "web_research",
    version: 1,
    description:
      "Searches the public web through the company's connected research provider (Tavily, then Exa, then SerpApi as fallbacks) and returns titles, URLs, snippets and dates. Use for market, competitor, news or fact research; cite the URLs. Fails truthfully when no research provider is connected.",
    input: z.object({ query: z.string().trim().min(2).max(400), maxResults: z.number().int().min(1).max(10).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" }, maxResults: { type: "integer", minimum: 1, maximum: 10, description: "Default 5" } },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["brain.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 45_000,
    summarize: ({ query }) => `Web research: ${query}`,
    async execute({ query, maxResults }, { organizationId, companyId }) {
      const r = await webSearch(organizationId, companyId, query, { maxResults: maxResults ?? 5 });
      if (!r.ok) return { content: `Web research unavailable: ${r.error}${r.code === "not_connected" ? " (a manager can connect Tavily, Exa or SerpApi under Integrations)" : ""}`, count: 0 };
      if (!r.data.results.length) return { content: `No web results for "${query}" (via ${r.providerId}).`, count: 0 };
      const lines = r.data.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}${x.publishedAt ? ` (${x.publishedAt})` : ""}\n   ${x.snippet}`);
      return { content: `Web results for "${query}" via ${r.providerId}:\n${lines.join("\n")}`, count: r.data.results.length };
    },
  }),
};
