// Client for the back-office API (/api/admin). Sends the HttpOnly session cookie
// cross-origin via credentials:"include"; on 401 it bounces to the login page.

export type Me = { email: string; displayName: string };

export type AdminProperty = {
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
  arrivalInstructions: string;
  houseRules: string;
};

export type AdminWeek = {
  id: string;
  startDate: string;
  endDate: string;
  rangeLabel: string;
  subLabel: string;
  priceCents: number;
  status: string;
  position: number;
  seasonId: string | null;
  tierKey: string | null;
  bookingReference: string | null;
  bookingCustomer: string | null;
};

export type RateTier = { key: string; label: string; priceCents: number };

export type AdminSeason = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  rateTiers: RateTier[];
  position: number;
};

export type AdminProduct = {
  id: string;
  key: string;
  label: string;
  description: string;
  priceCents: number;
  active: boolean;
  position: number;
};

export type AdminMedia = {
  id: string;
  url: string;
  alt: string;
  position: number;
};

export type AdminBooking = {
  reference: string;
  status: string;
  weekRange: string;
  startDate: string;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  cautionCents: number;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  cautionReleasedAt: string | null;
  cautionCapturedCents: number | null;
  channel: string;
  paymentMethod: string | null;
  cautionMethod: string | null;
  depositRefundedCents: number;
  balanceRefundedCents: number;
  balanceAttempts: number;
  balanceLastError: string | null;
  cautionAttempts: number;
  cautionLastError: string | null;
  balanceOverdue: boolean;
  paymentFlag: string | null;
  contractSignedAt: string | null;
  contractVersion: string | null;
  customerEmail: string | null;
  customerName: string | null;
  createdAt: string;
};

export type SignatureInfo = {
  signaturePng: string | null;
  contractVersion: string | null;
  signedAt: string | null;
};

export type FinanceSummary = {
  depositsPaidCents: number;
  balancesPaidCents: number;
  refundsCents: number;
  cautionCapturedCents: number;
  netCollectedCents: number;
  touristTaxCollectedCents: number;
  upcomingBalancesCents: number;
  upcomingCount: number;
  touristTaxUpcomingCents: number;
};

export type TaxDeclarationRow = {
  reference: string;
  customerName: string | null;
  startDate: string;
  adults: number;
  nights: number;
  touristTaxCents: number;
  collected: boolean;
};

export type FinancesResponse = {
  summary: FinanceSummary;
  taxDeclaration: TaxDeclarationRow[];
};

export type BookingDetailInfo = {
  reference: string;
  status: string;
  channel: string;
  weekRange: string;
  arrival: string;
  startDate: string;
  adults: number;
  children: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  cautionCents: number;
  touristTaxCents: number;
  depositPct: number;
  paymentMethod: string | null;
  cautionMethod: string | null;
  adminNotes: string | null;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  cautionReleasedAt: string | null;
  cautionCapturedCents: number | null;
  depositRefundedCents: number;
  balanceRefundedCents: number;
  paymentFlag: string | null;
  balanceAttempts: number;
  balanceLastError: string | null;
  cautionAttempts: number;
  cautionLastError: string | null;
  contractVersion: string | null;
  contractSignedAt: string | null;
  contractText: string | null;
  hasSignature: boolean;
  createdAt: string;
  cancelledAt: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  arrivalInstructions: string;
  houseRules: string;
};

export type PaymentEntry = {
  kind: string;
  method: string | null;
  provider: string;
  amountCents: number;
  status: string;
  createdAt: string;
};

export type EmailEntry = {
  kind: string;
  subject: string;
  recipient: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
};

export type NoteEntry = {
  body: string;
  author: string | null;
  createdAt: string;
};

export type BookingDetail = {
  booking: BookingDetailInfo;
  payments: PaymentEntry[];
  emails: EmailEntry[];
  notes: NoteEntry[];
};

export type ContactInfo = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
  country: string;
  createdAt: string;
};

export type ContactBooking = {
  reference: string;
  status: string;
  channel: string;
  weekRange: string;
  startDate: string;
  totalCents: number;
  depositPaidAt: string | null;
  balancePaidAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
};

export type ContactNote = {
  bookingReference: string;
  body: string;
  author: string | null;
  createdAt: string;
};

export type ContactEmail = {
  bookingReference: string;
  kind: string;
  subject: string;
  status: string;
  createdAt: string;
  openedAt: string | null;
};

export type ContactDetail = {
  contact: ContactInfo;
  bookings: ContactBooking[];
  notes: ContactNote[];
  emails: ContactEmail[];
};

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  phone: string;
  city: string;
  bookingsCount: number;
  confirmedCount: number;
  cartCount: number;
  totalPaidCents: number;
  lastActivity: string;
  createdAt: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/admin/login") {
      window.location.href = "/admin/login";
    }
    throw new Error("Non authentifié");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const adminApi = {
  me: () => req<Me>("/me"),
  login: (email: string, password: string) =>
    req<Me>("/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: boolean }>("/logout", { method: "POST" }),

  getProperty: (slug: string) => req<AdminProperty>(`/property/${slug}`),
  updateProperty: (slug: string, data: Omit<AdminProperty, "slug">) =>
    req<AdminProperty>(`/property/${slug}`, { method: "PUT", body: JSON.stringify(data) }),

  listSeasons: (slug: string) => req<AdminSeason[]>(`/seasons?slug=${slug}`),
  createSeason: (data: {
    slug: string;
    name: string;
    startDate: string;
    endDate: string;
    rateTiers: RateTier[];
  }) => req<AdminSeason>("/seasons", { method: "POST", body: JSON.stringify(data) }),
  updateSeason: (
    id: string,
    data: {
      name: string;
      startDate: string;
      endDate: string;
      isActive: boolean;
      rateTiers: RateTier[];
    },
  ) => req<AdminSeason>(`/seasons/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSeason: (id: string) => req<void>(`/seasons/${id}`, { method: "DELETE" }),

  listWeeks: (slug: string, seasonId?: string) =>
    req<AdminWeek[]>(
      `/weeks?slug=${slug}${seasonId ? `&seasonId=${seasonId}` : ""}`,
    ),
  updateWeek: (
    id: string,
    data: { priceCents: number; status: string; subLabel: string; tierKey?: string },
  ) => req<AdminWeek>(`/weeks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  generateWeeks: (data: {
    seasonId: string;
    startDate: string;
    endDate: string;
    tierKey?: string;
    priceCents?: number;
  }) => req<AdminWeek[]>("/weeks/generate", { method: "POST", body: JSON.stringify(data) }),
  deleteWeek: (id: string) => req<void>(`/weeks/${id}`, { method: "DELETE" }),

  listProducts: () => req<AdminProduct[]>("/products"),
  createProduct: (data: Omit<AdminProduct, "id">) =>
    req<AdminProduct>("/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id: string, data: Omit<AdminProduct, "id">) =>
    req<AdminProduct>(`/products/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProduct: (id: string) => req<void>(`/products/${id}`, { method: "DELETE" }),

  listBookings: () => req<AdminBooking[]>("/bookings"),
  bookingDetail: (reference: string) =>
    req<BookingDetail>(`/bookings/${reference}/detail`),
  addNote: (reference: string, body: string) =>
    req<void>(`/bookings/${reference}/note`, { method: "POST", body: JSON.stringify({ body }) }),
  sendBookingEmail: (reference: string, subject: string, message: string) =>
    req<void>(`/bookings/${reference}/email`, {
      method: "POST",
      body: JSON.stringify({ subject, message }),
    }),
  createManualBooking: (data: {
    weekId: string;
    customer: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      addressLine: string;
      postalCode: string;
      city: string;
    };
    adults: number;
    children: number;
    paymentMethod: "cheque" | "virement";
    cautionMethod: "cheque" | "card";
    depositPaid: boolean;
    balancePaid: boolean;
    adminNotes: string;
  }) =>
    req<{ reference: string }>("/bookings/manual", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  markPaid: (
    reference: string,
    kind: "deposit" | "balance",
    method: "cheque" | "virement",
    date?: string,
  ) =>
    req<void>(`/bookings/${reference}/mark-paid`, {
      method: "POST",
      body: JSON.stringify({ kind, method, date }),
    }),
  finances: () => req<FinancesResponse>("/finances"),
  listContacts: () => req<Contact[]>("/contacts"),
  contactDetail: (id: string) => req<ContactDetail>(`/contacts/${id}`),
  updateContact: (
    id: string,
    data: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      addressLine: string;
      postalCode: string;
      city: string;
    },
  ) => req<ContactInfo>(`/contacts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  getSignature: (reference: string) =>
    req<SignatureInfo>(`/bookings/${reference}/signature`),
  cancelBooking: (
    reference: string,
    data: { reason: string; refundDepositCents: number; refundBalanceCents: number },
  ) =>
    req<void>(`/bookings/${reference}/cancel`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  captureCaution: (reference: string, amountCents: number) =>
    req<void>(`/bookings/${reference}/caution/capture`, {
      method: "POST",
      body: JSON.stringify({ amountCents }),
    }),
  releaseCaution: (reference: string) =>
    req<void>(`/bookings/${reference}/caution/release`, { method: "POST" }),
  refundPayment: (reference: string, amountCents: number, paymentType: string) =>
    req<void>(`/bookings/${reference}/refund`, {
      method: "POST",
      body: JSON.stringify({ amountCents, paymentType }),
    }),

  listMedia: (slug: string) => req<AdminMedia[]>(`/property/${slug}/media`),
  uploadMedia: async (slug: string, file: File): Promise<AdminMedia> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_URL}/api/admin/property/${slug}/media`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (res.status === 401) {
      if (typeof window !== "undefined") window.location.href = "/admin/login";
      throw new Error("Non authentifié");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },
  updateMedia: (id: string, data: { alt: string; position: number }) =>
    req<AdminMedia>(`/media/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMedia: (id: string) => req<void>(`/media/${id}`, { method: "DELETE" }),
};

/** Format cents as euros, French style: 119000 -> "1 190 €". */
export const fmtEur = (cents: number) => (cents / 100).toLocaleString("fr-FR") + " €";

/** Labels for booking.paymentFlag (webhook-raised Stripe events). Shared so the
 *  dashboard and reservations list never diverge. */
export const PAYMENT_FLAG_LABEL: Record<string, string> = {
  refunded_externally: "Remboursé (Stripe)",
  disputed: "Litige Stripe",
};
