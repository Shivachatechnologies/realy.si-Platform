import type { Definition } from "./definition";

/** Built-in workflow templates (names/descriptions are i18n keys: workflows.templates.<key>.name|description). */
export interface WorkflowTemplate {
  key: string;
  category: "sales" | "finance" | "support" | "hr" | "projects" | "operations";
  definition: Definition;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "new_lead_follow_up",
    category: "sales",
    definition: {
      trigger: { type: "event", event: "lead.created", filters: [] },
      variables: [],
      steps: [
        {
          id: "has_owner",
          type: "branch",
          match: "all",
          conditions: [{ field: "event.data.ownerId", op: "exists" }],
          then: [],
          else: [{ id: "notify_sales", type: "action", action: { kind: "notify", recipients: "permission", permission: "sales.manage", userIds: [], title: "New unassigned lead: {{event.data.name}}", href: "/crm/{{event.entityId}}" } }],
        },
        {
          id: "follow_up_task",
          type: "action",
          action: { kind: "create_task", title: "Follow up with {{event.data.name}}", description: "New lead from {{event.data.source}}. Reach out within one business day.", assigneeId: "{{event.data.ownerId}}", priority: "HIGH", dueInDays: 1 },
        },
      ],
    },
  },
  {
    key: "invoice_overdue_reminder",
    category: "finance",
    definition: {
      trigger: { type: "event", event: "invoice.overdue", filters: [] },
      variables: [],
      steps: [
        { id: "notify_finance", type: "action", action: { kind: "notify", recipients: "permission", permission: "finance.manage", userIds: [], title: "Invoice overdue: {{event.data.number}}", href: "/finance" } },
        {
          id: "reminder_task",
          type: "action",
          action: { kind: "create_task", title: "Send payment reminder for invoice {{event.data.number}}", description: "Customer: {{event.data.customerName}}. Amount due: {{event.data.amountDue}} {{event.data.currency}}.", priority: "HIGH", dueInDays: 0 },
        },
      ],
    },
  },
  {
    key: "ticket_created_notify",
    category: "support",
    definition: {
      trigger: { type: "event", event: "ticket.created", filters: [] },
      variables: [],
      steps: [
        {
          id: "urgent",
          type: "branch",
          match: "any",
          conditions: [
            { field: "event.data.priority", op: "eq", value: "URGENT" },
            { field: "event.data.priority", op: "eq", value: "HIGH" },
          ],
          then: [{ id: "notify_urgent", type: "action", action: { kind: "notify", recipients: "permission", permission: "support.manage", userIds: [], title: "Urgent ticket: {{event.data.subject}}", href: "/support" } }],
          else: [{ id: "notify_support", type: "action", action: { kind: "notify", recipients: "permission", permission: "support.read", userIds: [], title: "New ticket: {{event.data.subject}}", href: "/support" } }],
        },
      ],
    },
  },
  {
    key: "employee_onboarding",
    category: "hr",
    definition: {
      trigger: { type: "event", event: "employee.joined", filters: [] },
      variables: [{ name: "employee", value: "{{event.data.firstName}} {{event.data.lastName}}" }],
      steps: [
        { id: "accounts", type: "action", action: { kind: "create_task", title: "Create accounts and equipment for {{vars.employee}}", priority: "HIGH", dueInDays: 0 } },
        { id: "buddy", type: "action", action: { kind: "create_task", title: "Assign an onboarding buddy to {{vars.employee}}", priority: "MEDIUM", dueInDays: 2 } },
        { id: "plan", type: "action", action: { kind: "create_task", title: "Prepare the 30-60-90 day plan for {{vars.employee}}", priority: "MEDIUM", dueInDays: 5 } },
        { id: "wait_week", type: "delay", amount: 7, unit: "days" },
        { id: "check_in", type: "action", action: { kind: "create_task", title: "First-week check-in with {{vars.employee}}", priority: "MEDIUM", dueInDays: 1 } },
      ],
    },
  },
  {
    key: "deal_won_project",
    category: "projects",
    definition: {
      trigger: { type: "event", event: "deal.won", filters: [] },
      variables: [],
      steps: [
        { id: "kickoff", type: "action", action: { kind: "create_task", title: "Kick off delivery project for {{event.data.name}}", description: "Deal won. Set up the project, owners and timeline.", assigneeId: "{{event.data.ownerId}}", priority: "HIGH", dueInDays: 2 } },
        {
          id: "plan_ai",
          type: "action",
          action: { kind: "generate_ai_content", profile: "operations_assistant", title: "Delivery plan for {{event.data.name}}", instructions: "Draft a project plan with milestones and a checklist to deliver what was sold in the won deal {{event.data.name}} (value {{event.data.value}}). Use the company's products and documents.", wait: false },
        },
        { id: "celebrate", type: "action", action: { kind: "notify", recipients: "permission", permission: "sales.read", userIds: [], title: "Deal won: {{event.data.name}}", href: "/crm" } },
      ],
    },
  },
  {
    key: "weekly_pipeline_review",
    category: "operations",
    definition: {
      trigger: { type: "schedule", schedule: { kind: "weekly", day: 1, time: "09:00" }, filters: [] },
      variables: [],
      steps: [{ id: "review", type: "action", action: { kind: "create_task", title: "Weekly pipeline review", description: "Review open leads, stuck deals and follow-ups due this week.", priority: "MEDIUM", dueInDays: 0 } }],
    },
  },
  {
    key: "form_submitted_lead",
    category: "sales",
    definition: {
      trigger: { type: "event", event: "form.submitted", filters: [{ field: "event.data.email", op: "exists" }] },
      variables: [],
      steps: [
        { id: "lead", type: "action", action: { kind: "create_lead", name: "{{event.data.name}}", email: "{{event.data.email}}", phone: "{{event.data.phone}}", source: "Form: {{event.data.formName}}" } },
        { id: "notify", type: "action", action: { kind: "notify", recipients: "permission", permission: "sales.manage", userIds: [], title: "New form lead: {{event.data.name}}", href: "/crm/{{steps.lead.id}}" } },
      ],
    },
  },
];

export const templateByKey = (key: string) => WORKFLOW_TEMPLATES.find((t) => t.key === key);
