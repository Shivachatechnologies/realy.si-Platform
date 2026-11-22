/**
 * Sentence chunking for streamed spoken answers (pure; safe for client components). Text deltas are appended and
 * complete sentences are released as soon as they end, so text-to-speech can start on the first sentence while the
 * model is still writing the rest. Very short sentences are joined with the next one (fewer, more natural TTS calls).
 */

/** Sentence ends in the five console languages (Latin, CJK, Devanagari danda, Arabic question mark). */
const END = /([.!?…]+["'”’)\]]*\s+|[。！？]+|[।॥]+\s*|[؟]+\s*)/g;
const MIN_CHARS = 24;
const MAX_CHARS = 280;

export class SentenceChunker {
  private buf = "";

  /** Add a delta; returns the sentences it completed (possibly none). */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      END.lastIndex = 0;
      let cut = -1;
      let m: RegExpExecArray | null;
      // CJK packs more meaning per character: a shorter minimum.
      const min = /[\u3040-\u30ff\u3400-\u9fff]/.test(this.buf) ? 8 : MIN_CHARS;
      while ((m = END.exec(this.buf))) {
        const end = m.index + m[0].length;
        if (end >= min) {
          cut = end;
          break;
        }
      }
      // A run-on without punctuation: break at the last space before the cap.
      if (cut < 0 && this.buf.length > MAX_CHARS) {
        const sp = this.buf.lastIndexOf(" ", MAX_CHARS);
        cut = sp > MIN_CHARS ? sp + 1 : MAX_CHARS;
      }
      if (cut < 0) break;
      const s = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (s) out.push(s);
    }
    return out;
  }

  /** The rest once the stream ended. */
  flush(): string[] {
    const s = this.buf.trim();
    this.buf = "";
    return s ? [s] : [];
  }
}

/** Split a whole text the same way (used when an answer arrives in one piece). */
export function splitSentences(text: string): string[] {
  const c = new SentenceChunker();
  return [...c.push(text), ...c.flush()];
}
