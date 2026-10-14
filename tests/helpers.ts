import { db } from "@/server/core/db";
import { userContext, systemContext, type RequestContext } from "@/server/core/context";
import { hashPassword } from "@/server/modules/auth/password";
import { seedDevCatalog, seedReferenceData } from "@/server/modules/seed";
import { systemRoleId } from "@/server/modules/rbac/service";
import type { ScopeType } from "@/generated/prisma/enums";

const TENANT_TABLES = [
  "stripe_events",
  "email_messages",
  "email_verification_tokens",
  "password_reset_tokens",
  "idempotency_keys",
  "notifications",
  "events",
  "audit_logs",
  "usage_records",
  "subscription_items",
  "subscriptions",
  "billing_profiles",
  "coupons",
  "promotions",
  "plan_entitlements",
  "price_versions",
  "prices",
  "plans",
  "billing_products",
  "feature_flag_rules",
  "role_assignments",
  "invitations",
  "api_keys",
  "service_accounts",
  "projects",
  "workspaces",
  "companies",
  "memberships",
  "organizations",
  "oauth_accounts",
  "mfa_recovery_codes",
  "mfa_factors",
  "sessions",
  "users",
];

let referenceSeeded = false;

/** Clean slate for one test file: tenant data and catalog wiped (TRUNCATE bypasses append-only row triggers). */
export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("resetDb only runs against a *_test database");
  const client = db();
  await client.$executeRawUnsafe(`TRUNCATE ${TENANT_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  await client.$executeRawUnsafe(`DELETE FROM roles WHERE organization_id IS NOT NULL`);
  if (!referenceSeeded) {
    await seedReferenceData(client);
    referenceSeeded = true;
  }
  await seedDevCatalog(client);
}

let counter = 0;
const passwordHash = hashPassword("correct horse battery staple");

/** Create a user directly and return a request context with a fresh MFA verification. */
export async function makeUser(opts: { name?: string; countryCode?: string; locale?: string; mfa?: boolean } = {}) {
  counter += 1;
  const user = await db().user.create({
    data: {
      email: `user${counter}-${Date.now()}@example.test`,
      name: opts.name ?? `User ${counter}`,
      passwordHash: await passwordHash,
      countryCode: opts.countryCode ?? null,
      locale: opts.locale ?? "en-US",
    },
  });
  const ctx = userContext(user.id, { mfaVerifiedAt: opts.mfa === false ? null : new Date() });
  return { user, ctx };
}

/** Bootstrap grant written by trusted code (like the CLI `grant-role` script). */
export async function grant(userId: string, roleKey: string, scopeType: ScopeType, scopeId: string, organizationId: string | null = null) {
  return db().roleAssignment.create({
    data: {
      principalType: "USER",
      principalId: userId,
      roleId: await systemRoleId(db(), roleKey),
      scopeType,
      scopeId,
      organizationId,
    },
  });
}

export const system = (): RequestContext => systemContext();

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const actual = (e as { code?: string }).code;
    if (actual !== code) throw new Error(`Expected error code ${code}, got ${actual ?? "none"}: ${(e as Error).message}`);
    return e;
  }
  throw new Error(`Expected error code ${code}, but the call succeeded`);
}
