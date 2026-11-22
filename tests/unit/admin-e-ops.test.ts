import { afterEach, describe, expect, it } from "vitest";
import { fingerprintError, normalizeMessage, scrubText, topFrame } from "@/server/modules/admin/errors";
import { parseRedisInfo } from "@/server/modules/admin/infra";
import { nextStatuses } from "@/server/modules/admin/incidents";
import { deployEnvironment, productionPhrase, releaseInfo, requireProductionConfirmation } from "@/server/modules/admin/releases";
import { dataShape } from "@/server/core/job-admin";
import { investigateLinks, ALERT_RULES } from "@/server/modules/admin/alerts";
import { HEALTH_SERVICES, worstStatus } from "@/server/modules/admin/health";
import { tonesE } from "@/components/admin/status/e";
import { sectionsE } from "@/components/admin/nav/sections/e";
import { sectionPermissions } from "@/server/modules/admin/console-gate";

/** Stream E pure logic: scrubbing, fingerprints, lifecycle, environment safety, Redis INFO parsing. */
describe("admin E — errors", () => {
  it("scrubs secrets and personal data from free text", () => {
    const s = scrubText("Bearer abcdefghijklmnop user jane@example.com password=hunter2 sk_live_ABCDEFGHIJKLMNOP postgresql://u:p@db/x ?token=xyz&a=1 card 4111111111111111");
    expect(s).not.toContain("jane@example.com");
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("sk_live_ABCDEFGHIJKLMNOP");
    expect(s).not.toContain("u:p@db");
    expect(s).not.toContain("xyz");
    expect(s).not.toContain("4111111111111111");
    expect(s).toContain("[email]");
  });

  it("normalizes ids and numbers so one bug yields one fingerprint", () => {
    expect(normalizeMessage("User 0198f6c4-1d2e-7a3b-8c4d-5e6f7a8b9c0d not found after 42 tries")).toBe(normalizeMessage("User 0198f6c4-0000-7a3b-8c4d-5e6f7a8b9c0d not found after 7 tries"));
    const a = new Error("Order 0198f6c4-1d2e-7a3b-8c4d-5e6f7a8b9c0d failed");
    const b = new Error("Order 0198f6c4-9999-7a3b-8c4d-5e6f7a8b9c0d failed");
    a.stack = b.stack = undefined;
    expect(fingerprintError("user", a, "GET /x").fingerprint).toBe(fingerprintError("user", b, "GET /x").fingerprint);
    expect(fingerprintError("user", a, "GET /x").fingerprint).not.toBe(fingerprintError("user", a, "GET /y").fingerprint);
  });

  it("uses the first in-app stack frame without line numbers", () => {
    const stack = "TypeError: boom\n    at Object.<anonymous> (/app/node_modules/x/y.js:1:2)\n    at runTask (/srv/app/packages/backend/src/worker/index.ts:120:15)";
    expect(topFrame(stack)).toBe("runTask (worker/index.ts)");
  });
});

describe("admin E — incidents lifecycle", () => {
  it("moves forward, reopens from RESOLVED, and stops at CLOSED", () => {
    expect(nextStatuses("DETECTED")).toEqual(["INVESTIGATING", "IDENTIFIED", "MITIGATING", "MONITORING", "RESOLVED"]);
    expect(nextStatuses("MONITORING")).toEqual(["RESOLVED"]);
    expect(nextStatuses("RESOLVED")).toContain("CLOSED");
    expect(nextStatuses("RESOLVED")).toContain("INVESTIGATING");
    expect(nextStatuses("CLOSED")).toEqual([]);
  });
});

describe("admin E — environment safety", () => {
  const saved = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });

  it("requires the PRODUCTION prefix only in production", () => {
    process.env.VERCEL_ENV = "preview";
    expect(deployEnvironment()).toBe("preview");
    expect(productionPhrase("pause x")).toBe("pause x");
    expect(() => requireProductionConfirmation("pause x", "pause x")).not.toThrow();
    process.env.VERCEL_ENV = "production";
    expect(productionPhrase("pause x")).toBe("PRODUCTION pause x");
    expect(() => requireProductionConfirmation("pause x", "pause x")).toThrow();
    expect(() => requireProductionConfirmation("PRODUCTION pause x", "pause x")).not.toThrow();
  });

  it("reads release metadata from the host", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    const r = releaseInfo("admin");
    expect(r.shortSha).toBe("0123456");
    expect(r.source).toBe("vercel");
  });
});

describe("admin E — infra and jobs helpers", () => {
  it("parses one Redis INFO answer", () => {
    const info = parseRedisInfo("# Server\r\nredis_version:7.2.4\r\nuptime_in_seconds:120\r\n# Memory\r\nused_memory:2048\r\nmaxmemory:0\r\n# Stats\r\nkeyspace_hits:9\r\nkeyspace_misses:1\r\n# Keyspace\r\ndb0:keys=5,expires=1,avg_ttl=0\r\ndb1:keys=2,expires=0\r\n");
    expect(info).toMatchObject({ version: "7.2.4", uptimeSeconds: 120, usedMemory: 2048, maxMemory: null, hits: 9, misses: 1, keys: 7 });
  });

  it("describes job data by shape, never by value", () => {
    expect(dataShape({ email: "a@b.c", n: 1, nested: { secret: "x" }, list: [1, 2] })).toEqual({ email: "string", n: "number", nested: "object", list: "array(2)" });
  });
});

describe("admin E — registries", () => {
  it("every alert rule has an investigate link and every status has a tone", () => {
    for (const r of ALERT_RULES) expect(investigateLinks(r.key, {}, null).length).toBeGreaterThan(0);
    for (const s of ["OPERATIONAL", "HEALTHY", "DEGRADED", "CRITICAL", "DOWN", "MAINTENANCE", "UNKNOWN", "NOT_CONFIGURED"]) expect(tonesE.serviceHealth![s]).toBeDefined();
    expect(worstStatus(["HEALTHY", "DEGRADED", "OPERATIONAL"])).toBe("DEGRADED");
    expect(worstStatus(["NOT_CONFIGURED", "HEALTHY"])).toBe("NOT_CONFIGURED");
    expect(HEALTH_SERVICES.length).toBe(19);
  });

  it("nav children point at gated sections", () => {
    for (const c of sectionsE[0]!.children ?? []) expect(sectionPermissions(`/en-US${c.href}`), c.href).not.toBeNull();
  });
});
