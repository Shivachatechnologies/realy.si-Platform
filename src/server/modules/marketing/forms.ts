import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext, type RequestContext } from "@/server/core/context";
import { invalid, notFound } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { emitDomainEvent } from "@/server/modules/events/emit";
import { notifyUsers, usersWithPermission } from "@/server/modules/notifications/service";
import { normalizePhone, scoreLead } from "@/server/modules/crm/scoring";
import { actorId, authorize, isUuid, normalizeEmail, requireOwned, uuid } from "./common";

export const FIELD_TYPES = ["text", "email", "tel", "textarea", "select", "checkbox"] as const;

export const formField = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
});
export type FormField = z.infer<typeof formField>;

const fields = z
  .array(formField)
  .min(1)
  .max(30)
  .refine((f) => new Set(f.map((x) => x.key)).size === f.length, { message: "Field keys must be unique" })
  .refine((f) => f.some((x) => x.type === "email"), { message: "A form needs an email field" });

export const formInput = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  fields,
  submitLabel: z.string().trim().max(60).optional(),
  successMessage: z.string().trim().max(500).optional(),
  followUpHours: z.number().int().min(1).max(24 * 60).nullable().optional(),
  campaignId: uuid.or(z.literal("")).nullable().optional(),
});
export const updateFormInput = formInput.partial().extend({ active: z.boolean().optional() });

export const DEFAULT_FIELDS: FormField[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "company", label: "Company", type: "text", required: false },
  { key: "message", label: "Message", type: "textarea", required: false },
];

export const parseFields = (raw: unknown): FormField[] => {
  const r = z.array(formField).safeParse(raw);
  return r.success ? r.data : [];
};

export async function listForms(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  return db().marketingForm.findMany({
    where: { organizationId, companyId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { campaign: { select: { id: true, name: true, code: true } } },
  });
}

export async function getForm(ctx: RequestContext, organizationId: string, companyId: string, formId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.read");
  if (!isUuid(formId)) throw notFound("Form");
  const form = await db().marketingForm.findFirst({
    where: { id: formId, organizationId, companyId },
    include: { campaign: { select: { id: true, name: true, code: true } }, sequences: { where: { archivedAt: null }, select: { id: true, name: true, status: true } } },
  });
  if (!form) throw notFound("Form");
  const submissions = await db().marketingFormSubmission.findMany({ where: { companyId, formId }, orderBy: { createdAt: "desc" }, take: 100 });
  return { form: { ...form, fields: parseFields(form.fields) }, submissions };
}

export async function createForm(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof formInput>) {
  const input = formInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const f = await tx.marketingForm.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        title: input.title,
        description: input.description || null,
        fields: input.fields,
        submitLabel: input.submitLabel || null,
        successMessage: input.successMessage || null,
        followUpHours: input.followUpHours ?? null,
        campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign"),
        createdById: actorId(ctx, organizationId),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.form.created", resourceType: "marketing_form", resourceId: f.id, newValue: { name: f.name } });
    return f;
  });
}

export async function updateForm(ctx: RequestContext, organizationId: string, companyId: string, formId: string, raw: z.input<typeof updateFormInput>) {
  const input = updateFormInput.parse(raw);
  if (!isUuid(formId)) throw notFound("Form");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const existing = await tx.marketingForm.findFirst({ where: { id: formId, organizationId, companyId, archivedAt: null }, select: { id: true } });
    if (!existing) throw notFound("Form");
    const f = await tx.marketingForm.update({
      where: { id: formId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.fields !== undefined ? { fields: input.fields } : {}),
        ...(input.submitLabel !== undefined ? { submitLabel: input.submitLabel || null } : {}),
        ...(input.successMessage !== undefined ? { successMessage: input.successMessage || null } : {}),
        ...(input.followUpHours !== undefined ? { followUpHours: input.followUpHours } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.campaignId !== undefined ? { campaignId: await requireOwned(tx, "marketingCampaign", companyId, input.campaignId || null, "Campaign") } : {}),
      },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.form.updated", resourceType: "marketing_form", resourceId: formId, newValue: { name: input.name, active: input.active } });
    return f;
  });
}

export async function archiveForm(ctx: RequestContext, organizationId: string, companyId: string, formId: string) {
  if (!isUuid(formId)) throw notFound("Form");
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const { count } = await tx.marketingForm.updateMany({ where: { id: formId, organizationId, companyId, archivedAt: null }, data: { archivedAt: new Date(), active: false } });
    if (!count) throw notFound("Form");
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "marketing.form.archived", resourceType: "marketing_form", resourceId: formId });
    return { ok: true };
  });
}

// ── Public ──

/** What the public page needs (no tenant internals). Null when the form is missing, archived or inactive. */
export async function getPublicForm(formId: string) {
  if (!isUuid(formId)) return null;
  const f = await db().marketingForm.findFirst({
    where: { id: formId, archivedAt: null, active: true, company: { deletedAt: null, status: "ACTIVE" } },
    select: { id: true, title: true, description: true, fields: true, submitLabel: true, successMessage: true, company: { select: { name: true, defaultLocale: true } } },
  });
  return f ? { ...f, fields: parseFields(f.fields) } : null;
}

export const publicSubmissionInput = z.object({
  values: z.record(z.string().max(60), z.union([z.string().max(5000), z.boolean()])),
  consent: z.boolean().default(false),
  campaign: z.string().trim().max(40).optional(),
  utmSource: z.string().trim().max(100).optional(),
  utmMedium: z.string().trim().max(100).optional(),
  /** Honeypot: humans leave it empty. */
  website: z.string().max(200).optional(),
});

/** Validate and store a public submission: creates (or reuses) a CRM lead, emits form.submitted (+ lead.created). */
export async function submitForm(formId: string, raw: z.input<typeof publicSubmissionInput>) {
  const input = publicSubmissionInput.parse(raw);
  if (!isUuid(formId)) throw notFound("Form");
  const form = await db().marketingForm.findFirst({
    where: { id: formId, archivedAt: null, active: true, company: { deletedAt: null, status: "ACTIVE" } },
    include: { campaign: { select: { code: true } }, company: { select: { baseCurrency: true } } },
  });
  if (!form) throw notFound("Form");
  // Bots filling the honeypot get a normal-looking success without anything being stored.
  if (input.website) return { ok: true, message: form.successMessage };

  const defs = parseFields(form.fields);
  const values: Record<string, string> = {};
  const issues: { path: string; message: string }[] = [];
  for (const f of defs) {
    const v = input.values[f.key];
    const s = typeof v === "boolean" ? (v ? "yes" : "") : (v ?? "").trim();
    if (f.required && !s) issues.push({ path: f.key, message: "required" });
    else if (s && f.type === "email" && !z.string().email().max(254).safeParse(s).success) issues.push({ path: f.key, message: "invalid_email" });
    else if (s && f.type === "select" && f.options && !f.options.includes(s)) issues.push({ path: f.key, message: "invalid_option" });
    else if (s) values[f.key] = s.slice(0, f.type === "textarea" ? 5000 : 500);
  }
  if (issues.length) throw invalid("Invalid submission", { issues });

  const emailField = defs.find((f) => f.type === "email");
  const email = emailField ? values[emailField.key] ?? null : null;
  const phoneField = defs.find((f) => f.type === "tel");
  const phone = phoneField ? values[phoneField.key] ?? null : null;
  const name =
    values.name || [values.first_name ?? values.firstname, values.last_name ?? values.lastname].filter(Boolean).join(" ") || (email ? email.split("@")[0]! : "Form lead");
  const firstName = values.first_name ?? values.firstname ?? name.split(" ")[0] ?? null;
  const account = values.company ?? values.organization ?? null;

  // Attribution: a known campaign code from the link wins, then the form's campaign.
  const wanted = input.campaign?.toUpperCase();
  const known = wanted ? await db().marketingCampaign.findFirst({ where: { companyId: form.companyId, code: wanted }, select: { code: true } }) : null;
  const campaignCode = known?.code ?? form.campaign?.code ?? null;
  const source = campaignCode ?? `Form: ${form.name}`.slice(0, 100);
  const consent = input.consent && !!email;
  const notes = defs
    .filter((f) => values[f.key] && !["name", "first_name", "firstname", "last_name", "lastname", "company", "organization"].includes(f.key) && f.type !== "email" && f.type !== "tel")
    .map((f) => `${f.label}: ${values[f.key]}`)
    .join("\n")
    .slice(0, 5000);

  const ctx = systemContext();
  return transaction(async (tx) => {
    const emailNormalized = normalizeEmail(email);
    const existing = emailNormalized
      ? await tx.lead.findFirst({ where: { companyId: form.companyId, archivedAt: null, emailNormalized }, select: { id: true, ownerId: true, name: true } })
      : null;
    let leadId: string;
    let ownerId: string | null = null;
    let createdLead = false;
    if (existing) {
      leadId = existing.id;
      ownerId = existing.ownerId;
      await tx.leadActivity.create({
        data: { organizationId: form.organizationId, companyId: form.companyId, leadId, type: "NOTE", summary: `Submitted form "${form.name}"${notes ? `\n${notes}` : ""}`.slice(0, 5000), occurredAt: new Date(), createdById: form.createdById },
      });
    } else {
      const { score, label } = scoreLead({ email, phone, account, notes, stage: "NEW" });
      const lead = await tx.lead.create({
        data: {
          organizationId: form.organizationId,
          companyId: form.companyId,
          name: name.slice(0, 200),
          email,
          emailNormalized,
          phone,
          phoneNormalized: normalizePhone(phone),
          account,
          source,
          notes: notes || null,
          currency: form.company.baseCurrency,
          score,
          scoreLabel: label,
          createdById: form.createdById,
        },
      });
      leadId = lead.id;
      createdLead = true;
    }
    const submission = await tx.marketingFormSubmission.create({
      data: {
        organizationId: form.organizationId,
        companyId: form.companyId,
        formId: form.id,
        leadId,
        data: values,
        campaignCode,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        consent,
      },
    });
    await tx.marketingForm.update({ where: { id: form.id }, data: { submissionCount: { increment: 1 } } });
    if (form.followUpHours) {
      await tx.leadFollowUp.create({
        data: { organizationId: form.organizationId, companyId: form.companyId, leadId, dueAt: new Date(Date.now() + form.followUpHours * 3_600_000), note: `Follow up on form "${form.name}"`.slice(0, 1000), priority: "MEDIUM", createdById: form.createdById },
      });
    }
    const eventData = { formId: form.id, formName: form.name, submissionId: submission.id, leadId, email, firstName, marketingConsent: consent, campaignCode, source };
    await emitDomainEvent(tx, ctx, "form.submitted", { organizationId: form.organizationId, companyId: form.companyId, entityType: "marketing_form_submission", entityId: submission.id, data: eventData });
    if (createdLead) {
      await emitDomainEvent(tx, ctx, "lead.created", { organizationId: form.organizationId, companyId: form.companyId, entityType: "lead", entityId: leadId, data: { ...eventData, name, stage: "NEW" } });
      await writeAudit(tx, ctx, { category: "TENANT", organizationId: form.organizationId, action: "lead.created", resourceType: "lead", resourceId: leadId, newValue: { source, formId: form.id } });
    }
    await writeAudit(tx, ctx, { category: "TENANT", organizationId: form.organizationId, action: "marketing.form.submitted", resourceType: "marketing_form_submission", resourceId: submission.id, newValue: { formId: form.id, leadId } });
    const recipients = ownerId ? [ownerId] : await usersWithPermission(tx, form.organizationId, form.companyId, "sales.manage");
    await notifyUsers(tx, form.organizationId, recipients, "marketing.form_submission", { companyId: form.companyId, title: name, href: `/crm/${leadId}` });
    return { ok: true, message: form.successMessage };
  });
}
