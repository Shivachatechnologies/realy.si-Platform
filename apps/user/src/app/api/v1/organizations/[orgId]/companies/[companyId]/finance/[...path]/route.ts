import { dispatch } from "@/server/modules/finance/api";

/** Finance OS API — every endpoint is declared in src/server/modules/finance/api.ts. */
export const GET = dispatch("GET");
export const POST = dispatch("POST");
export const PATCH = dispatch("PATCH");
export const PUT = dispatch("PUT");
export const DELETE = dispatch("DELETE");
