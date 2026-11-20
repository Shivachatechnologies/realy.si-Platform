import type { Prisma } from "@/generated/prisma/client";
import type { CrmEntity } from "@/generated/prisma/enums";
import { db, type Db, type Tx } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { authorize } from "./common";

export const CRM_ENTITIES = ["LEAD", "CONTACT", "ACCOUNT", "DEAL"] as const;
export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "SELECT"] as const;

export type CustomFieldDef = { key: string; label: string; type: (typeof FIELD_TYPES)[number]; options: string[]; required: boolean };
export type CustomValues = Record<string, string | number | null>;

export async function fieldDefs(client: Tx | Db, companyId: string, entity: CrmEntity): Promise<CustomFieldDef[]> {
  return client.crmCustomField.findMany({
    where: { companyId, entity, archivedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { key: true, label: true, type: true, options: true, required: true },
  });
}

/** Custom field definitions of an entity, for rendering forms. */
export async function listFieldDefs(ctx: RequestContext, organizationId: string, companyId: string, entity: CrmEntity) {
  await authorize(ctx, organizationId, companyId, "sales.read");
  return fieldDefs(db(), companyId, entity);
}

/**
 * Validate submitted custom values against the active definitions: unknown keys are dropped, types are checked,
 * required fields enforced (on create, or when `partial` is false). Merged over `existing`.
 */
export async function validateCustomFields(
  tx: Tx,
  companyId: string,
  entity: CrmEntity,
  input: Record<string, unknown> | undefined,
  existing: Prisma.JsonValue = {},
  opts: { partial?: boolean } = {},
): Promise<Prisma.InputJsonValue> {
  const defs = await fieldDefs(tx, companyId, entity);
  const base = (existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}) as CustomValues;
  const out: CustomValues = { ...base };
  for (const d of defs) {
    if (!input || !(d.key in input)) {
      if (!opts.partial && d.required && (out[d.key] == null || out[d.key] === "")) throw invalid(`${d.label} is required`, { reason: "crm_custom_field_required", field: d.key });
      continue;
    }
    const raw = input[d.key];
    if (raw == null || raw === "") {
      if (d.required) throw invalid(`${d.label} is required`, { reason: "crm_custom_field_required", field: d.key });
      out[d.key] = null;
      continue;
    }
    const s = String(raw).trim().slice(0, 1000);
    if (d.type === "NUMBER") {
      const n = Number(s);
      if (!Number.isFinite(n)) throw invalid(`${d.label} must be a number`, { reason: "crm_custom_field_invalid", field: d.key });
      out[d.key] = n;
    } else if (d.type === "DATE") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw invalid(`${d.label} must be a date`, { reason: "crm_custom_field_invalid", field: d.key });
      out[d.key] = s;
    } else if (d.type === "SELECT") {
      if (!d.options.includes(s)) throw invalid(`${d.label} has an invalid option`, { reason: "crm_custom_field_invalid", field: d.key });
      out[d.key] = s;
    } else out[d.key] = s;
  }
  return out as Prisma.InputJsonValue;
}

/** Display pairs (label, value) for a record's custom values. */
export function customDisplay(defs: CustomFieldDef[], values: Prisma.JsonValue): { key: string; label: string; value: string }[] {
  const v = (values && typeof values === "object" && !Array.isArray(values) ? values : {}) as CustomValues;
  return defs.filter((d) => v[d.key] != null && v[d.key] !== "").map((d) => ({ key: d.key, label: d.label, value: String(v[d.key]) }));
}
