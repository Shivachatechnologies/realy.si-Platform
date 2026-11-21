"use client";

import { api as request, ApiError } from "./core";

export { ApiError, setCookie } from "./core";

/**
 * Endpoints the admin deployment serves (apps/admin/src/app/api). Anything else belongs to the user app, which
 * is another origin with another session: calling it from the Control Center is a bug, so it fails fast here
 * instead of producing a confusing 404.
 */
const ADMIN_ENDPOINTS = [/^\/api\/v1\/admin(?:[/?]|$)/, /^\/api\/v1\/auth\/(?:sign-in|sign-out|mfa\/verify)(?:\?|$)/, /^\/api\/v1\/me(?:\?|$)/];

/** Admin-app API client entry (`@/lib/api-client` in apps/admin). Same-origin cookies authenticate. */
export function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!ADMIN_ENDPOINTS.some((re) => re.test(path))) return Promise.reject(new ApiError("not_found", `${path} is not served by the admin app`));
  return request<T>(path, init);
}
