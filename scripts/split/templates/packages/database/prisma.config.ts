import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Local development keeps one .env at the repo root; a packages/database/.env (if any) wins. CI and Vercel set real env vars.
config({ path: [".env", "../../.env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // CLI only (migrate/seed); the app connects with DATABASE_URL. A direct (non-pooled) URL is safer for migrations.
    url: process.env["DIRECT_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
