/** Plain helpers shared by marketing server and client components. */

/** "a, b, c" ⇄ string[] helper for tag-like inputs. */
export const splitList = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Local datetime-input value ("YYYY-MM-DDTHH:mm") ⇄ ISO string with the browser's offset. */
export function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
export function isoToLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export const majorUnits = (m: bigint | string | number | null | undefined) => {
  if (m == null) return "";
  const n = BigInt(m);
  return `${n / 100n}${n % 100n ? `.${(n % 100n).toString().padStart(2, "0")}` : ""}`;
};
