"use client";

/**
 * Shared WebAudio engine of the Realy voice console: one AudioContext, the microphone stream (only while the person
 * holds to talk or has hands-free capture running) with an analyser, and an analyser on every reply the console
 * plays. The AI Core reads `level()` each frame, so its motion follows real audio — mic input while listening,
 * the voice output while speaking — and nothing else.
 */

type Listener = () => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private outSource: AudioBufferSourceNode | null = null;
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  /** Word-boundary pulses from the browser speech fallback (no analyser access there). */
  private pulse = 0;
  private pulseAt = 0;
  private listeners = new Set<Listener>();
  micOpen = false;
  playing = false;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  context(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Open the microphone (asks for permission the first time). Echo cancellation keeps replies out of the input. */
  async openMic(): Promise<MediaStream> {
    if (this.mic && this.mic.getAudioTracks().some((t) => t.readyState === "live")) return this.mic;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("mic_unsupported");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.mic = stream;
    const ctx = this.context();
    if (ctx) {
      this.micSource = ctx.createMediaStreamSource(stream);
      this.micAnalyser = ctx.createAnalyser();
      this.micAnalyser.fftSize = 1024;
      this.micAnalyser.smoothingTimeConstant = 0.6;
      this.micSource.connect(this.micAnalyser);
    }
    this.micOpen = true;
    this.emit();
    return stream;
  }

  /** Release the microphone completely (the browser's recording indicator turns off). */
  closeMic() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.mic = null;
    this.micSource = null;
    this.micAnalyser = null;
    if (this.micOpen) {
      this.micOpen = false;
      this.emit();
    }
  }

  private rms(an: AnalyserNode | null): number {
    if (!an) return 0;
    if (this.buf.length !== an.fftSize) this.buf = new Uint8Array(new ArrayBuffer(an.fftSize));
    an.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = (this.buf[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 3.2);
  }

  micLevel(): number {
    return this.rms(this.micAnalyser);
  }

  outLevel(): number {
    const decay = Math.max(0, 1 - (performance.now() - this.pulseAt) / 220);
    return Math.max(this.rms(this.outAnalyser), this.pulse * decay);
  }

  /** The level the AI Core follows: voice output while a reply plays, the microphone while it is open. */
  level(): number {
    if (this.playing) return this.outLevel();
    if (this.micOpen) return this.micLevel();
    return 0;
  }

  /** A word boundary of the browser speech fallback (speechSynthesis has no audio graph). */
  speechPulse(strength = 0.7) {
    this.pulse = strength;
    this.pulseAt = performance.now();
  }

  setPlaying(v: boolean) {
    if (this.playing !== v) {
      this.playing = v;
      this.emit();
    }
  }

  /** Decode and play provider audio (mp3, or 16-bit mono PCM) through the output analyser. */
  async play(audioB64: string, format: "mp3" | "pcm16", sampleRate: number | null, onEnd: () => void): Promise<void> {
    const ctx = this.context();
    if (!ctx) throw new Error("audio_unsupported");
    this.stop();
    const bin = atob(audioB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let buffer: AudioBuffer;
    if (format === "pcm16") {
      const rate = sampleRate ?? 24_000;
      const samples = Math.floor(bytes.length / 2);
      buffer = ctx.createBuffer(1, samples, rate);
      const ch = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    } else {
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    }
    if (!this.outAnalyser) {
      this.outAnalyser = ctx.createAnalyser();
      this.outAnalyser.fftSize = 1024;
      this.outAnalyser.smoothingTimeConstant = 0.55;
      this.outAnalyser.connect(ctx.destination);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outAnalyser);
    src.onended = () => {
      if (this.outSource === src) {
        this.outSource = null;
        this.setPlaying(false);
        onEnd();
      }
    };
    this.outSource = src;
    this.setPlaying(true);
    src.start();
  }

  /** Stop any reply immediately (barge-in, mute, stop). */
  stop() {
    const src = this.outSource;
    this.outSource = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* not started */
      }
    }
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    this.setPlaying(false);
  }
}

export const audioEngine = new AudioEngine();
