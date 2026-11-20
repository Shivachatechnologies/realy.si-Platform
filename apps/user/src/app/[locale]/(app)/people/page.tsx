import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";

/** People now live in HR & People (employee directory). */
export default async function PeoplePage() {
  redirect(`/${await getLocale()}/hr/employees`);
}
