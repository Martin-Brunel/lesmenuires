// English dictionary — must mirror the shape of fr.ts (typed against it).

import type { fr } from "./fr";

export const en: typeof fr = {
  meta: {
    homeTitle: (site: string, location: string) => `${site} — Book your week in ${location}`,
    homeDescription: (location: string) =>
      `Holiday rental in ${location}. Book your week online: rates, extras, electronic signature and secure deposit payment.`,
    bookTitle: (site: string) => `Book your stay — ${site}`,
    bookDescription:
      "Choose your week, add your extras, sign the contract and pay the deposit online.",
  },

  nav: {
    contact: "Contact us",
    mySpace: "My account",
    back: "Back",
    backToProperty: "Back to the property",
    backToBooking: "Back to booking",
  },

  footer: {
    legalNotice: "Legal notice",
    terms: "Rental terms",
    termsShort: "Terms",
    privacy: "Privacy",
    cookies: "Cookies",
  },

  serviceDown: {
    title: "Service temporarily unavailable",
    body: "We could not load the availability. Please try again in a moment.",
  },

  closed: {
    onlineClosed: "Online booking closed",
    offSeason: "Off season",
    closedBody:
      "Online booking is temporarily closed. Contact us directly to arrange your stay — we will be happy to help.",
    closedBodyShort:
      "Online booking is temporarily closed. Contact us directly to arrange your stay.",
    openingSoonBody:
      "The booking calendar will open soon. Come back shortly to book your week.",
    openingSoonBodyShort: "The booking calendar will open soon. Come back shortly.",
  },

  booking: {
    resumeUnavailable:
      "We could not restore your cart: the selected week is no longer available or the booking has expired. Please choose a new week below.",
    resumeUnavailableShort:
      "We could not restore your cart: the selected week is no longer available or the booking has expired. Please choose a new week.",
    resumeRestored:
      "We found your booking in progress — your selection and contact details have been restored.",
    seePhotos: (n: number) => `See all ${n} photos`,
    nPhotos: (n: number) => `${n} photos`,
    chooseWeek: "Choose your week",
    perWeek: "/ week",
    from: "from",
    booked: "Booked",
    full: "Fully booked",
    arrival: "CHECK-IN",
    departure: "CHECK-OUT",
    arrivalWord: "Check-in",
    rental7Nights: "Rental · 7 nights",
    total: "Total",
    totalStay: "Stay total",
    free: "Included",
    depositToday: (pct: number) => `${pct}% deposit today`,
    balanceOn: (date: string) => `Balance on ${date}`,
    continue: "Continue",
    freeCancellation:
      "Free cancellation up to 30 days before arrival · You only pay the deposit today.",
    seeAvailability: "See availability",
    surface: "Surface",
    guests: "Guests",
    bedrooms: "Bedrooms",
    weekPlusExtras: "Week + extras",
    stay: "STAY",
    guestsUpper: "GUESTS",
    nights7: "7 nights",
  },

  steps: {
    week: "Week",
    options: "Extras",
    extras: "Extras",
    infos: "Your details",
    infosShort: "Details",
    contract: "Contract",
    payment: "Payment",
  },

  checkout: {
    title: "Complete your booking",
    extrasHeading: "OPTIONAL EXTRAS",
    extrasTitle: "Extras",
    extrasIntro:
      "Add whatever you need to arrive with your hands in your pockets — you can still change your mind before payment.",
    extrasIntroShort: "Add whatever you need to arrive with your hands in your pockets.",
    extrasNone: "No extras selected — you can continue without any.",
    extrasCount: (n: number, amount: string) => `${n} extra${n > 1 ? "s" : ""} · ${amount}`,
    continueWithoutExtras: "Continue without extras",
    infosHeading: "YOUR CONTACT DETAILS",
    infosTitle: "Your details",
    firstName: "First name",
    lastName: "Last name",
    email: "E-mail",
    phone: "Phone",
    address: "Address",
    postalCode: "Postcode",
    city: "City",
    completeInfos: "Complete your details",
    contractHeading: "SEASONAL RENTAL CONTRACT",
    contractTitle: "Contract & signature",
    acceptContract: "I confirm I have read and accept the contract and the",
    generalTerms: "general terms",
    signatureHeading: "ELECTRONIC SIGNATURE",
    signatureHeadingShort: "SIGNATURE",
    clear: "Clear",
    signHereMouse: "Sign here with your mouse",
    signHereFinger: "Sign here with your finger",
    acceptAndSign: "Accept and sign",
    acceptAndSignToContinue: "Accept and sign to continue",
    signAndPay: "Sign & pay the deposit",
    paymentHeading: "DEPOSIT PAYMENT",
    paymentTitle: "Deposit",
    payCard: "Credit card",
    payCardSub: "Immediate confirmation",
    payVirement: "Bank transfer",
    payCheque: "Cheque",
    payOfflineSub: "The week is held, confirmed upon receipt",
    methodCheque: "cheque",
    methodVirement: "bank transfer",
    cardExplainPrefix: "You pay the deposit of ",
    cardExplainRest: (balance: string, date: string, caution: string) =>
      ` today. The balance of ${balance} will be charged automatically on ${date}. A ${caution} security deposit acts as a guarantee: nothing is blocked, your card would only be charged in case of damage.`,
    securePayment:
      "Secure payment · Stripe — your card details never touch our servers.",
    securePaymentShort: "Secure payment · Stripe",
    payDeposit: (amount: string) => `Pay the ${amount} deposit`,
    pay: (amount: string) => `Pay ${amount}`,
    paying: "Payment in progress…",
    saving: "Saving…",
    offlineExplain: (method: string) =>
      ` by ${method}. Your week is held right away; the booking becomes final upon receipt of your payment.`,
    youPayDeposit: "You pay the deposit of ",
    paymentBy: (method: string) => `PAYMENT BY ${method.toUpperCase()}`,
    offlineInstructionsFallback: "The instructions will be sent to you by e-mail.",
    offlineReference: "Please include your booking reference with your payment.",
    confirmBooking: "Confirm the booking",
    payTodayDeposit: (pct: number) => `To pay today · ${pct}% deposit`,
    depositByMethod: (pct: number, method: string) => `${pct}% deposit · payable by ${method}`,
    cautionHold: "Security deposit hold",
    cautionNotCharged: (amount: string) => `${amount} · not charged`,
    balanceOn: (date: string) => `Balance on ${date}`,
    toPayToday: "To pay today",
    cautionGuarantee: "Security deposit (guarantee, not charged)",
    touristTaxIncluded: "incl. tourist tax",
    touristTaxAdded: "+ tourist tax (added to the balance)",
    depositTodayShort: (pct: number) => `${pct}% deposit — today`,
    balanceChargedOn: (date: string) => `Balance — charged on ${date}`,
    stripeModalTitle: "Deposit payment",
    stripeClose: "Close",
    stripePayFailed: "The payment failed.",
    stripeAcceptedFinalizing: "Payment accepted. Finalising…",
    stripeNotFinalized: "Payment not completed. Please try again.",
  },

  done: {
    confirmedTitle: "Booking confirmed",
    recordedTitle: "Booking recorded",
    confirmedBody: (site: string) =>
      `A welcome e-mail with the access codes, directions and your on-site contacts has just been sent to you. See you soon at ${site}.`,
    confirmedBodyShort:
      "A welcome e-mail with the access codes, directions and your on-site contacts has just been sent to you.",
    offlineBodyPrefix: "Your week is held. Pay the deposit of ",
    offlineBodySuffix: (method: string) =>
      ` by ${method} to confirm it — the instructions have just been sent to you by e-mail.`,
    reference: "REFERENCE",
    bookingReference: "BOOKING REFERENCE",
    timelineDepositPaid: "Deposit paid",
    timelineDepositDue: "Deposit to pay",
    timelineToday: "Today · paid",
    timelineNow: (method: string) => `Right away · by ${method}`,
    timelineBalance: "Stay balance",
    timelineBalanceOn: (date: string) => `Charged on ${date}`,
    timelineOn: (date: string) => `On ${date}`,
    timelineConfirmation: "Confirmation",
    timelineOnReceipt: "Upon receipt of your payment",
    timelineKeys: "Key handover",
    timelineKeysWhen: (arrival: string) => `Check-in ${arrival} · 4pm`,
    timelineCaution: "Security deposit released",
    timelineCautionWhen: "After the check-out inspection",
    backHome: "Back to home",
    finish: "Done",
  },

  guests: {
    adults: "Adults",
    adultsHint: (capacity: number) => `Up to ${capacity} guests in total`,
    children: "Children",
    childrenHint: "Under 12",
    remove: (label: string) => `Remove ${label}`,
    add: (label: string) => `Add ${label}`,
    partyLabel: (adults: number, children: number) =>
      `${adults} adult${adults > 1 ? "s" : ""}` +
      (children > 0 ? ` · ${children} child${children > 1 ? "ren" : ""}` : ""),
  },

  reviews: {
    title: "Guest reviews",
    count: (n: number) => `${n} review${n > 1 ? "s" : ""}`,
    seeAll: (n: number) => `See all ${n} reviews`,
    hostReply: "Reply from your host",
  },

  readMore: {
    more: "Read more",
    less: "Read less",
  },

  lightbox: {
    close: "Close",
    prev: "Previous photo",
    next: "Next photo",
    photoN: (n: number) => `Photo ${n}`,
  },

  errors: {
    generic: "Something went wrong.",
    noWeekSelected: "No week selected.",
    acceptAndSignFirst: "Please accept the contract and sign.",
    paymentAcceptedPending:
      "Your payment has been accepted. The final confirmation is in progress and you will receive an e-mail; you can follow your booking in your account.",
  },

  espace: {
    title: "Guest account",
    metaTitle: (site: string) => `My account — ${site}`,
    heading: "Your stay account",
    hello: (name: string) => `Hello ${name}`,
    loading: "Loading…",
    loginIntro:
      "Enter your e-mail: we will send you a secure sign-in link to your stay account.",
    linkInvalid: "This link is invalid or has expired. Request a new one below.",
    linkSentPrefix: "✓ If an account exists for ",
    linkSentSuffix: ", a sign-in link has just been sent. Check your inbox (and your spam).",
    emailPlaceholder: "your@email.com",
    receiveLink: "Send me the link",
    bookNewStay: "Book a new stay",
    logout: "Sign out",
    mySpaceUpper: "My account",
    noBookings: "No bookings yet.",
    upcoming: "Upcoming",
    past: "Past stays",
    prepareStay: "Prepare your stay",
    inDays: (n: number) => ` · in ${n} d`,
    arrivalOn: (arrival: string) => `check-in ${arrival}`,
    arrivalInstructions: "Arrival instructions",
    houseRules: "House rules",
    arrivalRef: (arrival: string, ref: string) => `Check-in ${arrival || "—"} · ref. ${ref}`,
    statusCart: "Payment pending",
    statusPending: "Awaiting payment",
    statusConfirmed: "Confirmed",
    statusBalancePaid: "Paid in full",
    statusCancelled: "Cancelled",
    pendingNote:
      "Your week is held — the booking will be confirmed upon receipt of your payment.",
    deposit: "Deposit",
    paidOn: (date: string) => `Paid on ${date}`,
    toPay: "To pay",
    balance: "Balance",
    notChargedCancelled: "Not charged (cancelled)",
    chargedOn: (date: string) => `Charged on ${date}`,
    chargeOn: (date: string) => `Charge on ${date}`,
    caution: "Security deposit",
    noCaution: "No security deposit",
    cautionDetail: "Guarantee · your card is only charged in case of damage",
    balanceFailed:
      "The automatic balance charge did not go through. Pay it online below to finalise your booking.",
    payBalanceOnline: (amount: string) => `Pay the balance online · ${amount}`,
    balanceAcceptedPending:
      "Your payment has been accepted. Confirmation is in progress; refresh in a moment.",
    seeContract: "View my signed contract (printable)",
  },

  avis: {
    linkNotFound: "Review link not found or expired.",
    errorShort: "Error",
    thanksTitle: "Thank you for your review!",
    thanksBody: (property: string, range: string, rating: number | null) =>
      `Your feedback about your stay at ${property} (${range}) has been recorded${rating ? ` — ${rating}/5` : ""}. It will be published after review by your host. See you soon!`,
    howWasStay: (firstName: string | null, range: string) =>
      `${firstName ? `${firstName}, how` : "How"} was your stay of ${range}? Your review helps future guests and your host.`,
    yourRating: "Your rating",
    starAria: (n: number) => `${n} star${n > 1 ? "s" : ""}`,
    ratingLabels: {
      1: "Disappointing",
      2: "Average",
      3: "Good",
      4: "Very good",
      5: "Excellent",
    } as Record<number, string>,
    commentLabel: "Your comment (optional)",
    commentPlaceholder: "The flat, the location, the welcome…",
    authorLabel: "Your first name (shown with the review)",
    send: "Send my review",
    sending: "Sending…",
    disclaimer:
      "Your review is final once sent. It will be published on the booking page after review by your host, signed with your first name only.",
  },

  contratPage: {
    linkNotFound: "Contract link not found or expired.",
    errorShort: "Error",
    subtitle: "Seasonal rental contract",
    bookingRef: (ref: string) => `Booking ${ref}`,
    weekOf: (range: string) => `Week of ${range}`,
    tenant: "Tenant:",
    arrival: "Check-in:",
    signedNote: (date: string | null) =>
      `Contract signed electronically${date ? ` on ${date}` : ""}.`,
    signatureAlt: "Tenant's signature",
    print: "Print / Save as PDF",
    keepLink: "Keep this link: it remains your copy of the signed contract.",
    acceptLabel: "I have read the contract and the general terms, and I accept them.",
    signHere: "Sign here with your mouse or finger",
    signButton: "Sign the contract",
    signFailed: "The signature could not be saved.",
  },

  legal: {
    legalNoticeTitle: (site: string) => `Legal notice — ${site}`,
    cgvTitle: (site: string) => `Rental terms — ${site}`,
    privacyTitle: (site: string) => `Privacy policy — ${site}`,
    cookiesTitle: (site: string) => `Cookies — ${site}`,
    lastUpdated: (date: string) => `Last updated: ${date}`,
    allRightsReserved: (year: string, site: string) => `© ${year} ${site}. All rights reserved.`,
  },

  cookieBanner: {
    aria: "Cookie information",
    body: "We only use cookies required for the site to work and for secure payment. No advertising trackers.",
    learnMore: "Learn more",
    ok: "Got it",
  },

  errorPage: {
    kicker: "SOMETHING WENT WRONG",
    title: "An error occurred",
    body: "Please try again. If the problem persists, contact us.",
    reference: "Reference:",
    retry: "Try again",
  },

  notFound: {
    kicker: "ERROR 404",
    title: "Page not found",
    body: "The page you are looking for does not exist or has been moved.",
    backHome: "Back to home",
  },
};
