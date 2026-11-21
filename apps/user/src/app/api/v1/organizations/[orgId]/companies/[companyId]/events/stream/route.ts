import { route } from "@/server/core/http";
import { companyEventStream, parseCursor, STREAM_MAX_MS, streamAccess } from "@/server/modules/voiceos/stream";

type P = { orgId: string; companyId: string };

/** The stream closes itself after five minutes (the browser reconnects with Last-Event-ID). */
export const maxDuration = 320;

/**
 * GET — Server-Sent Events: the active company's domain events and AI work / approval / call state changes, scoped to
 * the tenant and the viewer's read permissions. Resume with the Last-Event-ID header (or ?cursor=).
 */
export const GET = route<P>(
  { auth: "required", rateLimits: [{ name: "events-stream:principal", limit: 40, windowMs: 60_000, by: "principal" }] },
  async ({ req, ctx }, { orgId, companyId }) => {
    const access = await streamAccess(ctx, orgId, companyId);
    const cursor = parseCursor(req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("cursor"));
    const stream = companyEventStream(ctx, access, { cursor, signal: req.signal });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-stream-max-ms": String(STREAM_MAX_MS),
      },
    });
  },
);
