"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BookingContext } from "@/lib/api";
import { mediaVariant } from "@/lib/api";
import { contractText } from "@/lib/contract";
import { balanceDueDate, money, monthYear } from "@/lib/i18n";
import { useI18n } from "@/components/I18nProvider";
import { LangSwitcher } from "@/components/LangSwitcher";
import { useBookingFlow } from "./useBookingFlow";
import { GuestPicker } from "./GuestPicker";
import { ACCENT, monthKey } from "./data";
import { css } from "./css";
import { Lightbox } from "./Lightbox";
import { ReadMore } from "./ReadMore";
import { RatingBadge, ReviewsSection } from "./Reviews";
import { StripeCheckout } from "./StripeCheckout";
import { SignaturePad } from "./SignaturePad";
import { AmenitiesSection } from "./Amenities";

type Screen = "booking" | "checkout" | "done";

export function DesktopFunnel({
  ctx,
  resumeToken,
}: {
  ctx: BookingContext;
  resumeToken?: string | null;
}) {
  const { property, season, weeks, products, media, reviews } = ctx;
  const { locale, t, href } = useI18n();
  const eur = (cents: number) => money(cents, locale);
  const dueDate = (startDate: string) => balanceDueDate(startDate, locale);
  // `width` = largeur d'affichage approximative → la variante redimensionnée
  // suffisante est servie au lieu de l'original pleine résolution (LCP).
  const photo = (i: number, seed: string, dims: string, width = 960) =>
    media[i] ? mediaVariant(media[i], width) : `https://picsum.photos/seed/${seed}/${dims}`;
  const galleryImages = media.length
    ? media.map((m) => ({
        url: mediaVariant(m, 1600),
        thumb: mediaVariant(m, 480),
        alt: m.alt,
      }))
    : ["adret-d1", "adret-d2", "adret-d3"].map((s) => ({
        url: `https://picsum.photos/seed/${s}/1600/1100`,
        alt: "",
      }));
  // Le compteur reflète la galerie réellement ouverte par le lightbox.
  const photoCount = galleryImages.length;

  const [screen, setScreen] = useState<Screen>("booking");
  // L'écran « done » sert aux deux issues : acompte payé en ligne (paid) ou
  // réservation retenue en attente d'un règlement hors ligne (offline).
  const [doneKind, setDoneKind] = useState<"paid" | "offline">("paid");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const router = useRouter();
  // L'étape « prestations » (upsell) n'existe que si le catalogue en propose.
  const hasExtrasStep = products.length > 0;
  const firstStep = hasExtrasStep ? "prestations" : "infos";
  const [checkoutStep, setCheckoutStep] = useState<
    "prestations" | "infos" | "contrat" | "paiement"
  >(firstStep);
  const checkoutSteps = hasExtrasStep
    ? (["prestations", "infos", "contrat", "paiement"] as const)
    : (["infos", "contrat", "paiement"] as const);
  const stepLabels: Record<(typeof checkoutSteps)[number], string> = {
    prestations: t.steps.extras,
    infos: t.steps.infos,
    contrat: t.steps.contract,
    paiement: t.steps.payment,
  };

  // Shared flow orchestration (cart/payment) — single source of truth with the
  // mobile funnel, see useBookingFlow.
  const flow = useBookingFlow(ctx, resumeToken);
  const {
    info, setField, adults, setAdults, children, setChildren, capacity,
    marketingConsent, setMarketingConsent,
    monthIdx, setMonthIdx, weekIdx, selectWeek, extras, toggleExtra, selectedExtras,
    accepted, setAccepted, sigEmpty, setSigEmpty, sigRef,
    reference, submitting, error, setError, stripeSession, setStripeSession,
    payMethod, week, months, totals, infoComplete,
  } = flow;
  void setError;

  const pct = property.depositPct;
  const name = property.name;
  const caution = property.cautionCents;

  // Reprise de panier : la sélection et les coordonnées sont restaurées par le
  // hook — on reprend le parcours directement à l'étape « Vos infos ».
  useEffect(() => {
    if (flow.resumed === "restored") {
      setScreen("checkout");
      setCheckoutStep("infos");
    }
  }, [flow.resumed]);

  if (!week || !property.onlineBookingEnabled) {
    const closed = !property.onlineBookingEnabled;
    return (
      <div style={css("min-height:100vh;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:40px")}>
        <div style={css("text-align:center;max-width:460px")}>
          <div style={css("font:400 34px 'Marcellus'")}>{name}</div>
          <div style={css(`margin-top:14px;font:500 11px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}`)}>{closed ? t.closed.onlineClosed : season ? season.name : t.closed.offSeason}</div>
          <p style={css("margin:16px 0 0;font:400 15px/1.7 'Hanken Grotesk';color:#6B6E6B")}>
            {closed ? t.closed.closedBody : t.closed.openingSoonBody}
          </p>
        </div>
      </div>
    );
  }

  const { total, deposit, balance, touristTax } = totals;
  const inputCss =
    "background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:14px;font-size:14.5px;color:#1A1B1A";
  const checkoutReady = infoComplete && accepted && !sigEmpty && !submitting;

  const goToContract = async () => {
    if (await flow.ensureCart()) setCheckoutStep("contrat");
  };
  const payNow = () => {
    if (!checkoutReady) return;
    flow.pay(() => router.push(href("/espace")));
  };
  const confirmOffline = () => {
    if (submitting) return;
    flow.reserveOffline(() => {
      setDoneKind("offline");
      setScreen("done");
    });
  };
  const reset = () => {
    setScreen("booking");
    setCheckoutStep(firstStep);
    setDoneKind("paid");
    flow.resetFlow();
  };

  // Moyens de règlement actifs, dans l'ordre d'affichage. Garde-fou : si aucun
  // n'est activé côté admin, on retombe sur la carte (flux historique).
  const payMethodOptions: { key: "card" | "virement" | "cheque"; title: string; sub: string }[] = [];
  if (property.payCardEnabled) payMethodOptions.push({ key: "card", title: t.checkout.payCard, sub: t.checkout.payCardSub });
  if (property.payVirementEnabled) payMethodOptions.push({ key: "virement", title: t.checkout.payVirement, sub: t.checkout.payOfflineSub });
  if (property.payChequeEnabled) payMethodOptions.push({ key: "cheque", title: t.checkout.payCheque, sub: t.checkout.payOfflineSub });
  if (payMethodOptions.length === 0) payMethodOptions.push({ key: "card", title: t.checkout.payCard, sub: t.checkout.payCardSub });
  const methodLabel = payMethod === "cheque" ? t.checkout.methodCheque : t.checkout.methodVirement;
  const offlineInstructions =
    (payMethod === "cheque" ? property.instructionsCheque : property.instructionsVirement)?.trim() ?? "";

  const timeline = [
    { title: t.done.timelineDepositPaid, when: t.done.timelineToday, amount: eur(deposit), accent: true },
    { title: t.done.timelineBalance, when: t.done.timelineBalanceOn(dueDate(week.startDate) || "—"), amount: eur(balance), accent: false },
    { title: t.done.timelineKeys, when: t.done.timelineKeysWhen(week.arrival || "—"), amount: "", accent: false },
    { title: t.done.timelineCaution, when: t.done.timelineCautionWhen, amount: eur(caution), accent: false },
  ];
  const offlineTimeline = [
    { title: t.done.timelineDepositDue, when: t.done.timelineNow(methodLabel), amount: eur(deposit), accent: true },
    { title: t.done.timelineConfirmation, when: t.done.timelineOnReceipt, amount: "", accent: false },
    { title: t.done.timelineBalance, when: t.done.timelineOn(dueDate(week.startDate) || "—"), amount: eur(balance), accent: false },
    { title: t.done.timelineKeys, when: t.done.timelineKeysWhen(week.arrival || "—"), amount: "", accent: false },
  ];

  return (
    <div style={css("min-height:100vh;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif")}>
      {/* NAV */}
      <div style={css("position:sticky;top:0;z-index:30;height:62px;background:rgba(245,244,241,.86);backdrop-filter:blur(10px);border-bottom:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-between;padding:0 40px")}>
        <div onClick={() => setScreen("booking")} style={css("font:400 24px 'Marcellus';letter-spacing:.02em;cursor:pointer")}>{name}</div>
        <div style={css("display:flex;align-items:center;gap:26px")}>
          <LangSwitcher />
          <div
            onClick={() => window.dispatchEvent(new Event("adret:open-chat"))}
            style={css("font:500 13px 'Hanken Grotesk';color:#5A5C58;cursor:pointer")}
          >
            {t.nav.contact}
          </div>
          <a href={href("/espace")} style={css("font:600 13px 'Hanken Grotesk';color:#1A1B1A;cursor:pointer;text-decoration:none")}>{t.nav.mySpace}</a>
        </div>
      </div>

      {/* ============== BOOKING ============== */}
      {screen === "booking" && (
        <div style={css("max-width:1180px;margin:0 auto;padding:26px 40px 80px")}>
          {flow.resumed === "unavailable" && (
            <div style={css("margin-bottom:18px;padding:14px 18px;background:#FBF3E4;border:1px solid #E8D5AC;border-radius:12px;font:400 14px/1.5 'Hanken Grotesk';color:#7A5B18")}>
              {t.booking.resumeUnavailable}
            </div>
          )}
          {/* gallery */}
          <div style={css("display:grid;grid-template-columns:2fr 1fr;gap:10px;height:380px;border-radius:18px;overflow:hidden")}>
            <div onClick={() => setLightbox(0)} style={css(`background:#E5E4DF url('${photo(0, "adret-d1", "900/760")}') center/cover;cursor:pointer`)} />
            <div style={css("display:grid;grid-template-rows:1fr 1fr;gap:10px")}>
              <div onClick={() => setLightbox(1)} style={css(`background:#E5E4DF url('${photo(1, "adret-d2", "500/380", 480)}') center/cover;cursor:pointer`)} />
              <div onClick={() => setLightbox(2)} style={css(`position:relative;background:#E5E4DF url('${photo(2, "adret-d3", "500/380", 480)}') center/cover;cursor:pointer`)}>
                <div onClick={(e) => { e.stopPropagation(); setLightbox(0); }} style={css("position:absolute;right:14px;bottom:14px;padding:8px 14px;background:rgba(255,255,255,.92);border-radius:9px;font:500 12px 'Hanken Grotesk';cursor:pointer")}>{t.booking.seePhotos(photoCount)}</div>
              </div>
            </div>
          </div>

          {/* title */}
          <div style={css("margin-top:28px;display:flex;align-items:flex-end;justify-content:space-between")}>
            <div>
              <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:#9A9C97")}>{property.locationLabel}</div>
              <h1 style={css("margin:8px 0 0;font:400 42px 'Marcellus';color:#1A1B1A")}>{name}</h1>
              <div style={css("margin-top:8px")}>
                <RatingBadge reviews={reviews} />
              </div>
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
                amenities={property.amenities ?? []}
                textStyle={css("margin:0;font:400 16px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}
              />

              <AmenitiesSection amenities={property.amenities ?? []} locale={locale} />

              <div style={css("height:1px;background:rgba(0,0,0,.09);margin:30px 0")} />

              <div style={css("display:flex;align-items:center;justify-content:space-between")}>
                <h2 style={css("margin:0;font:400 28px 'Marcellus'")}>{t.booking.chooseWeek}</h2>
                <div style={css("display:flex;align-items:center;gap:14px")}>
                  <div onClick={() => setMonthIdx((m) => Math.max(0, m - 1))} style={css(`width:34px;height:34px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;color:#1A1B1A;${monthIdx === 0 ? "opacity:.35;cursor:default;" : "cursor:pointer;"}`)}>‹</div>
                  <div style={css("font:400 17px 'Marcellus';min-width:150px;text-align:center")}>{monthYear(months[monthIdx], locale)}</div>
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
                            <div style={css(`margin-top:3px;font:400 12px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? t.booking.full : wk.sub}</div>
                          </div>
                          {sel && <div style={css(`flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;background:${ACCENT}`)}>✓</div>}
                        </div>
                        <div style={css("margin-top:16px;display:flex;align-items:baseline;gap:6px")}>
                          <span style={css("font:400 22px 'Marcellus';color:#1A1B1A")}>{wk.booked ? t.booking.booked : eur(wk.priceCents)}</span>
                          {!wk.booked && <span style={css("font:400 12px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.perWeek}</span>}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {reviews.length > 0 && (
                <>
                  <div style={css("height:1px;background:rgba(0,0,0,.09);margin:34px 0 28px")} />
                  <ReviewsSection reviews={reviews} />
                </>
              )}
            </div>

            {/* RIGHT sticky summary */}
            <div style={css("position:sticky;top:86px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.06)")}>
              <div style={css("display:flex;align-items:baseline;gap:7px")}>
                <span style={css("font:400 30px 'Marcellus'")}>{eur(week.priceCents)}</span>
                <span style={css("font:400 13px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.perWeek}</span>
              </div>
              <div style={css("position:relative;margin-top:16px")}>
                <div
                  onClick={() => setWeekPickerOpen((o) => !o)}
                  style={css(`display:flex;border:1px solid ${weekPickerOpen ? ACCENT : "rgba(0,0,0,.12)"};border-radius:11px;overflow:hidden;cursor:pointer;transition:border-color .15s`)}
                >
                  <div style={css("flex:1;padding:11px 14px;border-right:1px solid rgba(0,0,0,.1)")}>
                    <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.booking.arrival}</div>
                    <div style={css("margin-top:3px;font:500 13.5px 'Hanken Grotesk'")}>{week.arrShort}</div>
                  </div>
                  <div style={css("flex:1;padding:11px 14px;display:flex;align-items:center;justify-content:space-between")}>
                    <div>
                      <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.booking.departure}</div>
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
                              <div style={css(`margin-top:1px;font:400 11.5px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? t.booking.full : wk.sub}</div>
                            </div>
                            <div style={css("display:flex;align-items:center;gap:8px")}>
                              <span style={css("font:400 14px 'Marcellus';color:#1A1B1A")}>{wk.booked ? t.booking.booked : eur(wk.priceCents)}</span>
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
                  <span>{t.booking.rental7Nights}</span>
                  <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                </div>
                {selectedExtras.map((se) => (
                  <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>{se.label}</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? t.booking.free : eur(se.priceCents)}</span>
                  </div>
                ))}
                <div style={css("display:flex;justify-content:space-between;margin:14px 0;padding-top:14px;border-top:1px solid rgba(0,0,0,.09);font:500 16px 'Hanken Grotesk'")}>
                  <span>{t.booking.total}</span>
                  <span style={css("font-family:'Marcellus';font-size:20px")}>{eur(total)}</span>
                </div>
                <div style={css(`padding:14px;border-radius:11px;background:${ACCENT}14`)}>
                  <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk'")}>
                    <span>{t.booking.depositToday(pct)}</span>
                    <span style={css("font-family:'Marcellus'")}>{eur(deposit)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>{t.booking.balanceOn(dueDate(week.startDate))}</span>
                    <span>{eur(balance)}</span>
                  </div>
                </div>
              </div>

              {week.booked ? (
                <div style={css("margin-top:18px;padding:16px;background:#D8D7D2;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';cursor:default;opacity:.7")}>{t.booking.full}</div>
              ) : (
                <div onClick={() => { setScreen("checkout"); setCheckoutStep(firstStep); }} style={css("margin-top:18px;padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';cursor:pointer")}>{t.booking.continue}</div>
              )}
              <div style={css("margin-top:12px;text-align:center;font:400 11.5px/1.5 'Hanken Grotesk';color:#9A9C97")}>{t.booking.freeCancellation}</div>
              <div style={css("margin-top:16px;text-align:center;display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:center;font:400 11px 'Hanken Grotesk';color:#9A9C97")}>
                <a href={href("/mentions-legales")} style={css("color:#9A9C97")}>{t.footer.legalNotice}</a>
                <a href={href("/cgv")} style={css("color:#9A9C97")}>{t.footer.terms}</a>
                <a href={href("/confidentialite")} style={css("color:#9A9C97")}>{t.footer.privacy}</a>
                <a href={href("/cookies")} style={css("color:#9A9C97")}>{t.footer.cookies}</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============== CHECKOUT ============== */}
      {screen === "checkout" && (
        <div style={css("max-width:1100px;margin:0 auto;padding:30px 40px 80px")}>
          <div onClick={() => setScreen("booking")} style={css("display:inline-flex;align-items:center;gap:6px;font:500 13px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>‹ {t.nav.backToProperty}</div>
          <h1 style={css("margin:14px 0 30px;font:400 36px 'Marcellus'")}>{t.checkout.title}</h1>

          {/* stepper */}
          <div style={css("display:flex;gap:10px;margin-bottom:28px;max-width:640px")}>
            {checkoutSteps.map((key, i) => {
              const done = (checkoutSteps as readonly string[]).indexOf(checkoutStep) >= i;
              const label = stepLabels[key];
              return (
                <div key={key} style={css("flex:1")}>
                  <div style={css(`height:3px;border-radius:2px;background:${done ? ACCENT : "rgba(0,0,0,.1)"}`)} />
                  <div style={css(`margin-top:6px;font:500 11px 'Hanken Grotesk';letter-spacing:.02em;color:${done ? "#1A1B1A" : "#B6B5B0"}`)}>{label}</div>
                </div>
              );
            })}
          </div>

          {flow.resumed === "restored" && (
            <div style={css("margin:-10px 0 24px;padding:12px 16px;background:#EEF4EE;border:1px solid #CBDECB;border-radius:12px;font:400 13.5px/1.5 'Hanken Grotesk';color:#3C5A3C;max-width:640px")}>
              {t.booking.resumeRestored}
            </div>
          )}

          <div style={css("display:grid;grid-template-columns:1fr 380px;gap:52px;align-items:start")}>
            {/* LEFT: current step */}
            <div>
              {checkoutStep === "prestations" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>{t.checkout.extrasHeading}</div>
                  <p style={css("margin:12px 0 18px;font:400 15px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}>
                    {t.checkout.extrasIntro}
                  </p>
                  {products.map((x) => {
                    const on = extras[x.key];
                    return (
                      <div key={x.key} onClick={() => toggleExtra(x.key)} style={css(`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 20px;background:#FFF;border:1px solid ${on ? ACCENT : "rgba(0,0,0,.07)"};border-radius:14px;margin-bottom:12px;cursor:pointer;transition:border-color .15s`)}>
                        <div style={css("flex:1")}>
                          <div style={css("font:500 15.5px 'Hanken Grotesk';color:#1A1B1A")}>{x.label}</div>
                          <div style={css("margin-top:3px;font:400 12.5px 'Hanken Grotesk';color:#9A9C97")}>{x.description}</div>
                        </div>
                        <div style={css("font:400 16px 'Marcellus';color:#1A1B1A;white-space:nowrap")}>{x.priceCents === 0 ? t.booking.free : "+ " + eur(x.priceCents)}</div>
                        <div style={css(`flex:none;position:relative;width:48px;height:28px;border-radius:99px;transition:background .18s;background:${on ? ACCENT : "#D8D7D2"}`)}>
                          <div style={css(`position:absolute;top:3px;left:${on ? "23px" : "3px"};width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .18s`)} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={css("margin-top:6px;display:flex;align-items:center;justify-content:space-between;max-width:520px")}>
                    <div style={css("font:400 13px 'Hanken Grotesk';color:#9A9C97")}>
                      {selectedExtras.length === 0
                        ? t.checkout.extrasNone
                        : t.checkout.extrasCount(
                            selectedExtras.length,
                            totals.extrasTotal === 0 ? t.booking.free.toLowerCase() : "+ " + eur(totals.extrasTotal),
                          )}
                    </div>
                  </div>
                  <div style={css("margin-top:20px;display:flex;align-items:center;gap:12px")}>
                    <div onClick={() => setScreen("booking")} style={css("padding:15px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ {t.nav.back}</div>
                    <div onClick={() => setCheckoutStep("infos")} style={css("flex:1;max-width:280px;padding:15px;border-radius:13px;text-align:center;font:600 14px 'Hanken Grotesk';background:#1A1B1A;color:#fff;cursor:pointer")}>
                      {selectedExtras.length === 0 ? t.checkout.continueWithoutExtras : t.booking.continue}
                    </div>
                  </div>
                </>
              )}

              {checkoutStep === "infos" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>{t.checkout.infosHeading}</div>
                  <div style={css("margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
                    <input placeholder={t.checkout.firstName} value={info.firstName} onChange={setField("firstName")} style={css(inputCss)} />
                    <input placeholder={t.checkout.lastName} value={info.lastName} onChange={setField("lastName")} style={css(inputCss)} />
                    <input placeholder={t.checkout.email} type="email" value={info.email} onChange={setField("email")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder={t.checkout.phone} value={info.phone} onChange={setField("phone")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder={t.checkout.address} value={info.addressLine} onChange={setField("addressLine")} style={css("grid-column:1/3;" + inputCss)} />
                    <input placeholder={t.checkout.postalCode} value={info.postalCode} onChange={setField("postalCode")} style={css(inputCss)} />
                    <input placeholder={t.checkout.city} value={info.city} onChange={setField("city")} style={css(inputCss)} />
                    <div style={css("grid-column:1/3")}>
                      <GuestPicker adults={adults} children={children} capacity={capacity} setAdults={setAdults} setChildren={setChildren} />
                    </div>
                    <label style={css("grid-column:1/3;display:flex;align-items:flex-start;gap:10px;font:400 12px/1.45 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>
                      <input
                        type="checkbox"
                        checked={marketingConsent}
                        onChange={(e) => setMarketingConsent(e.target.checked)}
                        style={css("margin-top:2px;accent-color:#1A1B1A")}
                      />
                      <span>{t.checkout.marketingConsent}</span>
                    </label>
                  </div>
                  {error && <div style={css("margin-top:14px;max-width:280px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                  <div style={css("margin-top:24px;display:flex;align-items:center;gap:12px")}>
                    {hasExtrasStep && (
                      <div onClick={() => setCheckoutStep("prestations")} style={css("padding:15px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ {t.nav.back}</div>
                    )}
                    <div onClick={goToContract} style={css(`flex:1;max-width:280px;padding:15px;border-radius:13px;text-align:center;font:600 14px 'Hanken Grotesk';${infoComplete && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{submitting ? "…" : infoComplete ? t.booking.continue : t.checkout.completeInfos}</div>
                  </div>
                </>
              )}

              {checkoutStep === "contrat" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>{t.checkout.contractHeading}</div>
                  <div style={css("margin-top:12px;max-height:220px;overflow:auto;white-space:pre-line;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:13px;padding:18px;font:400 12.5px/1.7 'Hanken Grotesk';color:#6B6E6B")}>
                    {contractText({ propertyName: name, locationLabel: property.locationLabel, cautionCents: caution, capacity, ownerName: property.ownerName, ownerAddress: property.ownerAddress, template: property.contractTemplate }, locale)}
                  </div>
                  <div onClick={() => setAccepted((a) => !a)} style={css("margin-top:14px;display:flex;align-items:center;gap:11px;cursor:pointer")}>
                    <div style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:background .15s;${accepted ? `background:${ACCENT};border:1.5px solid ${ACCENT};` : "background:#FFF;border:1.5px solid rgba(0,0,0,.2);"}`)}>{accepted ? "✓" : ""}</div>
                    <div style={css("font:400 13px 'Hanken Grotesk';color:#5A5C58")}>{t.checkout.acceptContract}{" "}
                      <a href={href("/cgv")} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={css(`color:${ACCENT}`)}>{t.checkout.generalTerms}</a>.
                    </div>
                  </div>
                  <div style={css("margin-top:22px;display:flex;align-items:center;justify-content:space-between")}>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>{t.checkout.signatureHeading}</div>
                    <div onClick={() => sigRef.current?.clear()} style={css("font:500 12px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>{t.checkout.clear}</div>
                  </div>
                  <div style={css("margin-top:10px")}>
                    <SignaturePad ref={sigRef} width={476} height={150} placeholder={t.checkout.signHereMouse} onEmptyChange={setSigEmpty} />
                  </div>
                  {error && <div style={css("margin-top:14px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                  <div style={css("margin-top:22px;display:flex;align-items:center;gap:12px")}>
                    <div onClick={() => setCheckoutStep("infos")} style={css("padding:15px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ {t.nav.back}</div>
                    <div onClick={async () => { if (accepted && !sigEmpty && !submitting && (await flow.saveSignedContract())) setCheckoutStep("paiement"); }} style={css(`flex:1;max-width:280px;padding:15px;border-radius:13px;text-align:center;font:600 14px 'Hanken Grotesk';${accepted && !sigEmpty && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{submitting ? "…" : accepted && !sigEmpty ? t.booking.continue : t.checkout.acceptAndSign}</div>
                  </div>
                </>
              )}

              {checkoutStep === "paiement" && (
                <>
                  <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.06em;color:#9A9C97")}>{t.checkout.paymentHeading}</div>
                  {payMethodOptions.length > 1 && (
                    <div style={css("margin-top:14px;display:flex;flex-direction:column;gap:10px;max-width:520px")}>
                      {payMethodOptions.map((m) => {
                        const sel = payMethod === m.key;
                        return (
                          <div key={m.key} onClick={() => flow.setPayMethod(m.key)} style={css(`display:flex;align-items:center;gap:14px;padding:15px 18px;background:#FFF;border:${sel ? `1.5px solid ${ACCENT}` : "1px solid rgba(0,0,0,.08)"};border-radius:14px;cursor:pointer;transition:border-color .15s`)}>
                            <div style={css(`flex:none;width:20px;height:20px;border-radius:50%;background:#FFF;${sel ? `border:6px solid ${ACCENT};` : "border:1.5px solid rgba(0,0,0,.2);"}`)} />
                            <div>
                              <div style={css("font:500 14.5px 'Hanken Grotesk';color:#1A1B1A")}>{m.title}</div>
                              <div style={css(`margin-top:2px;font:400 12px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{m.sub}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {payMethod === "card" ? (
                    <>
                      <p style={css("margin:12px 0 0;font:400 15px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}>
                        {t.checkout.cardExplainPrefix}<b>{eur(deposit)}</b>{t.checkout.cardExplainRest(eur(balance), dueDate(week.startDate), eur(caution))}
                      </p>
                      <div style={css("margin-top:14px;display:flex;align-items:center;gap:8px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>
                        <span style={css("font-size:13px")}>🔒</span> {t.checkout.securePayment}
                      </div>
                      <div style={css("margin-top:24px;display:flex;align-items:center;gap:12px")}>
                        <div onClick={() => setCheckoutStep("contrat")} style={css("padding:16px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ {t.nav.back}</div>
                        <div onClick={payNow} style={css(`flex:1;max-width:320px;padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? t.checkout.paying : t.checkout.payDeposit(eur(deposit))}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={css("margin:12px 0 0;font:400 15px/1.7 'Hanken Grotesk';color:#5A5C58;max-width:60ch")}>
                        {t.checkout.youPayDeposit}<b>{eur(deposit)}</b>{t.checkout.offlineExplain(methodLabel)}
                      </p>
                      <div style={css("margin-top:16px;max-width:520px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:18px 20px")}>
                        <div style={css("font:500 10.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.checkout.paymentBy(methodLabel)}</div>
                        <div style={css("margin-top:8px;white-space:pre-line;font:400 13.5px/1.65 'Hanken Grotesk';color:#5A5C58")}>
                          {offlineInstructions || t.checkout.offlineInstructionsFallback}
                        </div>
                        <div style={css(`margin-top:12px;padding:10px 12px;border-radius:10px;background:${ACCENT}14;font:500 12.5px 'Hanken Grotesk';color:#3f4b45`)}>
                          {t.checkout.offlineReference}
                        </div>
                      </div>
                      <div style={css("margin-top:24px;display:flex;align-items:center;gap:12px")}>
                        <div onClick={() => setCheckoutStep("contrat")} style={css("padding:16px 22px;border-radius:13px;font:500 14px 'Hanken Grotesk';color:#6B6E6B;border:1px solid rgba(0,0,0,.14);cursor:pointer")}>‹ {t.nav.back}</div>
                        <div onClick={confirmOffline} style={css(`flex:1;max-width:320px;padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? t.checkout.saving : t.checkout.confirmBooking}</div>
                      </div>
                    </>
                  )}
                  {error && <div style={css("margin-top:10px;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
                </>
              )}
            </div>

            {/* RIGHT: recap */}
            <div style={css("position:sticky;top:86px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:18px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.06)")}>
              <div style={css("display:flex;gap:14px;align-items:center;padding-bottom:18px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                <div style={css(`width:64px;height:64px;border-radius:12px;background:#E5E4DF url('${photo(0, "adret-d2", "200/200", 480)}') center/cover;flex:none`)} />
                <div>
                  <div style={css("font:400 18px 'Marcellus'")}>{name}</div>
                  <div style={css("margin-top:2px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>{property.locationLabel}</div>
                </div>
              </div>
              <div style={css("padding:16px 0;border-bottom:1px solid rgba(0,0,0,.08)")}>
                <div style={css("font:500 9.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.booking.stay}</div>
                <div style={css("margin-top:4px;font:500 14.5px 'Hanken Grotesk'")}>{week.range} · {t.booking.nights7}</div>
                <div style={css("margin-top:1px;font:400 12px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.arrivalWord} {week.arrival}</div>
              </div>
              <div style={css("padding-top:16px")}>
                <div style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                  <span>{t.booking.rental7Nights}</span>
                  <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                </div>
                {selectedExtras.map((se) => (
                  <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:10px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>{se.label}</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? t.booking.free : eur(se.priceCents)}</span>
                  </div>
                ))}
                <div style={css("display:flex;justify-content:space-between;margin:14px 0 0;padding-top:14px;border-top:1px solid rgba(0,0,0,.09);font:500 16px 'Hanken Grotesk'")}>
                  <span>{t.booking.totalStay}</span>
                  <span style={css("font-family:'Marcellus';font-size:20px")}>{eur(total)}</span>
                </div>
                {touristTax > 0 && (
                  <div style={css("display:flex;justify-content:space-between;margin:3px 0 14px;font:400 11px 'Hanken Grotesk';color:#9A9C97")}>
                    <span>{property.touristTaxIncluded ? t.checkout.touristTaxIncluded : t.checkout.touristTaxAdded}</span>
                    <span>{eur(touristTax)}</span>
                  </div>
                )}
                {touristTax <= 0 && <div style={css("margin-bottom:14px")} />}
                <div style={css(`padding:14px;border-radius:11px;background:${ACCENT}14`)}>
                  <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk'")}>
                    <span>{t.checkout.toPayToday}</span>
                    <span style={css("font-family:'Marcellus';font-size:16px")}>{eur(deposit)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>{t.booking.balanceOn(dueDate(week.startDate))}</span>
                    <span>{eur(balance)}</span>
                  </div>
                  <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12px 'Hanken Grotesk';color:#6B6E6B")}>
                    <span>{t.checkout.cautionGuarantee}</span>
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
          <h1 style={css("margin:26px 0 0;font:400 38px 'Marcellus'")}>{doneKind === "offline" ? t.done.recordedTitle : t.done.confirmedTitle}</h1>
          {doneKind === "offline" ? (
            <p style={css("margin:14px auto 0;max-width:420px;font:400 15px/1.65 'Hanken Grotesk';color:#6B6E6B")}>{t.done.offlineBodyPrefix}<b>{eur(deposit)}</b>{t.done.offlineBodySuffix(methodLabel)}</p>
          ) : (
            <p style={css("margin:14px auto 0;max-width:400px;font:400 15px/1.65 'Hanken Grotesk';color:#6B6E6B")}>{t.done.confirmedBody(name)}</p>
          )}
          {doneKind === "paid" && reference && <div style={css("margin-top:10px;font:500 12px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.done.reference} {reference}</div>}
          {doneKind === "offline" && (
            <div style={css("margin-top:26px;text-align:left;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:20px 22px")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                <div style={css("font:500 10.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.done.bookingReference}</div>
                <div style={css("font:400 21px 'Marcellus';color:#1A1B1A")}>{reference ?? "—"}</div>
              </div>
              <div style={css("margin-top:14px;font:500 10.5px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.checkout.paymentBy(methodLabel)}</div>
              <div style={css("margin-top:8px;white-space:pre-line;font:400 13.5px/1.65 'Hanken Grotesk';color:#5A5C58")}>
                {offlineInstructions || t.checkout.offlineInstructionsFallback}
              </div>
              <div style={css(`margin-top:12px;padding:10px 12px;border-radius:10px;background:${ACCENT}14;font:500 12.5px 'Hanken Grotesk';color:#3f4b45`)}>
                {t.checkout.offlineReference}
              </div>
            </div>
          )}
          <div style={css("margin-top:32px;text-align:left;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:16px;padding:8px 22px")}>
            {(doneKind === "offline" ? offlineTimeline : timeline).map((tl, i) => (
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
          <div onClick={reset} style={css("margin-top:26px;display:inline-block;padding:15px 34px;background:#1A1B1A;color:#fff;border-radius:13px;font:600 14px 'Hanken Grotesk';cursor:pointer")}>{t.done.backHome}</div>
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
          onPaid={() => flow.finishStripe(() => router.push(href("/espace")))}
          onClose={() => setStripeSession(null)}
        />
      )}
    </div>
  );
}
