// Dictionnaire français — source de vérité du typage (en.ts doit exposer la
// même forme). Les valeurs peuvent être des fonctions pour les interpolations
// et pluriels : les deux dictionnaires sont importés côté client par le
// provider, seule la locale traverse la frontière serveur→client.

export const fr = {
  meta: {
    homeTitle: (site: string, location: string) =>
      `${site} — Réservez votre semaine à ${location}`,
    homeDescription: (location: string) =>
      `Location saisonnière à ${location}. Réservez votre semaine en autonomie : tarifs, prestations, signature électronique et acompte en ligne.`,
    bookTitle: (site: string) => `Réserver votre séjour — ${site}`,
    bookDescription:
      "Choisissez votre semaine, ajoutez vos prestations, signez le contrat et réglez l'acompte en ligne.",
  },

  nav: {
    contact: "Nous contacter",
    mySpace: "Mon espace",
    back: "Retour",
    backToProperty: "Retour au logement",
    backToBooking: "Retour à la réservation",
  },

  chat: {
    open: "Ouvrir la conversation",
    close: "Fermer la conversation",
    title: "Léa",
    subtitle: "En ligne",
    intro:
      "Bonjour ! Je suis Léa, de l'équipe. Une question sur le logement, les disponibilités ou les tarifs ? Écrivez-moi !",
    placeholder: "Écrivez votre message…",
    send: "Envoyer",
    unavailable:
      "Je rencontre un petit souci technique… Laissez-nous un message juste en dessous, on revient vers vous rapidement !",
    rateLimited: "Un instant s'il vous plaît, vous m'écrivez un peu trop vite !",
    leaveMessage: "Laisser un message à l'équipe",
    contactName: "Votre nom",
    contactEmail: "Votre e-mail",
    contactMessage: "Votre message",
    contactSend: "Envoyer le message",
    contactSent:
      "Merci ! Votre message est bien transmis à l'équipe, on vous répond très vite par e-mail.",
    contactError: "L'envoi a échoué, réessayez dans un instant.",
    aiNotice: "Assistant virtuel · un membre de l'équipe reprend la conversation si besoin",
    disclaimer: "Réponses indicatives — seule la réservation en ligne fait foi",
  },

  footer: {
    legalNotice: "Mentions légales",
    terms: "Conditions de location",
    termsShort: "Conditions",
    privacy: "Confidentialité",
    cookies: "Cookies",
  },

  serviceDown: {
    title: "Service momentanément indisponible",
    body: "Impossible de charger les disponibilités. Réessayez dans un instant.",
  },

  closed: {
    onlineClosed: "Réservation en ligne fermée",
    offSeason: "Hors saison",
    closedBody:
      "La réservation en ligne est momentanément fermée. Contactez-nous directement pour organiser votre séjour — nous nous ferons un plaisir de vous répondre.",
    closedBodyShort:
      "La réservation en ligne est momentanément fermée. Contactez-nous directement pour organiser votre séjour.",
    openingSoonBody:
      "Le calendrier de réservation ouvrira prochainement. Revenez bientôt pour réserver votre semaine.",
    openingSoonBodyShort: "Le calendrier de réservation ouvrira prochainement. Revenez bientôt.",
  },

  booking: {
    resumeUnavailable:
      "Votre panier n'a pas pu être repris : la semaine choisie n'est plus disponible ou la réservation a expiré. Choisissez une nouvelle semaine ci-dessous.",
    resumeUnavailableShort:
      "Votre panier n'a pas pu être repris : la semaine choisie n'est plus disponible ou la réservation a expiré. Choisissez une nouvelle semaine.",
    resumeRestored:
      "Nous avons retrouvé votre réservation en cours — votre sélection et vos coordonnées ont été restaurées.",
    seePhotos: (n: number) => `Voir les ${n} photos`,
    nPhotos: (n: number) => `${n} photos`,
    chooseWeek: "Choisir votre semaine",
    perWeek: "/ semaine",
    from: "dès",
    booked: "Réservé",
    full: "Complet",
    arrival: "ARRIVÉE",
    departure: "DÉPART",
    arrivalWord: "Arrivée",
    rental7Nights: "Location · 7 nuits",
    total: "Total",
    totalStay: "Total séjour",
    free: "Offert",
    depositToday: (pct: number) => `Acompte ${pct}% aujourd'hui`,
    balanceOn: (date: string) => `Solde le ${date}`,
    continue: "Continuer",
    freeCancellation:
      "Annulation gratuite jusqu'à 30 jours avant l'arrivée · Vous ne payez que l'acompte aujourd'hui.",
    seeAvailability: "Voir les disponibilités",
    surface: "Surface",
    guests: "Voyageurs",
    bedrooms: "Chambres",
    weekPlusExtras: "Semaine + prestations",
    stay: "SÉJOUR",
    guestsUpper: "VOYAGEURS",
    nights7: "7 nuits",
  },

  steps: {
    week: "Semaine",
    options: "Options",
    extras: "Prestations",
    infos: "Vos infos",
    infosShort: "Infos",
    contract: "Contrat",
    payment: "Paiement",
  },

  checkout: {
    title: "Finaliser votre réservation",
    extrasHeading: "PRESTATIONS COMPLÉMENTAIRES",
    extrasTitle: "Prestations",
    extrasIntro:
      "Ajoutez ce qu'il faut pour arriver les mains dans les poches — vous pourrez encore changer d'avis avant le paiement.",
    extrasIntroShort: "Ajoutez ce qu'il faut pour arriver les mains dans les poches.",
    extrasNone: "Aucune prestation sélectionnée — vous pouvez continuer sans.",
    extrasCount: (n: number, amount: string) =>
      `${n} prestation${n > 1 ? "s" : ""} · ${amount}`,
    continueWithoutExtras: "Continuer sans prestation",
    infosHeading: "VOS COORDONNÉES",
    infosTitle: "Vos coordonnées",
    firstName: "Prénom",
    lastName: "Nom",
    email: "E-mail",
    phone: "Téléphone",
    address: "Adresse",
    postalCode: "Code postal",
    city: "Ville",
    completeInfos: "Complétez vos informations",
    contractHeading: "CONTRAT DE LOCATION SAISONNIÈRE",
    contractTitle: "Contrat & signature",
    acceptContract: "Je reconnais avoir lu et j'accepte le contrat et les",
    generalTerms: "conditions générales",
    signatureHeading: "SIGNATURE ÉLECTRONIQUE",
    signatureHeadingShort: "SIGNATURE",
    clear: "Effacer",
    signHereMouse: "Signez ici à la souris",
    signHereFinger: "Signez ici avec votre doigt",
    acceptAndSign: "Acceptez et signez",
    acceptAndSignToContinue: "Acceptez et signez pour continuer",
    signAndPay: "Signer & payer l'acompte",
    paymentHeading: "PAIEMENT DE L'ACOMPTE",
    paymentTitle: "Acompte",
    payCard: "Carte bancaire",
    payCardSub: "Confirmation immédiate",
    payVirement: "Virement bancaire",
    payCheque: "Chèque",
    payOfflineSub: "La semaine est retenue, confirmée à réception",
    methodCheque: "chèque",
    methodVirement: "virement",
    cardExplainPrefix: "Vous réglez aujourd'hui l'acompte de ",
    cardExplainRest: (balance: string, date: string, caution: string) =>
      `. Le solde de ${balance} sera prélevé automatiquement le ${date}. Une caution de ${caution} sert de garantie : rien n'est bloqué, votre carte ne serait débitée qu'en cas de dégâts.`,
    securePayment:
      "Paiement sécurisé · Stripe — vos informations bancaires ne transitent jamais par nos serveurs.",
    securePaymentShort: "Paiement sécurisé · Stripe",
    payDeposit: (amount: string) => `Payer l'acompte de ${amount}`,
    pay: (amount: string) => `Payer ${amount}`,
    paying: "Paiement en cours…",
    saving: "Enregistrement…",
    offlineExplain: (method: string) =>
      `par ${method}. Votre semaine est retenue dès maintenant ; la réservation devient définitive à réception de votre règlement.`,
    youPayDeposit: "Vous réglez l'acompte de ",
    paymentBy: (method: string) => `RÈGLEMENT PAR ${method.toUpperCase()}`,
    offlineInstructionsFallback: "Les instructions vous seront envoyées par e-mail.",
    offlineReference: "Indiquez la référence de votre réservation avec votre règlement.",
    confirmBooking: "Confirmer la réservation",
    payTodayDeposit: (pct: number) => `À régler aujourd'hui · acompte ${pct}%`,
    depositByMethod: (pct: number, method: string) => `Acompte ${pct}% · à régler par ${method}`,
    cautionHold: "Empreinte de caution",
    cautionNotCharged: (amount: string) => `${amount} · non débitée`,
    balanceOn: (date: string) => `Solde le ${date}`,
    toPayToday: "À payer aujourd'hui",
    cautionGuarantee: "Caution (garantie, non débitée)",
    touristTaxIncluded: "dont taxe de séjour",
    touristTaxAdded: "+ taxe de séjour (ajoutée au solde)",
    depositTodayShort: (pct: number) => `Acompte ${pct}% — aujourd'hui`,
    balanceChargedOn: (date: string) => `Solde — prélevé le ${date}`,
    stripeModalTitle: "Paiement de l'acompte",
    stripeClose: "Fermer",
    stripePayFailed: "Le paiement a échoué.",
    stripeAcceptedFinalizing: "Paiement accepté. Finalisation en cours…",
    stripeNotFinalized: "Paiement non finalisé. Réessayez.",
  },

  done: {
    confirmedTitle: "Réservation confirmée",
    recordedTitle: "Réservation enregistrée",
    confirmedBody: (site: string) =>
      `Un e-mail d'accueil avec les codes d'accès, l'itinéraire et vos contacts sur place vient de vous être envoyé. À très vite à ${site}.`,
    confirmedBodyShort:
      "Un e-mail d'accueil avec les codes d'accès, l'itinéraire et vos contacts sur place vient de vous être envoyé.",
    offlineBodyPrefix: "Votre semaine est retenue. Réglez l'acompte de ",
    offlineBodySuffix: (method: string) =>
      ` par ${method} pour la confirmer définitivement — les instructions viennent de vous être envoyées par e-mail.`,
    reference: "RÉFÉRENCE",
    bookingReference: "RÉFÉRENCE DE RÉSERVATION",
    timelineDepositPaid: "Acompte versé",
    timelineDepositDue: "Acompte à régler",
    timelineToday: "Aujourd'hui · payé",
    timelineNow: (method: string) => `Dès maintenant · par ${method}`,
    timelineBalance: "Solde du séjour",
    timelineBalanceOn: (date: string) => `Prélevé le ${date}`,
    timelineOn: (date: string) => `Le ${date}`,
    timelineConfirmation: "Confirmation",
    timelineOnReceipt: "À réception de votre règlement",
    timelineKeys: "Remise des clés",
    timelineKeysWhen: (arrival: string) => `Arrivée ${arrival} · 16h`,
    timelineCaution: "Caution libérée",
    timelineCautionWhen: "Après état des lieux de sortie",
    backHome: "Retour à l'accueil",
    finish: "Terminer",
  },

  guests: {
    adults: "Adultes",
    adultsHint: (capacity: number) => `Jusqu'à ${capacity} voyageurs au total`,
    children: "Enfants",
    childrenHint: "Moins de 12 ans",
    remove: (label: string) => `Retirer ${label}`,
    add: (label: string) => `Ajouter ${label}`,
    partyLabel: (adults: number, children: number) =>
      `${adults} adulte${adults > 1 ? "s" : ""}` +
      (children > 0 ? ` · ${children} enfant${children > 1 ? "s" : ""}` : ""),
  },

  reviews: {
    title: "Avis des voyageurs",
    count: (n: number) => `${n} avis`,
    seeAll: (n: number) => `Voir les ${n} avis`,
    hostReply: "Réponse de votre hôte",
  },

  readMore: {
    more: "Voir plus",
    less: "Voir moins",
  },

  lightbox: {
    close: "Fermer",
    prev: "Photo précédente",
    next: "Photo suivante",
    photoN: (n: number) => `Photo ${n}`,
  },

  errors: {
    generic: "Une erreur est survenue.",
    noWeekSelected: "Aucune semaine sélectionnée.",
    acceptAndSignFirst: "Merci d'accepter le contrat et de signer.",
    paymentAcceptedPending:
      "Votre paiement a bien été accepté. La confirmation finale est en cours et vous recevrez un e-mail ; vous pourrez suivre votre réservation dans votre espace client.",
  },

  espace: {
    title: "Espace client",
    metaTitle: (site: string) => `Mon espace — ${site}`,
    heading: "Votre espace séjour",
    hello: (name: string) => `Bonjour ${name}`,
    loading: "Chargement…",
    loginIntro:
      "Saisissez votre e-mail : nous vous envoyons un lien de connexion sécurisé à votre espace séjour.",
    linkInvalid: "Ce lien est invalide ou expiré. Demandez-en un nouveau ci-dessous.",
    linkSentPrefix: "✓ Si un compte existe pour ",
    linkSentSuffix:
      ", un lien de connexion vient d'être envoyé. Vérifiez votre boîte (et vos spams).",
    emailPlaceholder: "votre@email.fr",
    receiveLink: "Recevoir le lien",
    bookNewStay: "Réserver un nouveau séjour",
    logout: "Se déconnecter",
    mySpaceUpper: "Mon espace",
    noBookings: "Aucune réservation pour le moment.",
    upcoming: "À venir",
    past: "Séjours passés",
    prepareStay: "Préparer votre séjour",
    inDays: (n: number) => ` · dans ${n} j`,
    arrivalOn: (arrival: string) => `arrivée ${arrival}`,
    arrivalInstructions: "Consignes d'arrivée",
    houseRules: "Règlement intérieur",
    arrivalRef: (arrival: string, ref: string) => `Arrivée ${arrival || "—"} · réf. ${ref}`,
    statusCart: "Paiement en attente",
    statusPending: "En attente de règlement",
    statusConfirmed: "Confirmée",
    statusBalancePaid: "Soldée",
    statusCancelled: "Annulée",
    pendingNote:
      "Votre semaine est retenue — la réservation sera confirmée à réception de votre règlement.",
    deposit: "Acompte",
    paidOn: (date: string) => `Payé le ${date}`,
    toPay: "À régler",
    balance: "Solde",
    notChargedCancelled: "Non prélevé (annulation)",
    chargedOn: (date: string) => `Prélevé le ${date}`,
    chargeOn: (date: string) => `Prélèvement le ${date}`,
    caution: "Caution",
    noCaution: "Aucune caution",
    cautionDetail: "Garantie · votre carte n'est débitée qu'en cas de dégâts",
    balanceFailed:
      "Le prélèvement automatique du solde n'a pas abouti. Réglez-le en ligne ci-dessous pour finaliser votre réservation.",
    payBalanceOnline: (amount: string) => `Régler le solde en ligne · ${amount}`,
    balanceAcceptedPending:
      "Votre paiement a été accepté. La confirmation est en cours ; rafraîchissez dans un instant.",
    seeContract: "Voir mon contrat signé (imprimable)",
  },

  avis: {
    linkNotFound: "Lien d'avis introuvable ou expiré.",
    errorShort: "Erreur",
    thanksTitle: "Merci pour votre avis !",
    thanksBody: (property: string, range: string, rating: number | null) =>
      `Votre retour sur votre séjour à ${property} (${range}) a bien été enregistré${rating ? ` — ${rating}/5` : ""}. Il sera publié après relecture par votre hôte. À bientôt !`,
    howWasStay: (firstName: string | null, range: string) =>
      `${firstName ? `${firstName}, comment` : "Comment"} s'est passé votre séjour du ${range} ? Votre avis aide les prochains voyageurs et votre hôte.`,
    yourRating: "Votre note",
    starAria: (n: number) => `${n} étoile${n > 1 ? "s" : ""}`,
    ratingLabels: {
      1: "Décevant",
      2: "Moyen",
      3: "Bien",
      4: "Très bien",
      5: "Excellent",
    } as Record<number, string>,
    commentLabel: "Votre commentaire (facultatif)",
    commentPlaceholder: "L'appartement, l'emplacement, l'accueil…",
    authorLabel: "Votre prénom (affiché avec l'avis)",
    send: "Envoyer mon avis",
    sending: "Envoi…",
    disclaimer:
      "Votre avis est définitif une fois envoyé. Il sera publié sur la page de réservation après relecture par votre hôte, signé de votre prénom uniquement.",
  },

  contratPage: {
    linkNotFound: "Lien de contrat introuvable ou expiré.",
    errorShort: "Erreur",
    subtitle: "Contrat de location saisonnière",
    bookingRef: (ref: string) => `Réservation ${ref}`,
    weekOf: (range: string) => `Semaine du ${range}`,
    tenant: "Preneur :",
    arrival: "Arrivée :",
    signedNote: (date: string | null) =>
      `Contrat signé électroniquement${date ? ` le ${date}` : ""}.`,
    signatureAlt: "Signature du preneur",
    print: "Imprimer / Enregistrer en PDF",
    keepLink: "Conservez ce lien : il reste votre copie du contrat signé.",
    acceptLabel: "J'ai lu le contrat et les conditions générales, et je les accepte.",
    signHere: "Signez ici avec la souris ou le doigt",
    signButton: "Signer le contrat",
    signFailed: "La signature n'a pas pu être enregistrée.",
  },

  legal: {
    legalNoticeTitle: (site: string) => `Mentions légales — ${site}`,
    cgvTitle: (site: string) => `Conditions de location — ${site}`,
    privacyTitle: (site: string) => `Politique de confidentialité — ${site}`,
    cookiesTitle: (site: string) => `Cookies — ${site}`,
    lastUpdated: (date: string) => `Dernière mise à jour : ${date}`,
    allRightsReserved: (year: string, site: string) => `© ${year} ${site}. Tous droits réservés.`,
  },

  cookieBanner: {
    aria: "Information cookies",
    body: "Nous utilisons uniquement les cookies nécessaires au fonctionnement du site et au paiement sécurisé. Aucun traceur publicitaire.",
    learnMore: "En savoir plus",
    ok: "J'ai compris",
  },

  errorPage: {
    kicker: "UNE ERREUR EST SURVENUE",
    title: "Quelque chose s'est mal passé",
    body: "Merci de réessayer. Si le problème persiste, contactez-nous.",
    reference: "Référence :",
    retry: "Réessayer",
  },

  notFound: {
    kicker: "ERREUR 404",
    title: "Page introuvable",
    body: "La page que vous cherchez n'existe pas ou a été déplacée.",
    backHome: "Retour à l'accueil",
  },
};
