import type { Definition } from "./definition";

/**
 * Built-in workflow templates (names/descriptions are i18n keys: workflows.templates.<key>.name|description).
 * Every template is a complete definition that validates and can be published as is; people can tailor it afterwards.
 */
export interface WorkflowTemplate {
  key: string;
  category: "sales" | "finance" | "support" | "hr" | "projects" | "operations" | "strategy";
  definition: Definition;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    // Lead created → auto-assign an owner (CRM rules, else round robin over sales managers) → follow-up task due tomorrow → notify the team.
    key: "new_lead_follow_up",
    category: "sales",
    definition: {
      trigger: { type: "event", event: "lead.created", filters: [] },
      variables: [{ name: "owner", value: "{{event.data.ownerId}}" }],
      steps: [
        {
          id: "has_owner",
          type: "branch",
          match: "all",
          conditions: [{ field: "event.data.ownerId", op: "exists" }],
          then: [],
          else: [
            { id: "assign", type: "action", action: { kind: "assign_round_robin", entity: "lead", recordId: "{{event.entityId}}", pool: "crm_rules", userIds: [], fallbackPermission: "sales.manage" } },
            { id: "set_owner", type: "set_variable", name: "owner", value: "{{steps.assign.userId}}" },
          ],
        },
        {
          id: "follow_up_task",
          type: "action",
          action: { kind: "create_task", title: "Follow up with {{event.data.name}}", description: "New lead from {{event.data.source}}. Reach out within one business day and log the outcome on the lead.", assigneeId: "{{vars.owner}}", priority: "HIGH", dueInDays: 1 },
        },
        { id: "notify_owner", type: "action", action: { kind: "notify", recipients: "field", userIds: [], userField: "{{vars.owner}}", title: "New lead for you: {{event.data.name}}", href: "/crm/{{event.entityId}}" } },
        { id: "notify_team", type: "action", action: { kind: "notify", recipients: "permission", permission: "sales.read", userIds: [], title: "New lead: {{event.data.name}}", href: "/crm/{{event.entityId}}" } },
      ],
    },
  },
  {
    // Deal won → project from the client onboarding template named after the account → owner + team → onboarding tasks → finance invoices.
    key: "deal_won_project",
    category: "projects",
    definition: {
      trigger: { type: "event", event: "deal.won", filters: [] },
      variables: [{ name: "client", value: "{{event.data.name}}" }],
      steps: [
        {
          id: "has_account",
          type: "branch",
          match: "all",
          conditions: [{ field: "event.data.accountId", op: "exists" }],
          then: [
            { id: "account", type: "action", action: { kind: "load_record", entity: "account", recordId: "{{event.data.accountId}}" } },
            { id: "set_client", type: "set_variable", name: "client", value: "{{steps.account.name}}" },
          ],
          else: [],
        },
        {
          id: "project",
          type: "action",
          action: {
            kind: "create_project",
            name: "{{vars.client}}",
            description: "Delivery project for the won deal {{event.data.name}}.",
            template: "client_onboarding",
            ownerId: "{{event.data.ownerId}}",
            memberIds: [],
            extraMemberIds: "{{steps.account.ownerId}}",
            startInDays: 0,
          },
        },
        {
          id: "handover",
          type: "action",
          action: { kind: "create_task", title: "Sales to delivery handover: {{event.data.name}}", description: "Walk the delivery team through scope, contacts and commitments made during the sale.", assigneeId: "{{event.data.ownerId}}", projectId: "{{steps.project.id}}", priority: "HIGH", dueInDays: 1 },
        },
        {
          id: "kickoff",
          type: "action",
          action: { kind: "create_task", title: "Schedule the kick-off meeting with {{vars.client}}", assigneeId: "{{event.data.ownerId}}", projectId: "{{steps.project.id}}", priority: "HIGH", dueInDays: 3 },
        },
        {
          id: "access",
          type: "action",
          action: { kind: "create_task", title: "Collect onboarding documents and system access from {{vars.client}}", projectId: "{{steps.project.id}}", priority: "MEDIUM", dueInDays: 5 },
        },
        { id: "notify_finance", type: "action", action: { kind: "notify", recipients: "permission", permission: "finance.manage", userIds: [], title: "Deal won: {{event.data.name}}. Please prepare the invoice.", href: "/finance" } },
        { id: "notify_owner", type: "action", action: { kind: "notify", recipients: "field", userIds: [], userField: "{{event.data.ownerId}}", title: "Delivery project created for {{vars.client}}", href: "/projects/{{steps.project.id}}" } },
      ],
    },
  },
  {
    // Company objective created → the AI CEO decomposes it into milestones, projects and tasks → the owner reviews the plan.
    key: "objective_decompose",
    category: "strategy",
    definition: {
      trigger: { type: "event", event: "objective.created", filters: [] },
      variables: [],
      steps: [
        { id: "objective", type: "action", action: { kind: "load_record", entity: "objective", recordId: "{{event.entityId}}" } },
        { id: "plan", type: "action", action: { kind: "decompose_goal", objectiveId: "{{event.entityId}}", guidance: "Keep the plan realistic for the company's current team size.", wait: true } },
        { id: "notify_owner", type: "action", action: { kind: "notify", recipients: "field", userIds: [], userField: "{{steps.objective.ownerId}}", title: "AI plan ready for review: {{steps.objective.name}}", href: "/tasks/{{steps.plan.id}}" } },
      ],
    },
  },
  {
    // Invoice overdue → reminder task for the account owner → Slack post to #finance (skipped when Slack is not connected).
    key: "invoice_overdue_reminder",
    category: "finance",
    definition: {
      trigger: { type: "event", event: "invoice.overdue", filters: [] },
      variables: [],
      steps: [
        { id: "account", type: "action", action: { kind: "load_record", entity: "account", recordId: "{{event.data.customerId}}" } },
        {
          id: "reminder_task",
          type: "action",
          action: { kind: "create_task", title: "Payment reminder: invoice {{event.data.number}} ({{event.data.customerName}})", description: "The invoice was due on {{event.data.dueDate}}. Contact the customer, agree a payment date and note it on the account.", assigneeId: "{{steps.account.ownerId}}", priority: "HIGH", dueInDays: 0 },
        },
        { id: "slack", type: "action", action: { kind: "send_slack", channel: "finance", text: "Invoice {{event.data.number}} for {{event.data.customerName}} is overdue. A reminder task was created for the account owner.", ifNotConnected: "skip" } },
        { id: "notify_finance", type: "action", action: { kind: "notify", recipients: "permission", permission: "finance.manage", userIds: [], title: "Invoice overdue: {{event.data.number}}", href: "/finance/invoices/{{event.entityId}}" } },
      ],
    },
  },
  {
    // Urgent ticket → assign the on-call person (rotation over support managers) unless already assigned → notify.
    key: "ticket_urgent_on_call",
    category: "support",
    definition: {
      trigger: { type: "event", event: "ticket.created", filters: [{ field: "event.data.priority", op: "eq", value: "URGENT" }] },
      variables: [{ name: "assignee", value: "{{event.data.assigneeId}}" }],
      steps: [
        {
          id: "assigned",
          type: "branch",
          match: "all",
          conditions: [{ field: "event.data.assigneeId", op: "exists" }],
          then: [],
          else: [
            { id: "on_call", type: "action", action: { kind: "assign_round_robin", entity: "ticket", recordId: "{{event.entityId}}", pool: "permission", permission: "support.manage", userIds: [] } },
            { id: "set_assignee", type: "set_variable", name: "assignee", value: "{{steps.on_call.userId}}" },
          ],
        },
        { id: "notify_on_call", type: "action", action: { kind: "notify", recipients: "field", userIds: [], userField: "{{vars.assignee}}", title: "Urgent ticket #{{event.data.number}}: {{event.data.subject}}", href: "/support/tickets/{{event.entityId}}" } },
        { id: "notify_team", type: "action", action: { kind: "notify", recipients: "permission", permission: "support.manage", userIds: [], title: "Urgent ticket #{{event.data.number}} is being handled", href: "/support/tickets/{{event.entityId}}" } },
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
    // Employee joined → HR onboarding checklist → IT setup tasks → buddy and first-week check-in with the manager.
    key: "employee_onboarding",
    category: "hr",
    definition: {
      trigger: { type: "event", event: "employee.joined", filters: [] },
      variables: [{ name: "employee", value: "{{event.data.name}}" }],
      steps: [
        { id: "checklist", type: "action", action: { kind: "start_onboarding", employeeId: "{{event.entityId}}", checklist: "ONBOARDING" } },
        { id: "employee", type: "action", action: { kind: "load_record", entity: "employee", recordId: "{{event.entityId}}" } },
        { id: "it_equipment", type: "action", action: { kind: "create_task", title: "IT: prepare laptop and equipment for {{vars.employee}}", priority: "HIGH", dueInDays: 0 } },
        { id: "it_accounts", type: "action", action: { kind: "create_task", title: "IT: create email, SSO and tool accounts for {{vars.employee}}", priority: "HIGH", dueInDays: 0 } },
        { id: "it_access", type: "action", action: { kind: "create_task", title: "IT: grant system access for the {{event.data.title}} role ({{vars.employee}})", priority: "MEDIUM", dueInDays: 1 } },
        { id: "buddy", type: "action", action: { kind: "create_task", title: "Assign an onboarding buddy to {{vars.employee}}", assigneeId: "{{steps.employee.managerUserId}}", priority: "MEDIUM", dueInDays: 2 } },
        { id: "wait_week", type: "delay", amount: 7, unit: "days" },
        { id: "check_in", type: "action", action: { kind: "create_task", title: "First-week check-in with {{vars.employee}}", assigneeId: "{{steps.employee.managerUserId}}", priority: "MEDIUM", dueInDays: 1 } },
      ],
    },
  },
  {
    // Candidate hired → employee onboarding project with the first tasks → HR checklist → notify HR.
    key: "candidate_hired_onboarding",
    category: "hr",
    definition: {
      trigger: { type: "event", event: "candidate.hired", filters: [] },
      variables: [],
      steps: [
        {
          id: "project",
          type: "action",
          action: { kind: "create_project", name: "Onboarding: {{event.data.name}}", description: "Onboarding of {{event.data.name}}, hired as {{event.data.jobTitle}}. Start date: {{event.data.startDate}}.", template: "", memberIds: [], startInDays: 0, dueInDays: 30 },
        },
        { id: "contract", type: "action", action: { kind: "create_task", title: "Send the contract and collect signatures from {{event.data.name}}", projectId: "{{steps.project.id}}", priority: "HIGH", dueInDays: 2 } },
        { id: "equipment", type: "action", action: { kind: "create_task", title: "Order equipment for {{event.data.name}}", projectId: "{{steps.project.id}}", priority: "HIGH", dueInDays: 5 } },
        { id: "first_week", type: "action", action: { kind: "create_task", title: "Plan the first week of {{event.data.name}}", projectId: "{{steps.project.id}}", priority: "MEDIUM", dueInDays: 7 } },
        { id: "review_30", type: "action", action: { kind: "create_task", title: "30-day review with {{event.data.name}}", projectId: "{{steps.project.id}}", priority: "MEDIUM", dueInDays: 30 } },
        {
          id: "has_employee",
          type: "branch",
          match: "all",
          conditions: [{ field: "event.data.employeeId", op: "exists" }],
          then: [{ id: "checklist", type: "action", action: { kind: "start_onboarding", employeeId: "{{event.data.employeeId}}", checklist: "ONBOARDING" } }],
          else: [],
        },
        { id: "notify_hr", type: "action", action: { kind: "notify", recipients: "permission", permission: "hr.manage", userIds: [], title: "Onboarding project created for {{event.data.name}}", href: "/projects/{{steps.project.id}}" } },
      ],
    },
  },
  {
    // Large deal → approval by the deal owner's manager-level approvers (sales managers) with a 48h escalation.
    key: "deal_approval_gate",
    category: "sales",
    definition: {
      trigger: { type: "event", event: "deal.created", filters: [{ field: "event.data.amountMinor", op: "gt", value: "5000000" }] },
      variables: [],
      steps: [
        {
          id: "approval",
          type: "action",
          action: {
            kind: "request_approval",
            title: "Approve large deal: {{event.data.name}}",
            message: "A deal above the approval threshold was created in stage {{event.data.stage}}. Approve to notify the owner to proceed.",
            approverMode: "permission",
            permission: "sales.manage",
            approverIds: [],
            timeoutHours: 48,
            timeoutAction: "reject",
            escalateToIds: [],
          },
        },
        { id: "notify_owner", type: "action", action: { kind: "notify", recipients: "field", userIds: [], userField: "{{event.data.ownerId}}", title: "Deal approved: {{event.data.name}}", href: "/crm/deals/{{event.entityId}}" } },
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
