import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { invalid } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { LOCALES, directionOf, type AppLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { authorize, day, employeeName, optText, requireEmployee, toDay, uuid } from "./access";
import { logEmployeeEvent } from "./employees";

/**
 * Generated HR documents: plain-language letters (employment verification, experience, welcome, role change, written
 * warning) filled from the employee record, rendered as a printable HTML document in the chosen language and stored
 * with the employee's documents (HrDocument, category "letter"). Nothing is sent: HR downloads, prints and signs it.
 */

export const DOC_TEMPLATES = ["employment_verification", "experience", "welcome", "role_change", "warning"] as const;
export type DocTemplate = (typeof DOC_TEMPLATES)[number];

/** Extra inputs each template needs (beyond the employee record). */
export const TEMPLATE_FIELDS: Record<DocTemplate, ("details" | "newTitle" | "effectiveDate" | "endDate")[]> = {
  employment_verification: ["details"],
  experience: ["endDate", "details"],
  welcome: ["details"],
  role_change: ["newTitle", "effectiveDate", "details"],
  warning: ["details"],
};

export const generateDocInput = z.object({
  employeeId: uuid,
  template: z.enum(DOC_TEMPLATES),
  locale: z.enum(LOCALES).default("en-US"),
  details: optText(3000),
  newTitle: optText(160),
  effectiveDate: day.optional().or(z.literal("").transform(() => undefined)),
  endDate: day.optional().or(z.literal("").transform(() => undefined)),
});

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderHtml(o: { locale: AppLocale; company: string; subject: string; date: string; recipient: string; paragraphs: string[]; signoff: string; signer: string; footer: string }) {
  const dir = directionOf(o.locale);
  return `<!doctype html>
<html lang="${o.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.subject)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1c1917; background: #fff; margin: 0; }
  main { max-width: 42rem; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.65; font-size: 15px; }
  header { border-bottom: 2px solid #1c1917; padding-bottom: .75rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  header strong { font-size: 1.35rem; letter-spacing: .01em; }
  .muted { color: #57534e; font-size: 13px; }
  h1 { font-size: 1.1rem; margin: 1.75rem 0 1rem; }
  p { margin: 0 0 1rem; white-space: pre-line; }
  .sign { margin-top: 3rem; }
  .line { margin-top: 3rem; border-top: 1px solid #a8a29e; width: 14rem; padding-top: .25rem; }
  footer { margin-top: 3rem; border-top: 1px solid #e7e5e4; padding-top: .75rem; }
  @media print { main { margin: 0 auto; } }
</style>
</head>
<body>
<main>
<header><strong>${esc(o.company)}</strong><span class="muted">${esc(o.date)}</span></header>
<p>${esc(o.recipient)}</p>
<h1>${esc(o.subject)}</h1>
${o.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n")}
<div class="sign"><p>${esc(o.signoff)}</p><div class="line">${esc(o.signer)}<br><span class="muted">${esc(o.company)}</span></div></div>
<footer class="muted">${esc(o.footer)}</footer>
</main>
</body>
</html>
`;
}

/** Fill a template from the employee record and store it as an employee document. HR managers only. */
export async function generateHrDocument(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof generateDocInput>) {
  const input = generateDocInput.parse(raw);
  const need = TEMPLATE_FIELDS[input.template];
  if (need.includes("newTitle") && !input.newTitle) throw invalid("Enter the new job title", { reason: "hr_doc_field" });
  if (input.template === "warning" && !input.details) throw invalid("Describe what happened and what must change", { reason: "hr_doc_field" });
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const [e, company, actor] = await Promise.all([
    db().employee.findFirst({
      where: { id: input.employeeId, organizationId, companyId, archivedAt: null },
      include: { department: { select: { name: true } }, manager: { select: { firstName: true, lastName: true } } },
    }),
    db().company.findFirstOrThrow({ where: { id: companyId, organizationId }, select: { name: true, legalName: true, timezone: true } }),
    ctx.actor.id ? db().user.findUnique({ where: { id: ctx.actor.id }, select: { name: true, email: true } }) : null,
  ]);
  if (!e) await requireEmployee(db(), organizationId, companyId, input.employeeId); // throws not found
  const emp = e!;
  const t = await getT(input.locale);
  const fmt = (d: Date | null | undefined) => (d ? formatDate(d, input.locale, "UTC", { dateStyle: "long" }) : "—");
  const companyName = company.legalName || company.name;
  const name = employeeName(emp);
  const values = {
    name,
    company: companyName,
    title: emp.title || t("hr.docgen.noTitle"),
    department: emp.department?.name || t("hr.docgen.noDepartment"),
    startDate: fmt(emp.startDate),
    endDate: fmt(input.endDate ? toDay(input.endDate) : emp.status === "TERMINATED" ? emp.updatedAt : new Date()),
    effectiveDate: fmt(input.effectiveDate ? toDay(input.effectiveDate) : new Date()),
    newTitle: input.newTitle ?? "",
    manager: emp.manager ? employeeName(emp.manager) : t("hr.docgen.noManager"),
    employmentType: t(`hr.employmentType.${emp.employmentType}`),
  };
  const prefix = `hr.docgen.tpl.${input.template}`;
  const subject = t(`${prefix}.subject`, values);
  const paragraphs = t(`${prefix}.body`, values).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (input.details) paragraphs.push(input.details);
  const today = formatDate(new Date(), input.locale, company.timezone, { dateStyle: "long" });
  const html = renderHtml({
    locale: input.locale,
    company: companyName,
    subject,
    date: today,
    recipient: t(`${prefix}.recipient`, values),
    paragraphs,
    signoff: t("hr.docgen.signoff"),
    signer: actor?.name || actor?.email || companyName,
    footer: t("hr.docgen.footer", { date: today }),
  });
  const bytes = Buffer.from(html, "utf8");
  const docName = `${t(`${prefix}.name`)} — ${name}`.slice(0, 200);
  const filename = `${input.template}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee"}-${new Date().toISOString().slice(0, 10)}.html`;
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "hr.manage", tx);
    const doc = await tx.hrDocument.create({
      data: { organizationId, companyId, employeeId: emp.id, name: docName, category: "letter", filename, mimeType: "text/html", sizeBytes: bytes.length, content: bytes, uploadedById: ctx.actor.id },
      select: { id: true, name: true },
    });
    await logEmployeeEvent(tx, ctx, emp, "document", null, docName);
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "hr.document.generated", resourceType: "hr_document", resourceId: doc.id, newValue: { employeeId: emp.id, template: input.template, locale: input.locale } });
    return doc;
  });
}

/** Every employee document of the company (metadata only), newest first — the HR documents library. */
export async function listCompanyDocuments(ctx: RequestContext, organizationId: string, companyId: string, f: { q?: string; category?: string } = {}) {
  await authorize(ctx, organizationId, companyId, "hr.manage");
  const rows = await db().hrDocument.findMany({
    where: {
      organizationId,
      companyId,
      ...(f.category ? { category: f.category } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { employee: { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }] } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, name: true, category: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, employee: { select: { id: true, firstName: true, lastName: true, title: true } } },
  });
  const byCategory = await db().hrDocument.groupBy({ by: ["category"], where: { organizationId, companyId }, _count: { _all: true } });
  return { rows, byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])) as Record<string, number> };
}
