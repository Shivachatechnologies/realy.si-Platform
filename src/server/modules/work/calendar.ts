/** Month window for the calendar views: "YYYY-MM" (defaults to the current month), with the grid's date range. */
export function monthRange(month?: string) {
  const now = new Date();
  const valid = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const y = valid ? Number(month!.slice(0, 4)) : now.getUTCFullYear();
  const m = valid ? Number(month!.slice(5)) : now.getUTCMonth() + 1;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const from = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000);
  const to = new Date(from.getTime() + 42 * 86_400_000);
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
  return { month: fmt(y, m), from, to, prev: m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1), next: m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1) };
}
