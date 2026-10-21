import { redirect } from "next/navigation";
import { getLocale } from "@/i18n/server";

/** Company documents live in Company Brain. */
export default async function DocumentsPage() {
  redirect(`/${await getLocale()}/brain`);
}
