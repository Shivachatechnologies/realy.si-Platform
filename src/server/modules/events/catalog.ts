import { z } from "zod";

/**
 * Versioned domain event catalog (docs/workflows.md). Emitting a type/version not listed here,
 * or a payload that fails its schema, throws.
 */
const id = z.string().uuid();

export const eventCatalog = {
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
} as const;

export type EventType = keyof typeof eventCatalog;
export type EventPayload<T extends EventType, V extends keyof (typeof eventCatalog)[T] = 1> =
  (typeof eventCatalog)[T][V] extends z.ZodType<infer P> ? P : never;
