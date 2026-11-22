import { describe, expect, it } from "vitest";
import { dispatchReplyKey, heuristicIntent, replyLanguage, stripWake } from "@/server/modules/voiceos/intent";

describe("Voice OS intent routing (heuristic fallback)", () => {
  it("strips the wake phrase", () => {
    expect(stripWake("hey Realy, sab kaisa hai?")).toBe("sab kaisa hai?");
    expect(stripWake("Hi really what needs my approval")).toBe("what needs my approval");
    expect(stripWake("Realy")).toBe("Realy");
  });

  it.each([
    ["hey Realy, sab kaisa hai?", "company_question"],
    ["kitne approvals pending hain?", "company_question"],
    ["how is everything", "company_question"],
    ["how many tasks are pending?", "company_question"],
    ["what needs my approval", "company_question"],
    ["how are sales this week?", "company_question"],
    ["कितने अप्रूवल पेंडिंग हैं?", "company_question"],
    ["Wie läuft der Umsatz heute?", "company_question"],
    ["今天的任务怎么样？", "company_question"],
  ])("question: %s", (text, intent) => expect(heuristicIntent(text)).toBe(intent));

  it.each([
    ["hello", "conversation"],
    ["hey Realy, thank you!", "conversation"],
    ["how are you?", "conversation"],
    ["namaste", "conversation"],
    ["你好", "conversation"],
  ])("conversation: %s", (text, intent) => expect(heuristicIntent(text)).toBe(intent));

  it.each([
    ["ek LinkedIn post likho", "work_request"],
    ["write a LinkedIn post about our launch", "work_request"],
    ["send the invoice to Acme", "work_request"],
    ["create a campaign for the spring sale", "work_request"],
    ["Schreib einen Blogartikel über unser Produkt", "work_request"],
    ["एक लिंक्डइन पोस्ट लिखो", "work_request"],
    ["写一篇关于新产品的文章", "work_request"],
  ])("work: %s", (text, intent) => expect(heuristicIntent(text)).toBe(intent));
});

describe("Voice OS reply language", () => {
  it("answers Hinglish in Hinglish, Hindi in Hindi, otherwise the locale", () => {
    expect(replyLanguage("hey Realy, sab kaisa hai?", "en-US")).toMatchObject({ code: "hi-IN", label: expect.stringContaining("Hinglish") });
    expect(replyLanguage("kitne approvals pending hain?", "en-US").label).toContain("Hinglish");
    expect(replyLanguage("कितने अप्रूवल बाकी हैं?", "en-US")).toMatchObject({ code: "hi-IN", label: expect.stringContaining("Devanagari") });
    expect(replyLanguage("how is everything going", "en-US")).toEqual({ code: "en-US", label: "English" });
    expect(replyLanguage("ok", "de-DE")).toEqual({ code: "de-DE", label: "German" });
    expect(replyLanguage("كم عدد الموافقات؟", "en-US").code).toBe("ar-AE");
    expect(replyLanguage("今天怎么样", "en-US").code).toBe("zh-CN");
  });
});

describe("Voice OS dispatch honesty", () => {
  it("never promises a result when no background worker runs", () => {
    expect(dispatchReplyKey("delegated", "ok")).toBe("delegated");
    expect(dispatchReplyKey("delegated", "missing")).toBe("queuedWorkerDown");
    expect(dispatchReplyKey("delegated", "stale")).toBe("queuedWorkerDown");
    expect(dispatchReplyKey("planned", "missing")).toBe("queuedWorkerDown");
    expect(dispatchReplyKey("delegated", "not_configured")).toBe("queuedNoWorkerSetup");
    expect(dispatchReplyKey("blocked", "missing")).toBe("blocked");
    expect(dispatchReplyKey("failed", "ok")).toBe("failed");
  });

  it("the worker-down replies say so plainly in every catalog", async () => {
    for (const locale of ["en-US", "de-DE", "ar-AE", "hi-IN", "zh-CN"]) {
      const msgs = (await import(`@/i18n/messages/${locale}.json`)).default as { jarvis: { reply: Record<string, unknown> } };
      expect(typeof msgs.jarvis.reply.queuedWorkerDown).toBe("string");
      expect(msgs.jarvis.reply.queuedWorkerDown as string).toContain("{team}");
      expect(typeof msgs.jarvis.reply.queuedNoWorkerSetup).toBe("string");
    }
    const en = (await import("@/i18n/messages/en-US.json")).default as { jarvis: { reply: Record<string, string> } };
    expect(en.jarvis.reply.queuedWorkerDown).toMatch(/isn’t running/);
    expect(en.jarvis.reply.queuedWorkerDown).not.toMatch(/I’ll tell you when/);
  });
});
