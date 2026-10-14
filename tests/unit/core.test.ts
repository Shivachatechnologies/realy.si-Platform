import { describe, expect, it } from "vitest";
import { addMoney, applyBps, money } from "@/server/core/money";
import { decryptSecret, encryptSecret } from "@/server/core/crypto";
import { base32Decode, base32Encode, hotp, verifyTotp } from "@/server/modules/auth/totp";
import { evaluateRules } from "@/server/modules/flags/service";
import { parseMajorToMinor } from "@/lib/utils";
import { formatMoney } from "@/i18n/format";

describe("money", () => {
  it("never mixes currencies", () => {
    expect(() => addMoney(money(1, "USD"), money(1, "EUR"))).toThrow(/mismatch/);
    expect(addMoney(money(1n, "INR"), money(2n, "INR"))).toEqual({ amountMinor: 3n, currency: "INR" });
  });

  it("applies basis points with banker's rounding", () => {
    expect(applyBps(money(10n, "USD"), 2500).amountMinor).toBe(2n); // 2.5 → 2 (even)
    expect(applyBps(money(30n, "USD"), 2500).amountMinor).toBe(8n); // 7.5 → 8 (even)
    expect(applyBps(money(499900n, "INR"), 1800).amountMinor).toBe(89982n);
  });

  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const big = money(9_007_199_254_740_993n, "USD");
    expect(formatMoney(big, "en-US")).toBe("$90,071,992,547,409.93");
  });
});

describe("amount input parsing", () => {
  it("parses major units into minor units without floats", () => {
    expect(parseMajorToMinor("49.99", 2)).toBe(4999n);
    expect(parseMajorToMinor("5,499", 2)).toBe(549900n); // grouping comma
    expect(parseMajorToMinor("5.499,5", 2)).toBe(549950n); // decimal comma
    expect(parseMajorToMinor("12000", 0)).toBe(12000n); // JPY
    expect(parseMajorToMinor("0.1", 2)).toBe(10n);
    expect(parseMajorToMinor("abc", 2)).toBeNull();
    expect(parseMajorToMinor("-5", 2)).toBeNull();
  });
});

describe("secret encryption", () => {
  it("round-trips and binds ciphertexts to their purpose", () => {
    const ct = encryptSecret("top-secret", "mfa.totp");
    expect(ct).not.toContain("top-secret");
    expect(decryptSecret(ct, "mfa.totp")).toBe("top-secret");
    expect(() => decryptSecret(ct, "oauth.token")).toThrow();
    expect(encryptSecret("x", "p")).not.toBe(encryptSecret("x", "p")); // random IV
  });
});

describe("TOTP (RFC 6238 test vector, SHA-1)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC vector at T=59s", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
    expect(hotp(secret, 1n)).toBe("287082");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1n);
  });
  it("accepts ±1 step and rejects others", () => {
    expect(verifyTotp(secret, hotp(secret, 2n), 59_000)).toBe(2n);
    expect(verifyTotp(secret, hotp(secret, 5n), 59_000)).toBeNull();
    expect(verifyTotp(secret, "12345", 59_000)).toBeNull();
  });
});

describe("feature flag targeting", () => {
  const rules = [
    { targetType: "GLOBAL" as const, targetValue: "*", enabled: false, priority: 0 },
    { targetType: "REGION" as const, targetValue: "EU", enabled: true, priority: 0 },
    { targetType: "COUNTRY" as const, targetValue: "DE", enabled: false, priority: 0 },
    { targetType: "USER" as const, targetValue: "u1", enabled: true, priority: 0 },
  ];
  it("most specific target wins", () => {
    expect(evaluateRules(true, rules, { regionCode: "EU", countryCode: "FR" })).toBe(true);
    expect(evaluateRules(true, rules, { regionCode: "EU", countryCode: "DE" })).toBe(false);
    expect(evaluateRules(true, rules, { regionCode: "EU", countryCode: "DE", userId: "u1" })).toBe(true);
    expect(evaluateRules(true, rules, { regionCode: "US" })).toBe(false);
    expect(evaluateRules(true, [], {})).toBe(true);
  });
});
