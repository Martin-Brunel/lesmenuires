"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, type AuditEntry } from "@/lib/admin-api";
import { Avatar } from "@/components/admin/Avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PAGE_SIZE = 100; // aligné sur AUDIT_PAGE_SIZE côté API

const dt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** Traduit une entrée du journal (méthode + chemin) en action lisible. */
function humanize(e: AuditEntry): string {
  const p = e.path.replace(/^\/api\/admin/, "");
  const ref = p.match(/\/bookings\/([A-Z0-9-]+)\//)?.[1];
  const rules: [RegExp, string][] = [
    [/^\/login$/, "Connexion"],
    [/\/mark-paid$/, `Échéance pointée${ref ? ` · ${ref}` : ""}`],
    [/\/refund$/, `Remboursement · ${ref}`],
    [/\/cancel$/, `Annulation · ${ref}`],
    [/\/caution\/capture$/, `Caution débitée · ${ref}`],
    [/\/caution\/release$/, `Caution clôturée · ${ref}`],
    [/\/clear-flag$/, `Incident levé · ${ref}`],
    [/^\/bookings\/manual$/, "Réservation manuelle créée"],
    [/^\/bookings\/[^/]+\/note$/, `Note ajoutée · ${ref ?? "dossier"}`],
    [/^\/bookings\/[^/]+\/email$/, `E-mail envoyé · ${ref ?? "dossier"}`],
    [/^\/contacts\/[^/]+\/email$/, "E-mail envoyé à un contact"],
    [/^\/contacts\/[^/]+\/note$/, "Note ajoutée sur un contact"],
    [/^\/contacts\/[^/]+$/, "Fiche contact modifiée"],
    [/^\/property\//, e.method === "POST" ? "Photo ajoutée" : "Contenu éditorial modifié"],
    [/^\/media\//, e.method === "DELETE" ? "Photo supprimée" : "Photo modifiée"],
    [/^\/seasons$/, "Saison créée"],
    [/^\/seasons\//, e.method === "DELETE" ? "Saison supprimée" : "Saison modifiée"],
    [/^\/weeks\/generate$/, "Semaines générées"],
    [/^\/weeks\//, e.method === "DELETE" ? "Semaine supprimée" : "Semaine modifiée"],
    [/^\/products$/, "Prestation créée"],
    [/^\/products\//, e.method === "DELETE" ? "Prestation supprimée" : "Prestation modifiée"],
    [/^\/email-automations$/, "Transactionnel créé"],
    [
      /^\/email-automations\//,
      e.method === "DELETE" ? "Transactionnel supprimé" : "Transactionnel modifié",
    ],
    [/^\/users$/, "Compte admin créé"],
    [/^\/users\//, "Compte admin supprimé"],
    [/^\/me\/password$/, "Mot de passe modifié"],
    [/^\/me$/, "Compte modifié"],
    [/^\/settings$/, "Réglages modifiés"],
    [/\/emails-muted$/, `E-mails automatiques basculés${ref ? ` · ${ref}` : ""}`],
    [/^\/campaigns\/preview$/, "Aperçu de campagne"],
    [/^\/campaigns$/, "Campagne créée"],
    [/\/campaigns\/[^/]+\/send$/, "Campagne envoyée"],
    [/^\/campaigns\//, e.method === "DELETE" ? "Campagne supprimée" : "Campagne modifiée"],
    [/^\/accounting\/sync$/, "Synchronisation comptable"],
    [/^\/accounting\/entries\/[^/]+\/reverse$/, "Écriture extournée"],
    [/^\/accounting\/entries/, e.method === "DELETE" ? "Écriture supprimée" : "Écriture saisie"],
    [/^\/accounting\/accounts/, "Plan comptable modifié"],
    [/^\/accounting\/supplier-invoices\/[^/]+\/(un)?pay$/, "Règlement fournisseur pointé"],
    [
      /^\/accounting\/supplier-invoices/,
      e.method === "DELETE" ? "Facture fournisseur supprimée" : "Facture fournisseur saisie",
    ],
    [/^\/accounting\/suppliers/, "Fournisseur modifié"],
    [/^\/scheduler\/run$/, "Planificateur lancé manuellement"],
    [/^\/logout$/, "Déconnexion"],
  ];
  for (const [re, label] of rules) if (re.test(p) || re.test(e.path)) return label;
  return `${e.method} ${p}`;
}

export default function JournalPage() {
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    adminApi
      .listAudit()
      .then((rows) => {
        setAudit(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => setError(true));
  }, []);

  const loadMore = async () => {
    if (!audit || audit.length === 0 || loadingMore) return;
    const last = audit[audit.length - 1];
    setLoadingMore(true);
    try {
      const rows = await adminApi.listAudit({ before: last.createdAt, beforeId: last.id });
      setAudit([...audit, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const rows = useMemo(() => {
    if (!audit) return [];
    const q = query.trim().toLowerCase();
    if (!q) return audit;
    return audit.filter(
      (e) =>
        e.adminName.toLowerCase().includes(q) || humanize(e).toLowerCase().includes(q),
    );
  }, [audit, query]);

  if (error) return <p className="text-sm text-destructive">Impossible de charger le journal.</p>;
  if (!audit) return <p className="text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal d&apos;activité</h1>
          <p className="text-sm text-muted-foreground">
            Toutes les actions effectuées dans le back-office, signées par leur auteur.
          </p>
        </div>
        <Input
          placeholder="Filtrer (auteur, action, référence…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? "Aucune action ne correspond au filtre." : "Aucune action enregistrée."}
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <Avatar name={e.adminName} size={26} />
                  <span className="font-medium">{e.adminName}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">
                    {humanize(e)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{dt(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <div className="flex justify-center pt-3">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Chargement…" : "Charger plus"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
