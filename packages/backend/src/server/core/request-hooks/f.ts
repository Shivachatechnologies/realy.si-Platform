import type { ProcessApp } from "../observability";

/**
 * Stream F hooks (owned by stream F; placeholder from stream E). Register the API request logger here, e.g.
 *   const { onRequestComplete } = await import("../http");
 *   onRequestComplete((e) => recordApiRequest(e));
 * Skip HTTP hooks when `app === "worker"`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- placeholder until stream F registers its hooks
export async function installF(_app: ProcessApp): Promise<void> {}
