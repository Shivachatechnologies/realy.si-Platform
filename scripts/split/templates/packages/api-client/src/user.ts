/**
 * User-app API client entry (`@/lib/api-client` in apps/user). The admin entry (./admin.ts) is never reachable
 * from the user app: its tsconfig maps no alias to it and scripts/split/check-boundaries.mjs rejects the import.
 */
export { api, ApiError, setCookie } from "./core";
