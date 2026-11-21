import { hash, verify } from "@node-rs/argon2";

// argon2id, OWASP-recommended minimum (m=19 MiB, t=2, p=1). Algorithm 2 = argon2id.
const OPTIONS = { algorithm: 2 as const, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** A real hash of a random value, verified against when the user doesn't exist, to equalize timing. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(`dummy-${Math.random()}`);
  return dummy;
}
