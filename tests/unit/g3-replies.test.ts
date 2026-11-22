import { describe, expect, it } from "vitest";
import { replyText, returnDateIn, ruleVerdict } from "@/server/modules/crm/replies";
import { predictWin, type DealFacts } from "@/server/modules/crm/win-probability";
import { newPartOf } from "@/server/modules/support/inbound";

const NOW = new Date("2026-11-22T10:00:00Z");

describe("reply rules (crm/replies.ts)", () => {
  it("detects explicit unsubscribe wording", () => {
    expect(ruleVerdict({ subject: "Re: quick question", bodyText: "Please remove me from your list." }, NOW)?.cls).toBe("UNSUBSCRIBE");
    expect(ruleVerdict({ subject: "Re: intro", bodyText: "Stop emailing me." }, NOW)?.cls).toBe("UNSUBSCRIBE");
  });

  it("ignores unsubscribe words that only appear in the quoted original", () => {
    const body = "Sounds good, let's talk Tuesday.\n\nOn Mon, Nov 16, 2026 at 9:00 Sales <s@x.com> wrote:\n> If you'd rather not hear from us, unsubscribe here";
    expect(ruleVerdict({ subject: "Re: intro", bodyText: body }, NOW)).toBeNull();
    expect(replyText(body)).toBe("Sounds good, let's talk Tuesday.");
  });

  it("detects out-of-office auto replies and their return date", () => {
    const v = ruleVerdict({ subject: "Automatic reply: intro", bodyText: "I am out of the office and back on 2026-12-01." }, NOW);
    expect(v?.cls).toBe("OUT_OF_OFFICE");
    expect(v?.resumeAt?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(returnDateIn("Back on 3 December", NOW)?.toISOString().slice(0, 10)).toBe("2026-12-03");
    // A date in the past or too far ahead is not trusted (the sequence then waits the default 7 days).
    expect(returnDateIn("back on 2026-01-01", NOW)).toBeNull();
    expect(returnDateIn("back on 2027-06-01", NOW)).toBeNull();
  });

  it("leaves real replies to the model", () => {
    expect(ruleVerdict({ subject: "Re: intro", bodyText: "Interesting — what does it cost for 20 seats?" }, NOW)).toBeNull();
  });
});

const facts = (o: Partial<DealFacts> = {}): DealFacts => ({
  stageProbability: 40,
  stageWon: 0,
  stageClosed: 0,
  daysInStage: 3,
  staleDays: 30,
  daysSinceActivity: 10,
  closeDatePassed: false,
  amountMinor: 100_000n,
  medianWonMinor: null,
  owner: null,
  company: { won: 0, closed: 0 },
  ...o,
});

describe("deal win probability (crm/win-probability.ts)", () => {
  it("falls back to the stage default without history", () => {
    expect(predictWin(facts()).probability).toBe(40);
  });

  it("moves toward the stage's real win rate as history grows", () => {
    expect(predictWin(facts({ stageWon: 18, stageClosed: 20 })).probability).toBe(Math.round((100 * (18 + 2)) / 25));
    expect(predictWin(facts({ stageWon: 1, stageClosed: 20 })).probability).toBe(Math.round((100 * (1 + 2)) / 25));
  });

  it("itemises penalties for staleness, silence, overdue close and outsized amounts", () => {
    const p = predictWin(facts({ daysInStage: 70, daysSinceActivity: 45, closeDatePassed: true, amountMinor: 1_000_000n, medianWonMinor: 100_000n }));
    const by = Object.fromEntries(p.factors.map((f) => [f.key, f.delta]));
    expect(by).toMatchObject({ base: 40, stage_age: -15, activity: -8, overdue: -10, amount: -5, owner: 0 });
    expect(p.probability).toBe(2);
  });

  it("counts the owner's record only with enough closed deals, capped at ±10", () => {
    expect(predictWin(facts({ owner: { won: 4, closed: 4 }, company: { won: 5, closed: 20 } })).factors.find((f) => f.key === "owner")!.delta).toBe(0);
    expect(predictWin(facts({ owner: { won: 10, closed: 10 }, company: { won: 5, closed: 20 } })).factors.find((f) => f.key === "owner")!.delta).toBe(10);
  });

  it("stays within 1–99", () => {
    expect(predictWin(facts({ stageWon: 100, stageClosed: 100, daysSinceActivity: 1 })).probability).toBe(99);
  });
});

describe("support inbound email text", () => {
  it("keeps only the new part of a reply", () => {
    expect(newPartOf("Still broken after the update.\n\nOn Tue, Ana <help@acme.com> wrote:\n> Try restarting")).toBe("Still broken after the update.");
    expect(newPartOf("> only quoted")).toBe("> only quoted");
  });
});
