// Client for the back-office API (/api/admin). Sends the HttpOnly session cookie
// cross-origin via credentials:"include"; on 401 it bounces to the login page.

import type { Amenity } from "@/lib/amenities";

export type Me = { id: string; email: string; displayName: string; isSuper: boolean };

export type AdminAccount = {
  id: string;
  email: string;
  displayName: string;
  isSuper: boolean;
  /** Invitation envoyée, mot de passe pas encore défini. */
  pending: boolean;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  adminId: string | null;
  adminName: string;
  method: string;
  path: string;
  createdAt: string;
};

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
  contractTemplate: string;
  ownerName: string;
  ownerAddress: string;
  ownerPhone: string;
  ownerEmail: string;
  ownerSiret: string;
  amenities: Amenity[];
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
  // Statut du dossier qui tient la semaine (pending_payment/confirmed/balance_paid).
  // Une semaine `booked` sans bookingReference est marquée réservée sans dossier.
  bookingStatus: string | null;
  blockedSource: string | null;
};

export type IcalFeed = {
  id: string;
  name: string;
  url: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  blockedWeeks: number;
};

export type IcalSyncOutcome = {
  feedId: string;
  name: string;
  blocked: number;
  unblocked: number;
  error: string | null;
};

export type RateTier = { key: string; label: string; priceCents: number; labelEn?: string };

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
  /** Traductions anglaises (vides = repli sur le français). */
  labelEn: string;
  descriptionEn: string;
};

/** Contenus traduits d'une propriété ({ en: { description, ... } }). */
export type PropertyTranslations = {
  en?: Partial<{
    description: string;
    surfaceLabel: string;
    specsLabel: string;
    highlightLabel: string;
    locationLabel: string;
    arrivalInstructions: string;
    houseRules: string;
    contractTemplate: string;
    instructionsCheque: string;
    instructionsVirement: string;
  }>;
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
  endDate: string;
  seasonId: string | null;
  adults: number;
  children: number;
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
  customerPhone: string | null;
  createdAt: string;
};

export type SignatureInfo = {
  signaturePng: string | null;
  contractVersion: string | null;
  signedAt: string | null;
  contractSha256: string | null;
  signedIp: string | null;
  userAgent: string | null;
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

export type SeasonFinance = {
  name: string;
  weeksTotal: number;
  weeksSellable: number;
  weeksBooked: number;
  revenueBookedCents: number;
  collectedCents: number;
  upcomingCents: number;
};

export type FinancesResponse = {
  summary: FinanceSummary;
  seasons: SeasonFinance[];
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
  emailsMuted: boolean;
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
  ownerName: string;
  ownerAddress: string;
  ownerSiret: string;
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

export type BookingEventEntry = {
  kind: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  createdAt: string;
};

export type BookingLine = {
  kind: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export type BookingDetail = {
  booking: BookingDetailInfo;
  lines: BookingLine[];
  payments: PaymentEntry[];
  emails: EmailEntry[];
  notes: NoteEntry[];
  events: BookingEventEntry[];
};

export type SalesInvoice = {
  number: string;
  issuedAt: string;
  seller: {
    propertyName: string;
    locationLabel: string;
    ownerName: string;
    ownerAddress: string;
    ownerSiret: string;
    vatMention: string;
  };
  customer: { name: string | null; email: string | null; phone: string | null; address: string | null };
  stay: {
    reference: string;
    startDate: string;
    nights: number;
    adults: number;
    minors: number;
    touristTaxCents: number;
    touristTaxIncluded: boolean;
    cautionCents: number;
  };
  lines: Array<{ kind: string; label: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  payment: {
    depositPct: number;
    depositCents: number;
    balanceCents: number;
    depositPaidAt: string | null;
    balancePaidAt: string | null;
    paidCents: number;
    remainingCents: number;
    settled: boolean;
  };
  totalCents: number;
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
  /** Réservations actives à venir — 0 pour un client passé = à relancer. */
  upcomingCount: number;
  totalPaidCents: number;
  lastActivity: string;
  createdAt: string;
  marketingConsent: boolean;
  marketingConsentedAt: string | null;
  marketingOptedOutAt: string | null;
};

export type EmailAutomation = {
  id: string;
  name: string;
  /** reservation | arrival | departure | cancellation */
  event: string;
  /** Décalage en jours par rapport à l'événement (négatif = avant). */
  offsetDays: number;
  /** all | online | manual */
  channel: string;
  /** Vide = client du dossier ; sinon adresse fixe (prestataire). */
  recipientEmail: string;
  subject: string;
  body: string;
  active: boolean;
  sentCount: number;
  createdAt: string;
};

export type EmailAutomationInput = Omit<EmailAutomation, "id" | "sentCount" | "createdAt">;

export type SystemEmail = {
  kind: string;
  label: string;
  trigger: string;
  vars: string[];
  defaultSubject: string;
  defaultBody: string;
  ctaLabel: string;
  subject: string | null;
  body: string | null;
  customized: boolean;
};

export type AdminReview = {
  id: string;
  bookingReference: string;
  weekRange: string;
  customerName: string | null;
  authorName: string;
  rating: number;
  comment: string;
  published: boolean;
  adminReply: string | null;
  submittedAt: string;
};

// --- Comptabilité (partie double) -----------------------------------------

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

export type LedgerEntryLine = {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  label: string;
  debitCents: number;
  creditCents: number;
  supplierName: string | null;
  bookingReference: string | null;
};

export type LedgerEntry = {
  id: string;
  journal: "VE" | "AC" | "BQ" | "OD";
  entryDate: string;
  piece: string;
  label: string;
  sourceType: string | null;
  reverses: string | null;
  reversedBy: string | null;
  createdAt: string;
  lines: LedgerEntryLine[];
};

export type NewLedgerEntry = {
  journal: "VE" | "AC" | "BQ" | "OD";
  entryDate: string;
  label: string;
  lines: { accountId: string; label?: string; debitCents: number; creditCents: number }[];
};

export type LedgerRow = {
  entryId: string;
  entryDate: string;
  journal: string;
  piece: string;
  entryLabel: string;
  lineLabel: string;
  debitCents: number;
  creditCents: number;
  runningCents: number;
};

export type LedgerResponse = {
  accountCode: string;
  accountName: string;
  openingCents: number;
  rows: LedgerRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  closingCents: number;
};

export type BalanceRow = {
  accountId: string;
  code: string;
  name: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

export type Supplier = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  iban: string;
  notes: string;
  defaultAccountId: string | null;
  isActive: boolean;
  invoiceCount: number;
  totalCents: number;
  unpaidCents: number;
};

export type SupplierInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
  iban: string;
  notes: string;
  defaultAccountId: string | null;
  isActive: boolean;
};

export type SupplierInvoice = {
  id: string;
  supplierId: string;
  supplierName: string;
  label: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amountCents: number;
  expenseAccountId: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  status: "a_payer" | "payee";
  paidDate: string | null;
  paymentAccountId: string | null;
  notes: string;
};

export type SupplierInvoiceInput = {
  supplierId: string;
  label: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amountCents: number;
  expenseAccountId: string;
  notes: string;
};

export type CashflowResponse = {
  accounts: { accountId: string; code: string; name: string; balanceCents: number }[];
  totalCents: number;
  monthly: { month: string; inCents: number; outCents: number }[];
  upcomingIn: {
    reference: string;
    customerName: string | null;
    dueDate: string;
    amountCents: number;
  }[];
  upcomingOut: {
    id: string;
    supplierName: string;
    label: string;
    dueDate: string | null;
    amountCents: number;
  }[];
  upcomingInTotalCents: number;
  upcomingOutTotalCents: number;
};

export type GlobalSettings = {
  transactionalEmailsEnabled: boolean;
  onlineBookingEnabled: boolean;
  payCardEnabled: boolean;
  payChequeEnabled: boolean;
  payVirementEnabled: boolean;
  instructionsCheque: string;
  instructionsVirement: string;
  reviewsEnabled: boolean;
  englishEnabled: boolean;
  chatbotEnabled: boolean;
  chatbotExtraContext: string;
  minBookingLeadDays: number;
};

export type ChatConversation = {
  id: string;
  locale: string;
  visitorName: string | null;
  visitorEmail: string | null;
  contactLeftAt: string | null;
  contactProcessedAt: string | null;
  messageCount: number;
  lastMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatConversationDetail = {
  conversation: ChatConversation;
  messages: { role: "user" | "assistant" | "contact"; content: string; createdAt: string }[];
};

export type CampaignFilters = {
  audience?: "all" | "clients" | "prospects";
  upcoming?: boolean | null;
  minStays?: number | null;
  lastActivityAfter?: string | null;
  lastActivityBefore?: string | null;
  city?: string | null;
  /** Sélection manuelle (page Contacts) : remplace tous les autres critères. */
  customerIds?: string[] | null;
};

export type Campaign = {
  id: string;
  subject: string;
  status: "draft" | "sent";
  recipientCount: number;
  sentCount: number;
  createdAt: string;
  sentAt: string | null;
};

export type CampaignDetail = {
  id: string;
  subject: string;
  body: string;
  filters: CampaignFilters;
  status: "draft" | "sent";
  recipientCount: number;
  createdAt: string;
  sentAt: string | null;
  recipients: {
    email: string;
    firstName: string;
    lastName: string;
    status: "pending" | "sent";
    sentAt: string | null;
  }[];
};

export type CampaignPreview = {
  count: number;
  sample: { customerId: string; email: string; firstName: string; lastName: string }[];
};

export type ReportLine = { code: string; name: string; cents: number };

export type ReportMeta = {
  years: number[];
  seasons: { id: string; name: string; startDate: string; endDate: string }[];
};

export type YearReport = {
  label: string;
  from: string;
  to: string;
  produits: ReportLine[];
  charges: ReportLine[];
  totalProduitsCents: number;
  totalChargesCents: number;
  resultatCents: number;
  actif: ReportLine[];
  passif: ReportLine[];
  totalActifCents: number;
  totalPassifCents: number;
  inCents: number;
  outCents: number;
};

export type SeasonReport = {
  label: string;
  from: string;
  to: string;
  produits: ReportLine[];
  charges: ReportLine[];
  totalProduitsCents: number;
  totalChargesCents: number;
  resultatCents: number;
  collectedCents: number;
  taxCents: number;
  weeksTotal: number;
  weeksBooked: number;
  revenueBookedCents: number;
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
  getPropertyTranslations: (slug: string) =>
    req<PropertyTranslations>(`/property/${slug}/translations`),
  updatePropertyTranslations: (slug: string, data: PropertyTranslations) =>
    req<PropertyTranslations>(`/property/${slug}/translations`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

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
  issueInvoice: (reference: string) =>
    req<SalesInvoice>(`/bookings/${reference}/invoice`, { method: "POST" }),
  clearFlag: (reference: string) =>
    req<void>(`/bookings/${reference}/clear-flag`, { method: "POST" }),
  sendContract: (reference: string) =>
    req<void>(`/bookings/${reference}/send-contract`, { method: "POST" }),
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
      country: string;
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
  listConversations: (email?: string) =>
    req<ChatConversation[]>(
      `/conversations${email ? `?email=${encodeURIComponent(email)}` : ""}`,
    ),
  conversationDetail: (id: string) =>
    req<ChatConversationDetail>(`/conversations/${id}`),
  setConversationProcessed: (id: string, processed: boolean) =>
    req<void>(`/conversations/${id}/processed`, {
      method: "POST",
      body: JSON.stringify({ processed }),
    }),
  replyConversation: (id: string, subject: string, message: string) =>
    req<void>(`/conversations/${id}/reply`, {
      method: "POST",
      body: JSON.stringify({ subject, message }),
    }),
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
      country: string;
    },
  ) => req<ContactInfo>(`/contacts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  addContactNote: (id: string, body: string) =>
    req<void>(`/contacts/${id}/note`, { method: "POST", body: JSON.stringify({ body }) }),
  sendContactEmail: (id: string, subject: string, message: string) =>
    req<void>(`/contacts/${id}/email`, {
      method: "POST",
      body: JSON.stringify({ subject, message }),
    }),
  listEmailAutomations: () => req<EmailAutomation[]>("/email-automations"),
  createEmailAutomation: (data: EmailAutomationInput) =>
    req<EmailAutomation>("/email-automations", { method: "POST", body: JSON.stringify(data) }),
  updateEmailAutomation: (id: string, data: EmailAutomationInput) =>
    req<EmailAutomation>(`/email-automations/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEmailAutomation: (id: string) =>
    req<void>(`/email-automations/${id}`, { method: "DELETE" }),
  listAdminUsers: () => req<AdminAccount[]>("/users"),
  createAdminUser: (data: { email: string; displayName: string }) =>
    req<AdminAccount>("/users", { method: "POST", body: JSON.stringify(data) }),
  reinviteAdminUser: (id: string) =>
    req<void>(`/users/${id}/reinvite`, { method: "POST" }),
  deleteAdminUser: (id: string) => req<void>(`/users/${id}`, { method: "DELETE" }),
  forgotPassword: (email: string) =>
    req<void>("/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  setPassword: (token: string, password: string) =>
    req<Me>("/password/set", { method: "POST", body: JSON.stringify({ token, password }) }),
  updateMe: (data: { displayName: string; email: string; currentPassword?: string }) =>
    req<Me>("/me", { method: "PUT", body: JSON.stringify(data) }),
  changeMyPassword: (currentPassword: string, newPassword: string) =>
    req<void>("/me/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listAudit: (cursor?: { before: string; beforeId: string }) => {
    const q = new URLSearchParams();
    if (cursor) {
      q.set("before", cursor.before);
      q.set("beforeId", cursor.beforeId);
    }
    const s = q.toString();
    return req<AuditEntry[]>(`/audit${s ? `?${s}` : ""}`);
  },
  emailStats: () =>
    req<{ kind: string; sent: number; delivered: number; opened: number; failed: number }[]>(
      "/email-stats",
    ),
  listSystemEmails: (locale = "fr") =>
    req<SystemEmail[]>(`/email-overrides?locale=${locale}`),
  saveSystemEmail: (kind: string, subject: string, body: string, locale = "fr") =>
    req<void>(`/email-overrides/${kind}?locale=${locale}`, {
      method: "PUT",
      body: JSON.stringify({ subject, body }),
    }),
  resetSystemEmail: (kind: string, locale = "fr") =>
    req<void>(`/email-overrides/${kind}?locale=${locale}`, { method: "DELETE" }),
  /** ctaLabel : non fourni = « Mon espace » (envoi client), "" = pas de bouton. */
  previewEmailAutomation: (subject: string, body: string, ctaLabel?: string) =>
    req<{ subject: string; html: string }>("/email-automations/preview", {
      method: "POST",
      body: JSON.stringify({ subject, body, ctaLabel }),
    }),
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

  listReviews: () => req<AdminReview[]>("/reviews"),
  updateReview: (id: string, data: { published?: boolean; adminReply?: string }) =>
    req<void>(`/reviews/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  requestReview: (reference: string) =>
    req<void>(`/bookings/${reference}/request-review`, { method: "POST" }),
  getIcalUrl: (slug: string) => req<{ url: string }>(`/property/${slug}/ical`),
  listIcalFeeds: (slug: string) => req<IcalFeed[]>(`/property/${slug}/ical-feeds`),
  createIcalFeed: (slug: string, data: { name: string; url: string }) =>
    req<IcalSyncOutcome[]>(`/property/${slug}/ical-feeds`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteIcalFeed: (id: string) => req<void>(`/ical-feeds/${id}`, { method: "DELETE" }),
  syncIcalFeeds: () => req<IcalSyncOutcome[]>("/ical-feeds/sync", { method: "POST" }),

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
  updateMedia: (id: string, data: { alt?: string; position?: number }) =>
    req<AdminMedia>(`/media/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMedia: (id: string) => req<void>(`/media/${id}`, { method: "DELETE" }),

  // --- Comptabilité ---------------------------------------------------------
  listAccounts: () => req<LedgerAccount[]>("/accounting/accounts"),
  createAccount: (data: { code: string; name: string }) =>
    req<{ id: string }>("/accounting/accounts", { method: "POST", body: JSON.stringify(data) }),
  updateAccount: (id: string, data: { name?: string; isActive?: boolean }) =>
    req<void>(`/accounting/accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteAccount: (id: string) =>
    req<void>(`/accounting/accounts/${id}`, { method: "DELETE" }),

  listEntries: (params?: {
    journal?: string;
    from?: string;
    to?: string;
    accountId?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.journal) q.set("journal", params.journal);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.accountId) q.set("accountId", params.accountId);
    const s = q.toString();
    return req<LedgerEntry[]>(`/accounting/entries${s ? `?${s}` : ""}`);
  },
  createEntry: (data: NewLedgerEntry) =>
    req<{ id: string }>("/accounting/entries", { method: "POST", body: JSON.stringify(data) }),
  reverseEntry: (id: string) =>
    req<{ id: string }>(`/accounting/entries/${id}/reverse`, { method: "POST" }),
  deleteEntry: (id: string) =>
    req<void>(`/accounting/entries/${id}`, { method: "DELETE" }),

  accountLedger: (accountId: string, params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const s = q.toString();
    return req<LedgerResponse>(`/accounting/ledger/${accountId}${s ? `?${s}` : ""}`);
  },
  trialBalance: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const s = q.toString();
    return req<BalanceRow[]>(`/accounting/balance${s ? `?${s}` : ""}`);
  },

  listSuppliers: () => req<Supplier[]>("/accounting/suppliers"),
  createSupplier: (data: SupplierInput) =>
    req<{ id: string }>("/accounting/suppliers", { method: "POST", body: JSON.stringify(data) }),
  updateSupplier: (id: string, data: SupplierInput) =>
    req<void>(`/accounting/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSupplier: (id: string) =>
    req<void>(`/accounting/suppliers/${id}`, { method: "DELETE" }),

  listSupplierInvoices: () => req<SupplierInvoice[]>("/accounting/supplier-invoices"),
  createSupplierInvoice: (data: SupplierInvoiceInput) =>
    req<{ id: string }>("/accounting/supplier-invoices", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSupplierInvoice: (id: string, data: SupplierInvoiceInput) =>
    req<void>(`/accounting/supplier-invoices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteSupplierInvoice: (id: string) =>
    req<void>(`/accounting/supplier-invoices/${id}`, { method: "DELETE" }),
  paySupplierInvoice: (id: string, data: { paidDate: string; paymentAccountId: string }) =>
    req<void>(`/accounting/supplier-invoices/${id}/pay`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  unpaySupplierInvoice: (id: string) =>
    req<void>(`/accounting/supplier-invoices/${id}/unpay`, { method: "POST" }),

  syncAccounting: () => req<{ created: number }>("/accounting/sync", { method: "POST" }),
  cashflow: () => req<CashflowResponse>("/accounting/cashflow"),
  getSettings: () => req<GlobalSettings>("/settings"),
  updateSettings: (data: Partial<GlobalSettings>) =>
    req<GlobalSettings>("/settings", { method: "PUT", body: JSON.stringify(data) }),
  setEmailsMuted: (reference: string, muted: boolean) =>
    req<void>(`/bookings/${reference}/emails-muted`, {
      method: "POST",
      body: JSON.stringify({ muted }),
    }),

  listCampaigns: () => req<Campaign[]>("/campaigns"),
  campaignDetail: (id: string) => req<CampaignDetail>(`/campaigns/${id}`),
  previewCampaign: (filters: CampaignFilters) =>
    req<CampaignPreview>("/campaigns/preview", {
      method: "POST",
      body: JSON.stringify({ filters }),
    }),
  createCampaign: (data: { subject: string; body: string; filters: CampaignFilters }) =>
    req<{ id: string }>("/campaigns", { method: "POST", body: JSON.stringify(data) }),
  updateCampaign: (id: string, data: { subject: string; body: string; filters: CampaignFilters }) =>
    req<void>(`/campaigns/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCampaign: (id: string) => req<void>(`/campaigns/${id}`, { method: "DELETE" }),
  sendCampaign: (id: string) =>
    req<{ sent: number }>(`/campaigns/${id}/send`, { method: "POST" }),

  reportMeta: () => req<ReportMeta>("/accounting/report/meta"),
  yearReport: (year: number) => req<YearReport>(`/accounting/report/year?year=${year}`),
  seasonReport: (seasonId: string) =>
    req<SeasonReport>(`/accounting/report/season?seasonId=${seasonId}`),
};

/** Valeur exacte en euros pour préremplir un champ de saisie (parseable par
 *  parseFloat après remplacement de la virgule) : 32250 -> "322,50", 100000 -> "1000". */
export const eurosInput = (cents: number) =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");

/** Format cents as euros, French style: 119000 -> "1 190 €", 32250 -> "322,50 €".
 *  Même règle que money() (lib/i18n) : 2 décimales dès que le montant a des centimes. */
export const fmtEur = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: cents % 100 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  }) + " €";

/** Labels for booking.paymentFlag (webhook-raised Stripe events). Shared so the
 *  dashboard and reservations list never diverge. */
export const PAYMENT_FLAG_LABEL: Record<string, string> = {
  refunded_externally: "Remboursé (Stripe)",
  disputed: "Litige Stripe",
};
