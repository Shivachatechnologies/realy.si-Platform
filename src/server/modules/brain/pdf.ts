import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { ExtractionError, MAX_PDF_BYTES } from "./extract";

const MAX_PAGES = 1000;
const TIMEOUT_MS = 30_000;
// Control characters that PDF text layers sometimes contain; replaced so the text passes extractText().
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/g;

/**
 * Text layer of a PDF, pages separated by blank lines. Parsing is hardened for untrusted files: no font loading,
 * bounded size, pages and time. (This PDF.js version has no eval code path.)
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new ExtractionError(`PDF exceeds ${MAX_PDF_BYTES / 1_000_000} MB`, "brain_too_large");
  if (Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") === -1) throw new ExtractionError("The file is not a valid PDF", "brain_invalid_pdf");

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractionError("The PDF took too long to read", "brain_invalid_pdf")), TIMEOUT_MS);
  });
  const work = (async () => {
    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
    } catch {
      throw new ExtractionError("The file is not a valid PDF", "brain_invalid_pdf");
    }
    try {
      if (pdf.numPages > MAX_PAGES) throw new ExtractionError(`PDF has more than ${MAX_PAGES} pages`, "brain_too_large");
      const { text } = await extractText(pdf, { mergePages: false });
      return text.map((page) => page.replace(CONTROL, " ").trim()).filter(Boolean).join("\n\n");
    } finally {
      await pdf.loadingTask.destroy();
    }
  })();
  try {
    const text = await Promise.race([work, timeout]);
    if (!text.trim()) throw new ExtractionError("This PDF has no text layer (scanned PDFs need OCR, which is not supported)", "brain_no_text");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
