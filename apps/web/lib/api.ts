// Typed client for the Rust API (apps/api). Mirrors its JSON DTOs.

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
};

export type ApiSeason = {
  name: string;
  startDate: string;
  endDate: string;
};

export type BookingContext = {
  property: ApiProperty;
  season: ApiSeason | null;
  weeks: ApiWeek[];
  products: ApiProduct[];
  media: ApiMedia[];
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
  };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** Absolute URL for a media path returned by the API (e.g. "/media/x.jpg"). */
export function mediaUrl(path: string) {
  return `${API_URL}${path}`;
}

export async function getBookingContext(slug: string): Promise<BookingContext> {
  const res = await fetch(`${API_URL}/api/booking-context/${slug}`, {
    // Availability/prices change — always read fresh.
    cache: "no-store",
  });
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

/** Persist the signed contract (version + drawn signature) before payment. */
export async function saveContract(
  reference: string,
  input: { contractVersion: string; signaturePng: string; accepted: boolean },
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

/** Confirm the deposit (also opens the customer session cookie). */
export async function confirmDeposit(reference: string): Promise<BookingResult> {
  const res = await fetch(`${API_URL}/api/bookings/${reference}/confirm-deposit`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `confirm-deposit: HTTP ${res.status}`);
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
export async function getMe(): Promise<MeResponse | null> {
  const res = await fetch(`${API_URL}/api/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me: HTTP ${res.status}`);
  return res.json();
}
