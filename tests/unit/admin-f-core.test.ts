import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateFlag, isStaleFlag, rolloutBucket } from "@/server/modules/flags/service";
import { parsePostmark, parseResend, verifyPostmarkBasic, verifySvix } from "@/server/modules/email/events";
import { shouldSample } from "@/server/modules/admin/api-logs";
import { slaState } from "@/server/modules/admin/support";
import { maskNumber } from "@/server/modules/admin/telephony-admin";
import { jsonDiff } from "@/components/admin/security/json-diff";

describe("feature flags v2 evaluation", () => {
  const flag = { key: "beta.x", defaultEnabled: false };
  const base = { percentage: null, environments: [], startsAt: null, endsAt: null, killedAt: null };
  it("kill switch beats every rule", () => {
    expect(evaluateFlag(flag, [{ targetType: "GLOBAL", targetValue: "*", enabled: true, priority: 0 }], { ...base, killedAt: new Date() }, {})).toBe(false);
  });
  it("environment targeting turns the flag off elsewhere", () => {
    const r = { ...base, environments: ["production"] };
    expect(evaluateFlag({ ...flag, defaultEnabled: true }, [], r, {}, "development")).toBe(false);
    expect(evaluateFlag({ ...flag, defaultEnabled: true }, [], r, {}, "production")).toBe(true);
  });
  it("explicit rules win over the rollout; rollout is stable and monotonic", () => {
    const rules = [{ targetType: "USER" as const, targetValue: "u1", enabled: false, priority: 0 }];
    expect(evaluateFlag(flag, rules, { ...base, percentage: 100 }, { userId: "u1" })).toBe(false);
    expect(evaluateFlag(flag, [], { ...base, percentage: 100 }, { userId: "u2" })).toBe(true);
    expect(evaluateFlag(flag, [], { ...base, percentage: 0 }, { userId: "u2" })).toBe(false);
    const b = rolloutBucket("beta.x", "u3");
    expect(evaluateFlag(flag, [], { ...base, percentage: b + 1 }, { userId: "u3" })).toBe(true);
    expect(evaluateFlag(flag, [], { ...base, percentage: b }, { userId: "u3" })).toBe(false);
  });
  it("a rollout outside its schedule falls back to the default", () => {
    expect(evaluateFlag(flag, [], { ...base, percentage: 100, startsAt: new Date(Date.now() + 60_000) }, { userId: "u" })).toBe(false);
  });
  it("stale report: old and decided", () => {
    const old = new Date(Date.now() - 100 * 86_400_000);
    expect(isStaleFlag({ rules: [], rollout: null, lastChangedAt: old })).toBe(true);
    expect(isStaleFlag({ rules: [], rollout: { percentage: 30, killedAt: null }, lastChangedAt: old })).toBe(false);
  });
});

describe("email provider webhooks", () => {
  const secret = `whsec_${Buffer.from("0123456789abcdef0123").toString("base64")}`;
  const sign = (id: string, ts: string, body: string) => createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  it("verifies Svix signatures and rejects tampering and old timestamps", () => {
    const body = '{"type":"email.bounced"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const h = new Headers({ "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${sign("msg_1", ts, body)}` });
    expect(verifySvix(secret, h, body)).toBe(true);
    expect(verifySvix(secret, h, body + " ")).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifySvix(secret, new Headers({ "svix-id": "msg_1", "svix-timestamp": old, "svix-signature": `v1,${sign("msg_1", old, body)}` }), body)).toBe(false);
  });
  it("verifies Postmark basic credentials", () => {
    const h = new Headers({ authorization: `Basic ${Buffer.from("hooks:secret-password-1").toString("base64")}` });
    expect(verifyPostmarkBasic("hooks:secret-password-1", h)).toBe(true);
    expect(verifyPostmarkBasic("hooks:other-password-1", h)).toBe(false);
  });
  it("normalizes Resend and Postmark events", () => {
    expect(parseResend({ type: "email.bounced", created_at: "2026-11-01T00:00:00Z", data: { email_id: "e1", to: ["A@x.io"], bounce: { type: "Permanent" } } })).toMatchObject({ type: "bounced", hard: true, recipient: "a@x.io", providerMessageId: "e1" });
    expect(parseResend({ type: "email.sent", data: { to: ["a@x.io"] } })).toBeNull();
    expect(parsePostmark({ RecordType: "Bounce", Type: "SoftBounce", Email: "b@x.io", MessageID: "m" })).toMatchObject({ type: "deferred", hard: false });
    expect(parsePostmark({ RecordType: "SpamComplaint", Email: "c@x.io", MessageID: "m" })).toMatchObject({ type: "complained" });
  });
});

describe("small helpers", () => {
  it("samples every error and a share of successes", () => {
    expect(shouldSample(500, 0.99)).toBe(true);
    expect(shouldSample(429, 0.99)).toBe(true);
    expect(shouldSample(200, 0.99)).toBe(false);
    expect(shouldSample(200, 0.01)).toBe(true);
  });
  it("computes SLA state", () => {
    const now = new Date();
    expect(slaState({ slaDueAt: new Date(now.getTime() - 1000), firstResponseAt: null, status: "OPEN" }, now)).toBe("breached");
    expect(slaState({ slaDueAt: new Date(now.getTime() + 3_600_000), firstResponseAt: null, status: "NEW" }, now)).toBe("due");
    expect(slaState({ slaDueAt: new Date(now.getTime() + 1000), firstResponseAt: now, status: "OPEN" }, now)).toBe("met");
  });
  it("masks phone numbers", () => {
    expect(maskNumber("+38640123456")).toBe("••••••••3456");
  });
  it("diffs audit values", () => {
    const d = jsonDiff({ a: 1, b: { c: true } }, { a: 2, b: { c: true }, d: "x" });
    expect(d.find((r) => r.path === "a")?.kind).toBe("changed");
    expect(d.find((r) => r.path === "d")?.kind).toBe("added");
    expect(d.find((r) => r.path === "b.c")?.kind).toBe("same");
  });
});
