import { describe, expect, it } from "vitest";
import { ADMIN_NAV, navTrail } from "@/components/admin/nav/registry";
import { PALETTE_SOURCES } from "@/components/admin/palette/registry";
import { OPEN_SECTIONS, SECTION_KEYS, sectionPermissions } from "@/server/modules/admin/console-gate";
import { aiSearch } from "@/server/modules/admin/search/providers/ai";
import { billingSearch } from "@/server/modules/admin/search/providers/billing";
import { opsSearch } from "@/server/modules/admin/search/providers/ops";
import { peopleSearch } from "@/server/modules/admin/search/providers/people";
import { platformSearch } from "@/server/modules/admin/search/providers/platform";
import { MFA_GATED, NEVER_FOR_AGENTS, PERMISSION_KEYS, PLATFORM_ONLY, SYSTEM_ROLES } from "@/server/modules/rbac/catalog";

/** Step 0 (docs/admin/STREAMS.md): the shared registries every stream appends to stay consistent. */
describe("admin Step 0 registries", () => {
  it("adds every planned platform permission, platform-only and never for agents", () => {
    const planned = [
      "platform.incidents.read",
      "platform.incidents.manage",
      "platform.alerts.manage",
      "platform.billing.refund",
      "platform.roles.manage",
      "platform.impersonate",
      "platform.data.read",
      "platform.data.export",
      "platform.logs.read",
      "platform.copilot.use",
    ];
    for (const k of planned) {
      expect(PERMISSION_KEYS.has(k), k).toBe(true);
      expect(PLATFORM_ONLY.has(k), k).toBe(true);
      expect(NEVER_FOR_AGENTS.has(k), k).toBe(true);
    }
    const superAdmin = SYSTEM_ROLES.find((r) => r.key === "SUPER_ADMIN")!;
    for (const k of planned) expect(superAdmin.permissions).toContain(k);
  });

  it("MFA-gates every platform manage permission that changes tenants or money", () => {
    for (const k of ["platform.organizations.manage", "platform.subscriptions.manage", "platform.support.manage", "platform.billing.refund", "platform.roles.manage", "platform.impersonate"]) {
      expect(MFA_GATED.has(k), k).toBe(true);
    }
  });

  it("role grants and section gates reference only known permissions", () => {
    for (const r of SYSTEM_ROLES) for (const k of r.permissions) expect(PERMISSION_KEYS.has(k), `${r.key}: ${k}`).toBe(true);
    for (const s of SECTION_KEYS) for (const k of sectionPermissions(`/en-US/${s}`) ?? []) expect(PERMISSION_KEYS.has(k), `${s}: ${k}`).toBe(true);
    for (const p of [peopleSearch, aiSearch, billingSearch, opsSearch, platformSearch]) for (const k of p.perms) expect(PERMISSION_KEYS.has(k), `${p.group}: ${k}`).toBe(true);
  });

  it("gates the new sections and keeps shell sections open", () => {
    for (const s of ["incidents", "alerts", "health", "infra", "logs", "errors", "releases", "data", "workflows", "knowledge", "invoices", "payments", "credits", "usage", "growth", "analytics", "support", "email", "telephony", "files", "webhooks", "copilot", "api-logs"]) {
      expect(sectionPermissions(`/en-US/${s}`), s).not.toBeNull();
      expect(sectionPermissions(`/api/v1/admin/${s}`), s).not.toBeNull();
    }
    for (const s of ["actions", "notifications", "me", "search"]) {
      expect(OPEN_SECTIONS.has(s)).toBe(true);
      expect(sectionPermissions(`/en-US/${s}`)).toBeNull();
    }
  });

  it("nav entries are unique, ordered, use full message keys and known permissions", () => {
    const orders = ADMIN_NAV.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(ADMIN_NAV.map((s) => s.id)).size).toBe(ADMIN_NAV.length);
    for (const s of ADMIN_NAV) {
      for (const item of [s, ...(s.children ?? [])]) {
        expect(item.label).toMatch(/^admin\.[\w.]+$/);
        for (const k of item.perms) expect(PERMISSION_KEYS.has(k), `${item.id}: ${k}`).toBe(true);
      }
    }
    expect(ADMIN_NAV.map((s) => s.id)).toEqual(["overview", "users", "companies", "ai", "billing", "content", "marketplace", "features", "integrations", "system", "securityAudit", "settings"]);
  });

  it("derives breadcrumbs from the registry", () => {
    expect(navTrail("")).toEqual([]);
    expect(navTrail("/ai/models")).toEqual([
      { label: "admin.nav.ai", href: "/ai" },
      { label: "admin.nav.aiModels", href: "/ai/models" },
    ]);
    expect(navTrail("/users/123")).toEqual([{ label: "admin.nav.users", href: "/users" }]);
    expect(navTrail("/roles/view-as")).toEqual([
      { label: "admin.nav.users", href: "/users" },
      { label: "admin.nav.viewAs", href: "/roles/view-as" },
    ]);
    expect(navTrail("/nowhere")).toEqual([]);
  });

  it("palette groups and search result keys are unique across streams", () => {
    expect(new Set(PALETTE_SOURCES.map((s) => s.group)).size).toBe(PALETTE_SOURCES.length);
    const keys = [peopleSearch, aiSearch, billingSearch, opsSearch, platformSearch].flatMap((p) => Object.keys(p.empty));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(["companies", "controls", "integrations", "organizations", "tasks", "users"]);
  });
});
