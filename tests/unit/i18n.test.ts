import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { LOCALES, closestLocale, directionOf } from "@/i18n/config";
import { createTranslator } from "@/i18n/translate";

const dir = path.resolve(import.meta.dirname, "../../src/i18n/messages");
const load = (l: string) => JSON.parse(readFileSync(path.join(dir, `${l}.json`), "utf8")) as Record<string, unknown>;

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

describe("message catalogs", () => {
  const base = flatten(load("en-US"));

  for (const locale of LOCALES) {
    it(`${locale} has exactly the en-US key set and valid ICU messages`, () => {
      const flat = flatten(load(locale));
      expect(Object.keys(flat).sort()).toEqual(Object.keys(base).sort());
      for (const [key, msg] of Object.entries(flat)) {
        expect(() => new IntlMessageFormat(msg, locale), `${locale}:${key}`).not.toThrow();
      }
    });
  }

  it("formats plurals per locale rules", () => {
    expect(createTranslator("en-US", load("en-US"))("settings.billing.trial", { days: 1 })).toBe("1 day free trial");
    expect(createTranslator("en-US", load("en-US"))("settings.billing.trial", { days: 0 })).toBe("No free trial");
    expect(createTranslator("ar-AE", load("ar-AE"))("settings.billing.trial", { days: 2 })).toBe("فترة تجريبية مجانية ليومين");
    expect(createTranslator("de-DE", load("de-DE"))("settings.members.permissionCount", { count: 3 })).toBe("3 Berechtigungen");
  });

  it("resolves message keys that contain dots", () => {
    expect(createTranslator("de-DE", load("de-DE"))("pricing.features.agents.max")).toBe("Digitale Mitarbeitende");
    expect(createTranslator("en-US", load("en-US"))("pricing.features.computer_use.advanced")).toBe("Advanced computer use");
  });

  it("falls back to en-US for missing keys and to the key itself as a last resort", () => {
    const t = createTranslator("de-DE", { common: {} });
    expect(t("common.save")).toBe("Save");
    expect(t("does.not.exist")).toBe("does.not.exist");
  });
});

describe("locale resolution", () => {
  it("maps arbitrary tags to shipped locales", () => {
    expect(closestLocale("ar")).toBe("ar-AE");
    expect(closestLocale("ar-SA")).toBe("ar-AE");
    expect(closestLocale("de-AT")).toBe("de-DE");
    expect(closestLocale("hi")).toBe("hi-IN");
    expect(closestLocale("zh-TW")).toBe("zh-CN");
    expect(closestLocale("fr-FR")).toBe("en-US");
    expect(closestLocale(undefined)).toBe("en-US");
  });

  it("derives text direction from the language", () => {
    expect(directionOf("ar-AE")).toBe("rtl");
    expect(directionOf("en-US")).toBe("ltr");
    expect(directionOf("hi-IN")).toBe("ltr");
  });
});

// ── Static guards for globalization rules (docs/globalization.md §2, §4) ──

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = path.join(root, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const uiRoots = ["src/app", "src/components"].map((r) => path.resolve(import.meta.dirname, "../..", r));
const uiFiles = uiRoots.flatMap((r) => {
  try {
    return sourceFiles(r);
  } catch {
    return [];
  }
});

describe("UI source guards", () => {
  it("uses logical (RTL-safe) spacing and alignment utilities only", () => {
    const physical = /(?<![\w-])(?:-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|border-[lr](?:-|\b)|rounded-[lr](?:-|\b)|float-left|float-right)/;
    const offenders = uiFiles.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /className=|cn\(|cva\(/.test(line) && physical.test(line))
        .map(({ i }) => `${path.relative(process.cwd(), f)}:${i + 1}`),
    );
    expect(offenders).toEqual([]);
  });

  it("contains no hard-coded user-facing text in JSX", () => {
    // A JSX text node: after a tag's closing ">" (not "=>" or a generic's "\">"), letters, then the next tag.
    // Code-like characters exclude TypeScript generics and arrow functions from matching.
    const textNode = /(?:(?<![=\-])>|\})\s*([^<>{}\n();=|&]*\p{L}[^<>{}\n();=|&]*)\s*<[/A-Za-z]/u;
    const offenders = uiFiles.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => !line.trim().startsWith("//") && !line.includes("i18n-ignore") && textNode.test(line))
        .map(({ i, line }) => `${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
