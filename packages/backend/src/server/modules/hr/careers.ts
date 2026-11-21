import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import { systemContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { isUuid, optText } from "./access";
import { insertCandidate, readResume, resumeInput } from "./recruiting";

/** Public careers site: open jobs of a company and the application form (no sign-in; the route is rate limited). */

export const applyInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: optText(100),
  email: z.string().trim().email().max(254),
  phone: optText(40),
  linkedinUrl: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  coverLetter: optText(10_000),
  resume: resumeInput,
  /** Honeypot: humans never fill it. */
  website: z.string().max(0).optional().or(z.literal("")),
  consent: z.literal(true),
});

export async function publicCompany(companyId: string) {
  if (!isUuid(companyId)) return null;
  return db().company.findFirst({ where: { id: companyId, deletedAt: null, status: "ACTIVE" }, select: { id: true, organizationId: true, name: true, timezone: true } });
}

export async function publicJobs(companyId: string) {
  if (!isUuid(companyId)) return [];
  return db().hrJob.findMany({
    where: { companyId, status: "OPEN", company: { deletedAt: null } },
    orderBy: { publishedAt: "desc" },
    take: 200,
    select: { id: true, title: true, location: true, remote: true, employmentType: true, publishedAt: true, department: { select: { name: true } } },
  });
}

export async function publicJob(companyId: string, jobId: string) {
  if (!isUuid(companyId) || !isUuid(jobId)) return null;
  return db().hrJob.findFirst({
    where: { id: jobId, companyId, status: "OPEN", company: { deletedAt: null } },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      remote: true,
      employmentType: true,
      salaryMinMinor: true,
      salaryMaxMinor: true,
      currency: true,
      publishedAt: true,
      department: { select: { name: true } },
    },
  });
}

export async function applyToJob(companyId: string, jobId: string, raw: z.input<typeof applyInput>, requestId?: string) {
  const input = applyInput.parse(raw);
  const company = await publicCompany(companyId);
  if (!company || !isUuid(jobId)) throw notFound("Job");
  const resume = await readResume(input.resume);
  const ctx = systemContext(requestId);
  await transaction(async (tx) => {
    const job = await tx.hrJob.findFirst({ where: { id: jobId, companyId, organizationId: company.organizationId, status: "OPEN" } });
    if (!job) throw notFound("Job");
    await insertCandidate(tx, ctx, job, { ...input, source: "careers" }, resume);
  });
  return { ok: true };
}
