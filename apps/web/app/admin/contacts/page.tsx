"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, fmtEur, type Contact } from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
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

type Filter = "all" | "clients" | "prospects";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    adminApi.listContacts().then(setContacts).catch(() => setError(true));
  }, []);

  const rows = useMemo(() => {
    const all = contacts ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === "clients" && c.confirmedCount === 0) return false;
      if (filter === "prospects" && c.confirmedCount > 0) return false;
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
          {(["all", "clients", "prospects"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "h-9 rounded-md border px-3 text-sm " +
                (filter === f ? "bg-primary text-primary-foreground" : "bg-background")
              }
            >
              {f === "all" ? "Tous" : f === "clients" ? "Clients" : "Prospects"}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                Aucun contact.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.name ?? "—"}</div>
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
                  {c.confirmedCount > 0 ? (
                    <Badge variant="success">Client</Badge>
                  ) : (
                    <Badge variant="muted">Prospect</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
