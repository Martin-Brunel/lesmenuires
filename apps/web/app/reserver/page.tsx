import type { Metadata } from "next";
import { BookingFunnel } from "@/components/booking/BookingFunnel";
import { getBookingContext } from "@/lib/api";
import { css } from "@/components/booking/css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Réserver votre séjour — ${site.name}`,
  description:
    "Choisissez votre semaine, ajoutez vos prestations, signez le contrat et réglez l'acompte en ligne.",
};

export default async function ReserverPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  // Reprise de panier depuis l'e-mail de relance : /reserver?ref=ADR-XXXXXX.
  const rawRef = (await searchParams).ref;
  const resumeRef =
    rawRef && /^[A-Z]{2,6}-[0-9A-Fa-f]{4,12}$/.test(rawRef) ? rawRef : null;
  let ctx;
  try {
    ctx = await getBookingContext("ladret");
  } catch {
    return (
      <div style={css("max-width:520px;margin:0 auto;padding:120px 40px;text-align:center")}>
        <h1 style={css("font:400 30px 'Marcellus';color:#1A1B1A")}>Service momentanément indisponible</h1>
        <p style={css("margin-top:14px;font:400 15px/1.6 'Hanken Grotesk';color:#6B6E6B")}>
          Impossible de charger les disponibilités. Réessayez dans un instant.
        </p>
      </div>
    );
  }
  return <BookingFunnel ctx={ctx} resumeRef={resumeRef} />;
}
