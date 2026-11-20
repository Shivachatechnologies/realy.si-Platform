/** i18n key of a domain event type's label (dots are not allowed inside message keys). */
export const eventLabelKey = (type: string) => `workflows.events.${type.replaceAll(".", "_")}`;

/** Human duration of a run or step ("850 ms", "12 s", "4 min", "3 h"). */
export function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / 360_000) / 10} h`;
}
