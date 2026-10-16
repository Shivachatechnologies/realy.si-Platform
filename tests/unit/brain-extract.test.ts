import { describe, expect, it } from "vitest";
import { chunkText, extractText, ExtractionError, MAX_DOCUMENT_BYTES, mimeTypeFor } from "@/server/modules/brain/extract";

describe("brain extraction", () => {
  it("derives the type from the extension, never from the client", () => {
    expect(mimeTypeFor("notes.TXT")).toBe("text/plain");
    expect(mimeTypeFor("README.md")).toBe("text/markdown");
    expect(mimeTypeFor(undefined)).toBe("text/plain");
    for (const bad of ["report.pdf", "image.png", "script.md.exe", "noextension", "archive.tar.gz"]) expect(() => mimeTypeFor(bad)).toThrow(ExtractionError);
  });

  it("normalizes text and refuses empty, binary and oversized content", () => {
    expect(extractText("﻿  Title\r\nline\r\n\n")).toBe("Title\nline");
    expect(() => extractText("  \n\t ")).toThrow("empty");
    expect(() => extractText("PDF\u0000\u0001binary")).toThrow("binary");
    expect(() => extractText("bad � bytes")).toThrow("UTF-8");
    expect(() => extractText("a".repeat(MAX_DOCUMENT_BYTES + 1))).toThrow("exceeds");
  });

  it("chunks losslessly at paragraph boundaries, every passage non-blank", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40 + (i % 7) * 10)}`.trim());
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const [i, c] of chunks.entries()) {
      expect(c.ordinal).toBe(i);
      expect(text.slice(c.startOffset, c.startOffset + c.text.length)).toBe(c.text);
      expect(c.text.trim()).not.toBe("");
      expect(c.text.length).toBeLessThanOrEqual(2000);
    }
    // A single unbroken token longer than a passage is still split.
    expect(chunkText("x".repeat(4500)).map((c) => c.text.length)).toEqual([2000, 2000, 500]);
    expect(chunkText("short")).toEqual([{ ordinal: 0, startOffset: 0, text: "short" }]);
  });
});
