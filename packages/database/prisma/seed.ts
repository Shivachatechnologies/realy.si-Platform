import "dotenv/config";
import { db } from "@/server/core/db";
import { seedDevCatalog, seedReferenceData } from "@/server/modules/seed";
import { seedPlanCatalog } from "@/server/modules/entitlements/seed";

async function main() {
  const client = db();
  await seedReferenceData(client);
  console.log("✓ reference data (currencies, locales, regions, countries, tax, permissions, roles, flags)");
  await seedPlanCatalog(client);
  console.log("✓ plan catalog (Starter / Growth / Scale: entitlements, USD + EUR monthly and annual prices)");
  if (process.env.NODE_ENV !== "production" && process.env.SEED_DEV_CATALOG !== "false") {
    await seedDevCatalog(client);
    console.log("✓ development pricing catalog (illustrative values)");
  }
  await client.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
