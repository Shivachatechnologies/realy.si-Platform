import "server-only";
import { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { AppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { getControls } from "@/server/core/platform-controls";
import { generateText } from "@/server/modules/integrations/services/ai-text";
import { AGENT_PROFILES } from "@/server/modules/agents/profiles";
import { DEFINITION_HELP } from "./ai-tools";
import { validateDefinition, type Definition, type DefinitionIssue } from "./definition";
import { parseAutomationText, type RuleNote } from "./nl-rules";
import { authorizeWorkflows, createWorkflow } from "./service";

/**
 * Natural-language automation ("When a new lead comes in, research them, score them, assign them and notify me").
 *  1. A connected AI text provider (OpenAI / Gemini via Integrations) designs the definition; it is validated with
 *     validateDefinition exactly like the visual editor's output.
 *  2. Without a provider (or when its design does not validate) the rule-based parser (nl-rules.ts) builds it and
 *     the result says so (`source: "rules"`), listing every phrase it could not understand.
 * Nothing is saved by `composeAutomation`; `saveComposedDraft` stores a DRAFT workflow. Publishing and turning it on
 * stay explicit user actions on the workflow page.
 */

export const composeInput = z.object({ text: z.string().trim().min(10).max(2000) });
export const saveComposedInput = z.object({
  name: z.string().trim().min(1).max(160),
  text: z.string().trim().max(2000).optional(),
  source: z.enum(["ai", "rules"]),
  definition: z.unknown(),
});

export interface ComposeResult {
  source: "ai" | "rules";
  /** Why the AI path was not used (null when it was). */
  aiStatus: "used" | "not_connected" | "paused" | "invalid_design" | "error";
  name: string;
  /** AI: one plain sentence per step. Rules: the phrase each step came from. */
  notes: RuleNote[];
  unmatched: string[];
  definition: Definition | null;
  issues: DefinitionIssue[];
}

const SYSTEM = (profiles: string) =>
  [
    "You turn a business owner's plain-language description of an automation into a workflow definition for the Realy platform.",
    "Reply with ONLY one JSON object, no prose and no code fences: {\"name\": string (max 80 chars), \"notes\": [{\"phrase\": the words from the request, \"target\": the step id or \"trigger\"}], \"unmatched\": [phrases you could not express], \"definition\": DEFINITION}.",
    DEFINITION_HELP,
    `AI employee profiles you may use in profile fields: ${profiles}.`,
    "Rules: 'me' / 'I' means the workflow owner (notify recipients \"owner\"; approvals: approverMode \"permission\" with permission \"workflows.manage\"). Use assign_ai_employee with wait:true for research, ai_decision for scoring/classifying/deciding (options like Hot, Warm, Cold), assign_round_robin with pool crm_rules for leads (fallbackPermission \"sales.manage\").",
    "Never invent record ids or user ids: use templates like {{event.entityId}}, {{event.data.name}}, {{event.data.email}}, {{steps.<id>.userId}}. Any step that sends something outside the company (send_email, send_slack, send_teams, http_webhook) must come after a request_approval step.",
    "Prefer the fewest steps that do what was asked. If something cannot be expressed, leave it out and list it in unmatched.",
  ].join("\n");

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const aiShape = z.object({
  name: z.string().trim().min(1).max(160),
  notes: z.array(z.object({ phrase: z.string().max(500), target: z.string().max(60).nullable() })).max(60).default([]),
  unmatched: z.array(z.string().max(500)).max(30).default([]),
  definition: z.unknown(),
});

export async function composeAutomation(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof composeInput>): Promise<ComposeResult> {
  const { text } = composeInput.parse(raw);
  await authorizeWorkflows(ctx, organizationId, companyId, "workflows.manage");
  if (!ctx.actor.id) throw new AppError("unauthenticated", "Sign in required");

  let aiStatus: ComposeResult["aiStatus"] = "not_connected";
  const controls = await getControls().catch(() => null);
  if (controls && (!controls.aiWorkforceEnabled || controls.aiExecutionPaused)) {
    aiStatus = "paused";
  } else {
    const profiles = AGENT_PROFILES.map((p) => p.key).join(", ");
    const r = await generateText(organizationId, companyId, { system: SYSTEM(profiles), prompt: `Automation request:\n${text}`, maxOutputTokens: 4000, temperature: 0.1 }).catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, "automation compose: AI text failed");
      return null;
    });
    if (r?.ok) {
      const parsed = aiShape.safeParse(extractJson(r.data.text));
      const v = parsed.success ? validateDefinition(parsed.data.definition) : null;
      if (parsed.success && v?.ok) {
        return { source: "ai", aiStatus: "used", name: parsed.data.name.slice(0, 160), notes: parsed.data.notes, unmatched: parsed.data.unmatched, definition: v.definition, issues: [] };
      }
      aiStatus = "invalid_design";
    } else if (r && r.code !== "not_connected") {
      aiStatus = "error";
    } else if (!r) {
      aiStatus = "error";
    }
  }

  const rules = parseAutomationText(text, { meId: ctx.actor.id });
  const v = validateDefinition(rules.definition);
  return {
    source: "rules",
    aiStatus,
    name: rules.name,
    notes: rules.notes,
    unmatched: rules.unmatched,
    definition: v.ok ? v.definition : rules.definition.steps.length ? rules.definition : null,
    issues: v.ok ? [] : v.issues,
  };
}

/** Save a composed definition as a DRAFT workflow (validated again server-side). Returns the new workflow id. */
export async function saveComposedDraft(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof saveComposedInput>) {
  const input = saveComposedInput.parse(raw);
  const v = validateDefinition(input.definition);
  if (!v.ok) throw new AppError("validation_error", "The workflow definition is invalid", { reason: "automation_workflow_invalid", issues: v.issues });
  const label = input.source === "ai" ? "Designed by AI from" : "Built by the rule-based parser from";
  const description = input.text ? `${label}: “${input.text}”`.slice(0, 2000) : undefined;
  const wf = await createWorkflow(ctx, organizationId, companyId, { name: input.name, description }, { draft: v.definition });
  return { id: wf.id };
}
