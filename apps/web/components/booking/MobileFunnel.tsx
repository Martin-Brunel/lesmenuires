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
import { ACCENT, monthKey } from "./data";
import { css } from "./css";
import { Lightbox } from "./Lightbox";
import { ReadMore } from "./ReadMore";
import { RatingBadge, ReviewsSection } from "./Reviews";
import { SignaturePad } from "./SignaturePad";
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

export function MobileFunnel({
  ctx,
  resumeRef,
}: {
  ctx: BookingContext;
  resumeRef?: string | null;
}) {
  const { property, season, weeks, products, media, reviews } = ctx;
  const { locale, t, href } = useI18n();
  const eur = (cents: number) => money(cents, locale);
  const dueDate = (startDate: string) => balanceDueDate(startDate, locale);
  const stepLabels = [t.steps.week, t.steps.options, t.steps.infosShort, t.steps.contract, t.steps.payment];
  // Variantes redimensionnées : héro ≈ largeur écran (960 couvre les mobiles
  // haute densité), plein écran 1600, vignettes 480.
  const heroImg = media[0]
    ? mediaVariant(media[0], 960)
    : "https://picsum.photos/seed/adret-chalet-a/820/640";
  const galleryImages = media.length
    ? media.map((m) => ({
        url: mediaVariant(m, 1600),
        thumb: mediaVariant(m, 480),
        alt: m.alt,
      }))
    : [{ url: "https://picsum.photos/seed/adret-chalet-a/1200/1600", alt: "" }];

  const [screen, setScreen] = useState<Screen>("home");
  // L'écran « done » sert aux deux issues : acompte payé en ligne (paid) ou
  // réservation retenue en attente d'un règlement hors ligne (offline).
  const [doneKind, setDoneKind] = useState<"paid" | "offline">("paid");
  const router = useRouter();
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Shared flow orchestration (cart/payment) — single source of truth with the
  // desktop funnel, see useBookingFlow.
  const flow = useBookingFlow(ctx, resumeRef);
  const {
    info, setField, adults, setAdults, children, setChildren, capacity,
    monthIdx, setMonthIdx, weekIdx, selectWeek, extras, toggleExtra, selectedExtras,
    accepted, setAccepted, sigEmpty, setSigEmpty, sigRef,
    reference, submitting, error, setError, stripeSession, setStripeSession,
    payMethod, week, months, totals, infoComplete,
  } = flow;
  void setError;

  const pct = property.depositPct;
  const name = property.name;
  const location = property.locationLabel;
  const caution = property.cautionCents;

  // Reprise de panier : sélection/coordonnées restaurées par le hook — on
  // reprend le parcours à l'étape « Infos » (stepper complet en amont).
  useEffect(() => {
    if (flow.resumed === "restored") setScreen("infos");
  }, [flow.resumed]);
  const partyLabel = t.guests.partyLabel(adults, children);

  if (!week || !property.onlineBookingEnabled) {
    const closed = !property.onlineBookingEnabled;
    return (
      <div style={css("height:100dvh;max-width:480px;margin:0 auto;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:32px")}>
        <div style={css("text-align:center")}>
          <div style={css("font:400 30px 'Marcellus'")}>{name}</div>
          <div style={css(`margin-top:12px;font:500 10.5px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:${ACCENT}`)}>{closed ? t.closed.onlineClosed : season ? season.name : t.closed.offSeason}</div>
          <p style={css("margin:14px 0 0;font:400 14px/1.65 'Hanken Grotesk';color:#6B6E6B")}>
            {closed ? t.closed.closedBodyShort : t.closed.openingSoonBodyShort}
          </p>
        </div>
      </div>
    );
  }

  const { total, deposit, balance, touristTax } = totals;
  const fromPrice = Math.min(...weeks.map((w) => w.priceCents));
  const inputCss =
    "width:100%;background:#FFF;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:14px;font-size:15px;color:#1A1B1A";
  const contractReady = accepted && !sigEmpty;

  const goPayment = async () => {
    if (contractReady && (await flow.saveSignedContract())) setScreen("payment");
  };
  const goToContract = async () => {
    if (await flow.ensureCart()) setScreen("contract");
  };
  const payNow = () => flow.pay(() => router.push(href("/espace")));
  const confirmOffline = () => {
    if (submitting) return;
    flow.reserveOffline(() => {
      setDoneKind("offline");
      setScreen("done");
    });
  };
  const reset = () => {
    setScreen("home");
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

  const cur = STEP_MAP[screen] || 0;
  const Stepper = () => (
    <div style={css("padding:18px 22px 4px;display:flex;gap:8px")}>
      {stepLabels.map((label, idx) => {
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
    <div style={css("height:100dvh;max-width:480px;margin:0 auto;background:#F5F4F1;color:#1A1B1A;font-family:'Hanken Grotesk',system-ui,sans-serif;overflow:hidden")}>
      {/* ============== HOME ============== */}
      {screen === "home" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            {flow.resumed === "unavailable" && (
              <div style={css("margin:12px 16px 0;padding:12px 14px;background:#FBF3E4;border:1px solid #E8D5AC;border-radius:12px;font:400 13px/1.5 'Hanken Grotesk';color:#7A5B18")}>
                {t.booking.resumeUnavailableShort}
              </div>
            )}
            <div onClick={() => setLightbox(0)} style={css(`position:relative;height:320px;background-color:#E5E4DF;background-image:url('${heroImg}');background-size:cover;background-position:center;cursor:pointer`)}>
              <div style={css("position:absolute;left:0;right:0;bottom:0;height:170px;background:linear-gradient(to top,rgba(245,244,241,1),rgba(245,244,241,0))")} />
              <div style={css("position:absolute;left:22px;bottom:20px")}>
                <div style={css("font:500 10.5px 'Hanken Grotesk';letter-spacing:.2em;text-transform:uppercase;color:#6B6E6B")}>{property.locationLabel}</div>
                <div style={css("margin-top:7px;font:400 44px/.95 'Marcellus';color:#1A1B1A")}>{name}</div>
              </div>
              <div onClick={(e) => e.stopPropagation()} style={css("position:absolute;left:16px;top:16px;padding:4px;background:rgba(255,255,255,.92);border-radius:9px")}>
                <LangSwitcher compact />
              </div>
              <a href={href("/espace")} onClick={(e) => e.stopPropagation()} style={css("position:absolute;right:16px;top:16px;padding:7px 12px;background:rgba(255,255,255,.92);border-radius:8px;font:600 11.5px 'Hanken Grotesk';color:#1A1B1A;text-decoration:none")}>{t.nav.mySpace}</a>
              {media.length > 0 && (
                <div style={css("position:absolute;right:16px;bottom:18px;padding:7px 12px;background:rgba(255,255,255,.92);border-radius:8px;font:500 11.5px 'Hanken Grotesk'")}>
                  {t.booking.nPhotos(media.length)}
                </div>
              )}
            </div>
            <div style={css("padding:18px 22px 14px")}>
              {reviews.length > 0 && (
                <div style={css("margin-bottom:12px")}>
                  <RatingBadge reviews={reviews} />
                </div>
              )}
              <ReadMore
                content={property.description}
                lines={5}
                textStyle={css("margin:0;font:400 14.5px/1.65 'Hanken Grotesk';color:#5A5C58")}
              />
              <div style={css("margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid rgba(0,0,0,.09)")}>
                <div style={css("padding:14px 4px;border-bottom:1px solid rgba(0,0,0,.09);border-right:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.surfaceLabel}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.booking.surface}</div>
                </div>
                <div style={css("padding:14px 4px 14px 16px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.capacity}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.booking.guests}</div>
                </div>
                <div style={css("padding:14px 4px;border-bottom:1px solid rgba(0,0,0,.09);border-right:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.bedrooms}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.booking.bedrooms}</div>
                </div>
                <div style={css("padding:14px 4px 14px 16px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                  <div style={css("font:400 22px 'Marcellus'")}>{property.highlightLabel || "—"}</div>
                  <div style={css("margin-top:2px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>&nbsp;</div>
                </div>
              </div>
              <div style={css("margin-top:20px;display:flex;align-items:baseline;gap:8px")}>
                <span style={css("font:400 26px 'Marcellus'")}>{t.booking.from} {eur(fromPrice)}</span>
                <span style={css("font:400 13px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.perWeek}</span>
              </div>
              {reviews.length > 0 && (
                <div style={css("margin-top:26px")}>
                  <ReviewsSection reviews={reviews} />
                </div>
              )}
            </div>
          </div>
          <div style={css("padding:14px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            <div onClick={() => setScreen("week")} style={css("padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';letter-spacing:.02em;cursor:pointer")}>{t.booking.seeAvailability}</div>
            <div style={css("margin-top:12px;text-align:center;display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:center;font:400 11px 'Hanken Grotesk';color:#9A9C97")}>
              <a href={href("/mentions-legales")} style={css("color:#9A9C97")}>{t.footer.legalNotice}</a>
              <a href={href("/cgv")} style={css("color:#9A9C97")}>{t.footer.termsShort}</a>
              <a href={href("/confidentialite")} style={css("color:#9A9C97")}>{t.footer.privacy}</a>
              <a href={href("/cookies")} style={css("color:#9A9C97")}>{t.footer.cookies}</a>
            </div>
          </div>
        </div>
      )}

      {/* ============== WEEK ============== */}
      {screen === "week" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("home")} style={css(back)}>‹ {t.nav.back}</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>{t.booking.chooseWeek}</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid rgba(0,0,0,.09)")}>
                <div onClick={() => setMonthIdx((m) => Math.max(0, m - 1))} style={css(`width:32px;height:32px;border-radius:50%;border:1px solid rgba(0,0,0,.14);display:flex;align-items:center;justify-content:center;font-size:15px;color:#1A1B1A;${monthIdx === 0 ? "opacity:.35;" : ""}`)}>‹</div>
                <div style={css("font:400 17px 'Marcellus'")}>{monthYear(months[monthIdx], locale)}</div>
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
                          <div style={css(`margin-top:2px;font:400 11px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{wk.booked ? t.booking.full : wk.sub}</div>
                        </div>
                      </div>
                      <div style={css("text-align:right")}>
                        <div style={css("font:400 18px 'Marcellus';color:#1A1B1A")}>{wk.booked ? t.booking.booked : eur(wk.priceCents)}</div>
                        {!wk.booked && <div style={css("font:400 10.5px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.perWeek}</div>}
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
              <div style={css("font:400 11px 'Hanken Grotesk';color:#9A9C97")}>{week.range} · {t.booking.nights7}</div>
            </div>
            {week.booked ? (
              <div style={css(ctaSmall + ";background:#D8D7D2;cursor:default;opacity:.7")}>{t.booking.full}</div>
            ) : (
              <div onClick={() => setScreen("extras")} style={css(ctaSmall)}>{t.booking.continue}</div>
            )}
          </div>
        </div>
      )}

      {/* ============== EXTRAS ============== */}
      {screen === "extras" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("week")} style={css(back)}>‹ {t.nav.back}</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>{t.checkout.extrasTitle}</div>
            </div>
            <Stepper />
            <div style={css("padding:10px 22px 16px")}>
              <p style={css("margin:0 0 16px;font:400 13px/1.55 'Hanken Grotesk';color:#9A9C97")}>{t.checkout.extrasIntroShort}</p>
              {products.map((x) => {
                const on = extras[x.key];
                return (
                  <div key={x.key} onClick={() => toggleExtra(x.key)} style={css("display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:13px;margin-bottom:10px;cursor:pointer")}>
                    <div style={css("flex:1")}>
                      <div style={css("font:500 15px 'Hanken Grotesk';color:#1A1B1A")}>{x.label}</div>
                      <div style={css("margin-top:3px;font:400 11.5px/1.4 'Hanken Grotesk';color:#9A9C97")}>{x.description}</div>
                    </div>
                    <div style={css("font:400 15px 'Marcellus';color:#1A1B1A;white-space:nowrap")}>{x.priceCents === 0 ? t.booking.free : "+ " + eur(x.priceCents)}</div>
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
              <div style={css("font:400 11px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.weekPlusExtras}</div>
            </div>
            <div onClick={() => setScreen("infos")} style={css(ctaSmall)}>{t.booking.continue}</div>
          </div>
        </div>
      )}

      {/* ============== INFOS ============== */}
      {screen === "infos" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("extras")} style={css(back)}>‹ {t.nav.back}</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>{t.checkout.infosTitle}</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              <div style={css("display:flex;flex-direction:column;gap:12px")}>
                <input placeholder={t.checkout.firstName} value={info.firstName} onChange={setField("firstName")} style={css(inputCss)} />
                <input placeholder={t.checkout.lastName} value={info.lastName} onChange={setField("lastName")} style={css(inputCss)} />
                <input placeholder={t.checkout.email} type="email" value={info.email} onChange={setField("email")} style={css(inputCss)} />
                <input placeholder={t.checkout.phone} type="tel" value={info.phone} onChange={setField("phone")} style={css(inputCss)} />
                <input placeholder={t.checkout.address} value={info.addressLine} onChange={setField("addressLine")} style={css(inputCss)} />
                <div style={css("display:flex;gap:12px")}>
                  <input placeholder={t.checkout.postalCode} value={info.postalCode} onChange={setField("postalCode")} style={css(inputCss)} />
                  <input placeholder={t.checkout.city} value={info.city} onChange={setField("city")} style={css(inputCss)} />
                </div>
                <GuestPicker adults={adults} children={children} capacity={capacity} setAdults={setAdults} setChildren={setChildren} />
              </div>
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            {error && <div style={css("margin-bottom:10px;text-align:center;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
            <div
              onClick={goToContract}
              style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${infoComplete && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}
            >
              {submitting ? "…" : infoComplete ? t.booking.continue : t.checkout.completeInfos}
            </div>
          </div>
        </div>
      )}

      {/* ============== CONTRACT ============== */}
      {screen === "contract" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("infos")} style={css(back)}>‹ {t.nav.back}</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>{t.checkout.contractTitle}</div>
            </div>
            <Stepper />
            <div style={css("padding:10px 22px 16px")}>
              {/* recap */}
              <div style={css("background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:16px 16px 6px")}>
                <div style={css("display:flex;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                  <div>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.booking.stay}</div>
                    <div style={css("margin-top:3px;font:500 15px 'Hanken Grotesk'")}>{week.range}</div>
                    <div style={css("margin-top:1px;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>{t.booking.arrivalWord} {week.arrival}</div>
                  </div>
                  <div style={css("text-align:right")}>
                    <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.booking.guestsUpper}</div>
                    <div style={css("margin-top:3px;font:500 15px 'Hanken Grotesk'")}>{partyLabel}</div>
                  </div>
                </div>
                <div style={css("padding:12px 0 4px")}>
                  <div style={css("display:flex;justify-content:space-between;margin-bottom:9px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                    <span>{t.booking.rental7Nights}</span>
                    <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{eur(week.priceCents)}</span>
                  </div>
                  {selectedExtras.map((se) => (
                    <div key={se.key} style={css("display:flex;justify-content:space-between;margin-bottom:9px;font:400 13.5px 'Hanken Grotesk';color:#5A5C58")}>
                      <span>{se.label}</span>
                      <span style={css("font-family:'Marcellus';color:#1A1B1A")}>{se.priceCents === 0 ? t.booking.free : eur(se.priceCents)}</span>
                    </div>
                  ))}
                  <div style={css("display:flex;justify-content:space-between;margin:11px 0 0;padding-top:12px;border-top:1px solid rgba(0,0,0,.08);font:500 15px 'Hanken Grotesk'")}>
                    <span>{t.booking.totalStay}</span>
                    <span style={css("font-family:'Marcellus';font-size:18px")}>{eur(total)}</span>
                  </div>
                  {touristTax > 0 && (
                    <div style={css("display:flex;justify-content:space-between;margin:3px 0 12px;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>
                      <span>{property.touristTaxIncluded ? t.checkout.touristTaxIncluded : t.checkout.touristTaxAdded}</span>
                      <span>{eur(touristTax)}</span>
                    </div>
                  )}
                  {touristTax <= 0 && <div style={css("margin-bottom:12px")} />}
                  <div style={css(`margin-top:4px;padding:13px;border-radius:11px;background:${ACCENT}14`)}>
                    <div style={css("display:flex;justify-content:space-between;font:500 13.5px 'Hanken Grotesk';color:#1A1B1A")}>
                      <span>{t.checkout.depositTodayShort(pct)}</span>
                      <span style={css("font-family:'Marcellus'")}>{eur(deposit)}</span>
                    </div>
                    <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                      <span>{t.checkout.balanceChargedOn(dueDate(week.startDate))}</span>
                      <span>{eur(balance)}</span>
                    </div>
                    <div style={css("display:flex;justify-content:space-between;margin-top:7px;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                      <span>{t.checkout.cautionGuarantee}</span>
                      <span>{eur(caution)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* contract text */}
              <div style={css("margin-top:16px;font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.checkout.contractHeading}</div>
              <div style={css("margin-top:8px;max-height:120px;overflow:auto;white-space:pre-line;background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:12px;padding:14px;font:400 11.5px/1.6 'Hanken Grotesk';color:#6B6E6B")}>
                {contractText({ propertyName: name, locationLabel: location, cautionCents: caution, capacity, ownerName: property.ownerName, ownerAddress: property.ownerAddress, template: property.contractTemplate }, locale)}
              </div>

              {/* accept */}
              <div onClick={() => setAccepted((a) => !a)} style={css("margin-top:14px;display:flex;align-items:center;gap:11px;cursor:pointer")}>
                <div style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:background .15s;${accepted ? `background:${ACCENT};border:1.5px solid ${ACCENT};` : "background:#FFF;border:1.5px solid rgba(0,0,0,.2);"}`)}>{accepted ? "✓" : ""}</div>
                <div style={css("font:400 12.5px/1.4 'Hanken Grotesk';color:#5A5C58")}>{t.checkout.acceptContract}{" "}
                  <a href={href("/cgv")} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={css(`color:${ACCENT}`)}>{t.checkout.generalTerms}</a>.
                </div>
              </div>

              {/* signature */}
              <div style={css("margin-top:16px;display:flex;align-items:center;justify-content:space-between")}>
                <div style={css("font:500 11px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{t.checkout.signatureHeadingShort}</div>
                <div onClick={() => sigRef.current?.clear()} style={css("font:500 12px 'Hanken Grotesk';color:#6B6E6B;cursor:pointer")}>{t.checkout.clear}</div>
              </div>
              <div style={css("margin-top:8px")}>
                <SignaturePad ref={sigRef} width={338} height={120} fullWidth placeholder={t.checkout.signHereFinger} onEmptyChange={setSigEmpty} />
              </div>
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            {error && <div style={css("margin-bottom:10px;text-align:center;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
            <div onClick={goPayment} style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';transition:opacity .15s;${contractReady && !submitting ? "background:#1A1B1A;color:#fff;cursor:pointer;opacity:1;" : "background:#D8D7D2;color:#fff;cursor:default;opacity:.7;"}`)}>{submitting ? "…" : contractReady ? t.checkout.signAndPay : t.checkout.acceptAndSignToContinue}</div>
          </div>
        </div>
      )}

      {/* ============== PAYMENT ============== */}
      {screen === "payment" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:26px 22px 0")}>
              <div onClick={() => setScreen("contract")} style={css(back)}>‹ {t.nav.back}</div>
              <div style={css("margin-top:14px;font:400 28px 'Marcellus'")}>{t.checkout.paymentTitle}</div>
            </div>
            <Stepper />
            <div style={css("padding:14px 22px 16px")}>
              {payMethodOptions.length > 1 && (
                <div style={css("display:flex;flex-direction:column;gap:8px")}>
                  {payMethodOptions.map((m) => {
                    const sel = payMethod === m.key;
                    return (
                      <div key={m.key} onClick={() => flow.setPayMethod(m.key)} style={css(`display:flex;align-items:center;gap:12px;padding:12px 14px;background:#FFF;border:${sel ? `1.5px solid ${ACCENT}` : "1px solid rgba(0,0,0,.08)"};border-radius:13px;cursor:pointer;transition:border-color .15s`)}>
                        <div style={css(`flex:none;width:19px;height:19px;border-radius:50%;background:#FFF;${sel ? `border:6px solid ${ACCENT};` : "border:1.5px solid rgba(0,0,0,.2);"}`)} />
                        <div>
                          <div style={css("font:500 14px 'Hanken Grotesk';color:#1A1B1A")}>{m.title}</div>
                          <div style={css(`margin-top:1px;font:400 11px 'Hanken Grotesk';color:${sel ? ACCENT : "#9A9C97"}`)}>{m.sub}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={css("text-align:center;padding:14px 0 22px")}>
                <div style={css("font:400 12px 'Hanken Grotesk';letter-spacing:.04em;color:#9A9C97")}>{payMethod === "card" ? t.checkout.payTodayDeposit(pct) : t.checkout.depositByMethod(pct, methodLabel)}</div>
                <div style={css("margin-top:6px;font:400 46px 'Marcellus';color:#1A1B1A")}>{eur(deposit)}</div>
              </div>
              {payMethod === "card" ? (
                <>
                  <div style={css("background:#EFEEEB;border-radius:12px;padding:14px")}>
                    <div style={css("display:flex;justify-content:space-between;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B;margin-bottom:8px")}>
                      <span>{t.checkout.cautionHold}</span>
                      <span>{t.checkout.cautionNotCharged(eur(caution))}</span>
                    </div>
                    <div style={css("display:flex;justify-content:space-between;font:400 12.5px 'Hanken Grotesk';color:#6B6E6B")}>
                      <span>{t.checkout.balanceOn(dueDate(week.startDate))}</span>
                      <span>{eur(balance)}</span>
                    </div>
                  </div>
                  <div style={css("margin-top:14px;display:flex;align-items:center;gap:8px;justify-content:center;font:400 11.5px 'Hanken Grotesk';color:#9A9C97")}>
                    <span style={css("font-size:13px")}>🔒</span> {t.checkout.securePaymentShort}
                  </div>
                </>
              ) : (
                <>
                  <p style={css("margin:0;font:400 13.5px/1.6 'Hanken Grotesk';color:#5A5C58")}>
                    {t.checkout.youPayDeposit}<b>{eur(deposit)}</b>{t.checkout.offlineExplain(methodLabel)}
                  </p>
                  <div style={css("margin-top:12px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:13px;padding:14px 16px")}>
                    <div style={css("font:500 10px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.checkout.paymentBy(methodLabel)}</div>
                    <div style={css("margin-top:7px;white-space:pre-line;font:400 12.5px/1.6 'Hanken Grotesk';color:#5A5C58")}>
                      {offlineInstructions || t.checkout.offlineInstructionsFallback}
                    </div>
                    <div style={css(`margin-top:10px;padding:9px 11px;border-radius:9px;background:${ACCENT}14;font:500 11.5px 'Hanken Grotesk';color:#3f4b45`)}>
                      {t.checkout.offlineReference}
                    </div>
                  </div>
                </>
              )}
              {error && <div style={css("margin-top:12px;text-align:center;font:400 12px 'Hanken Grotesk';color:#B23B3B")}>{error}</div>}
            </div>
          </div>
          <div style={css("padding:13px 22px 30px;background:#FFF;border-top:1px solid rgba(0,0,0,.08)")}>
            {payMethod === "card" ? (
              <div onClick={payNow} style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? t.checkout.paying : t.checkout.pay(eur(deposit))}</div>
            ) : (
              <div onClick={confirmOffline} style={css(`padding:16px;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';${submitting ? "background:#D8D7D2;color:#fff;cursor:default;opacity:.75;" : "background:#1A1B1A;color:#fff;cursor:pointer;"}`)}>{submitting ? t.checkout.saving : t.checkout.confirmBooking}</div>
            )}
          </div>
        </div>
      )}

      {/* ============== DONE ============== */}
      {screen === "done" && (
        <div style={css("height:100%;display:flex;flex-direction:column")}>
          <div style={css("flex:1;overflow:auto")}>
            <div style={css("padding:54px 26px 0;text-align:center")}>
              <div style={css(`width:74px;height:74px;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:36px;color:#fff;background:${ACCENT};box-shadow:0 12px 30px ${ACCENT}40`)}>✓</div>
              <div style={css("margin-top:22px;font:400 30px 'Marcellus'")}>{doneKind === "offline" ? t.done.recordedTitle : t.done.confirmedTitle}</div>
              {doneKind === "offline" ? (
                <p style={css("margin:12px auto 0;max-width:300px;font:400 13.5px/1.6 'Hanken Grotesk';color:#6B6E6B")}>{t.done.offlineBodyPrefix}<b>{eur(deposit)}</b>{t.done.offlineBodySuffix(methodLabel)}</p>
              ) : (
                <p style={css("margin:12px auto 0;max-width:280px;font:400 13.5px/1.6 'Hanken Grotesk';color:#6B6E6B")}>{t.done.confirmedBodyShort}</p>
              )}
            </div>
            <div style={css("padding:26px 22px 16px")}>
              {doneKind === "offline" && (
                <div style={css("margin-bottom:14px;background:#FFF;border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:16px")}>
                  <div style={css("display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:12px;border-bottom:1px solid rgba(0,0,0,.08)")}>
                    <div style={css("font:500 10px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.done.reference}</div>
                    <div style={css("font:400 19px 'Marcellus';color:#1A1B1A")}>{reference ?? "—"}</div>
                  </div>
                  <div style={css("margin-top:12px;font:500 10px 'Hanken Grotesk';letter-spacing:.08em;color:#9A9C97")}>{t.checkout.paymentBy(methodLabel)}</div>
                  <div style={css("margin-top:7px;white-space:pre-line;font:400 12.5px/1.6 'Hanken Grotesk';color:#5A5C58")}>
                    {offlineInstructions || t.checkout.offlineInstructionsFallback}
                  </div>
                  <div style={css(`margin-top:10px;padding:9px 11px;border-radius:9px;background:${ACCENT}14;font:500 11.5px 'Hanken Grotesk';color:#3f4b45`)}>
                    {t.checkout.offlineReference}
                  </div>
                </div>
              )}
              <div style={css("background:#FFF;border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:6px 16px")}>
                {(doneKind === "offline" ? offlineTimeline : timeline).map((tl, i) => (
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
            <div onClick={reset} style={css("padding:16px;background:#1A1B1A;color:#fff;border-radius:13px;text-align:center;font:600 14.5px 'Hanken Grotesk';cursor:pointer")}>{t.done.finish}</div>
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
          onPaid={() => flow.finishStripe(() => router.push(href("/espace")))}
          onClose={() => setStripeSession(null)}
        />
      )}
    </div>
  );
}
