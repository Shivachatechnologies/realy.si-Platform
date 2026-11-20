import { WIDGET_JS } from "./widget-source";

/**
 * GET /api/public/chat/widget.js — the embeddable live chat script (static; configuration is fetched at runtime from
 * /api/public/chat/config with the snippet's data-key). Cross-origin loadable (classic <script>), cached for an hour.
 */
export function GET() {
  return new Response(WIDGET_JS, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "cross-origin-resource-policy": "cross-origin",
      "access-control-allow-origin": "*",
    },
  });
}
