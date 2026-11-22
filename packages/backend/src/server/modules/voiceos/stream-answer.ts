import "server-only";
import type { z } from "zod";
import type { RequestContext } from "@/server/core/context";
import { isAppError } from "@/server/core/errors";
import { logger } from "@/server/core/logger";
import { spokenClean } from "./converse";
import { SentenceChunker } from "./sentences";
import { utter, type utterInput } from "./service";

/**
 * One utterance answered as a stream (newline-delimited JSON), for low-latency voice:
 *   {"type":"route","intent":…}             as soon as the utterance is routed
 *   {"type":"sentence","index":n,"text":…}  each finished sentence of a direct answer, while the model still writes
 *   {"type":"result", …}                    the same final result as POST …/utterances (authoritative: when the AI
 *                                           failed mid-answer it carries the honest status reply instead)
 *   {"type":"error","code":…,"message":…}   the request failed (nothing else follows)
 * Work requests produce route + result only (they become an AI Command run, as before).
 */
export function utteranceStream(ctx: RequestContext, organizationId: string, companyId: string, sessionId: string, input: z.input<typeof utterInput>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          open = false;
        }
      };
      const chunker = new SentenceChunker();
      let index = 0;
      const emit = (sentences: string[]) => {
        for (const raw of sentences) {
          const text = spokenClean(raw);
          if (text) send({ type: "sentence", index: index++, text });
        }
      };
      try {
        const result = await utter(ctx, organizationId, companyId, sessionId, input, {
          onRoute: (r) => send({ type: "route", ...r }),
          onText: (delta) => emit(chunker.push(delta)),
        });
        emit(chunker.flush());
        send({ type: "result", ...result, streamedSentences: index });
      } catch (err) {
        const code = isAppError(err) ? err.code : "internal_error";
        const message = isAppError(err) ? err.message : "The request failed";
        if (!isAppError(err)) logger.warn({ err: err instanceof Error ? err.message : String(err) }, "voice stream answer failed");
        send({ type: "error", code, message, details: isAppError(err) ? (err.details ?? null) : null });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* closed by the client */
        }
      }
    },
  });
}
