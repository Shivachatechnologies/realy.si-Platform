import { describe, expect, it } from "vitest";
import { aiSpendToBase, usdFromMicros } from "@/server/modules/finance/ai-costs";
import { packMonth } from "@/server/modules/finance/monthly-pack";
import { roiPct } from "@/server/modules/finance/roi";
import { scheduleExecutionPlan } from "@/server/modules/work/execution";

const task = (title: string, extra: Partial<{ offsetDays: number; durationDays: number; dependsOn: number[]; milestone: string }> = {}) => ({ title, priority: "MEDIUM" as const, offsetDays: 0, durationDays: 1, dependsOn: [] as number[], ...extra });

describe("G4 pure helpers", () => {
  it("converts micro-USD only into USD books", () => {
    expect(aiSpendToBase(1_234_567n, "USD")).toBe(123n);
    expect(aiSpendToBase(1_235_000n, "USD")).toBe(124n);
    expect(aiSpendToBase(1_000_000n, "EUR")).toBeNull();
    expect(usdFromMicros(12_345_678n)).toBe("12.35 USD");
    expect(usdFromMicros(0n)).toBe("0.00 USD");
  });

  it("computes ROI only with a cost", () => {
    expect(roiPct(300n, 100n)).toBe(200);
    expect(roiPct(0n, 100n)).toBe(-100);
    expect(roiPct(100n, 0n)).toBeNull();
  });

  it("picks the last full month and never a future one", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    expect(packMonth(undefined, now)).toMatchObject({ month: "2026-10", partial: false });
    expect(packMonth("2026-11", now)).toMatchObject({ month: "2026-11", partial: true });
    expect(packMonth("2027-03", now).month).toBe("2026-10");
  });

  it("schedules tasks after their predecessors and refuses broken graphs", () => {
    const r = scheduleExecutionPlan({ milestones: [{ title: "M", offsetDays: 5 }], tasks: [task("a", { durationDays: 3 }), task("b", { dependsOn: [0] }), task("c", { dependsOn: [0, 1], offsetDays: 10, milestone: "M" })] });
    expect(r.offsets).toEqual([0, 3, 10]);
    expect(r.shifted).toBe(1);
    expect(() => scheduleExecutionPlan({ milestones: [], tasks: [task("a", { dependsOn: [1] }), task("b", { dependsOn: [0] })] })).toThrow(/cycle/);
    expect(() => scheduleExecutionPlan({ milestones: [], tasks: [task("a", { dependsOn: [0] })] })).toThrow(/itself/);
    expect(() => scheduleExecutionPlan({ milestones: [], tasks: [task("a", { dependsOn: [4] })] })).toThrow(/does not exist/);
    expect(() => scheduleExecutionPlan({ milestones: [], tasks: [task("a", { milestone: "X" })] })).toThrow(/unknown milestone/);
  });
});
