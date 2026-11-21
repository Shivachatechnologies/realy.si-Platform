import { z } from "zod";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, invalid } from "@/server/core/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { actorId, authorize, requireSite } from "./common";
import { shapeSite } from "./service";

/**
 * Custom domains: the founder proves ownership with a DNS TXT record; the check is a real DNS lookup. Routing a
 * verified domain to the site (DNS CNAME + adding the domain to the hosting project) is a separate operator step
 * documented in docs/sites.md — until then the site stays at /s/<slug> and the UI says so.
 */

export const TXT_PREFIX = "_realy-verification";
export const txtName = (domain: string) => `${TXT_PREFIX}.${domain}`;
export const txtValue = (token: string) => `realy-site-verification=${token}`;

const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BLOCKED = /(^|\.)(realy\.si|localhost|local|internal|example\.(com|org|net)|vercel\.app)$/;

export const domainInput = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, ""))
    .pipe(z.string().regex(HOST, "Enter a domain like www.example.com").refine((v) => !BLOCKED.test(v), "This domain cannot be used")),
});

export async function setDomain(ctx: RequestContext, organizationId: string, companyId: string, raw: z.input<typeof domainInput>) {
  const { domain } = domainInput.parse(raw);
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const site = await requireSite(tx, organizationId, companyId);
    const other = await tx.site.findUnique({ where: { customDomain: domain }, select: { id: true } });
    if (other && other.id !== site.id) throw conflict("This domain is already connected to another site", { reason: "sites_domain_taken" });
    const token = site.customDomain === domain && site.domainToken ? site.domainToken : randomBytes(16).toString("hex");
    const updated = await tx.site.update({
      where: { id: site.id },
      data: { customDomain: domain, domainToken: token, domainStatus: site.customDomain === domain && site.domainStatus === "VERIFIED" ? "VERIFIED" : "PENDING", domainError: null, ...(site.customDomain !== domain ? { domainVerifiedAt: null, domainCheckedAt: null } : {}), updatedById: actorId(ctx, organizationId) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.domain.set", resourceType: "site", resourceId: site.id, oldValue: { domain: site.customDomain }, newValue: { domain } });
    return shapeSite(updated);
  });
}

export async function removeDomain(ctx: RequestContext, organizationId: string, companyId: string) {
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const site = await requireSite(tx, organizationId, companyId);
    const updated = await tx.site.update({ where: { id: site.id }, data: { customDomain: null, domainToken: null, domainStatus: "NONE", domainError: null, domainCheckedAt: null, domainVerifiedAt: null, updatedById: actorId(ctx, organizationId) } });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.domain.removed", resourceType: "site", resourceId: site.id, oldValue: { domain: site.customDomain } });
    return shapeSite(updated);
  });
}

async function lookup(name: string): Promise<{ values: string[]; error: string | null }> {
  try {
    const records = await Promise.race([resolveTxt(name), new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 8000))]);
    return { values: records.map((r) => r.join("")), error: null };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    return { values: [], error: code === "ENOTFOUND" || code === "ENODATA" ? "record_not_found" : code === "ETIMEOUT" ? "dns_timeout" : "dns_error" };
  }
}

/** Look the TXT record up now and store the honest result (VERIFIED or FAILED with the reason). */
export async function verifyDomain(ctx: RequestContext, organizationId: string, companyId: string) {
  await authorize(ctx, organizationId, companyId, "marketing.manage");
  const site = await transaction((tx) => requireSite(tx, organizationId, companyId));
  if (!site.customDomain || !site.domainToken) throw invalid("Add a domain first", { reason: "sites_no_domain" });
  const { values, error } = await lookup(txtName(site.customDomain));
  const ok = values.some((v) => v.trim() === txtValue(site.domainToken!));
  const reason = ok ? null : (error ?? (values.length ? "record_mismatch" : "record_not_found"));
  return transaction(async (tx) => {
    await authorize(ctx, organizationId, companyId, "marketing.manage", tx);
    const now = new Date();
    const updated = await tx.site.update({
      where: { id: site.id },
      data: { domainStatus: ok ? "VERIFIED" : "FAILED", domainCheckedAt: now, domainError: reason, ...(ok && !site.domainVerifiedAt ? { domainVerifiedAt: now } : {}) },
    });
    await writeAudit(tx, ctx, { category: "TENANT", organizationId, action: "site.domain.checked", resourceType: "site", resourceId: site.id, newValue: { domain: site.customDomain, verified: ok, reason } });
    return shapeSite(updated);
  });
}
