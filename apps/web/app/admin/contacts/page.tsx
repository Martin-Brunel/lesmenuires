"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminApi, fmtEur, type Contact } from "@/lib/admin-api";
import { csvDate, csvEur, downloadCsv } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

type Filter = "all" | "clients" | "prospects" | "relance";

/** Client fidèle sans séjour à venir : cible naturelle d'une relance saison. */
const needsFollowUp = (c: Contact) => c.confirmedCount > 0 && c.upcomingCount === 0;

const FILTER_LABEL: Record<Filter, string> = {
  all: "Tous",
  clients: "Clients",
  prospects: "Prospects",
  relance: "À relancer",
};

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Sélection manuelle (ids) pour créer une campagne ciblée.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    adminApi.listContacts().then(setContacts).catch(() => setError(true));
  }, []);

  const rows = useMemo(() => {
    const all = contacts ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === "clients" && c.confirmedCount === 0) return false;
      if (filter === "prospects" && c.confirmedCount > 0) return false;
      if (filter === "relance" && !needsFollowUp(c)) return false;
      if (!needle) return true;
      return (
        c.email.toLowerCase().includes(needle) ||
        (c.name ?? "").toLowerCase().includes(needle) ||
        (c.city ?? "").toLowerCase().includes(needle) ||
        c.phone.includes(needle)
      );
    });
  }, [contacts, q, filter]);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger les contacts.</p>;
  }
  if (!contacts) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const clients = contacts.filter((c) => c.confirmedCount > 0).length;
  const prospects = contacts.length - clients;

  // Lignes sélectionnables parmi celles affichées (les contacts sans e-mail sont exclus).
  const selectableRows = rows.filter((c) => c.email);
  const allDisplayedSelected =
    selectableRows.length > 0 && selectableRows.every((c) => selected.has(c.id));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllDisplayed = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allDisplayedSelected) selectableRows.forEach((c) => next.delete(c.id));
      else selectableRows.forEach((c) => next.add(c.id));
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          {contacts.length} contact(s) — {clients} client(s), {prospects} prospect(s).
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Rechercher (nom, e-mail, ville, téléphone)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex gap-1">
          {(["all", "clients", "prospects", "relance"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "h-9 rounded-md border px-3 text-sm " +
                (filter === f ? "bg-primary text-primary-foreground" : "bg-background")
              }
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          className="ml-auto"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              "contacts.csv",
              ["Nom", "E-mail", "Téléphone", "Ville", "Statut", "Résas confirmées", "Résas à venir", "Paniers", "Total réglé (€)", "Dernière activité"],
              rows.map((c) => [
                c.name ?? "",
                c.email,
                c.phone,
                c.city,
                c.confirmedCount > 0 ? (needsFollowUp(c) ? "Client à relancer" : "Client") : "Prospect",
                c.confirmedCount,
                c.upcomingCount,
                c.cartCount,
                csvEur(c.totalPaidCents),
                csvDate(c.lastActivity),
              ]),
            )
          }
        >
          Exporter CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[36px]">
              <input
                type="checkbox"
                aria-label="Tout sélectionner"
                title="Sélectionner tous les contacts affichés"
                checked={allDisplayedSelected}
                disabled={selectableRows.length === 0}
                onChange={toggleAllDisplayed}
              />
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Coordonnées</TableHead>
            <TableHead className="text-right">Réservations</TableHead>
            <TableHead className="text-right">Total réglé</TableHead>
            <TableHead>Dernière activité</TableHead>
            <TableHead>Statut</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-sm text-muted-foreground">
                Aucun contact.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${c.name ?? c.email}`}
                    checked={selected.has(c.id)}
                    disabled={!c.email}
                    title={c.email ? undefined : "Pas d'e-mail"}
                    onChange={() => toggleOne(c.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/admin/contacts/${c.id}`} className="font-medium text-primary underline underline-offset-2 hover:text-foreground">
                    {c.name ?? c.email}
                  </Link>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {c.phone || "—"}
                  {c.city ? ` · ${c.city}` : ""}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {c.confirmedCount > 0 && (
                    <span className="text-foreground">{c.confirmedCount} confirmée(s)</span>
                  )}
                  {c.cartCount > 0 && (
                    <span className="text-muted-foreground">
                      {c.confirmedCount > 0 ? " · " : ""}
                      {c.cartCount} panier(s)
                    </span>
                  )}
                  {c.bookingsCount === 0 && <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {fmtEur(c.totalPaidCents)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {frDate(c.lastActivity)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.confirmedCount > 0 ? (
                      <Badge variant="success">Client</Badge>
                    ) : (
                      <Badge variant="muted">Prospect</Badge>
                    )}
                    {needsFollowUp(c) && <Badge variant="warning">À relancer</Badge>}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </Card>

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center gap-3 flex-wrap rounded-lg border bg-background p-3 shadow-lg">
          <p className="text-sm font-medium">
            {selected.size} contact{selected.size > 1 ? "s" : ""} sélectionné
            {selected.size > 1 ? "s" : ""}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={() => setSelected(new Set())}>
              Tout désélectionner
            </Button>
            <Button
              onClick={() => {
                // Les IDs passent par sessionStorage : dans l'URL, une grosse
                // sélection dépasserait la limite et serait tronquée en silence.
                sessionStorage.setItem(
                  "campaignContacts",
                  JSON.stringify(Array.from(selected)),
                );
                router.push("/admin/campagnes?contacts=selection");
              }}
            >
              Créer une campagne
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
