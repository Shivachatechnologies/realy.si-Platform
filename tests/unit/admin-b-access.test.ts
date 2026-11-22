import { describe, expect, it } from "vitest";
import { MFA_GATED, NEVER_FOR_AGENTS, PLATFORM_ONLY, SYSTEM_ROLES } from "@/server/modules/rbac/catalog";
import { restrictionReason, type WriteGuard } from "@/server/modules/rbac/service";
import { sectionPermissions } from "@/server/modules/admin/console-gate";
import { diffPermissions, validatePlatformPermissions } from "@/server/modules/admin/roles";
import { parseRestrictions } from "@/server/modules/admin/users";

const guard = (over: Partial<WriteGuard> = {}): WriteGuard => ({ impersonation: null, readOnly: false, aiDisabled: false, ...over });

describe("write guard (impersonation and user restrictions)", () => {
  it("READ_ONLY impersonation refuses every write, never reads", () => {
    const g = guard({ impersonation: { id: "x", mode: "READ_ONLY", live: true } });
    expect(restrictionReason(g, "companies.read")).toBeNull();
    expect(restrictionReason(g, "companies.manage")).toBe("impersonation_read_only");
    expect(restrictionReason(g, "agents.run")).toBe("impersonation_read_only");
  });
  it("no impersonation session ever uses platform permissions, read or write", () => {
    for (const mode of ["READ_ONLY", "FULL"] as const) {
      const g = guard({ impersonation: { id: "x", mode, live: true } });
      expect(restrictionReason(g, "platform.users.read")).toBe("impersonation_platform");
      expect(restrictionReason(g, "platform.impersonate")).toBe("impersonation_platform");
    }
    expect(restrictionReason(guard({ impersonation: { id: "x", mode: "FULL", live: true } }), "companies.manage")).toBeNull();
  });
  it("platform-set restrictions: read-only and AI disabled", () => {
    expect(restrictionReason(guard({ readOnly: true }), "projects.manage")).toBe("user_read_only");
    expect(restrictionReason(guard({ readOnly: true }), "projects.read")).toBeNull();
    expect(restrictionReason(guard({ aiDisabled: true }), "agents.run")).toBe("user_ai_disabled");
    expect(restrictionReason(guard({ aiDisabled: true }), "workflows.execute")).toBe("user_ai_disabled");
    expect(restrictionReason(guard({ aiDisabled: true }), "projects.manage")).toBeNull();
    expect(parseRestrictions({ readOnly: true, junk: 1 })).toEqual({ readOnly: true, aiDisabled: false });
    expect(parseRestrictions(null)).toEqual({ readOnly: false, aiDisabled: false });
  });
});

describe("platform RBAC catalog and gate", () => {
  it("impersonation and role management are MFA-gated platform permissions, never for agents", () => {
    for (const k of ["platform.impersonate", "platform.roles.manage", "platform.data.export", "platform.organizations.manage", "platform.users.manage"]) {
      expect(PLATFORM_ONLY.has(k)).toBe(true);
      expect(MFA_GATED.has(k)).toBe(true);
      expect(NEVER_FOR_AGENTS.has(k)).toBe(true);
    }
    expect(SYSTEM_ROLES.find((r) => r.key === "SUPER_ADMIN")!.permissions).toContain("platform.impersonate");
    expect(SYSTEM_ROLES.filter((r) => r.key !== "SUPER_ADMIN" && r.permissions.includes("platform.impersonate"))).toEqual([]);
  });
  it("section gate covers stream B pages and APIs", () => {
    expect(sectionPermissions("/en-US/roles/matrix")).toContain("platform.roles.manage");
    expect(sectionPermissions("/api/v1/admin/access-reviews")).toContain("platform.roles.manage");
    expect(sectionPermissions("/api/v1/admin/impersonation")).toEqual(expect.arrayContaining(["platform.impersonate", "platform.security.read"]));
    expect(sectionPermissions("/en-US/users/abc")).toContain("platform.users.read");
  });
  it("custom platform roles accept only platform permissions; diffs are exact", () => {
    expect(validatePlatformPermissions(["platform.users.read", "platform.users.read", "platform.audit.read"])).toEqual(["platform.audit.read", "platform.users.read"]);
    expect(() => validatePlatformPermissions(["platform.users.read", "companies.manage"])).toThrow(/Only platform permissions/);
    expect(diffPermissions(["a", "b", "c"], ["b", "d"])).toEqual({ onlyA: ["a", "c"], onlyB: ["d"], both: ["b"] });
  });
});
