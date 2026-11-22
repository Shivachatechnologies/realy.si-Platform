import { describe, expect, it } from "vitest";
import { CORE_STATES, deriveCoreState, STATE_TUNING, type CoreSignals } from "@/components/jarvis/core-state";
import { SentenceChunker, splitSentences } from "@/server/modules/voiceos/sentences";

/** B16 / B28 (G5): the full Voice OS state lifecycle, and sentence chunking for streamed speech. */

const idle: CoreSignals = { listening: false, transcribing: false, thinking: false, speaking: false, executing: false, alertUntil: 0, successUntil: 0, errorUntil: 0 };

describe("Voice OS core states", () => {
  it("has all nine states, each with visual tuning", () => {
    expect([...CORE_STATES]).toEqual(["IDLE", "LISTENING", "TRANSCRIBING", "THINKING", "EXECUTING", "SPEAKING", "SUCCESS", "ERROR", "ALERT"]);
    for (const st of CORE_STATES) expect(STATE_TUNING[st]).toBeDefined();
    expect(STATE_TUNING.ERROR.tone).toBe("danger");
  });

  it("follows the real lifecycle signals", () => {
    const now = 1_000_000;
    expect(deriveCoreState(idle, now)).toBe("IDLE");
    expect(deriveCoreState({ ...idle, listening: true }, now)).toBe("LISTENING");
    expect(deriveCoreState({ ...idle, transcribing: true }, now)).toBe("TRANSCRIBING");
    expect(deriveCoreState({ ...idle, thinking: true }, now)).toBe("THINKING");
    expect(deriveCoreState({ ...idle, executing: true }, now)).toBe("EXECUTING");
    expect(deriveCoreState({ ...idle, speaking: true, thinking: true }, now)).toBe("SPEAKING");
    expect(deriveCoreState({ ...idle, successUntil: now + 10 }, now)).toBe("SUCCESS");
    expect(deriveCoreState({ ...idle, errorUntil: now + 10, alertUntil: now + 10 }, now)).toBe("ERROR");
    expect(deriveCoreState({ ...idle, alertUntil: now + 10, executing: true }, now)).toBe("ALERT");
    // Flashes end on their own.
    expect(deriveCoreState({ ...idle, errorUntil: now - 1 }, now)).toBe("IDLE");
  });
});

describe("sentence chunking for streamed speech", () => {
  it("releases sentences as they complete, joining very short ones", () => {
    const c = new SentenceChunker();
    expect(c.push("Hi. Revenue is up twelve ")).toEqual([]);
    expect(c.push("percent this week. Two approvals ")).toEqual(["Hi. Revenue is up twelve percent this week."]);
    expect(c.push("are waiting for you.")).toEqual([]);
    expect(c.flush()).toEqual(["Two approvals are waiting for you."]);
  });

  it("splits Chinese, Hindi and Arabic sentence ends", () => {
    expect(splitSentences("今天收入增长了百分之十二，情况很好。目前有两个审批正在等待您的处理。")).toEqual(["今天收入增长了百分之十二，情况很好。", "目前有两个审批正在等待您的处理。"]);
    expect(splitSentences("सब ठीक है, कोई काम नहीं चल रहा। दो अनुमोदन आपका इंतज़ार कर रहे हैं।").length).toBe(2);
    expect(splitSentences("هل تريد أن أراجع الموافقات الآن؟ هناك موافقتان بانتظارك اليوم.").length).toBe(2);
  });

  it("breaks run-on text without punctuation", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const parts = splitSentences(words);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(words);
  });
});
