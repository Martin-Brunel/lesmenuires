import { redirect } from "next/navigation";
import { localePath } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n/server";

export default async function Home() {
  // The booking funnel is the product entry point for now.
  const locale = await requestLocale();
  redirect(localePath(locale, "/reserver"));
}
