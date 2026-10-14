import "dotenv/config";
import { db } from "../src/server/core/db";
import { seedDevCatalog, seedReferenceData } from "../src/server/modules/seed";

async function main() {
  const client = db();
  await seedReferenceData(client);
  console.log("✓ reference data (currencies, locales, regions, countries, tax, permissions, roles, flags)");
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
