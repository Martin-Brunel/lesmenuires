"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BookingContext } from "@/lib/api";
import { mediaUrl } from "@/lib/api";
import { useBookingFlow } from "./useBookingFlow";
import { GuestPicker } from "./GuestPicker";
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
import { StripeCheckout } from "./StripeCheckout";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

type Screen = "booking" | "checkout" | "done";

export function DesktopFunnel({ ctx }: { ctx: BookingContext }) {
  const { property, season, weeks, products, media } = ctx;
  const photo = (i: number, seed: string, dims: string) =>
    media[i] ? mediaUrl(media[i].url) : `https://picsum.photos/seed/${seed}/${dims}`;
  const photoCount = media.length || 24;
  const galleryImages = media.length
    ? media.map((m) => ({ url: mediaUrl(m.url), alt: m.alt }))
    : ["adret-d1", "adret-d2", "adret-d3"].map((s) => ({
        url: `https://picsum.photos/seed/${s}/1600/1100`,
        alt: "",
      }));

  const [screen, setScreen] = useState<Screen>("booking");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const router = useRouter();
  const [checkoutStep, setCheckoutStep] = useState<"infos" | "contrat" | "paiement">("infos");

  // Shared flow orchestration (cart/payment) — single source of truth with the
  // mobile funnel, see useBookingFlow.
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
      <div style={css("min-height:100vh;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:40px")}>
        <div style={css("text-align:center;max-width:460px")}>
          <div style={css("font:400 34px 'Marcellus'")}>{name}</div>
          <div style={css(`margin-top:14px;font:500 11px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}`)}>{season ? season.name : "Hors saison"}</div>
          <p style={css("margin:16px 0 0;font:400 15px/1.7 'Hanken Grotesk';color:#6B6E6B")}>Le calendrier de réservation ouvrira prochainement. Revenez bientôt pour réserver votre semaine.</p>
        </div>
      </div>
    );
  }

  const { total, deposit, balance } = totals;
  const inputCss =
    "background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:14px;font-size:14.5px;color:#1A1B1A";
  const checkoutReady = infoComplete && accepted && !sigEmpty && !submitting;

  const goToContract = async () => {
    if (await flow.ensureCart()) setCheckoutStep("contrat");
  };
  const payNow = () => {
    if (!checkoutReady) return;
    flow.pay(() => router.push("/espace"));
  };
  const reset = () => {
    setScreen("booking");
    setCheckoutStep("infos");
    flow.resetFlow();
  };

  const timeline = [
    { title: "Acompte versé", when: "Aujourd'hui · payé", amount: eur(deposit), accent: true },
    { title: "Solde du séjour", when: "Prélevé le " + (balanceDueLabel(week.startDate) || "—"), amount: eur(balance), accent: false },
    { title: "Remise des clés", when: "Arrivée " + (week.arrival || "—") + " · 16h", amount: "", accent: false },
    { title: "Caution libérée", when: "Après état des lieux de sortie", amount: eur(caution), accent: false },
  ];

  return (
    <div style={css("min-height:100vh;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif")}>
      {/* NAV */}
      <div style={css("position:sticky;top:0;z-index:30;height:62px;background:rgba(245,244,241,.86);backdrop-filter:blur(10px);border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;padding:0 40px")}>
        <div onClick={() => setScreen("booking")} style={css("font:400 24px 'Marcellus';letter-spacing:.02em;cursor:pointer")}>{name}</div>
        <div style={css("display:flex;align-items:center;gap:26px")}>
          <div style={css("display:flex;align-items:center;gap:3px;font:500 12px 'Hanken Grotesk'")}>
            <span style={css("padding:5px 9px;border-radius:7px;background:#1A1B1A;color:#fff")}>FR</span>
            <span style={css("padding:5px 9px;color:#9A9C97")}>EN</span>
          </div>
          <div style={css("font:500 13px 'Hanken Grotesk';color:#5A5C58;cursor:pointer")}>Nous contacter</div>
          <a href="/espace" style={css("font:600 13px 'Hanken Grotesk';color:#1A1B1A;cursor:pointer;text-decoration:none")}>Mon espace</a>
        </div>
      </div>

      {/* ============== BOOKING ============== */}
      {screen === "booking" && (
        <div style={css("max-width:1180px;margin:0 auto;padding:26px 40px 80px")}>
          {/* gallery */}
          <div style={css("display:grid;grid-template-columns:2fr 1fr;gap:10px;height:380px;border-radius:18px;overflow:hidden")}>
            <div onClick={() => setLightbox(0)} style={css(`background:#E5E4DF url('${photo(0, "adret-d1", "900/760")}') center/cover;cursor:pointer`)} />
            <div style={css("display:grid;grid-template-rows:1fr 1fr;gap:10px")}>
              <div onClick={() => setLightbox(1)} style={css(`background:#E5E4DF url('${photo(1, "adret-d2", "500/380")}') center/cover;cursor:pointer`)} />
              <div onClick={() => setLightbox(2)} style={css(`position:relative;background:#E5E4DF url('${photo(2, "adret-d3", "500/380")}') center/cover;cursor:pointer`)}>
                <div onClick={(e) => { e.stopPropagation(); setLightbox(0); }} style={css("position:absolute;right:14px;bottom:14px;padding:8px 14px;background:rgba(255,255,255,.92);border-radius:9px;font:500 12px 'Hanken Grotesk';cursor:pointer")}>Voir les {photoCount} photos</div>
              </div>
            </div>
          </div>

          {/* title */}
          <div style={css("margin-top:28px;display:flex;align-items:flex-end;justify-content:space-between")}>
            <div>
              <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:#9A9C97")}>{property.locationLabel}</div>
              <h1 style={css("margin:8px 0 0;font:400 42px 'Marcellus';color:#1A1B1A")}>{name}</h1>
            </div>
            <div style={css("font:400 15px 'Hanken Grotesk';color:#5A5C58")}>{property.specsLabel}</div>
          </div>

          {/* two columns */}
          <div style={css("display:grid;grid-template-columns:1fr 380px;gap:52px;align-items:start;margin-top:34px")}>
            {/* LEFT */}
            <div>
              <ReadMore
                content={property.description}
                lines={5}
                textStyle={css("margin:0;font:400 16px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}
              />

              <div style={css("height:1px;background:rgba(0,0,0,.09);margin:30px 0")} />

              <div style={css("display:flex;align-items:center;justify-content:space-between")}>
                <h2 style={css("margin:0;font:400 28px 'Marcellus'")}>Choisir votre semaine</h2>
                <div style={css("display:flex;align-items:center;gap:14px")}>
                  <div onClick={() => setMonthIdx((m) => Math.max(0, m - 1))} style={css(`width:34px;height:34px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;color:#1A1B1A;${monthIdx === 0 ? "opacity:.35;cursor:default;" : "cursor:pointer;"}`)}>‹</div>
                  <div style={css("font:400 17px 'Marcellus';min-width:150px;text-align:center")}>{frMonthYear(months[monthIdx])}</div>
                  <div onClick={() => setMonthIdx((m) => Math.min(months.length - 1, m + 1))} style={css(`width:34px;height:34px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;color:#1A1B1A;${monthIdx >= months.length - 1 ? "opacity:.35;cursor:default;" : "cursor:pointer;"}`)}>›</div>
                </div>
              </div>

              <div style={css("margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px")}>
                {weeks
                  .map((wk, i) => ({ wk, i }))
                  .filter(({ wk }) => monthKey(wk.startDate) === months[monthIdx])
                  .map(({ wk, i }) => {
                    const sel = i === weekIdx;
                    const base = "padding:18px;border-radius:15px;transition:box-shadow .15s,border-color .15s;";
                    const cardStyle = wk.booked
                      ? base + "background:#EFEEEB;border:1px solid rgba(0,0,0,.05);opacity:.5;cursor:default;"
                      : sel
                        ? base + `background:#FFF;border:1.5px solid ${ACCENT};box-shadow:0 10px 26px ${ACCENT}22;cursor:pointer;`
                        : base + "background:#FFF;border:1px solid rgba(0,0,0,.08);cursor:pointer;";
                    return (
                      <div key={wk.id} onClick={() => selectWeek(i)} style={css(cardStyle)}>
                        <div style={css("display:flex;align-items:flex-start;justify-content:space-between")}>
                          <div>
                            <div style={css("font:500 16px 'Hanken Grotesk';color:#1A1B1A")}>{wk.range}</div>
                            <div style={css(`margin-top:3px;font:400 12px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? "Complet" : wk.sub}</div>
                          </div>
                          {sel && <div style={css(`flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;background:${ACCENT}`)}>✓</div>}
                        </div>
                        <div style={css("margin-top:16px;display:flex;align-items:baseline;gap:6px")}>
                          <span style={css("font:400 22px 'Marcellus';color:#1A1B1A")}>{wk.booked ? "Réservé" : eur(wk.priceCents)}</span>
                          {!wk.booked && <span style={css("font:400 12px 'Hanken Grotesk';color:#9A9C97")}>/ semaine</span>}
                        </div>
                      </div>
                    );
                  })}
              </div>

              <div style={css("height:1px;background:rgba(0,0,0,.09);margin:34px 0 28px")} />

              <h2 style={css("margin:0 0 6px;font:400 28px 'Marcellus'")}>Prestations</h2>
              <p style={css("margin:0 0 18px;font:400 14px 'Hanken Grotesk';color:#9A9C97")}>Ajoutez ce qu&apos;il faut pour arriver les mains dans les poches.</p>
              {products.map((x) => {
                const on = extras[x.key];
                return (
                  <div key={x.key} onClick={() => toggleExtra(x.key)} style={css("display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 20px;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;margin-bottom:12px;cursor:pointer")}>
                    <div style={css("flex:1")}>
                      <div style={css("font:500 15.5px 'Hanken Grotesk';color:#1A1B1A")}>{x.label}</div>
                      <div style={css("margin-top:3px;font:400 12.5px 'Hanken Grotesk';color:#9A9C97")}>{x.description}</div>
                    </div>
                    <div style={css("font:400 16px 'Marcellus';color:#1A1B1A;white-space:nowrap")}>{x.priceCents === 0 ? "Offert" : "+ " + eur(x.priceCents)}</div>
                    <div style={css(`flex:none;position:relative;width:48px;height:28px;border-radius:99px;transition:background .18s;background:${on ? ACCENT : "#D8D7D2"}`)}>
                      <div style={css(`position:absolute;top:3px;left:${on ? "23px" : "3px"};width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .18s`)} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* RIGHT sticky summary */}
            <div style={css("position:sticky;top:86px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.06)")}>
              <div style={css("display:flex;align-items:baseline;gap:7px")}>
                <span style={css("font:400 30px 'Marcellus'")}>{eur(week.priceCents)}</span>
                <span style={css("font:400 13px 'Hanken Grotesk';color:#9A9C97")}>/ semaine</span>
              </div>
              <div style={css("position:relative;margin-top:16px")}>
                <div
                  onClick={() => setWeekPickerOpen((o) => !o)}
                  style={css(`display:flex;border:1px solid ${weekPickerOpen ? ACCENT : "rgba(0,0,0,.12)"};border-radius:11px;overflow:hidden;cursor:pointer;transition:border-color .15s`)}
                >
                  <div style={css("flex:1;padding:11px 14px;border-right:1px solid rgba(0,0,0,.1)")}>
                    <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>ARRIVÉE</div>
                    <div style={css("margin-top:3px;font:500 13.5px 'Hanken Grotesk'")}>{week.arrShort}</div>
                  </div>
                  <div style={css("flex:1;padding:11px 14px;display:flex;align-items:center;justify-content:space-between")}>
                    <div>
                      <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>DÉPART</div>
                      <div style={css("margin-top:3px;font:500 13.5px 'Hanken Grotesk'")}>{week.depShort}</div>
                    </div>
                    <div style={css(`font-size:10px;color:#9A9C97;transition:transform .15s;transform:rotate(${weekPickerOpen ? "180deg" : "0deg"})`)}>▼</div>
                  </div>
                </div>

                {weekPickerOpen && (
                  <>
                    <div onClick={() => setWeekPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div style={css("position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:41;background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:13px;box-shadow:0 16px 40px rgba(0,0,0,.14);padding:6px;max-height:340px;overflow:auto")}>
                      {weeks.map((wk, i) => {
                        const sel = i === weekIdx;
                        return (
                          <div
                            key={wk.id}
                            onClick={() => {
                              if (wk.booked) return;
                              selectWeek(i);
                              setMonthIdx(Math.max(0, months.indexOf(monthKey(wk.startDate))));
                              setWeekPickerOpen(false);
                            }}
                            style={css(`display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:9px;${wk.booked ? "opacity:.45;cursor:default;" : "cursor:pointer;"}${sel ? `background:${ACCENT}14;` : ""}`)}
                          >
                            <div>
                              <div style={css("font:500 13.5px 'Hanken Grotesk';color:#1A1B1A")}>{wk.range}</div>
                              <div style={css(`margin-top:1px;font:400 11.5px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? "Complet" : wk.sub}</div>
                            </div>
                            <div style={css("display:flex;align-items:center;gap:8px")}>
                              <span style={css("font:400 14px 'Marcellus';color:#1A1B1A")}>{wk.booked ? "Réservé" : eur(wk.priceCents)}</span>
                              {sel && <span style={css(`color:${ACCENT};font-size:13px`)}>✓</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div style={css("margin-top:18px")}>
                <div style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                  <span>Location · 7 nuits</span>
                  <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                </div>
                {selectedExtras.map((se) => (
                  <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>{se.label}</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? "Offert" : eur(se.priceCents)}</span>
                  </div>
                ))}
                <div style={css("display:flex;justify-content:space-between;margin:14px 0;padding-top:14px;border-top:1px solid rgba(0,0,0,.09);font:500 16px 'Hanken Grotesk'")}>
                  <span>Total</span>
                  <span style={css("font-family:'Marcellus';font-size:20px")}>{eur(total)}</span>
                </div>
                <div style={css(`padding:14px;border-radius:11px;background:${ACCENT}14`)}>
                  <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk'")}>
                    <span>Acompte {pct}% aujourd&apos;hui</span>
                    <span style={css("font-family:'Marcellus'")}>{eur(deposit)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>Solde le {balanceDueLabel(week.startDate)}</span>
                    <span>{eur(balance)}</span>
                  </div>
                </div>
              </div>

              <div onClick={() => { setScreen("checkout"); setCheckoutStep("infos"); }} style={css("margin-top:18px;padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';cursor:pointer")}>Continuer</div>
              <div style={css("margin-top:12px;text-align:center;font:400 11.5px/1.5 'Hanken Grotesk';color:#9A9C97")}>Annulation gratuite jusqu&apos;à 30 jours avant l&apos;arrivée · Vous ne payez que l&apos;acompte aujourd&apos;hui.</div>
              <div style={css("margin-top:16px;text-align:center;display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center;font:400 11px 'Hanken Grotesk';color:#9A9C97")}>
                <a href="/mentions-legales" style={css("color:#9A9C97")}>Mentions légales</a>
                <a href="/cgv" style={css("color:#9A9C97")}>Conditions de location</a>
                <a href="/confidentialite" style={css("color:#9A9C97")}>Confidentialité</a>
                <a href="/cookies" style={css("color:#9A9C97")}>Cookies</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============== CHECKOUT ============== */}
      {screen === "checkout" && (
        <div style={css("max-width:1100px;margin:0 auto;padding:30px 40px 80px")}>
          <div onClick={() => setScreen("booking")} style={css("display:inline-flex;align-items:center;gap:6px;font:500 13px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>‹ Retour au logement</div>
          <h1 style={css("margin:14px 0 30px;font:400 36px 'Marcellus'")}>Finaliser votre réservation</h1>

          {/* stepper */}
          <div style={css("display:flex;gap:10px;margin-bottom:28px;max-width:520px")}>
            {(["infos", "contrat", "paiement"] as const).map((key, i) => {
              const done = ["infos", "contrat", "paiement"].indexOf(checkoutStep) >= i;
              const label = key === "infos" ? "Vos infos" : key === "contrat" ? "Contrat" : "Paiement";
              return (
                <div key={key} style={css("flex:1")}>
                  <div style={css(`height:3px;border-radius:2px;background:${done ? ACCENT : "rgba(0,0,0,.1)"}`)} />
                  <div style={css(`margin-top:6px;font:500 11px 'Hanken Grotesk';letter-spacing:.02em;color:${done ? "#1A1B1A" : "#B6B5B0"}`)}>{label}</div>
                </div>
              );
            })}
          </div>

          <div style={css("display:grid;grid-template-columns:1fr 380px;gap:52px;align-items:start")}>
            {/* LEFT: current step */}
            <div>
              {checkoutStep === "infos" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>VOS COORDONNÉES</div>
                  <div style={css("margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
                    <input placeholder="Prénom" value={info.firstName} onChange={setField("firstName")} style={css(inputCss)} />
                    <input placeholder="Nom" value={info.lastName} onChange={setField("lastName")} style={css(inputCss)} />
                    <input placeholder="E-mail" type="email" value={info.email} onChange={setField("email")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder="Téléphone" value={info.phone} onChange={setField("phone")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder="Adresse" value={info.addressLine} onChange={setField("addressLine")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder="Code postal" value={info.postalCode} onChange={setField("postalCode")} style={css(inputCss)} />
                    <input placeholder="Ville" value={info.city} onChange={setField("city")} style={css(inputCss)} />
                    <div style={css("grid-column:1/3")}>
                      <GuestPicker adults={adults} children={children} capacity={capacity} setAdults={setAdults} setChildren={setChildren} />
                    </div>
                  </div>
                  {error && <div style={css("margin-top:14px;max-width:280px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                  <div onClick={goToContract} style={css(`margin-top:24px;max-width:280px;padding:15px;border-radius:13px;text-align:center;font:600 14px 'Hanken Grotesk';${infoComplete && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{submitting ? "…" : infoComplete ? "Continuer" : "Complétez vos informations"}</div>
                </>
              )}

              {checkoutStep === "contrat" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>CONTRAT DE LOCATION SAISONNIÈRE</div>
                  <div style={css("margin-top:12px;max-height:220px;overflow:auto;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:13px;padding:18px;font:400 12.5px/1.7 'Hanken Grotesk';color:#6B6E6B")}>
                    Entre le propriétaire de {name}, ci-après « le Bailleur », et le signataire, ci-après « le Preneur ». Le présent contrat a pour objet la location meublée à usage saisonnier situé à {property.locationLabel}, pour la période indiquée dans le récapitulatif ci-contre.
                    <br />
                    <br />
                    Le Preneur s&apos;engage à occuper les lieux paisiblement et à restituer le logement en bon état. L&apos;acompte versé à la signature vaut réservation ferme. Le solde est prélevé deux semaines avant l&apos;arrivée. Une empreinte de caution est réalisée à titre de garantie et libérée après l&apos;état des lieux de sortie. Toute annulation est régie par les conditions générales annexées au présent contrat.
                  </div>
                  <div onClick={() => setAccepted((a) => !a)} style={css("margin-top:14px;display:flex;align-items:center;gap:11px;cursor:pointer")}>
                    <div style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:background .15s;${accepted ? `background:${ACCENT};border:1.5px solid ${ACCENT};` : "background:#FFF;border:1.5px solid rgba(0,0,0,.2);"}`)}>{accepted ? "✓" : ""}</div>
                    <div style={css("font:400 13px 'Hanken Grotesk';color:#5A5C58")}>Je reconnais avoir lu et j&apos;accepte le contrat et les{" "}
                      <a href="/cgv" target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={css(`color:${ACCENT}`)}>conditions générales</a>.
                    </div>
                  </div>
                  <div style={css("margin-top:22px;display:flex;align-items:center;justify-content:space-between")}>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>SIGNATURE ÉLECTRONIQUE</div>
                    <div onClick={() => sigRef.current?.clear()} style={css("font:500 12px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>Effacer</div>
                  </div>
                  <div style={css("margin-top:10px")}>
                    <SignaturePad ref={sigRef} width={476} height={150} placeholder="Signez ici à la souris" onEmptyChange={setSigEmpty} />
                  </div>
                  {error && <div style={css("margin-top:14px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                  <div style={css("margin-top:22px;display:flex;align-items:center;gap:12px")}>
                    <div onClick={() => setCheckoutStep("infos")} style={css("padding:15px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ Retour</div>
                    <div onClick={async () => { if (accepted && !sigEmpty && !submitting && (await flow.saveSignedContract())) setCheckoutStep("paiement"); }} style={css(`flex:1;max-width:280px;padding:15px;border-radius:13px;text-align:center;font:600 14px 'Hanken Grotesk';${accepted && !sigEmpty && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{submitting ? "…" : accepted && !sigEmpty ? "Continuer" : "Acceptez et signez"}</div>
                  </div>
                </>
              )}

              {checkoutStep === "paiement" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>PAIEMENT DE L&apos;ACOMPTE</div>
                  <p style={css("margin:12px 0 0;font:400 15px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}>
                    Vous réglez aujourd&apos;hui l&apos;acompte de <b>{eur(deposit)}</b>. Le solde de {eur(balance)} sera prélevé automatiquement le {balanceDueLabel(week.startDate)}, et une empreinte de caution de {eur(caution)} (non débitée) sera réalisée avant votre arrivée.
                  </p>
                  <div style={css("margin-top:14px;display:flex;align-items:center;gap:8px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>
                    <span style={css("font-size:13px")}>🔒</span> Paiement sécurisé · Stripe — vos informations bancaires ne transitent jamais par nos serveurs.
                  </div>
                  <div style={css("margin-top:24px;display:flex;align-items:center;gap:12px")}>
                    <div onClick={() => setCheckoutStep("contrat")} style={css("padding:16px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ Retour</div>
                    <div onClick={payNow} style={css(`flex:1;max-width:320px;padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? "Paiement en cours…" : "Payer l’acompte de " + eur(deposit)}</div>
                  </div>
                  {error && <div style={css("margin-top:10px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                </>
              )}
            </div>

            {/* RIGHT: recap */}
            <div style={css("position:sticky;top:86px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.06)")}>
              <div style={css("display:flex;gap:14px;align-items:center;padding-bottom:18px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                <div style={css(`width:64px;height:64px;border-radius:12px;background:#E5E4DF url('${photo(0, "adret-d2", "200/200")}') center/cover;flex:none`)} />
                <div>
                  <div style={css("font:400 18px 'Marcellus'")}>{name}</div>
                  <div style={css("margin-top:2px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>{property.locationLabel}</div>
                </div>
              </div>
              <div style={css("padding:16px 0;border-bottom:1px solid rgba(0,0,0,.08)")}>
                <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>SÉJOUR</div>
                <div style={css("margin-top:4px;font:500 14.5px 'Hanken Grotesk'")}>{week.range} · 7 nuits</div>
                <div style={css("margin-top:1px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>Arrivée {week.arrival}</div>
              </div>
              <div style={css("padding-top:16px")}>
                <div style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                  <span>Location · 7 nuits</span>
                  <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                </div>
                {selectedExtras.map((se) => (
                  <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>{se.label}</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? "Offert" : eur(se.priceCents)}</span>
                  </div>
                ))}
                <div style={css("display:flex;justify-content:space-between;margin:14px 0;padding-top:14px;border-top:1px solid rgba(0,0,0,.09);font:500 16px 'Hanken Grotesk'")}>
                  <span>Total séjour</span>
                  <span style={css("font-family:'Marcellus';font-size:20px")}>{eur(total)}</span>
                </div>
                <div style={css(`padding:14px;border-radius:11px;background:${ACCENT}14`)}>
                  <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk'")}>
                    <span>À payer aujourd&apos;hui</span>
                    <span style={css("font-family:'Marcellus';font-size:16px")}>{eur(deposit)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>Solde le {balanceDueLabel(week.startDate)}</span>
                    <span>{eur(balance)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>Caution (empreinte)</span>
                    <span>{eur(caution)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============== DONE ============== */}
      {screen === "done" && (
        <div style={css("max-width:560px;margin:0 auto;padding:70px 40px 80px;text-align:center")}>
          <div style={css(`width:84px;height:84px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;background:${ACCENT};box-shadow:0 14px 36px ${ACCENT}40`)}>✓</div>
          <h1 style={css("margin:26px 0 0;font:400 38px 'Marcellus'")}>Réservation confirmée</h1>
          <p style={css("margin:14px auto 0;max-width:400px;font:400 15px/1.65 'Hanken Grotesk';color:#6B6E6B")}>Un e-mail d&apos;accueil avec les codes d&apos;accès, l&apos;itinéraire et vos contacts sur place vient de vous être envoyé. À très vite à {name}.</p>
          {reference && <div style={css("margin-top:10px;font:500 12px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>RÉFÉRENCE {reference}</div>}
          <div style={css("margin-top:32px;text-align:left;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:16px;padding:8px 22px")}>
            {timeline.map((tl, i) => (
              <div key={i} style={css("display:flex;gap:14px;align-items:flex-start;padding:16px 0;border-bottom:1px solid rgba(0,0,0,.07)")}>
                <div style={css(`flex:none;width:9px;height:9px;border-radius:50%;margin-top:6px;background:${tl.accent ? ACCENT : "#CFCEC9"}`)} />
                <div style={css("flex:1")}>
                  <div style={css("font:500 14.5px 'Hanken Grotesk';color:#1A1B1A")}>{tl.title}</div>
                  <div style={css("margin-top:2px;font:400 12.5px 'Hanken Grotesk';color:#9A9C97")}>{tl.when}</div>
                </div>
                <div style={css("font:400 16px 'Marcellus';color:#1A1B1A")}>{tl.amount}</div>
              </div>
            ))}
          </div>
          <div onClick={reset} style={css("margin-top:26px;display:inline-block;padding:15px 34px;background:#1A1B1A;color:#fff;border-radius:13px;font:600 14px 'Hanken Grotesk';cursor:pointer")}>Retour à l&apos;accueil</div>
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
