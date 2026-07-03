"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { adminApi, fmtEur, type ContactDetail, type ContactInfo } from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { CountryField } from "@/components/admin/CountryField";
import { countryName } from "@/lib/countries";

const STATUS_LABEL: Record<string, string> = {
  cart: "Panier",
  confirmed: "Confirmée",
  balance_paid: "Soldée",
  cancelled: "Annulée",
  expired: "Expirée",
};
const STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  cart: "warning",
  confirmed: "success",
  balance_paid: "success",
  cancelled: "destructive",
  expired: "muted",
};
const EMAIL_KIND: Record<string, string> = {
  welcome: "Confirmation",
  magic_link: "Lien de connexion",
  balance_paid: "Solde réglé",
  balance_prenotify: "Prélèvement à venir",
  payment_issue: "Incident de paiement",
  cart_reminder: "Relance panier",
  arrival_reminder: "Rappel avant arrivée",
  automation: "E-mail automatique",
  contract_request: "Contrat à signer",
  cancellation: "Annulation",
  manual: "E-mail manuel",
};

const dt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const dd = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

type Ev = { at: string; title: string; detail?: string; ref?: string };

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<ContactDetail | null>(null);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  const saveNote = async () => {
    const body = (noteDraft ?? "").trim();
    if (!body || noteBusy) return;
    setNoteBusy(true);
    try {
      await adminApi.addContactNote(id, body);
      setNoteDraft(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setNoteBusy(false);
    }
  };

  const reload = useCallback(() => {
    adminApi
      .contactDetail(id)
      .then((r) => {
        setData(r);
        setError(false);
      })
      .catch(() => setError(true));
  }, [id]);
  useEffect(() => reload(), [reload]);

  if (error) return <p className="text-sm text-destructive">Contact introuvable.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const c = data.contact;
  const name = `${c.firstName} ${c.lastName}`.trim() || c.email;
  const isClient = data.bookings.some((b) => b.status === "confirmed" || b.status === "balance_paid");
  const totalPaid = data.bookings.reduce(
    (a, b) => a + (b.depositPaidAt ? 0 : 0),
    0,
  );

  // History timeline: bookings created + notes + emails, most recent first.
  const events: Ev[] = [];
  data.bookings.forEach((b) =>
    events.push({ at: b.createdAt, title: `Réservation ${STATUS_LABEL[b.status] ?? b.status}`, detail: b.weekRange, ref: b.reference }),
  );
  data.notes.forEach((n) =>
    events.push({ at: n.createdAt, title: "Note interne", detail: n.body + (n.author ? ` — ${n.author}` : ""), ref: n.bookingReference }),
  );
  data.emails.forEach((e) =>
    events.push({
      at: e.createdAt,
      title: `E-mail : ${EMAIL_KIND[e.kind] ?? e.kind}`,
      detail: e.openedAt ? "ouvert" : e.status,
      ref: e.bookingReference,
    }),
  );
  events.sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/contacts" className="text-sm text-primary underline underline-offset-2">
          ‹ Contacts
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <div className="flex items-center gap-2">
            <Badge variant={isClient ? "success" : "muted"}>{isClient ? "Client" : "Prospect"}</Badge>
            <Button size="sm" disabled={!c.email} onClick={() => setEmailOpen(true)}>
              Envoyer un e-mail
            </Button>
            {!edit && (
              <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>
                Modifier
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Coordonnées</CardTitle></CardHeader>
          <CardContent>
            {edit ? (
              <ContactForm contact={c} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />
            ) : (
              <div className="space-y-1.5 text-sm">
                <Row label="Nom" value={name} />
                <Row label="E-mail" value={c.email} />
                <Row label="Téléphone" value={c.phone || "—"} />
                <Row
                  label="Adresse"
                  value={[c.addressLine, [c.postalCode, c.city].filter(Boolean).join(" "), countryName(c.country)].filter(Boolean).join(", ") || "—"}
                />
                <Row label="Fiche créée le" value={dt(c.createdAt)} muted />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Réservations ({data.bookings.length})</CardTitle></CardHeader>
          <CardContent>
            {data.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune réservation.</p>
            ) : (
              <ul className="divide-y">
                {data.bookings.map((b) => (
                  <li key={b.reference} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <Link
                        href={`/admin/reservations/${b.reference}`}
                        className="font-medium text-primary underline underline-offset-2 hover:text-foreground"
                      >
                        {b.reference}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {b.weekRange} · {dd(b.startDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{fmtEur(b.totalCents)}</span>
                      <Badge variant={STATUS_VARIANT[b.status] ?? "muted"}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Historique
            {noteDraft === null && (
              <Button size="sm" variant="secondary" onClick={() => setNoteDraft("")}>
                Ajouter une note
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {noteDraft !== null && (
            <div className="mb-4 space-y-2">
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                rows={3}
                placeholder="Note interne sur ce contact…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setNoteDraft(null)} disabled={noteBusy}>
                  Annuler
                </Button>
                <Button size="sm" onClick={saveNote} disabled={noteBusy || !(noteDraft ?? "").trim()}>
                  {noteBusy ? "…" : "Enregistrer la note"}
                </Button>
              </div>
            </div>
          )}
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune activité.</p>
          ) : (
            <ol className="relative space-y-4 border-l pl-5">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[23px] top-1.5 size-2.5 rounded-full bg-muted-foreground/40 ring-4 ring-background" />
                  <div className="text-sm font-medium">
                    {e.title}
                    {e.ref && (
                      <Link href={`/admin/reservations/${e.ref}`} className="ml-2 text-xs font-normal text-primary underline underline-offset-2">
                        {e.ref}
                      </Link>
                    )}
                  </div>
                  {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
                  <div className="text-xs text-muted-foreground">{dt(e.at)}</div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      {emailOpen && c.email && (
        <ContactEmailDialog
          contactId={c.id}
          to={c.email}
          onClose={() => setEmailOpen(false)}
          onSent={() => {
            setEmailOpen(false);
            reload();
          }}
        />
      )}
      {/* totalPaid placeholder retained for future KPI */}
      <span className="hidden">{totalPaid}</span>
    </div>
  );
}

function ContactEmailDialog({
  contactId,
  to,
  onClose,
  onSent,
}: {
  contactId: string;
  to: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!subject.trim() || !message.trim() || busy) return;
    setBusy(true);
    try {
      await adminApi.sendContactEmail(contactId, subject, message);
      toast.success("E-mail envoyé.");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Envoyer un e-mail au contact"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button size="sm" onClick={send} disabled={busy || !subject.trim() || !message.trim()}>
            {busy ? "…" : "Envoyer"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Destinataire : {to}</p>
        <Input placeholder="Sujet" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          rows={6}
          placeholder="Votre message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Le message est habillé du modèle du site et journalisé sur la fiche.
        </p>
      </div>
    </Modal>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "text-right font-medium"}>{value}</span>
    </div>
  );
}

function ContactForm({
  contact,
  onCancel,
  onSaved,
}: {
  contact: ContactInfo;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(contact.firstName);
  const [lastName, setLastName] = useState(contact.lastName);
  const [email, setEmail] = useState(contact.email);
  const [phone, setPhone] = useState(contact.phone);
  const [addressLine, setAddressLine] = useState(contact.addressLine);
  const [postalCode, setPostalCode] = useState(contact.postalCode);
  const [city, setCity] = useState(contact.city);
  const [country, setCountry] = useState(contact.country);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy || !/.+@.+\..+/.test(email)) {
      if (!/.+@.+\..+/.test(email)) toast.error("E-mail invalide.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.updateContact(contact.id, {
        firstName,
        lastName,
        email,
        phone,
        addressLine,
        postalCode,
        city,
        country,
      });
      toast.success("Contact mis à jour.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <Input placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <Input placeholder="Adresse" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Code postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        <Input placeholder="Ville" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <CountryField value={country} onChange={setCountry} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
