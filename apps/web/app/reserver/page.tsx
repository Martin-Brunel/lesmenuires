import type { Metadata } from "next";
import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { getBookingContext } from "@/lib/api";
import { css } from "@/components/booking/css";
import { getDict } from "@/lib/i18n";
import { hreflangAlternates, requestLocale } from "@/lib/i18n/server";
import { site } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const t = getDict(locale);
  return {
    title: t.meta.bookTitle(site.name),
    description: t.meta.bookDescription,
    alternates: hreflangAlternates("/reserver"),
  };
}

export default async function ReserverPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const locale = await requestLocale();
  const t = getDict(locale);
  // Reprise de panier depuis l'e-mail de relance : /reserver?ref=ADR-XXXXXX.
  const rawRef = (await searchParams).ref;
  const resumeRef =
    rawRef && /^[A-Z]{2,6}-[0-9A-Fa-f]{4,12}$/.test(rawRef) ? rawRef : null;
  let ctx;
  try {
    ctx = await getBookingContext("ladret", locale);
  } catch {
    return (
      <div style={css("max-width:520px;margin:0 auto;padding:120px 40px;text-align:center")}>
        <h1 style={css("font:400 30px 'Marcellus';color:#1A1B1A")}>{t.serviceDown.title}</h1>
        <p style={css("margin-top:14px;font:400 15px/1.6 'Hanken Grotesk';color:#6B6E6B")}>
          {t.serviceDown.body}
        </p>
      </div>
    );
  }
  return <BookingFunnel ctx={ctx} resumeRef={resumeRef} />;
}
