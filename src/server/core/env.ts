import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REALY_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  REALY_DEV_RELAX_MFA: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Throws on first access if misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.REALY_DEV_RELAX_MFA) {
    throw new Error("REALY_DEV_RELAX_MFA must not be enabled in production");
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached env after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}
