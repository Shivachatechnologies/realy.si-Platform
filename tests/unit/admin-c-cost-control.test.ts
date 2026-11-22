import { describe, expect, it } from "vitest";
import { projectDayEnd, projectMonthEnd, spendAnomalies } from "@/server/modules/admin/ai-budgets";
import { scrubSecret } from "@/server/modules/admin/ai-request-log";
import { COPILOT_TOOLS } from "@/server/modules/admin/copilot-tools";
import { tonesC } from "@/components/admin/status/c";

describe("admin-c cost control", () => {
  it("projects month and day ends linearly and refuses to guess in the first hour", () => {
    const mid = new Date(Date.UTC(2026, 10, 16, 0, 0, 0)); // 15 days into a 30-day month
    expect(projectMonthEnd(15_000_000, mid)).toBe(30_000_000);
    expect(projectMonthEnd(1_000, new Date(Date.UTC(2026, 10, 1, 0, 10)))).toBeNull();
    expect(projectDayEnd(1_000_000, new Date(Date.UTC(2026, 10, 16, 12, 0)))).toBe(2_000_000);
  });

  it("flags spend above 3× the trailing median and above $1 only", () => {
    const today = new Date(Date.UTC(2026, 10, 22, 12));
    const day = (n: number) => new Date(Date.UTC(2026, 10, 22 - n)).toISOString().slice(0, 10);
    const rows = [
      ...[2, 3, 4, 5, 6, 7, 8].map((n) => ({ organizationId: "a", day: day(n), micros: 1_000_000 })),
      { organizationId: "a", day: day(0), micros: 5_000_000 },
      ...[2, 3, 4, 5, 6, 7, 8].map((n) => ({ organizationId: "b", day: day(n), micros: 1_000_000 })),
      { organizationId: "b", day: day(0), micros: 2_000_000 },
      { organizationId: "c", day: day(1), micros: 900_000 },
    ];
    const out = spendAnomalies(rows, today);
    expect(out.map((o) => o.organizationId)).toEqual(["a"]);
    expect(out[0]!.ratio).toBe(5);
  });

  it("never stores credentials in request-log error messages", () => {
    expect(scrubSecret("401 for key sk-ant-api03-abcdefghijklmnopqrstuvwx")).not.toContain("abcdefghij");
    expect(scrubSecret("Authorization: Bearer abc.def.ghijklmnop")).toContain("[redacted]");
    expect(scrubSecret("task 0195f3a2-1b2c-7d4e-8f90-123456789abc failed")).toContain("0195f3a2-1b2c-7d4e-8f90-123456789abc");
  });

  it("copilot tools are read-only and permission-scoped", () => {
    expect(COPILOT_TOOLS.length).toBeGreaterThanOrEqual(8);
    for (const t of COPILOT_TOOLS) {
      expect(t.perms.length).toBeGreaterThan(0);
      expect(t.perms.every((p) => p.startsWith("platform."))).toBe(true);
      expect(t.name).toMatch(/^[a-z_]+$/);
    }
  });

  it("status tones cover the new PAUSED task status", () => {
    expect(tonesC.aiTask!.PAUSED).toBe("warning");
    expect(tonesC.aiRequest!.BUDGET_BLOCKED).toBe("warning");
  });
});
