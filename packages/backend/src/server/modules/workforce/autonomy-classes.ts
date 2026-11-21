/**
 * Autonomy action classes (docs/autonomy.md). Pure data and classification, no imports: used by the tool contract
 * (tools/define.ts), the policy engine (./autonomy-policy.ts) and the /autonomy control room.
 */

export const ACTION_CLASSES = ["read", "change_data", "send_message", "call", "publish", "spend", "pay", "contract", "hr", "delete_data"] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];
export const isActionClass = (v: unknown): v is ActionClass => typeof v === "string" && (ACTION_CLASSES as readonly string[]).includes(v);

/** Classes that act outside the company (customers, the public, money, legal, people). Default: ask a person. */
export const EXTERNAL_CLASSES: readonly ActionClass[] = ["send_message", "call", "publish", "spend", "pay", "contract", "hr"];
/** Classes whose limits are money caps (an amount is required to act on its own). */
export const MONEY_CLASSES: readonly ActionClass[] = ["spend", "pay"];

/**
 * Hard floors: classes that can never be AUTO, whatever a policy says (contracts/legal, hiring/firing, deleting data).
 * Payments are a partial floor: AUTO only up to PAYMENT_HARD_CAP_MAJOR per action (see autonomy-policy.ts).
 */
export const NEVER_AUTO: readonly ActionClass[] = ["contract", "hr", "delete_data"];
/** A payment or transfer above this many major units of its currency always needs a person. */
export const PAYMENT_HARD_CAP_MAJOR = 500;

export const AUTONOMY_LEVEL_KEYS = ["OFF", "SUGGEST", "ASK", "AUTO"] as const;
export type AutonomyLevelKey = (typeof AUTONOMY_LEVEL_KEYS)[number];

/** Built-in defaults = the platform's behaviour before autonomy policies existed. */
export const DEFAULT_LEVEL: Record<ActionClass, AutonomyLevelKey> = {
  read: "AUTO",
  change_data: "ASK",
  send_message: "ASK",
  call: "ASK",
  publish: "ASK",
  spend: "ASK",
  pay: "ASK",
  contract: "ASK",
  hr: "ASK",
  delete_data: "ASK",
};

/** Channels a policy can allow (free-form strings are accepted from modules; these are offered in the UI). */
export const AUTONOMY_CHANNELS = ["email", "sms", "whatsapp", "phone", "chat", "social", "ads", "web"] as const;

/** Departments a policy can target ("*" = whole company). Mirrors workforce/service.ts DEPARTMENTS. */
export const AUTONOMY_DEPARTMENTS = ["executive", "sales", "marketing", "finance", "hr", "engineering", "product", "support", "operations", "research"] as const;
export const ALL_DEPARTMENTS = "*";

interface ToolShape {
  name: string;
  permissions: string[];
  risk: string;
  autonomy: string;
  actionClass?: ActionClass;
  channel?: string;
}

/**
 * The action class of a tool: its declared `actionClass`, else inferred from name, permissions and risk. Inference is
 * conservative — anything ambiguous lands in a class that defaults to "ask".
 */
export function classifyTool(t: ToolShape): ActionClass {
  if (t.actionClass) return t.actionClass;
  const n = t.name;
  const isRead = t.autonomy === "AUTONOMOUS" && t.permissions.length > 0 && t.permissions.every((p) => p.endsWith(".read"));
  if (isRead || /^(read|search|get|list)_/.test(n)) return t.autonomy === "AUTONOMOUS" ? "read" : "change_data";
  if (/(^|_)(delete|remove|purge|erase|archive)(_|$)/.test(n)) return "delete_data";
  // Drafts never leave the company, whatever they are drafts of.
  if (/(^|_)drafts?(_|$)/.test(n)) return t.autonomy === "AUTONOMOUS" ? "read" : "change_data";
  if (/(^|_)(pay|payment|payout|transfer|refund|wire)(_|$)/.test(n)) return "pay";
  if (/(^|_)(contract|legal|sign|signature|nda|terms)(_|$)/.test(n)) return "contract";
  if (/(^|_)(hire|fire|terminate|dismiss|offer|reject_candidate|advance_candidate|salary|payroll)(_|$)/.test(n)) return "hr";
  if (/(^|_)(call|dial|voice)(_|$)/.test(n)) return "call";
  if (/(^|_)(budget|spend|purchase|buy|order)(_|$)|ad_campaign/.test(n)) return "spend";
  if (/(^|_)(publish|post|launch|go_live|schedule_social)(_|$)/.test(n)) return "publish";
  if (/(^|_)(send|reply|outreach|email|sms|whatsapp|message|enroll)(_|$)/.test(n) && t.autonomy !== "AUTONOMOUS") return "send_message";
  return t.autonomy === "AUTONOMOUS" ? "read" : "change_data";
}

/** The channel of a tool: declared, else inferred from its name (null when it has none). */
export function toolChannel(t: ToolShape): string | null {
  if (t.channel) return t.channel;
  const n = t.name;
  if (/sms/.test(n)) return "sms";
  if (/whatsapp/.test(n)) return "whatsapp";
  if (/(^|_)(call|dial|voice)(_|$)/.test(n)) return "phone";
  if (/social|comment/.test(n)) return "social";
  if (/(^|_)ad(_|s_)/.test(n)) return "ads";
  if (/email|outreach|reply|sequence|enroll/.test(n)) return "email";
  return null;
}
