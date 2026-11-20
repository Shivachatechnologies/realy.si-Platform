import { z } from "zod";
import { db, transaction, type Prisma, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid, notFound } from "@/server/core/errors";
import { toJson } from "@/server/core/json";
import {
  CONTROL_DEFS,
  LOCKDOWN_KEY,
  LOCKDOWN_SETS,
  controlMeta,
  getControls,
  invalidateControls,
  invalidateOrgState,
  isControlKey,
  orgOverrideKey,
  orgOverrideSchema,
  getOrgOverride,
  type ControlKey,
  type LockdownState,
} from "@/server/core/platform-controls";
import { writeAudit } from "@/server/modules/audit/service";
import { requirePermission } from "@/server/modules/rbac/service";
import { platformChain } from "@/server/modules/rbac/scope";
import { isUuid, reasonSchema, requireAnyPlatform, requireConfirmation } from "./access";

/** Permission that guards a control: AI policy keys need platform.ai.manage, everything else platform.controls.manage. */
export const controlPermission = (key: ControlKey) => (CONTROL_DEFS[key].group === "ai" ? "platform.ai.manage" : "platform.controls.manage");

/** A critical switch moved away from normal operation needs the typed confirmation phrase (the control key). */
export function needsTypedConfirmation(key: ControlKey, value: unknown) {
  const def = CONTROL_DEFS[key];
  return def.critical && value !== def.default;
}

async function saveSetting(tx: Tx, ctx: RequestContext, key: string, value: unknown, reason: string) {
  const json = toJson(value) as Prisma.InputJsonValue;
  await tx.platformSetting.upsert({
    where: { key },
    create: { key, value: json, updatedById: ctx.actor.id, reason },
    update: { value: json, updatedById: ctx.actor.id, reason },
  });
}

export const setControlInput = z.object({
  key: z.string().max(64),
  value: z.unknown(),
  reason: reasonSchema,
  confirm: z.string().max(100).optional(),
});

/** Change one platform control. Validated against the registry, permission- and MFA-checked, audited (SECURITY). */
export async function setControl(ctx: RequestContext, raw: z.input<typeof setControlInput>) {
  const input = setControlInput.parse(raw);
  if (!isControlKey(input.key)) throw notFound("Control");
  const key = input.key;
  const parsed = CONTROL_DEFS[key].schema.safeParse(input.value);
  if (!parsed.success) throw invalid(`Invalid value for ${key}`, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const value = parsed.data;
  if (needsTypedConfirmation(key, value)) requireConfirmation(input.confirm, key);
  const before = (await getControls())[key];
  if (key in LOCKDOWN_SETS && (await getControls()).lockdown) {
    throw conflict("End the emergency lockdown before changing this switch", { reason: "platform_lockdown_active" });
  }
  await transaction(async (tx) => {
    await requirePermission(ctx, controlPermission(key), platformChain(), tx);
    await saveSetting(tx, ctx, key, value, input.reason);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.control.changed", resourceType: "platform_control", resourceId: key, oldValue: { [key]: before }, newValue: { [key]: value }, reason: input.reason });
  });
  invalidateControls();
  return { key, value };
}

/** Controls with their current value and last change (for the admin UI). */
export async function listControls(ctx: RequestContext) {
  await requireAnyPlatform(ctx, ["platform.audit.read", "platform.controls.manage", "platform.ai.read"]);
  const [controls, meta] = await Promise.all([getControls(), controlMeta()]);
  return { controls, meta: Object.fromEntries(meta) };
}

// ───────────── Emergency lockdown ─────────────

export const LOCKDOWN_PHRASE = "LOCKDOWN";
export const lockdownInput = z.object({ reason: reasonSchema, confirm: z.string().max(100).optional() });

/**
 * Emergency lockdown: maintenance on, AI workforce off, background jobs paused and every non-admin session revoked.
 * The previous values are stored so "end lockdown" restores exactly what was there before.
 */
export async function startLockdown(ctx: RequestContext, raw: z.input<typeof lockdownInput>) {
  const input = lockdownInput.parse(raw);
  requireConfirmation(input.confirm, LOCKDOWN_PHRASE);
  const c = await getControls();
  if (c.lockdown) throw conflict("Emergency lockdown is already active", { reason: "platform_lockdown_active" });
  const state = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.controls.manage", platformChain(), tx);
    const admins = await tx.roleAssignment.findMany({ where: { principalType: "USER", scopeType: { in: ["PLATFORM", "REGION", "COUNTRY"] } }, select: { principalId: true } });
    const keep = [...new Set(admins.map((a) => a.principalId))];
    const revoked = await tx.session.updateMany({ where: { revokedAt: null, userId: { notIn: keep } }, data: { revokedAt: new Date() } });
    const lockdown: LockdownState = {
      startedAt: new Date().toISOString(),
      startedById: ctx.actor.id,
      reason: input.reason,
      previous: { maintenanceMode: c.maintenanceMode, aiWorkforceEnabled: c.aiWorkforceEnabled, backgroundJobsPaused: c.backgroundJobsPaused },
      revokedSessions: revoked.count,
    };
    for (const [k, v] of Object.entries(LOCKDOWN_SETS)) await saveSetting(tx, ctx, k, v, input.reason);
    await saveSetting(tx, ctx, LOCKDOWN_KEY, lockdown, input.reason);
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.lockdown.started", resourceType: "platform_control", resourceId: LOCKDOWN_KEY, oldValue: lockdown.previous, newValue: { ...LOCKDOWN_SETS, revokedSessions: revoked.count }, reason: input.reason });
    return lockdown;
  });
  invalidateControls();
  return state;
}

export async function endLockdown(ctx: RequestContext, raw: { reason: string }) {
  const reason = reasonSchema.parse(raw.reason);
  const c = await getControls();
  if (!c.lockdown) throw conflict("No emergency lockdown is active", { reason: "platform_lockdown_inactive" });
  const previous = c.lockdown.previous;
  await transaction(async (tx) => {
    await requirePermission(ctx, "platform.controls.manage", platformChain(), tx);
    for (const [k, v] of Object.entries(previous)) await saveSetting(tx, ctx, k, v, reason);
    await tx.platformSetting.deleteMany({ where: { key: LOCKDOWN_KEY } });
    await writeAudit(tx, ctx, { category: "SECURITY", action: "platform.lockdown.ended", resourceType: "platform_control", resourceId: LOCKDOWN_KEY, oldValue: LOCKDOWN_SETS, newValue: previous, reason });
  });
  invalidateControls();
  return { restored: previous };
}

// ───────────── Organization restrictions and status ─────────────

export const orgOverrideInput = orgOverrideSchema.extend({ reason: reasonSchema });

/** Per-organization restrictions: modules, AI on/off and token budgets. */
export async function setOrgOverride(ctx: RequestContext, organizationId: string, raw: z.input<typeof orgOverrideInput>) {
  if (!isUuid(organizationId)) throw notFound("Organization");
  const { reason, ...value } = orgOverrideInput.parse(raw);
  const before = await getOrgOverride(organizationId);
  await transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    if (!(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
    await saveSetting(tx, ctx, orgOverrideKey(organizationId), value, reason);
    await writeAudit(tx, ctx, { category: "ADMIN", organizationId, action: "platform.organization.restrictions_changed", resourceType: "organization", resourceId: organizationId, oldValue: before, newValue: value, reason });
  });
  invalidateControls();
  invalidateOrgState(organizationId);
  return value;
}

export const orgStatusInput = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: reasonSchema, confirm: z.string().max(200).optional() });

/**
 * Suspend or reactivate an organization. Suspension is enforced on every org-scoped API (route()) and page
 * (requireOrgContext), and stops its AI tasks; members see a clear "organization suspended" message.
 */
export async function setOrganizationStatus(ctx: RequestContext, organizationId: string, raw: z.input<typeof orgStatusInput>) {
  if (!isUuid(organizationId)) throw notFound("Organization");
  const input = orgStatusInput.parse(raw);
  const result = await transaction(async (tx) => {
    await requirePermission(ctx, "platform.organizations.manage", platformChain(), tx);
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, slug: true, status: true } });
    if (!org) throw notFound("Organization");
    if (org.status === "CLOSED") throw conflict("Closed organizations cannot be changed");
    if (input.status === "SUSPENDED") requireConfirmation(input.confirm, org.slug);
    if (org.status === input.status) return { id: org.id, status: org.status };
    await tx.organization.update({ where: { id: org.id }, data: { status: input.status } });
    await writeAudit(tx, ctx, {
      category: "ADMIN",
      organizationId,
      action: input.status === "SUSPENDED" ? "platform.organization.suspended" : "platform.organization.reactivated",
      resourceType: "organization",
      resourceId: organizationId,
      oldValue: { status: org.status },
      newValue: { status: input.status },
      reason: input.reason,
    });
    return { id: org.id, status: input.status };
  });
  invalidateOrgState(organizationId);
  return result;
}

/** Last change of every stored setting (who/when/why) for the controls page. */
export async function settingRows() {
  return db()
    .platformSetting.findMany({ where: { NOT: { key: { startsWith: "org:" } } }, orderBy: { updatedAt: "desc" } })
    .catch(() => []);
}
