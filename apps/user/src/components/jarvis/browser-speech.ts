"use client";

/**
 * Browser speech engines (Web Speech API): recognition for the keyboard-free fallback and the opt-in "Hey Realy"
 * wake word, speechSynthesis for spoken replies without a TTS provider. Availability and accuracy depend on the
 * browser (Chrome/Edge/Safari send audio to their vendor's recogniser); the console labels this clearly.
 */

export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onspeechstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

export function recognitionCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const recognitionSupported = () => recognitionCtor() !== null;
export const synthesisSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Collect interim and final text of one result event. */
export function readResults(e: SpeechResultEvent): { finalText: string; interim: string } {
  let finalText = "";
  let interim = "";
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i]!;
    if (r.isFinal) finalText += r[0].transcript;
    else interim += r[0].transcript;
  }
  return { finalText: finalText.trim(), interim: interim.trim() };
}

/** Pick a system voice for the language, preferring the personality's gender hint when names reveal it. */
export function pickSystemVoice(lang: string, gender: "female" | "male"): SpeechSynthesisVoice | null {
  if (!synthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0]!.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase() === lang.toLowerCase());
  const pool = matching.length ? matching : voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  if (!pool.length) return null;
  const female = /(female|woman|samantha|victoria|karen|zira|anna|helena|hedda|katja|salma|hoda|lekha|swara|ting|tingting|xiaoxiao|huihui|aria|jenny|sonia)/i;
  const male = /(male|man|daniel|alex|david|mark|stefan|conrad|naayf|hemant|madhur|kangkang|yunxi|guy|ryan)/i;
  const want = gender === "female" ? female : male;
  return pool.find((v) => want.test(v.name)) ?? pool.find((v) => v.localService) ?? pool[0]!;
}
