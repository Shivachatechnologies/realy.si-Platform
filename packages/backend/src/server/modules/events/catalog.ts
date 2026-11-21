import { z } from "zod";

/**
 * Versioned domain event catalog (docs/workflows.md). Emitting a type/version not listed here,
 * or a payload that fails its schema, throws.
 */
const id = z.string().uuid();

/**
 * Events emitted by business modules. Payload: { companyId, entityId, data } where `data` is a flat snapshot
 * (strings, numbers, booleans, null) of the record — what workflow conditions and AI triggers read.
 */
export const DOMAIN_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.assigned",
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "customer.created",
  "contact.created",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.overdue",
  "expense.created",
  "payment.received",
  "task.created",
  "task.completed",
  "project.created",
  "employee.joined",
  "employee.left",
  "candidate.applied",
  "candidate.hired",
  "leave.requested",
  "form.submitted",
  "campaign.launched",
  "content.published",
  "ticket.created",
  "ticket.updated",
  "ticket.resolved",
  "meeting.completed",
  "announcement.published",
  "webhook.received",
  "schedule.tick",
  "integration.synced",
  "agent.task.completed",
  "agent.task.failed",
  // Launch modules (voice, autonomy, marketing engine, CRM prospecting/outreach, live chat, briefings).
  "creative.project_created",
  "creative.asset_created",
  "creative.video_approved",
  "creative.changes_requested",
  "creative.handed_off",
  "autopilot.mode_changed",
  "costs.budget_reached",
  "voice.call_placed",
  "voice.call_completed",
  "autonomy.action_auto_approved",
  "autonomy.demoted",
  "marketing.run_completed",
  "crm.prospect_found",
  "crm.outreach_sent",
  "livechat.lead_captured",
  "briefing.delivered",
  // Company websites & landing pages (modules/sites).
  "site.published",
  "site.form_submitted",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENTS)[number];
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const domainEvent = z.object({ companyId: id, entityId: z.string().min(1).max(200), data: z.record(z.string(), scalar).default({}) });

const baseCatalog = {
  "user.registered": { 1: z.object({ userId: id, locale: z.string() }) },
  "organization.created": { 1: z.object({ organizationId: id, name: z.string() }) },
  "member.invited": { 1: z.object({ invitationId: id, organizationId: id, roleKey: z.string() }) },
  "member.joined": { 1: z.object({ organizationId: id, userId: id }) },
  "company.created": {
    1: z.object({
      companyId: id,
      organizationId: id,
      incorporationCountryCode: z.string().nullable(),
      dataRegion: z.string(),
    }),
  },
  "workspace.created": { 1: z.object({ workspaceId: id, companyId: id }) },
  "role.created": { 1: z.object({ roleId: id, key: z.string(), permissions: z.array(z.string()) }) },
  "role.assigned": {
    1: z.object({
      assignmentId: id,
      roleKey: z.string(),
      principalType: z.string(),
      principalId: id,
      scopeType: z.string(),
      scopeId: z.string(),
    }),
  },
  "role.revoked": { 1: z.object({ assignmentId: id }) },
  "pricing.plan.created": { 1: z.object({ planId: id, key: z.string() }) },
  "pricing.plan.updated": { 1: z.object({ planId: id, key: z.string() }) },
  "pricing.price.created": {
    1: z.object({ priceId: id, planId: id, marketType: z.string(), marketCode: z.string(), currency: z.string() }),
  },
  "pricing.price_version.created": {
    1: z.object({
      priceId: id,
      priceVersionId: id,
      version: z.number().int(),
      amountMinor: z.string(),
      currency: z.string(),
      effectiveFrom: z.string(),
    }),
  },
  "feature_flag.updated": { 1: z.object({ flagId: id, key: z.string() }) },
  "globalization.country.updated": { 1: z.object({ countryCode: z.string() }) },
  "billing.profile.updated": { 1: z.object({ organizationId: id, billingCountryCode: z.string() }) },
  "approval.requested": { 1: z.object({ approvalId: id, companyId: id, tool: z.string(), risk: z.string(), taskId: id.nullable() }) },
  "approval.resolved": { 1: z.object({ approvalId: id, companyId: id, tool: z.string(), status: z.string() }) },
  "objective.created": { 1: z.object({ objectiveId: id, companyId: id }) },
  "milestone.completed": { 1: z.object({ milestoneId: id, objectiveId: id, companyId: id }) },
} as const;

export const eventCatalog = baseCatalog as typeof baseCatalog & Record<DomainEventType, { 1: typeof domainEvent }>;
for (const t of DOMAIN_EVENTS) (eventCatalog as Record<string, unknown>)[t] = { 1: domainEvent };

export type EventType = keyof typeof eventCatalog;
export type EventPayload<T extends EventType, V extends keyof (typeof eventCatalog)[T] = 1> =
  (typeof eventCatalog)[T][V] extends z.ZodType<infer P> ? P : never;
