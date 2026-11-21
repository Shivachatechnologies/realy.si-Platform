import { z } from "zod";
import { db, transaction } from "@/server/core/db";
import type { RequestContext } from "@/server/core/context";
import { conflict, notFound } from "@/server/core/errors";
import { randomToken } from "@/server/core/crypto";
import { writeAudit } from "@/server/modules/audit/service";
import { authorizeOrg } from "./policy";
import { txtRecordPresent } from "./sso";

/** White-label configuration: product name, logo, primary color and a custom domain (verified by DNS TXT). */

const blank = z.literal("").transform(() => undefined);
export const brandingInput = z.object({
  productName: z.string().trim().max(60).optional().or(blank),
  logoUrl: z.string().trim().url().max(500).optional().or(blank),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb")
    .optional()
    .or(blank),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Enter a domain like app.example.com")
    .optional()
    .or(blank),
});

export async function getBranding(organizationId: string) {
  return db().enterpriseBranding.findUnique({ where: { organizationId } });
}

export async function updateBranding(ctx: RequestContext, organizationId: string, raw: z.input<typeof brandingInput>) {
  const input = brandingInput.parse(raw);
  return transaction(async (tx) => {
    await authorizeOrg(ctx, organizationId, "organizations.manage", tx);
    const before = await tx.enterpriseBranding.findUnique({
      where: { organizationId },
    });
    const domain = input.customDomain ?? null;
    if (domain) {
      const taken = await tx.enterpriseBranding.findUnique({
        where: { customDomain: domain },
      });
      if (taken && taken.organizationId !== organizationId)
        throw conflict("This domain is used by another organization", {
          reason: "enterprise_domain_claimed",
        });
    }
    const domainChanged = (before?.customDomain ?? null) !== domain;
    const data = {
      productName: input.productName ?? null,
      logoUrl: input.logoUrl ?? null,
      primaryColor: input.primaryColor?.toLowerCase() ?? null,
      customDomain: domain,
      ...(domainChanged
        ? {
            customDomainToken: domain ? randomToken(18) : null,
            customDomainVerifiedAt: null,
          }
        : {}),
    };
    const row = await tx.enterpriseBranding.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await writeAudit(tx, ctx, {
      category: "TENANT",
      organizationId,
      action: "organization.branding_updated",
      resourceType: "branding",
      resourceId: row.id,
      oldValue: before ?? undefined,
      newValue: data,
    });
    return row;
  });
}

export async function verifyCustomDomain(ctx: RequestContext, organizationId: string) {
  await authorizeOrg(ctx, organizationId, "organizations.manage");
  const b = await db().enterpriseBranding.findUnique({
    where: { organizationId },
  });
  if (!b?.customDomain || !b.customDomainToken) throw notFound("Custom domain");
  const found = await txtRecordPresent(b.customDomain, b.customDomainToken);
  if (found && !b.customDomainVerifiedAt) {
    await transaction(async (tx) => {
      await tx.enterpriseBranding.update({
        where: { id: b.id },
        data: { customDomainVerifiedAt: new Date() },
      });
      await writeAudit(tx, ctx, {
        category: "TENANT",
        organizationId,
        action: "organization.custom_domain_verified",
        resourceType: "branding",
        resourceId: b.id,
        newValue: { domain: b.customDomain },
      });
    });
  }
  return { verified: found || !!b.customDomainVerifiedAt };
}

/** Readable foreground (near-black or white) for a #rrggbb background, by WCAG relative luminance. */
export function foregroundFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return l > 0.4 ? "#111111" : "#ffffff";
}
