"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BookingContext } from "@/lib/api";
import { mediaUrl } from "@/lib/api";
import { useBookingFlow } from "./useBookingFlow";
import {
  ACCENT,
  balanceDueLabel,
  computeTotals,
  defaultExtras,
  eur,
  frMonthYear,
  monthKey,
  monthsOf,
  pickDefaultWeek,
  type ExtrasState,
} from "./data";
import { css } from "./css";
import { Lightbox } from "./Lightbox";
import { ReadMore } from "./ReadMore";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";
import { StripeCheckout } from "./StripeCheckout";
import { GuestPicker } from "./GuestPicker";

type Screen = "home" | "week" | "extras" | "infos" | "contract" | "payment" | "done";

const STEP_MAP: Record<string, number> = {
  week: 1,
  extras: 2,
  infos: 3,
  contract: 4,
  payment: 5,
};
const STEP_LABELS = ["Semaine", "Options", "Infos", "Contrat", "Paiement"];

export function MobileFunnel({ ctx }: { ctx: BookingContext }) {
  const { property, season, weeks, products, media } = ctx;
  const heroImg = media[0]
    ? mediaUrl(media[0].url)
    : "https://picsum.photos/seed/adret-chalet-a/820/640";
  const galleryImages = media.length
    ? media.map((m) => ({ url: mediaUrl(m.url), alt: m.alt }))
    : [{ url: "https://picsum.photos/seed/adret-chalet-a/1200/1600", alt: "" }];

  const [screen, setScreen] = useState<Screen>("home");
  const router = useRouter();
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Shared flow orchestration (cart/payment) — single source of truth with the
  // desktop funnel, see useBookingFlow.
  const flow = useBookingFlow(ctx);
  const {
    info, setField, adults, setAdults, children, setChildren, capacity,
    monthIdx, setMonthIdx, weekIdx, selectWeek, extras, toggleExtra, selectedExtras,
    accepted, setAccepted, sigEmpty, setSigEmpty, sigRef,
    reference, submitting, error, setError, stripeSession, setStripeSession,
    week, months, totals, infoComplete,
  } = flow;

  const pct = property.depositPct;
  const name = property.name;
  const caution = property.cautionCents;

  if (!week) {
    return (
      <div style={css("height:100dvh;max-width:480px;margin:0 auto;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:32px")}>
        <div style={css("text-align:center")}>
          <div style={css("font:400 30px 'Marcellus'")}>{name}</div>
          <div style={css(`margin-top:12px;font:500 10.5px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}`)}>{season ? season.name : "Hors saison"}</div>
          <p style={css("margin:14px 0 0;font:400 14px/1.65 'Hanken Grotesk';color:#6B6E6B")}>Le calendrier de réservation ouvrira prochainement. Revenez bientôt.</p>
        </div>
      </div>
    );
  }

  const { total, deposit, balance } = totals;
  const fromPrice = Math.min(...weeks.map((w) => w.priceCents));
  const inputCss =
    "width:100%;background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:14px;font-size:15px;color:#1A1B1A";
  const contractReady = accepted && !sigEmpty;

  const goPayment = () => {
    if (contractReady) setScreen("payment");
  };
  const goToContract = async () => {
    if (await flow.ensureCart()) setScreen("contract");
  };
  const payNow = () => flow.pay(() => router.push("/espace"));
  const reset = () => {
    setScreen("home");
    flow.resetFlow();
  };

  const cur = STEP_MAP[screen] || 0;
  const Stepper = () => (
    <div style={css("padding:18px 22px 4px;display:flex;gap:8px")}>
      {STEP_LABELS.map((label, idx) => {
        const active = idx + 1 <= cur;
        return (
          <div key={label} style={css("flex:1;display:flex;flex-direction:column;gap:6px")}>
            <div style={css(`height:3px;border-radius:2px;background:${active ? ACCENT : "rgba(0,0,0,.1)"}`)} />
            <div style={css(`font:500 9.5px 'Hanken Grotesk';letter-spacing:.02em;color:${active ? "#1A1B1A" : "#B6B5B0"}`)}>{label}</div>
          </div>
        );
      })}
    </div>
  );

  const back = "display:inline-flex;align-items:center;gap:6px;font:500 13px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer";
  const footer = "padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between";
  const ctaSmall = "padding:14px 26px;background:#1A1B1A;color:#fff;border-radius:12px;font:600 14px 'Hanken Grotesk';cursor:pointer";

  const timeline = [
    { title: "Acompte versé", when: "Aujourd'hui · payé", amount: eur(deposit), accent: true },
    { title: "Solde du séjour", when: "Prélevé le " + (balanceDueLabel(week.startDate) || "—"), amount: eur(balance), accent: false },
    { title: "Remise des clés", when: "Arrivée " + (week.arrival || "—") + " · 16h", amount: "", accent: false },
    { title: "Caution libérée", when: "Après état des lieux de sortie", amount: eur(caution), accent: false },
  ];

  return (
    <div style={css("height:100dvh;max-width:480px;margin:0 auto;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;overflow:hidden")}>
      {/* ============== HOME ============== */}
      {screen === "home" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div onClick={() => setLightbox(0)} style={css(`position:relative;height:320px;background-color:#E5E4DF;background-image:url('${heroImg}');background-size:cover;background-position:center;cursor:pointer`)}>
              <div style={css("position:absolute;left:0;right:0;bottom:0;height:170px;background:linear-gradient(to top,rgba(245,244,241,1),rgba(245,244,241,0))")} />
              <div style={css("position:absolute;left:22px;bottom:20px")}>
                <div style={css("font:500 10.5px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:#6B6E6B")}>{property.locationLabel}</div>
                <div style={css("margin-top:7px;font:400 44px/.95 'Marcellus';color:#1A1B1A")}>{name}</div>
              </div>
              <a href="/espace" onClick={(e) => e.stopPropagation()} style={css("position:absolute;right:16px;top:16px;padding:7px 12px;background:rgba(255,255,255,.92);border-radius:8px;font:600 11.5px 'Hanken Grotesk';color:#1A1B1A;text-decoration:none")}>Mon espace</a>
              {media.length > 0 && (
                <div style={css("position:absolute;right:16px;bottom:18px;padding:7px 12px;background:rgba(255,255,255,.92);border-radius:8px;font:500 11.5px 'Hanken Grotesk'")}>
                  {media.length} photos
                </div>
              )}
            </div>
            <div style={css("padding:18px 22px 14px")}>
              <ReadMore
                content={property.description}
                lines={5}
                textStyle={css("margin:0;font:400 14.5px/1.65 'Hanken Grotesk';color:#5A5C58")}
              />
              <div style={css("margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid rgba(0,0,0,.09)")}>
                <div style={css("padding:14px 4px;border-bottom:1px solid rgba(0,0,0,.09);border-right:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.surfaceLabel}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>Surface</div>
                </div>
                <div style={css("padding:14px 4px 14px 16px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.capacity}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>Voyageurs</div>
                </div>
                <div style={css("padding:14px 4px;border-bottom:1px solid rgba(0,0,0,.09);border-right:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.bedrooms}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>Chambres</div>
                </div>
                <div style={css("padding:14px 4px 14px 16px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>Sauna</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>&amp; cheminée</div>
                </div>
              </div>
              <div style={css("margin-top:20px;display:flex;align-items:baseline;gap:8px")}>
                <span style={css("font:400 26px 'Marcellus'")}>dès {eur(fromPrice)}</span>
                <span style={css("font:400 13px 'Hanken Grotesk';color:#9A9C97")}>/ semaine</span>
              </div>
            </div>
          </div>
          <div style={css("padding:14px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div onClick={() => setScreen("week")} style={css("padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';letter-spacing:.02em;cursor:pointer")}>Voir les disponibilités</div>
          </div>
        </div>
      )}

      {/* ============== WEEK ============== */}
      {screen === "week" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("home")} style={css(back)}>‹ Retour</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>Choisir votre semaine</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                <div onClick={() => setMonthIdx((m) => Math.max(0, m - 1))} style={css(`width:32px;height:32px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;font-size:15px;color:#1A1B1A;${monthIdx === 0 ? "opacity:.35;" : ""}`)}>‹</div>
                <div style={css("font:400 17px 'Marcellus'")}>{frMonthYear(months[monthIdx])}</div>
                <div onClick={() => setMonthIdx((m) => Math.min(months.length - 1, m + 1))} style={css(`width:32px;height:32px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;font-size:15px;color:#1A1B1A;${monthIdx >= months.length - 1 ? "opacity:.35;" : ""}`)}>›</div>
              </div>
              <div style={css("margin-top:16px")}>
                {weeks
                  .map((wk, i) => ({ wk, i }))
                  .filter(({ wk }) => monthKey(wk.startDate) === months[monthIdx])
                  .map(({ wk, i }) => {
                  const sel = i === weekIdx;
                  const base = "display:flex;align-items:center;justify-content:space-between;padding:14px;border-radius:13px;margin-bottom:10px;transition:box-shadow .15s,border-color .15s;";
                  const cardStyle = wk.booked
                    ? base + "background:#EFEEEB;border:1px solid rgba(0,0,0,.05);opacity:.5;cursor:default;"
                    : sel
                      ? base + `background:#FFF;border:1.5px solid ${ACCENT};box-shadow:0 8px 22px ${ACCENT}24;cursor:pointer;`
                      : base + "background:#FFF;border:1px solid rgba(0,0,0,.07);cursor:pointer;";
                  return (
                    <div key={wk.id} onClick={() => selectWeek(i)} style={css(cardStyle)}>
                      <div style={css("display:flex;align-items:center;gap:11px")}>
                        {sel && <div style={css(`flex:none;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;background:${ACCENT}`)}>✓</div>}
                        <div>
                          <div style={css("font:500 16px 'Hanken Grotesk';color:#1A1B1A")}>{wk.range}</div>
                          <div style={css(`margin-top:2px;font:400 11px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? "Complet" : wk.sub}</div>
                        </div>
                      </div>
                      <div style={css("text-align:right")}>
                        <div style={css("font:400 18px 'Marcellus';color:#1A1B1A")}>{wk.booked ? "Réservé" : eur(wk.priceCents)}</div>
                        {!wk.booked && <div style={css("font:400 10.5px 'Hanken Grotesk';color:#9A9C97")}>/ semaine</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={css(footer)}>
            <div>
              <div style={css("font:400 21px 'Marcellus'")}>{eur(week.priceCents)}</div>
              <div style={css("font:400 11px 'Hanken Grotesk';color:#9A9C97")}>{week.range} · 7 nuits</div>
            </div>
            <div onClick={() => setScreen("extras")} style={css(ctaSmall)}>Continuer</div>
          </div>
        </div>
      )}

      {/* ============== EXTRAS ============== */}
      {screen === "extras" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("week")} style={css(back)}>‹ Retour</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>Prestations</div>
            </div>
            <Stepper />
            <div style={css("padding:10px 22px 16px")}>
              <p style={css("margin:0 0 16px;font:400 13px/1.55 'Hanken Grotesk';color:#9A9C97")}>Ajoutez ce qu&apos;il faut pour arriver les mains dans les poches.</p>
              {products.map((x) => {
                const on = extras[x.key];
                return (
                  <div key={x.key} onClick={() => toggleExtra(x.key)} style={css("display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:13px;margin-bottom:10px;cursor:pointer")}>
                    <div style={css("flex:1")}>
                      <div style={css("font:500 15px 'Hanken Grotesk';color:#1A1B1A")}>{x.label}</div>
                      <div style={css("margin-top:3px;font:400 11.5px/1.4 'Hanken Grotesk';color:#9A9C97")}>{x.description}</div>
                    </div>
                    <div style={css("font:400 15px 'Marcellus';color:#1A1B1A;white-space:nowrap")}>{x.priceCents === 0 ? "Offert" : "+ " + eur(x.priceCents)}</div>
                    <div style={css(`flex:none;position:relative;width:46px;height:27px;border-radius:99px;transition:background .18s;background:${on ? ACCENT : "#D8D7D2"}`)}>
                      <div style={css(`position:absolute;top:3px;left:${on ? "22px" : "3px"};width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .18s`)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={css(footer)}>
            <div>
              <div style={css("font:400 21px 'Marcellus'")}>{eur(total)}</div>
              <div style={css("font:400 11px 'Hanken Grotesk';color:#9A9C97")}>Semaine + prestations</div>
            </div>
            <div onClick={() => setScreen("infos")} style={css(ctaSmall)}>Continuer</div>
          </div>
        </div>
      )}

      {/* ============== INFOS ============== */}
      {screen === "infos" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("extras")} style={css(back)}>‹ Retour</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>Vos coordonnées</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              <div style={css("display:flex;flex-direction:column;gap:12px")}>
                <input placeholder="Prénom" value={info.firstName} onChange={setField("firstName")} style={css(inputCss)} />
                <input placeholder="Nom" value={info.lastName} onChange={setField("lastName")} style={css(inputCss)} />
                <input placeholder="E-mail" type="email" value={info.email} onChange={setField("email")} style={css(inputCss)} />
                <input placeholder="Téléphone" type="tel" value={info.phone} onChange={setField("phone")} style={css(inputCss)} />
                <input placeholder="Adresse" value={info.addressLine} onChange={setField("addressLine")} style={css(inputCss)} />
                <div style={css("display:flex;gap:12px")}>
                  <input placeholder="Code postal" value={info.postalCode} onChange={setField("postalCode")} style={css(inputCss)} />
                  <input placeholder="Ville" value={info.city} onChange={setField("city")} style={css(inputCss)} />
                </div>
                <GuestPicker adults={adults} children={children} capacity={capacity} setAdults={setAdults} setChildren={setChildren} />
              </div>
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div
              onClick={goToContract}
              style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${infoComplete && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}
            >
              {submitting ? "…" : infoComplete ? "Continuer" : "Complétez vos informations"}
            </div>
          </div>
        </div>
      )}

      {/* ============== CONTRACT ============== */}
      {screen === "contract" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("infos")} style={css(back)}>‹ Retour</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>Contrat &amp; signature</div>
            </div>
            <Stepper />
            <div style={css("padding:10px 22px 16px")}>
              {/* recap */}
              <div style={css("background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:16px 16px 6px")}>
                <div style={css("display:flex;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                  <div>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>SÉJOUR</div>
                    <div style={css("margin-top:3px;font:500 15px 'Hanken Grotesk'")}>{week.range} 2026</div>
                    <div style={css("margin-top:1px;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>Arrivée {week.arrival}</div>
                  </div>
                  <div style={css("text-align:right")}>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>VOYAGEURS</div>
                    <div style={css("margin-top:3px;font:500 15px 'Hanken Grotesk'")}>4 adultes</div>
                  </div>
                </div>
                <div style={css("padding:12px 0 4px")}>
                  <div style={css("display:flex;justify-content:space-between;margin-bottom:9px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>Location · 7 nuits</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                  </div>
                  {selectedExtras.map((se) => (
                    <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:9px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                      <span>{se.label}</span>
                      <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? "Offert" : eur(se.priceCents)}</span>
                    </div>
                  ))}
                  <div style={css("display:flex;justify-content:space-between;margin:11px 0 12px;padding-top:12px;border-top:1px solid rgba(0,0,0,.08);font:500 15px 'Hanken Grotesk'")}>
                    <span>Total séjour</span>
                    <span style={css("font-family:'Marcellus';font-size:18px")}>{eur(total)}</span>
                  </div>
                  <div style={css(`margin-top:4px;padding:13px;border-radius:11px;background:${ACCENT}14`)}>
                    <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk';color:#1A1B1A")}>
                      <span>Acompte {pct}% — aujourd&apos;hui</span>
                      <span style={css("font-family:'Marcellus'")}>{eur(deposit)}</span>
                    </div>
                    <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                      <span>Solde — prélevé le {balanceDueLabel(week.startDate)}</span>
                      <span>{eur(balance)}</span>
                    </div>
                    <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                      <span>Caution (empreinte, non débitée)</span>
                      <span>{eur(caution)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* contract text */}
              <div style={css("margin-top:16px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>CONTRAT DE LOCATION SAISONNIÈRE</div>
              <div style={css("margin-top:8px;max-height:120px;overflow:auto;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:12px;padding:14px;font:400 11.5px/1.6 'Hanken Grotesk';color:#6B6E6B")}>
                Entre le propriétaire de {name}, ci-après « le Bailleur », et le signataire, ci-après « le Preneur ». Le présent contrat a pour objet la location meublée à usage saisonnier du chalet situé au Grand-Bornand, pour la période indiquée ci-dessus.
                <br />
                <br />
                Le Preneur s&apos;engage à occuper les lieux paisiblement, à hauteur de 6 personnes maximum, et à restituer le logement en bon état. L&apos;acompte versé à la signature vaut réservation ferme. Le solde est prélevé deux semaines avant l&apos;arrivée. Une empreinte de caution est réalisée à titre de garantie et libérée après l&apos;état des lieux de sortie. Toute annulation est régie par les conditions générales annexées.
              </div>

              {/* accept */}
              <div onClick={() => setAccepted((a) => !a)} style={css("margin-top:14px;display:flex;align-items:center;gap:11px;cursor:pointer")}>
                <div style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:background .15s;${accepted ? `background:${ACCENT};border:1.5px solid ${ACCENT};` : "background:#FFF;border:1.5px solid rgba(0,0,0,.2);"}`)}>{accepted ? "✓" : ""}</div>
                <div style={css("font:400 12.5px/1.4 'Hanken Grotesk';color:#5A5C58")}>Je reconnais avoir lu et j&apos;accepte le contrat et les conditions générales.</div>
              </div>

              {/* signature */}
              <div style={css("margin-top:16px;display:flex;align-items:center;justify-content:space-between")}>
                <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>SIGNATURE</div>
                <div onClick={() => sigRef.current?.clear()} style={css("font:500 12px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>Effacer</div>
              </div>
              <div style={css("margin-top:8px")}>
                <SignaturePad ref={sigRef} width={338} height={120} fullWidth placeholder="Signez ici avec votre doigt" onEmptyChange={setSigEmpty} />
              </div>
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div onClick={goPayment} style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';transition:opacity .15s;${contractReady ? "background:#1A1B1A;color:#fff;cursor:pointer;opacity:1;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{contractReady ? "Signer & payer l’acompte" : "Acceptez et signez pour continuer"}</div>
          </div>
        </div>
      )}

      {/* ============== PAYMENT ============== */}
      {screen === "payment" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("contract")} style={css(back)}>‹ Retour</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>Acompte</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              <div style={css("text-align:center;padding:14px 0 22px")}>
                <div style={css("font:400 12px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>À régler aujourd&apos;hui · acompte {pct}%</div>
                <div style={css("margin-top:6px;font:400 46px 'Marcellus';color:#1A1B1A")}>{eur(deposit)}</div>
              </div>
              <div style={css("background:#EFEEEB;border-radius:12px;padding:14px")}>
                <div style={css("display:flex;justify-content:space-between;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B;margin-bottom:8px")}>
                  <span>Empreinte de caution</span>
                  <span>{eur(caution)} · non débitée</span>
                </div>
                <div style={css("display:flex;justify-content:space-between;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                  <span>Solde le {balanceDueLabel(week.startDate)}</span>
                  <span>{eur(balance)}</span>
                </div>
              </div>
              <div style={css("margin-top:14px;display:flex;align-items:center;gap:8px;justify-content:center;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>
                <span style={css("font-size:13px")}>🔒</span> Paiement sécurisé · Stripe
              </div>
              {error && <div style={css("margin-top:12px;text-align:center;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div onClick={payNow} style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? "Paiement en cours…" : "Payer " + eur(deposit)}</div>
          </div>
        </div>
      )}

      {/* ============== DONE ============== */}
      {screen === "done" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:54px 26px 0;text-align:center")}>
              <div style={css(`width:74px;height:74px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff;background:${ACCENT};box-shadow:0 12px 30px ${ACCENT}40`)}>✓</div>
              <div style={css("margin-top:22px;font:400 30px 'Marcellus'")}>Réservation confirmée</div>
              <p style={css("margin:12px auto 0;max-width:280px;font:400 13.5px/1.6 'Hanken Grotesk';color:#6B6E6B")}>Un e-mail d&apos;accueil avec les codes d&apos;accès, l&apos;itinéraire et vos contacts sur place vient de vous être envoyé.</p>
            </div>
            <div style={css("padding:26px 22px 16px")}>
              <div style={css("background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:6px 16px")}>
                {timeline.map((tl, i) => (
                  <div key={i} style={css("display:flex;gap:13px;padding:13px 0;border-bottom:1px solid rgba(0,0,0,.07)")}>
                    <div style={css(`flex:none;width:9px;height:9px;border-radius:50%;margin-top:5px;background:${tl.accent ? ACCENT : "#CFCEC9"}`)} />
                    <div style={css("flex:1")}>
                      <div style={css("font:500 13.5px 'Hanken Grotesk';color:#1A1B1A")}>{tl.title}</div>
                      <div style={css("margin-top:2px;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>{tl.when}</div>
                    </div>
                    <div style={css("font:400 14px 'Marcellus';color:#1A1B1A")}>{tl.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div onClick={reset} style={css("padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';cursor:pointer")}>Terminer</div>
          </div>
        </div>
      )}

      {lightbox !== null && (
        <Lightbox
          images={galleryImages}
          index={lightbox}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}

      {stripeSession && (
        <StripeCheckout
          publishableKey={stripeSession.pk}
          clientSecret={stripeSession.clientSecret}
          amountLabel={eur(deposit)}
          onPaid={() => flow.finishStripe(() => router.push("/espace"))}
          onClose={() => setStripeSession(null)}
        />
      )}
    </div>
  );
}
