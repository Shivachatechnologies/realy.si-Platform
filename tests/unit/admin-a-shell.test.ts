import { describe, expect, it } from "vitest";
import { csvCell, filterParams, hrefWith, tableParams, toCsv } from "@/components/admin/data-table/params";
import { kpiDelta } from "@/components/admin/kpi-delta";
import { ADMIN_NAV, NAV_GROUPS, navAllowed, navEntryFor, navGroup, navTrail, visibleNav } from "@/components/admin/nav/registry";
import { PALETTE_SOURCES, type PaletteContext } from "@/components/admin/palette/registry";
import { itemPermissions, PENDING_SOURCES, SOURCES } from "@/server/modules/admin/action-center";
import { MONITOR_PERMS } from "@/server/modules/admin/monitoring";
import { SECTION_PERMS } from "@/server/modules/admin/overview";
import { PERMISSION_KEYS } from "@/server/modules/rbac/catalog";

describe("shell navigation (stream A)", () => {
  it("puts every registered section in a known sidebar group", () => {
    for (const s of ADMIN_NAV) expect(NAV_GROUPS, s.id).toContain(navGroup(s));
    expect(ADMIN_NAV.filter((s) => navGroup(s) === "other").map((s) => s.id)).toEqual([]);
  });

  it("filters the registry by the admin's permissions", () => {
    const content = new Set(["platform.content.manage"]);
    const ids = visibleNav(content).map((s) => s.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("content");
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("system");
    expect(ids).not.toContain("billing");
    const finance = visibleNav(new Set(["globalization.read"])).find((s) => s.id === "billing");
    expect(finance?.children?.length).toBeGreaterThan(0);
    expect(navAllowed({ perms: [] }, new Set())).toBe(true);
    expect(visibleNav(new Set()).map((s) => s.id)).toEqual(["overview"]);
  });

  it("resolves shell pages and breadcrumbs", () => {
    expect(navEntryFor("/actions")?.item.label).toBe("admin.nav.actionCenter");
    expect(navEntryFor("")?.item.label).toBe("admin.nav.commandCenter");
    expect(navTrail("/notifications")).toEqual([
      { label: "admin.nav.overview", href: "" },
      { label: "admin.nav.notifications", href: "/notifications" },
    ]);
  });
});

describe("command palette (stream A)", () => {
  const ctx = (perms: string[], needle = ""): PaletteContext => ({
    t: ((k: string) => k) as PaletteContext["t"],
    base: "/en-US",
    needle,
    low: needle.toLowerCase(),
    data: null,
    controls: [],
    can: (p) => p.length === 0 || p.some((k) => perms.includes(k)),
    path: "",
  });
  const quick = PALETTE_SOURCES.find((s) => s.group === "quick")!;

  it("hides quick commands the admin cannot open", () => {
    const all = quick.hits(ctx(["platform.controls.manage", "platform.ai.read", "pricing.read", "platform.content.manage"])).map((h) => h.id);
    const none = quick.hits(ctx([])).map((h) => h.id);
    expect(all).toContain("cmd:dlq");
    expect(none).not.toContain("cmd:dlq");
    expect(none).toContain("cmd:actions");
    expect(quick.hits(ctx([], "dead")).map((h) => h.id)).toEqual([]);
    expect(quick.hits(ctx(["platform.audit.read"], "dlq")).map((h) => h.href)).toEqual(["/en-US/system/jobs?status=DEAD"]);
  });
});

describe("data table conventions (stream A)", () => {
  it("parses bounded table params and filter params", () => {
    expect(tableParams({ pageSize: "50", cursor: "abc", sort: "name", dir: "asc" }, { sortable: ["name"] })).toEqual({ cursor: "abc", pageSize: 50, sort: { by: "name", dir: "asc" } });
    expect(tableParams({ pageSize: "5000", sort: "password" }, { sortable: ["name"] })).toEqual({ cursor: undefined, pageSize: 25, sort: null });
    expect(filterParams({ q: "acme", status: ["ACTIVE", "X"], cursor: "c", pageSize: "10", empty: "" })).toEqual({ q: "acme", status: "ACTIVE" });
    expect(filterParams({ q: "acme", other: "x" }, ["q"])).toEqual({ q: "acme" });
    expect(hrefWith("/en-US/users", { q: "a b", cursor: undefined, pageSize: 25 })).toBe("/en-US/users?q=a+b&pageSize=25");
  });

  it("exports CSV safely (quotes, formula injection)", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x\ny"]])).toBe('a,b\r\n1,"x\ny"');
  });
});

describe("command center deltas (stream A)", () => {
  const pct = (p: number) => `${p.toFixed(0)}%`;
  it("judges change by the metric's good direction and never invents history", () => {
    expect(kpiDelta(120, 100, "up", pct, "new")).toMatchObject({ direction: "up", good: true, text: "20%" });
    expect(kpiDelta(120, 100, "down", pct, "new")).toMatchObject({ direction: "up", good: false });
    expect(kpiDelta(5, 0, "up", pct, "new")).toMatchObject({ pct: null, text: "new" });
    expect(kpiDelta(3, 3, "up", pct, "new")).toMatchObject({ direction: "flat", good: null });
    expect(kpiDelta(3, null, "up", pct, "new")).toBeNull();
  });

  it("gates KPI sets and action items with known permissions", () => {
    for (const perms of Object.values(SECTION_PERMS)) for (const p of perms) expect(PERMISSION_KEYS.has(p), p).toBe(true);
    expect([...SECTION_PERMS.system].sort()).toEqual([...MONITOR_PERMS].sort());
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    for (const p of PENDING_SOURCES) expect(itemPermissions(p.href), p.id).not.toBeNull();
    for (const href of ["/system/jobs?status=DEAD", "/subscriptions?status=PAST_DUE", "/marketplace?status=IN_REVIEW", "/roles", "/ai/models", "/developers", "/integrations", "/controls", "/ops"]) {
      expect(itemPermissions(href), href).not.toBeNull();
    }
  });
});
