import "server-only";
import type { VoiceGoal } from "@/generated/prisma/enums";
import { db } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { can } from "@/server/modules/rbac/service";
import { companyChain } from "@/server/modules/rbac/scope";
import type { VoiceLanguage } from "./common";

/**
 * What a voice agent knows and how it must behave: the company knowledge pack (Brain facts, products, help articles,
 * founder-provided offers) and the system prompt + mandatory opening line sent to the provider.
 */

const MAX_KNOWLEDGE = 12_000;
const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Compile the company knowledge an agent may use on calls. Only what the person building it may read: Brain facts need
 * brain.read; products and published help articles are company-public information.
 */
export async function buildKnowledge(ctx: RequestContext, organizationId: string, companyId: string): Promise<{ text: string; sources: { brainFacts: number; products: number; articles: number } }> {
  const chain = await companyChain(db(), organizationId, companyId);
  const brain = await can(ctx, "brain.read", chain).catch(() => false);
  const scope = { organizationId, companyId };
  const priceWords = ["price", "pricing", "plan", "cost", "fee", "discount", "refund", "payment", "hours", "opening"];
  const [company, pinned, pricing, products, articles] = await Promise.all([
    db().company.findFirst({ where: { id: companyId, organizationId }, select: { name: true, legalName: true, timezone: true, baseCurrency: true } }),
    brain ? db().companyMemory.findMany({ where: { ...scope, pinned: true }, orderBy: { updatedAt: "desc" }, take: 15, select: { title: true, fact: true } }) : Promise.resolve([]),
    brain
      ? db().companyMemory.findMany({
          where: { ...scope, pinned: false, OR: priceWords.flatMap((w) => [{ title: { contains: w, mode: "insensitive" as const } }, { fact: { contains: w, mode: "insensitive" as const } }]) },
          orderBy: { updatedAt: "desc" },
          take: 12,
          select: { title: true, fact: true },
        })
      : Promise.resolve([]),
    db().product.findMany({ where: { ...scope, archivedAt: null, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 10, select: { name: true, description: true, targetUsers: true } }),
    db().supportKbArticle.findMany({ where: { ...scope, status: "PUBLISHED" }, orderBy: [{ views: "desc" }, { updatedAt: "desc" }], take: 12, select: { title: true, body: true } }),
  ]);
  const parts: string[] = [];
  if (company) parts.push(`Company: ${company.name}${company.legalName && company.legalName !== company.name ? ` (${company.legalName})` : ""}. Time zone ${company.timezone}. Currency ${company.baseCurrency}.`);
  const facts = [...pinned, ...pricing];
  if (facts.length) parts.push(`Company facts (Company Brain):\n${facts.map((f) => `- ${clip(f.title, 120)}: ${clip(f.fact, 400)}`).join("\n")}`);
  if (products.length) parts.push(`Products and services:\n${products.map((p) => `- ${clip(p.name, 120)}${p.description ? `: ${clip(p.description, 300)}` : ""}${p.targetUsers ? ` (for ${clip(p.targetUsers, 120)})` : ""}`).join("\n")}`);
  if (articles.length) parts.push(`Frequently asked questions (published help articles):\n${articles.map((a) => `- ${clip(a.title, 150)}: ${clip(a.body, 350)}`).join("\n")}`);
  return { text: parts.join("\n\n").slice(0, MAX_KNOWLEDGE), sources: { brainFacts: facts.length, products: products.length, articles: articles.length } };
}

const DISCLOSURE: Record<VoiceLanguage, (agent: string, company: string) => string> = {
  "en-US": (a, c) => `Hi, this is ${a}, an AI assistant calling for ${c}.`,
  "de-DE": (a, c) => `Hallo, hier ist ${a}, ein KI-Assistent von ${c}.`,
  "hi-IN": (a, c) => `नमस्ते, मैं ${a} हूँ, ${c} की ओर से एक AI सहायक।`,
  "zh-CN": (a, c) => `您好，我是${a}，${c}的AI助手。`,
  "ar-AE": (a, c) => `مرحباً، معك ${a}، مساعد ذكاء اصطناعي من ${c}.`,
};
const RECORDING: Record<VoiceLanguage, string> = {
  "en-US": " This call is recorded.",
  "de-DE": " Dieses Gespräch wird aufgezeichnet.",
  "hi-IN": " यह कॉल रिकॉर्ड की जा रही है।",
  "zh-CN": " 本次通话将被录音。",
  "ar-AE": " يتم تسجيل هذه المكالمة.",
};
const DEFAULT_GREETING: Record<VoiceLanguage, string> = {
  "en-US": "How can I help you today?",
  "de-DE": "Wie kann ich Ihnen heute helfen?",
  "hi-IN": "मैं आज आपकी क्या मदद कर सकता हूँ?",
  "zh-CN": "今天有什么可以帮您？",
  "ar-AE": "كيف يمكنني مساعدتك اليوم؟",
};

const lang = (l: string): VoiceLanguage => (l in DISCLOSURE ? (l as VoiceLanguage) : "en-US");

/** The opening line: always discloses that the caller is an AI (and the recording, when on), then the greeting. */
export function openingLine(a: { name: string; language: string; greeting: string | null }, companyName: string, recordCalls: boolean): string {
  const l = lang(a.language);
  return `${DISCLOSURE[l](a.name, companyName)}${recordCalls ? RECORDING[l] : ""} ${(a.greeting ?? "").trim() || DEFAULT_GREETING[l]}`.slice(0, 1000);
}

export const GOAL_BRIEF: Record<VoiceGoal, string> = {
  QUALIFY_LEAD:
    "Qualify the lead: understand their need, timeline, budget range and who decides. Be curious, not pushy. If they are a fit and interested, offer a follow-up meeting with the team.",
  BOOK_MEETING:
    "Book a meeting: explain briefly why a conversation is worthwhile, then agree on a specific date and time (with their time zone). Repeat the agreed time back to confirm it.",
  SUPPORT_TRIAGE:
    "Triage a support request: understand the problem, how urgent it is and who is affected; collect their name and email for the ticket. Give answers only from the knowledge below; otherwise promise that the support team follows up.",
  COLLECTIONS_REMINDER:
    "Give a polite payment reminder: confirm you are speaking with the right person before mentioning any amount, state what is outstanding only if it is in the call context, ask when they expect to pay and note the date. Never threaten, never pressure, and never take card details on the call.",
  RECEPTIONIST:
    "Act as the company's receptionist: greet callers, find out who they are and what they need. Answer simple questions from the knowledge below. For sales interest collect name, company, email and need; for problems collect the issue and contact details; otherwise take a clear message for the team.",
};

export interface PromptInput {
  agentName: string;
  companyName: string;
  goal: VoiceGoal;
  language: string;
  recordCalls: boolean;
  employee: { name: string; jobTitle: string | null; instructions: string | null } | null;
  instructions: string | null;
  offerNotes: string | null;
  knowledge: string | null;
}

/** System prompt sent to the provider. {{customer_name}} and {{call_purpose}} are filled per call. */
export function systemPrompt(p: PromptInput): string {
  const rules = [
    "You are an AI voice assistant, not a human. Your first sentence already said so. If anyone asks, confirm you are an AI assistant. Never claim or imply to be a person.",
    "If the person asks not to be called again, apologise, confirm they will not be called again, and end the call politely.",
    "If the person is busy or not interested, thank them and end the call. Never pressure anyone.",
    "Never invent prices, discounts, availability, policies or facts. Use only the offers and the company knowledge below. If you do not know, say a person from the team will follow up.",
    "Never ask for or accept payment card numbers, bank passwords or one-time codes.",
    "Speak naturally and briefly: short sentences, one question at a time. Confirm names, emails, dates and times by repeating them back.",
    p.recordCalls ? "This call is recorded and the person was told. If they object to the recording, apologise and end the call." : "This call is not recorded.",
  ];
  return [
    `You are ${p.agentName}, the AI phone assistant of ${p.companyName}.${p.employee ? ` You represent the AI employee ${p.employee.name}${p.employee.jobTitle ? ` (${p.employee.jobTitle})` : ""}.` : ""}`,
    `Speak in the language of this locale: ${p.language}, unless the person clearly prefers another language you can speak.`,
    `Rules you always follow:\n${rules.map((r) => `- ${r}`).join("\n")}`,
    `Your goal on this call: ${GOAL_BRIEF[p.goal]}`,
    "Person on the call: {{customer_name}}\nWhy this call happens: {{call_purpose}}",
    p.employee?.instructions ? `Role notes:\n${p.employee.instructions.slice(0, 2000)}` : "",
    p.instructions ? `Instructions from the company:\n${p.instructions.slice(0, 3000)}` : "",
    p.offerNotes ? `Offers, prices and policies you may quote (exactly as written):\n${p.offerNotes.slice(0, 3000)}` : "No offers or prices were provided: do not quote any price.",
    p.knowledge ? `Company knowledge:\n${p.knowledge}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Post-call analysis both providers fill in from the conversation (Vapi structured data / Retell custom analysis). */
export const ANALYSIS_FIELDS = [
  { name: "outcome", type: "enum", choices: ["interested", "not_interested", "meeting_requested", "callback_requested", "support_issue", "payment_promised", "message_taken", "wrong_number", "do_not_call", "other"], description: "The main result of the call." },
  { name: "sentiment", type: "enum", choices: ["positive", "neutral", "negative"], description: "How the person felt during the call." },
  { name: "caller_name", type: "string", description: "The person's full name if they said it, else empty." },
  { name: "caller_email", type: "string", description: "The person's email address if they gave it, else empty." },
  { name: "caller_company", type: "string", description: "The person's company if they said it, else empty." },
  { name: "meeting_requested", type: "boolean", description: "True if the person agreed to a meeting with the team." },
  { name: "meeting_time", type: "string", description: "The exact meeting date-time the person agreed to, as ISO 8601 with UTC offset (e.g. 2026-05-04T14:00:00+02:00); empty if no exact time was agreed." },
  { name: "callback_requested", type: "boolean", description: "True if the person asked to be called back later." },
  { name: "callback_time", type: "string", description: "When to call back, ISO 8601 with UTC offset; empty if not stated." },
  { name: "follow_up_note", type: "string", description: "One sentence: what the team should do next; empty if nothing." },
  { name: "support_issue", type: "string", description: "Short description of the problem the person reported; empty if none." },
  { name: "urgency", type: "enum", choices: ["low", "normal", "high"], description: "How urgent the person's request is." },
  { name: "payment_promise_date", type: "string", description: "Date the person promised to pay (YYYY-MM-DD); empty if none." },
  { name: "message_for_team", type: "string", description: "The message the person left for the team; empty if none." },
  { name: "do_not_call", type: "boolean", description: "True if the person asked not to be called again." },
] as const;

/** JSON Schema of the analysis (Vapi structuredDataPlan). */
export function analysisJsonSchema() {
  const properties: Record<string, unknown> = {};
  for (const f of ANALYSIS_FIELDS) {
    properties[f.name] =
      f.type === "enum" ? { type: "string", enum: [...f.choices], description: f.description } : f.type === "boolean" ? { type: "boolean", description: f.description } : { type: "string", description: f.description };
  }
  return { type: "object", properties, required: ["outcome", "sentiment"] };
}

/** Retell post_call_analysis_data. */
export function retellAnalysisFields() {
  return ANALYSIS_FIELDS.map((f) => (f.type === "enum" ? { type: "enum", name: f.name, description: f.description, choices: [...f.choices] } : { type: f.type, name: f.name, description: f.description }));
}
