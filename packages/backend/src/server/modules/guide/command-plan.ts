import "server-only";
import { profileByKey } from "@/server/modules/agents/profiles";
import type { RoutedIntent } from "./command";

/**
 * Deterministic planner for AI Command. It turns the routed intents into an explicit, persisted plan:
 * an optional research step first (market / competitor / "why" questions), one step per department, and a review
 * step that reads every finished result, writes the answer and recommends the next action. The plan is built from
 * the command and the company's real state — never invented progress — and each step later becomes a real agent task.
 */

export type PlannedStepKind = "RESEARCH" | "DEPARTMENT" | "REVIEW";

export interface PlannedStep {
  position: number;
  kind: PlannedStepKind;
  intent: string;
  profile: string;
  focus: string;
  dependsOn: number[];
}

/** Words (five shipped languages) that mean "find out first": research runs before the departments act. */
const RESEARCH_WORDS = [
  "research", "market", "competitor", "competition", "strategy", "industry", "benchmark", "potential customer", "ideal customer", "target audience", "positioning", "opportunit",
  "markt", "wettbewerb", "konkurrenz", "strategie", "branche", "zielgruppe",
  "市场", "竞争", "战略", "策略", "行业", "调研", "目标客户",
  "बाज़ार", "बाजार", "प्रतिस्पर्धी", "रणनीति", "उद्योग", "शोध",
  "سوق", "منافس", "استراتيجية", "صناعة", "بحث", "الجمهور المستهدف",
];

/** What each department's step must deliver (English: instructions for the AI employee). */
const FOCUS: Record<string, string> = {
  prospecting:
    "Find potential customers that fit this company (use the research results and the company's records for the ideal customer profile). Propose each as a lead with your create tools — every new lead waits for a person's approval. Report how many you proposed, why each fits, and where the data came from.",
  sales:
    "Look at the real pipeline, deals and proposals. Explain what is happening with sales using the numbers, find the deals that need attention and propose concrete actions (follow-ups, proposals) through your tools.",
  marketing:
    "Build the marketing part: audience, positioning, channels, messages and a short timeline grounded in the company's data and the research results. Propose campaigns or content drafts through your tools where useful (they wait for approval).",
  content: "Draft the content this command needs, in the company's voice. Save drafts through your tools (they wait for approval) and list what you drafted.",
  seo: "Work out the search-visibility part: keywords, pages and content that would help. Propose drafts through your tools where useful.",
  product: "Work out the product part: problem, users, scope, priorities and next milestones from the company's product records. Propose roadmap items or features through your tools where useful.",
  finance:
    "Prepare the finance part from the real ledger: revenue, expenses, cash position, receivables and what changed versus the previous period. Use exact figures from your tools and flag anything that needs the founder's attention.",
  recruiting: "Work out the hiring part: which roles, why now, and a draft job post or plan. Propose records through your tools where useful (they wait for approval).",
  people: "Answer the people part from the HR records: headcount, leave, onboarding and anything that needs attention.",
  support: "Look at the real support queue: volume, oldest and urgent tickets, recurring problems. Propose replies or fixes through your tools where useful.",
  projects: "Turn this into a delivery plan: project, milestones, tasks and dates from the company's real projects and capacity. Propose them through your tools (they wait for approval).",
  automation: "Find what can be automated here and propose a concrete workflow (trigger, steps, approvals) through your tools.",
  analytics:
    "Diagnose with data: read the company's KPIs and their time series, compare with the previous period, find which metrics and departments moved and the most likely causes. Separate evidence from judgement and never invent numbers.",
  operations: "Work out the operations part: processes, checklists, suppliers and bottlenecks from the company's records, with concrete improvements.",
  knowledge: "Answer from the company's documents and memory, citing passages like [S1]. Say plainly what the documents do not cover.",
  fallback:
    "No single department clearly owns this command. Decide what it needs. If the company has AI employees for the departments involved (read_ai_employees), delegate their parts with delegate_to_ai_employee and summarize; otherwise do what you can yourself and say which department should do the rest.",
};

const RESEARCH_FOCUS =
  "Research first so the departments can act on facts: the market, competitors, customers and trends relevant to this command, plus what the company's own documents and records already say. Use web research when it is available and cite every URL; if no research provider is connected, say so and rely on the company's data. End with a short list of the facts the next steps should use.";

const REVIEW_FOCUS =
  "Review the results of every finished step below. Check them against each other and against the company's real data, remove anything unsupported, and write one clear result for the founder: what was found, what was proposed (with the approvals waiting), what is still missing. Then recommend the single most valuable next action.";

export const needsResearch = (text: string, intents: RoutedIntent[]) => {
  const lower = ` ${text.toLowerCase()} `;
  if (intents.some((i) => i.key === "knowledge" || i.key === "analytics") && intents.length === 1) return false;
  return RESEARCH_WORDS.some((w) => lower.includes(w));
};

const firstProfile = (...keys: string[]) => keys.find((k) => profileByKey(k)) ?? null;

/** What the model-based understanding adds to a plan (B26). */
export interface PlanHints {
  /** Research first; null = the word list decides. */
  research: boolean | null;
  /** Department intent → intents it needs first. */
  dependsOn: Record<string, string[]>;
  source?: "model" | "keywords";
}

/**
 * Build the plan for a command (pure apart from profile availability). Department steps may depend on earlier
 * department steps (hints from the classifier); a dependency on a later step is dropped, so the plan is always acyclic.
 */
export function buildPlan(text: string, intents: RoutedIntent[], hints?: PlanHints): { research: boolean; steps: PlannedStep[] } {
  const steps: PlannedStep[] = [];
  const wantsResearch = hints?.research ?? needsResearch(text, intents);
  const researchProfile = wantsResearch ? firstProfile("marketing_analyst", "research_analyst") : null;
  if (researchProfile) steps.push({ position: 0, kind: "RESEARCH", intent: "research", profile: researchProfile, focus: RESEARCH_FOCUS, dependsOn: [] });
  const workDeps = researchProfile ? [0] : [];
  // Order departments so that a step comes after the steps it needs (stable; cycles fall back to the given order).
  const ordered: RoutedIntent[] = [];
  const pending = [...intents];
  while (pending.length) {
    const i = pending.findIndex((x) => (hints?.dependsOn[x.key] ?? []).every((d) => ordered.some((o) => o.key === d) || !pending.some((p) => p.key === d)));
    ordered.push(...pending.splice(i >= 0 ? i : 0, 1));
  }
  for (const i of ordered) {
    const deps = (hints?.dependsOn[i.key] ?? []).map((d) => steps.find((s) => s.kind === "DEPARTMENT" && s.intent === d)?.position).filter((p): p is number => p !== undefined);
    steps.push({ position: steps.length, kind: "DEPARTMENT", intent: i.key, profile: i.profile, focus: FOCUS[i.key] ?? FOCUS.fallback!, dependsOn: [...new Set([...workDeps, ...deps])] });
  }
  // A review step whenever more than one AI employee contributes (a single step's result is reviewed by the person).
  const reviewer = firstProfile("ai_ceo", "chief_of_staff", "research_analyst");
  if (steps.length > 1 && reviewer) {
    steps.push({ position: steps.length, kind: "REVIEW", intent: "review", profile: reviewer, focus: REVIEW_FOCUS, dependsOn: steps.map((s) => s.position) });
  }
  return { research: !!researchProfile, steps };
}

/** The "Next step: …" line an AI result ends with (instructions ask for it), or null. */
export function nextStepLine(output: string | null | undefined): string | null {
  if (!output) return null;
  const lines = output.split("\n").map((l) => l.replace(/^[\s>*_#-]+/, "").replace(/\*\*/g, "").trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/^(next step|nächster schritt|下一步|अगला कदम|الخطوة التالية)\s*[:：]\s*(.+)$/i);
    if (m) return m[2]!.trim().slice(0, 300);
  }
  return null;
}
