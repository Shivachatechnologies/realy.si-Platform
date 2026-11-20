import { z } from "zod";
import { db } from "@/server/core/db";
import { def, type ToolDefinition } from "@/server/modules/tools/define";
import { ACTION_KINDS, TRIGGER_EVENTS, validateDefinition } from "./definition";
import { createWorkflow, getWorkflow, listRuns, listWorkflows, updateWorkflow } from "./service";

const definitionText = z
  .string()
  .min(2)
  .max(30_000)
  .refine((s) => {
    try {
      return validateDefinition(JSON.parse(s)).ok;
    } catch {
      return false;
    }
  }, "definition_json must be a valid workflow definition (see the tool description)");

const DEFINITION_HELP = [
  'definition_json is a JSON string: {"trigger": T, "variables": [{"name","value"}], "steps": [S...]}.',
  `T is {"type":"event","event":<one of ${TRIGGER_EVENTS.join(", ")}>,"filters":[C...]} or {"type":"schedule","schedule":{"kind":"daily","time":"09:00"}|{"kind":"weekly","day":1,"time":"09:00"}|{"kind":"interval","minutes":60},"filters":[]} or {"type":"webhook","hookId":<incoming webhook id>,"filters":[C...]} or {"type":"manual","filters":[]}.`,
  'C is {"field":"event.data.stage","op":"eq|neq|contains|gt|lt|exists|not_exists","value":"WON"}.',
  'S is {"id":"slug","type":"condition","match":"all|any","conditions":[C...]} (stops the run when false), {"id","type":"branch","match","conditions","then":[S...],"else":[S...]}, {"id","type":"delay","amount":2,"unit":"minutes|hours|days"}, {"id","type":"set_variable","name":"x","value":"{{event.data.name}}"} or {"id","type":"action","action":A}.',
  `A has "kind" (${ACTION_KINDS.join(", ")}): create_lead{name,email?,phone?,source?,notes?,ownerId?}; create_contact{firstName,lastName?,email?,phone?,title?}; create_task{title,description?,assigneeId?,priority:LOW|MEDIUM|HIGH|URGENT,dueInDays?}; update_lead{leadId,stage?,ownerId?}; update_record{entity:lead|work_task,recordId,field,value}; assign_user{entity,recordId,userId}; assign_ai_employee{profile,title,instructions,wait}; notify{recipients:owner|users|permission,userIds:[],permission?,title,href?}; request_approval{title,message?,approverIds:[]}; generate_ai_content{profile,title,instructions,wait}; send_email{to,subject,body}; send_slack{channel,text}; http_webhook{url,body?}; custom_api{method,path,body?}.`,
  "Text fields accept templates like {{event.data.name}}, {{event.entityId}}, {{vars.x}}, {{steps.<id>.id}}.",
].join(" ");

/** AI tools of the automation module, registered in src/server/modules/tools/modules.ts. Use `def` from tools/define. */
export const AUTOMATION_TOOLS: Record<string, ToolDefinition> = {
  read_workflows: def({
    name: "read_workflows",
    version: 1,
    description: "Lists the company's workflows (status, trigger, published version, runs and failures in the last 30 days). Pass workflowId to read one workflow's full draft and published definition.",
    input: z.object({ workflowId: z.string().uuid().optional(), q: z.string().max(200).optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: { workflowId: { type: "string", description: "Read one workflow in full" }, q: { type: "string", description: "Search by name" } },
      required: [],
      additionalProperties: false,
    },
    permissions: ["workflows.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: ({ workflowId }) => (workflowId ? `Read workflow ${workflowId}` : "Read workflows"),
    async execute({ workflowId, q }, { ctx, organizationId, companyId }) {
      if (workflowId) {
        const wf = await getWorkflow(ctx, organizationId, companyId, workflowId);
        return {
          content: `Workflow "${wf.name}" (${wf.status}, published version ${wf.currentVersion || "none"}, owner ${wf.owner?.name ?? wf.ownerId}).\nDescription: ${wf.description ?? "-"}\nDraft definition: ${JSON.stringify(wf.draft)}\nPublished definition: ${wf.published ? JSON.stringify(wf.published) : "(not published)"}`,
          records: [`workflow:${wf.id}`],
          count: 1,
        };
      }
      const list = await listWorkflows(ctx, organizationId, companyId, { q });
      if (!list.length) return { content: "No workflows yet.", count: 0 };
      const lines = list.map((w) => `- ${w.id} "${w.name}" ${w.status}, trigger ${w.triggerType ?? w.draftTrigger.type}${w.triggerKey ? ` ${w.triggerKey}` : ""}, v${w.currentVersion}, runs 30d ${w.runs30d}, failed ${w.failed30d}`);
      return { content: lines.join("\n"), count: list.length, records: list.map((w) => `workflow:${w.id}`) };
    },
  }),

  read_workflow_runs: def({
    name: "read_workflow_runs",
    version: 1,
    description: "Lists recent workflow runs (status, trigger, error) newest first, optionally for one workflow or status. Pass runId to read one run's step-by-step log.",
    input: z.object({ workflowId: z.string().uuid().optional(), status: z.enum(["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(), runId: z.string().uuid().optional() }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        status: { type: "string", enum: ["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED"] },
        runId: { type: "string", description: "Read one run's step log" },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ["workflows.read"],
    risk: "LOW",
    autonomy: "AUTONOMOUS",
    timeoutMs: 15_000,
    summarize: () => "Read workflow runs",
    async execute({ workflowId, status, runId }, { ctx, organizationId, companyId }) {
      if (runId) {
        await listRuns(ctx, organizationId, companyId, {}, 1); // authorization
        const run = await db().workflowRun.findFirst({ where: { id: runId, organizationId, companyId }, include: { steps: { orderBy: { startedAt: "asc" } }, workflow: { select: { name: true } } } });
        if (!run) return { content: "Run not found.", count: 0 };
        const steps = run.steps.map((s) => `- ${s.stepId} (${s.stepType}) ${s.status} attempts ${s.attempts}${s.error ? ` error: ${s.error}` : ""}${s.output ? ` output: ${JSON.stringify(s.output).slice(0, 300)}` : ""}`);
        return { content: `Run of "${run.workflow.name}": ${run.status}${run.error ? ` — ${run.error}` : ""}\nTrigger: ${JSON.stringify(run.triggerData).slice(0, 1000)}\nSteps:\n${steps.join("\n") || "(none)"}`, count: 1, records: [`workflow_run:${run.id}`] };
      }
      const { data } = await listRuns(ctx, organizationId, companyId, { workflowId, status }, 30);
      if (!data.length) return { content: "No runs.", count: 0 };
      const lines = data.map((r) => `- ${r.id} ${r.createdAt.toISOString()} "${r.workflow.name}" ${r.status}${r.isTest ? " (test)" : ""}${r.error ? ` — ${r.error}` : ""}`);
      return { content: lines.join("\n"), count: data.length, records: data.map((r) => `workflow_run:${r.id}`) };
    },
  }),

  create_workflow_draft: def({
    name: "create_workflow_draft",
    version: 1,
    description: `Creates a new DRAFT workflow, or replaces the unpublished draft of an existing one (workflowId). Never publishes or enables it. ${DEFINITION_HELP}`,
    input: z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional(), workflowId: z.string().uuid().optional(), definition_json: definitionText }).strict(),
    modelSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string", description: "What the workflow does and why" },
        workflowId: { type: "string", description: "Existing workflow whose draft to replace" },
        definition_json: { type: "string", description: "The workflow definition as a JSON string (format in the tool description)" },
      },
      required: ["name", "definition_json"],
      additionalProperties: false,
    },
    permissions: ["workflows.manage"],
    risk: "MEDIUM",
    autonomy: "SUPERVISED",
    timeoutMs: 15_000,
    summarize: ({ name, workflowId }) => (workflowId ? `Replace the draft of workflow "${name}"` : `Create draft workflow "${name}"`),
    async execute({ name, description, workflowId, definition_json }, { ctx, organizationId, companyId }) {
      const parsed = validateDefinition(JSON.parse(definition_json));
      if (!parsed.ok) return { content: `Invalid definition: ${parsed.issues.map((i) => `${i.path} ${i.message}`).join("; ")}` };
      if (workflowId) {
        const wf = await updateWorkflow(ctx, organizationId, companyId, workflowId, { name, ...(description !== undefined ? { description } : {}), draft: parsed.definition });
        return { content: `Draft of workflow "${wf.name}" replaced. It is not published; a person must review, publish and enable it.`, records: [`workflow:${wf.id}`] };
      }
      const wf = await createWorkflow(ctx, organizationId, companyId, { name, description }, { draft: parsed.definition });
      return { content: `Draft workflow "${wf.name}" created (id ${wf.id}). It is not published; a person must review, publish and enable it.`, records: [`workflow:${wf.id}`] };
    },
  }),
};
