/**
 * Text extraction and chunking for Company Brain (pure functions, no I/O).
 * Plain text and Markdown are indexed as the UTF-8 text supplied; PDFs as the text layer extracted by ./pdf.ts
 * (scanned PDFs without a text layer are refused — no OCR).
 */

/** Largest document accepted, in UTF-8 bytes of extracted text. */
export const MAX_DOCUMENT_BYTES = 1_000_000;
/** Largest PDF accepted, in bytes of the file itself. */
export const MAX_PDF_BYTES = 8_000_000;

const TYPES = { ".txt": "text/plain", ".text": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".pdf": "application/pdf" } as const;
export type BrainMimeType = (typeof TYPES)[keyof typeof TYPES];
export const ACCEPTED_EXTENSIONS = Object.keys(TYPES);

/** `reason` is a stable code the UI localizes (errors.reasons.*). */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly reason: "brain_unsupported_type" | "brain_too_large" | "brain_not_text" | "brain_empty" | "brain_invalid_pdf" | "brain_no_text",
  ) {
    super(message);
  }
}

/**
 * The type comes from the file extension, never from a client-declared MIME type. Pasted text (no filename)
 * is plain text.
 */
export function mimeTypeFor(filename: string | undefined): BrainMimeType {
  if (!filename) return "text/plain";
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const type = filename.includes(".") ? TYPES[ext as keyof typeof TYPES] : undefined;
  if (!type) throw new ExtractionError(`Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`, "brain_unsupported_type");
  return type;
}

/** Normalized document text: line endings unified, surrounding whitespace trimmed; binary content refused. */
export function extractText(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES) throw new ExtractionError(`Document exceeds ${MAX_DOCUMENT_BYTES / 1_000_000} MB of text`, "brain_too_large");
  if (raw.includes("\uFFFD")) throw new ExtractionError("The file is not valid UTF-8 text", "brain_not_text");
  // Control characters other than tab/newline/carriage return mean binary content (or a renamed binary file).
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) throw new ExtractionError("The file contains binary data, not text", "brain_not_text");
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new ExtractionError("The document is empty", "brain_empty");
  return text;
}

export interface Chunk {
  ordinal: number;
  startOffset: number;
  text: string;
}

const MAX_CHUNK = 2000;
const MIN_CUT = 600;

/**
 * Split text into passages of at most ~2000 characters, cutting at paragraph, line or word boundaries.
 * The passages partition the text exactly: concatenated, they reproduce it (offsets are stable citations).
 */
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.length;
    if (end - start > MAX_CHUNK) {
      const window = text.slice(start, start + MAX_CHUNK);
      let cut = -1;
      for (const sep of ["\n\n", "\n", " "]) {
        const at = window.lastIndexOf(sep);
        if (at >= MIN_CUT) {
          cut = at + sep.length;
          break;
        }
      }
      end = start + (cut > 0 ? cut : MAX_CHUNK);
    }
    const piece = text.slice(start, end);
    const prev = chunks[chunks.length - 1];
    if (!piece.trim() && prev) prev.text += piece; // a whitespace-only run belongs to the previous passage
    else chunks.push({ ordinal: chunks.length, startOffset: start, text: piece });
    start = end;
  }
  return chunks;
}
