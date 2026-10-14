/**
 * Bootstrap platform administration (there is no UI path to the first SUPER_ADMIN, by design).
 *
 *   pnpm realy:grant-role <email> <ROLE_KEY> [SCOPE_TYPE=PLATFORM] [SCOPE_ID=*]
 *   e.g. pnpm realy:grant-role ops@realy.si SUPER_ADMIN
 *        pnpm realy:grant-role uae@realy.si REGION_ADMIN REGION MIDDLE_EAST
 *
 * Runs as the SYSTEM actor through the normal assignRole path, so the grant is validated and audited.
 */
import "dotenv/config";
import { db } from "../src/server/core/db";
import { systemContext } from "../src/server/core/context";
import { assignRole, systemRoleId } from "../src/server/modules/rbac/service";

async function main() {
  const [email, roleKey, scopeType = "PLATFORM", scopeId = "*"] = process.argv.slice(2);
  if (!email || !roleKey) {
    console.error("usage: pnpm realy:grant-role <email> <ROLE_KEY> [SCOPE_TYPE] [SCOPE_ID]");
    process.exit(2);
  }
  if (!["PLATFORM", "REGION", "COUNTRY"].includes(scopeType)) throw new Error("This tool only grants platform, region or country scoped roles");
  const user = await db().user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error(`No user with email ${email}`);
  const ctx = { ...systemContext(), userAgent: "cli:grant-role" };
  const r = await assignRole(ctx, null, {
    principalType: "USER",
    principalId: user.id,
    roleId: await systemRoleId(db(), roleKey),
    scopeType: scopeType as "PLATFORM" | "REGION" | "COUNTRY",
    scopeId,
  });
  console.log(`✓ granted ${roleKey} at ${scopeType}:${scopeId} to ${email} (assignment ${r.id})`);
  await db().$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
