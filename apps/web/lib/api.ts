import type { Amenity } from "@/lib/amenities";

// Typed client for the Rust API (apps/api). Mirrors its JSON DTOs.

/** Error carrying the HTTP status, so callers can tell a definitive rejection
 *  (4xx — e.g. the week was taken and the deposit refunded) from a transient
 *  failure (network / 5xx) that a retry or the webhook will still resolve. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiProperty = {
  slug: string;
  name: string;
  locationLabel: string;
  description: string;
  surfaceLabel: string;
  capacity: number;
  bedrooms: number;
  specsLabel: string;
  highlightLabel: string;
  heroSeed: string;
  depositPct: number;
  cautionCents: number;
  touristTaxCents: number;
  touristTaxIncluded: boolean;
  ownerName: string;
  ownerAddress: string;
  onlineBookingEnabled: boolean;
  payCardEnabled: boolean;
  payChequeEnabled: boolean;
  payVirementEnabled: boolean;
  instructionsCheque: string;
  instructionsVirement: string;
  contractTemplate: string;
  amenities: Amenity[];
};

export type ApiWeek = {
  id: string;
  startDate: string;
  range: string;
  sub: string;
  priceCents: number;
  status: string;
  booked: boolean;
  arrival: string;
  arrShort: string;
  depShort: string;
  balanceDue: string;
};

export type ApiProduct = {
  key: string;
  label: string;
  description: string;
  priceCents: number;
};

export type ApiMedia = {
  url: string;
  alt: string;
  /** Largeurs des variantes redimensionnées disponibles (px), vide = original seul. */
  widths: number[];
};

export type ApiSeason = {
  name: string;
  startDate: string;
  endDate: string;
};

export type ApiReview = {
  authorName: string;
  rating: number;
  comment: string;
  adminReply: string | null;
  submittedAt: string;
};

export type BookingContext = {
  property: ApiProperty;
  season: ApiSeason | null;
  weeks: ApiWeek[];
  products: ApiProduct[];
  media: ApiMedia[];
  reviews: ApiReview[];
};

export type BookingResult = {
  reference: string;
  status: string;
  weekPriceCents: number;
  extrasTotalCents: number;
  totalCents: number;
  depositPct: number;
  depositCents: number;
  balanceCents: number;
  cautionCents: number;
  touristTaxCents: number;
  createdAt: string;
};

export type CreateBookingInput = {
  propertySlug: string;
  weekId: string;
  extras: string[];
  adults?: number;
  children?: number;
  customer?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    addressLine?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    /** Langue du client (fr/en) — détermine la langue des e-mails. */
    locale?: string;
  };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Absolute URL for a media path returned by the API (e.g. "/media/x.jpg"). */
export function mediaUrl(path: string) {
  return `${API_URL}${path}`;
}

/** URL de la plus petite variante suffisante pour `targetWidth` px d'affichage
 *  (fichiers `<stem>-w<width>.jpg` générés à l'upload) ; à défaut, l'original. */
export function mediaVariant(m: ApiMedia, targetWidth: number) {
  const fit = (m.widths ?? [])
    .filter((w) => w >= targetWidth)
    .sort((a, b) => a - b)[0];
  if (!fit) return mediaUrl(m.url);
  return mediaUrl(`${m.url.replace(/\.[^./]+$/, "")}-w${fit}.jpg`);
}

export async function getPublicSettings(): Promise<{
  englishEnabled: boolean;
  chatbotEnabled: boolean;
}> {
  const res = await fetch(`${API_URL}/api/public-settings`, { cache: "no-store" });
  if (!res.ok) return { englishEnabled: true, chatbotEnabled: false };
  return res.json();
}

export async function sendChatMessage(input: {
  sessionToken?: string;
  message: string;
  locale: string;
}): Promise<{ sessionToken: string; reply: string }> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `chat: HTTP ${res.status}`, res.status);
  }
  return res.json();
}

export async function sendChatContact(input: {
  sessionToken?: string;
  name: string;
  email: string;
  message: string;
  locale: string;
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/chat/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `chat-contact: HTTP ${res.status}`, res.status);
  }
}

export async function getBookingContext(
  slug: string,
  locale = "fr",
): Promise<BookingContext> {
  const res = await fetch(
    `${API_URL}/api/booking-context/${slug}?locale=${locale}`,
    {
      // Availability/prices change — always read fresh.
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`booking-context: HTTP ${res.status}`);
  return res.json();
}

export async function createBooking(
  input: CreateBookingInput,
): Promise<BookingResult> {
  const res = await fetch(`${API_URL}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `bookings: HTTP ${res.status}`);
  }
  return res.json();
}

export type ResumeData = {
  reference: string;
  weekId: string;
  adults: number;
  children: number;
  extras: string[];
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    addressLine: string;
    postalCode: string;
    city: string;
  };
};

/** Restore an abandoned cart (reminder e-mail link `/reserver?ref=…`).
 *  Only works while the booking is still a cart; 404 otherwise. */
export async function resumeBooking(reference: string): Promise<ResumeData> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/resume`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `resume: HTTP ${res.status}`);
  }
  return res.json();
}

/** Persist the signed contract (version + drawn signature) before payment. */
export async function saveContract(
  reference: string,
  input: {
    contractVersion: string;
    signaturePng: string;
    accepted: boolean;
    contractText: string;
  },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/contract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `contract: HTTP ${res.status}`);
  }
}

export type PayDepositResult = {
  provider: string;
  clientSecret: string;
  publishableKey: string | null;
  depositCents: number;
};

/** Create the deposit PaymentIntent for a booking. */
export async function payDeposit(reference: string): Promise<PayDepositResult> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/pay-deposit`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `pay-deposit: HTTP ${res.status}`);
  }
  return res.json();
}

export type OfflineMethod = "cheque" | "virement";

/** Finalise sans paiement en ligne (chèque/virement) : la semaine est retenue,
 *  la réservation passe en `pending_payment` jusqu'au pointage de l'acompte. */
export async function reserveOffline(
  reference: string,
  method: OfflineMethod,
): Promise<{ status: string; reference: string }> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/reserve-offline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `reserve-offline: HTTP ${res.status}`);
  }
  return res.json();
}

/** Confirm the deposit (also opens the customer session cookie). The deposit
 *  client_secret is sent as proof of ownership: the server only mints the session
 *  cookie for a caller that presents it (the booking reference alone is public). */
export async function confirmDeposit(
  reference: string,
  clientSecret?: string,
): Promise<BookingResult> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/confirm-deposit`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientSecret: clientSecret ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `confirm-deposit: HTTP ${res.status}`, res.status);
  }
  return res.json();
}

/** Start an online balance payment (fallback for a failed off-session charge). */
export async function payBalance(reference: string): Promise<PayDepositResult> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/pay-balance`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `pay-balance: HTTP ${res.status}`);
  }
  return res.json();
}

/** Confirm the online balance payment once completed in the browser. */
export async function confirmBalance(reference: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/confirm-balance`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `confirm-balance: HTTP ${res.status}`);
  }
}

export type MyBooking = {
  reference: string;
  status: string;
  weekRange: string;
  arrival: string;
  startDate: string;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  cautionCents: number;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  cautionAuthorizedAt: string | null;
  cancelledAt: string | null;
  touristTaxCents: number;
  balancePayable: boolean;
  balanceFailed: boolean;
  /** Jeton du contrat signé — copie consultable sur /contrat/{token}. */
  contractToken: string | null;
  createdAt: string;
};

export type MeProperty = {
  name: string;
  locationLabel: string;
  arrivalInstructions: string;
  houseRules: string;
};

export type MeResponse = {
  customer: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    addressLine: string;
    postalCode: string;
    city: string;
  };
  property: MeProperty | null;
  bookings: MyBooking[];
};

export type ReviewLink = {
  propertyName: string;
  locationLabel: string;
  weekRange: string;
  firstName: string | null;
  submitted: boolean;
  rating: number | null;
  comment: string | null;
};

/** Le contexte d'une demande d'avis (jeton reçu par e-mail après le séjour). */
export async function getReviewLink(token: string): Promise<ReviewLink> {
  const res = await fetch(`${API_URL}/api/avis/${token}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`avis: HTTP ${res.status}`);
  return res.json();
}

/** Dépose l'avis (une seule fois par séjour). */
export async function submitReview(
  token: string,
  input: { rating: number; comment: string; authorName: string },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/avis/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `avis: HTTP ${res.status}`);
  }
}

/** Request a magic login link by e-mail (always resolves; never leaks existence). */
export async function requestEspaceLink(email: string): Promise<void> {
  await fetch(`${API_URL}/api/espace/request-link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }).catch(() => {});
}

/** Close the espace session. */
export async function logoutEspace(): Promise<void> {
  await fetch(`${API_URL}/api/espace/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}

/** The logged-in customer + their bookings, or null if no session. */
export async function getMe(locale = "fr"): Promise<MeResponse | null> {
  const res = await fetch(`${API_URL}/api/me?locale=${locale}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me: HTTP ${res.status}`);
  return res.json();
}
