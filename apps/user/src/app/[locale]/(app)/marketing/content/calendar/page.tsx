import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";

/** The content calendar moved into the unified marketing calendar (content, posts, autopilot slots and emails). */
export default async function ContentCalendarPage({ searchParams }: PageProps<"/[locale]/marketing/content/calendar">) {
  const locale = await getLocale();
  const raw = (await searchParams).month;
  const month = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? `?view=month&date=${raw}-01` : "";
  redirect(`/${locale}/marketing/calendar${month}`);
}
