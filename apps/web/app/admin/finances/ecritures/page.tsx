"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  adminApi,
  fmtEur,
  type LedgerAccount,
  type LedgerEntry,
  type NewLedgerEntry,
} from "@/lib/admin-api";
import { DateField } from "@/components/admin/DateField";
import { HelpCard } from "@/components/admin/HelpCard";
import { useConfirm } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Journal = NewLedgerEntry["journal"];

const JOURNALS: { value: Journal; label: string }[] = [
  { value: "VE", label: "VE — Ventes" },
  { value: "AC", label: "AC — Achats" },
  { value: "BQ", label: "BQ — Banque" },
  { value: "OD", label: "OD — Opérations diverses" },
];

const JOURNAL_BADGE: Record<Journal, "success" | "warning" | "secondary" | "muted"> = {
  VE: "success",
  AC: "warning",
  BQ: "secondary",
  OD: "muted",
};

const JOURNAL_NAMES: Record<Journal, string> = {
  VE: "Ventes",
  AC: "Achats",
  BQ: "Banque",
  OD: "Opérations diverses",
};

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function EcrituresPage() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [loadError, setLoadError] = useState(false);

  // Filtres
  const [journal, setJournal] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const confirm = useConfirm();

  const reload = useCallback(() => {
    adminApi
      .listEntries({
        journal: journal || undefined,
        from: from || undefined,
        to: to || undefined,
        accountId: accountId || undefined,
      })
      .then((e) => {
        setEntries(e);
        setLoadError(false);
      })
      .catch(() => {
        setLoadError(true);
        toast.error("Impossible de charger les écritures.");
      });
  }, [journal, from, to, accountId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    adminApi
      .listAccounts()
      .then(setAccounts)
      .catch(() => toast.error("Impossible de charger le plan comptable."));
  }, []);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  const sync = async () => {
    setSyncing(true);
    try {
      const { created } = await adminApi.syncAccounting();
      toast.success(`${created} écriture(s) générée(s).`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la synchronisation.");
    } finally {
      setSyncing(false);
    }
  };

  const reverse = async (entry: LedgerEntry) => {
    if (
      !(await confirm({
        title: "Extourner l'écriture ?",
        description: `Une écriture inverse va être créée pour annuler « ${entry.piece} — ${entry.label} ». Les deux resteront visibles (piste d'audit). Continuer ?`,
        confirmLabel: "Extourner",
      }))
    )
      return;
    setBusyId(entry.id);
    try {
      await adminApi.reverseEntry(entry.id);
      toast.success("Écriture extournée.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'extourne.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: LedgerEntry) => {
    if (
      !(await confirm({
        title: "Supprimer l'écriture ?",
        description: `« ${entry.piece} — ${entry.label} » sera définitivement supprimée.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    setBusyId(entry.id);
    try {
      await adminApi.deleteEntry(entry.id);
      toast.success("Écriture supprimée.");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la suppression.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Écritures comptables</h1>
          <p className="text-sm text-muted-foreground">
            Journaux : VE (ventes), AC (achats), BQ (banque), OD (opérations diverses).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={sync} disabled={syncing}>
            {syncing ? "Synchronisation…" : "Synchroniser les flux"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Nouvelle écriture (OD)</Button>
        </div>
      </div>

      <HelpCard id="ecritures">
        <p>
          Chaque opération (réservation, encaissement, facture…) est enregistrée en{" "}
          <b>écriture</b> : au moins deux lignes qui s&apos;équilibrent, une au <b>débit</b>, une
          au <b>crédit</b>.
        </p>
        <p>
          Lecture rapide : sur un compte de <b>banque</b>, débit = argent qui entre, crédit =
          argent qui sort. Sur un compte de <b>produits</b> (7xx), le crédit = revenu gagné ; sur
          un compte de <b>charges</b> (6xx), le débit = dépense.
        </p>
        <p>
          Les écritures marquées <b>auto</b> sont générées depuis les réservations et paiements —
          vous n&apos;avez rien à saisir. Une écriture ne se supprime pas : elle s&apos;
          <b>extourne</b> (une écriture inverse l&apos;annule, tout reste tracé).
        </p>
        <p>
          Ex. : un acompte de 310 € encaissé → débit 517000 Stripe (+310 €), crédit 411000
          Clients (le client doit 310 € de moins).
        </p>
      </HelpCard>

      <div className="flex items-end flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label>Journal</Label>
          <select
            value={journal}
            onChange={(e) => setJournal(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Tous</option>
            {JOURNALS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Du</Label>
          <DateField value={from} onChange={setFrom} className="w-32" />
        </div>
        <div className="space-y-1.5">
          <Label>Au</Label>
          <DateField value={to} onChange={setTo} className="w-32" />
        </div>
        <div className="space-y-1.5">
          <Label>Compte</Label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-9 max-w-72 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Tous les comptes</option>
            {sortedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">
          Impossible de charger les écritures. Rechargez la page.
        </p>
      ) : entries === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Aucune écriture — cliquez sur « Synchroniser les flux » pour générer les écritures des
          réservations existantes.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Compte</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead className="text-right w-[120px]">Débit</TableHead>
                <TableHead className="text-right w-[120px]">Crédit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const totalDebit = entry.lines.reduce((a, l) => a + l.debitCents, 0);
                const totalCredit = entry.lines.reduce((a, l) => a + l.creditCents, 0);
                const canDelete =
                  entry.sourceType === null && !entry.reverses && !entry.reversedBy;
                return (
                  <EntryRows
                    key={entry.id}
                    entry={entry}
                    totalDebit={totalDebit}
                    totalCredit={totalCredit}
                    canDelete={canDelete}
                    busy={busyId === entry.id}
                    onReverse={() => reverse(entry)}
                    onDelete={() => remove(entry)}
                  />
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateEntryModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        accounts={sortedAccounts}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
      />
    </div>
  );
}

function EntryRows({
  entry,
  totalDebit,
  totalCredit,
  canDelete,
  busy,
  onReverse,
  onDelete,
}: {
  entry: LedgerEntry;
  totalDebit: number;
  totalCredit: number;
  canDelete: boolean;
  busy: boolean;
  onReverse: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={5} className="py-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-sm">{frDate(entry.entryDate)}</span>
              <span className="font-mono text-xs text-muted-foreground">{entry.piece}</span>
              <Badge variant={JOURNAL_BADGE[entry.journal]} title={JOURNAL_NAMES[entry.journal]}>
                {entry.journal}
              </Badge>
              <span className="text-xs text-muted-foreground">{JOURNAL_NAMES[entry.journal]}</span>
              <span className="text-sm font-medium">{entry.label}</span>
              {entry.sourceType !== null && (
                <Badge
                  variant="outline"
                  title="Générée automatiquement depuis les flux (réservations, paiements). Non modifiable : extournez-la si besoin."
                >
                  auto
                </Badge>
              )}
              {entry.reversedBy && (
                <Badge
                  variant="destructive"
                  title="Annulée par une écriture inverse — son effet est neutralisé."
                >
                  extournée
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!entry.reversedBy && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onReverse}
                  disabled={busy}
                  title="Créer l'écriture inverse pour annuler celle-ci (contre-passation)"
                >
                  Extourner
                </Button>
              )}
              {canDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onDelete}
                  disabled={busy}
                  title="Supprimer"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        </TableCell>
      </TableRow>
      {entry.lines.map((line) => (
        <TableRow key={line.id}>
          <TableCell>
            <span className="font-mono text-xs">{line.accountCode}</span>{" "}
            <span className="text-muted-foreground">{line.accountName}</span>
          </TableCell>
          <TableCell className="text-sm">
            {line.label}
            {line.supplierName && (
              <span className={`text-xs text-muted-foreground${line.label ? " ml-1" : ""}`}>
                ({line.supplierName})
              </span>
            )}
          </TableCell>
          <TableCell className="font-mono text-xs text-muted-foreground">
            {line.bookingReference ?? ""}
          </TableCell>
          <TableCell className="text-right">
            {line.debitCents !== 0 ? fmtEur(line.debitCents) : ""}
          </TableCell>
          <TableCell className="text-right">
            {line.creditCents !== 0 ? fmtEur(line.creditCents) : ""}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={3} className="py-1.5 text-right text-xs text-muted-foreground">
          Totaux
        </TableCell>
        <TableCell className="py-1.5 text-right text-sm font-medium">
          {fmtEur(totalDebit)}
        </TableCell>
        <TableCell className="py-1.5 text-right text-sm font-medium">
          {fmtEur(totalCredit)}
        </TableCell>
      </TableRow>
    </>
  );
}

// --- Modale de saisie manuelle ----------------------------------------------

type DraftLine = {
  accountId: string;
  label: string;
  amount: string;
  side: "debit" | "credit";
};

const emptyLine = (side: DraftLine["side"]): DraftLine => ({
  accountId: "",
  label: "",
  amount: "",
  side,
});

// Modèles d'écriture : pré-remplissent journal, libellé et contrepartie pour
// que l'utilisateur n'ait jamais à deviner les comptes. Un modèle n'est
// proposé que si tous ses comptes existent dans le plan comptable chargé.
type EntryTemplate = {
  id: string;
  name: string;
  journal: Journal;
  label: string;
  lines: { code: string; side: DraftLine["side"] }[];
};

const ENTRY_TEMPLATES: EntryTemplate[] = [
  {
    id: "frais-stripe",
    name: "Frais bancaires / commissions Stripe",
    journal: "OD",
    label: "Frais Stripe",
    lines: [
      { code: "627000", side: "debit" },
      { code: "517000", side: "credit" },
    ],
  },
  {
    id: "taxe-sejour",
    name: "Reversement taxe de séjour à la commune",
    journal: "OD",
    label: "Reversement taxe de séjour",
    lines: [
      { code: "447800", side: "debit" },
      { code: "512100", side: "credit" },
    ],
  },
  {
    id: "apport",
    name: "Apport personnel du propriétaire",
    journal: "OD",
    label: "Apport de l'exploitant",
    lines: [
      { code: "512100", side: "debit" },
      { code: "108000", side: "credit" },
    ],
  },
  {
    id: "prelevement",
    name: "Prélèvement personnel du propriétaire",
    journal: "OD",
    label: "Prélèvement de l'exploitant",
    lines: [
      { code: "108000", side: "debit" },
      { code: "512100", side: "credit" },
    ],
  },
  {
    id: "immobilisation",
    name: "Achat de mobilier / équipement (immobilisé)",
    journal: "OD",
    label: "Achat mobilier",
    lines: [
      { code: "218000", side: "debit" },
      { code: "512100", side: "credit" },
    ],
  },
];

function CreateEntryModal({
  open,
  onClose,
  accounts,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  accounts: LedgerAccount[];
  onCreated: () => void;
}) {
  const [journal, setJournal] = useState<Journal>("OD");
  const [entryDate, setEntryDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine("debit"), emptyLine("credit")]);
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);

  // Un modèle n'est proposé que si tous ses comptes sont retrouvés par code.
  const availableTemplates = useMemo(
    () =>
      ENTRY_TEMPLATES.filter((t) =>
        t.lines.every((l) => activeAccounts.some((a) => a.code === l.code)),
      ),
    [activeAccounts],
  );

  const applyTemplate = (id: string) => {
    setTemplate(id);
    const t = availableTemplates.find((x) => x.id === id);
    if (!t) {
      // « Écriture libre » : retour à la saisie vierge.
      setJournal("OD");
      setLabel("");
      setLines([emptyLine("debit"), emptyLine("credit")]);
      return;
    }
    setJournal(t.journal);
    setLabel(t.label);
    setLines(
      t.lines.map((l) => ({
        accountId: activeAccounts.find((a) => a.code === l.code)?.id ?? "",
        label: "",
        amount: "",
        side: l.side,
      })),
    );
  };

  const reset = () => {
    setJournal("OD");
    setEntryDate(todayIso());
    setLabel("");
    setLines([emptyLine("debit"), emptyLine("credit")]);
    setTemplate("");
  };

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const lineCents = (l: DraftLine) => Math.round(parseFloat(l.amount || "0") * 100);
  const totalDebit = lines
    .filter((l) => l.side === "debit")
    .reduce((a, l) => a + lineCents(l), 0);
  const totalCredit = lines
    .filter((l) => l.side === "credit")
    .reduce((a, l) => a + lineCents(l), 0);
  const gap = totalDebit - totalCredit;

  // Équilibrage automatique : complète la dernière ligne du côté déficitaire
  // (en priorité une ligne encore à 0) avec le montant manquant.
  const balance = () => {
    if (gap === 0) return;
    const missingSide: DraftLine["side"] = gap > 0 ? "credit" : "debit";
    const missing = Math.abs(gap);
    const candidates = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.side === missingSide);
    if (candidates.length === 0) {
      setLines((ls) => [...ls, { ...emptyLine(missingSide), amount: String(missing / 100) }]);
      return;
    }
    const zero = [...candidates].reverse().find(({ l }) => lineCents(l) === 0);
    const target = zero ?? candidates[candidates.length - 1];
    setLine(target.i, { amount: String((lineCents(target.l) + missing) / 100) });
  };

  const linesValid = lines.every((l) => l.accountId !== "" && lineCents(l) > 0);
  const canSave =
    label.trim() !== "" && entryDate !== "" && linesValid && gap === 0 && totalDebit > 0 && !busy;

  const save = async () => {
    setBusy(true);
    try {
      await adminApi.createEntry({
        journal,
        entryDate,
        label: label.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          label: l.label.trim() || undefined,
          debitCents: l.side === "debit" ? lineCents(l) : 0,
          creditCents: l.side === "credit" ? lineCents(l) : 0,
        })),
      });
      toast.success("Écriture enregistrée.");
      reset();
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouvelle écriture"
      description="Saisie manuelle en partie double : le total des débits doit égaler le total des crédits."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Modèle</Label>
          <select
            value={template}
            onChange={(e) => applyTemplate(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Écriture libre</option>
            {availableTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Un modèle pré-remplit le journal, le libellé et les comptes — il ne reste qu&apos;à
            saisir les montants.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Journal</Label>
            <select
              value={journal}
              onChange={(e) => setJournal(e.target.value as Journal)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {JOURNALS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <DateField value={entryDate} onChange={setEntryDate} />
          </div>
          <div className="space-y-1.5">
            <Label>Libellé</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex. Régularisation charges"
            />
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={line.accountId}
                onChange={(e) => setLine(i, { accountId: e.target.value })}
                className="h-9 flex-1 min-w-0 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Compte…</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <Input
                value={line.label}
                onChange={(e) => setLine(i, { label: e.target.value })}
                placeholder="Libellé (optionnel)"
                className="h-9 w-44"
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={line.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
                placeholder="0,00"
                className="h-9 w-28 text-right"
              />
              <div className="flex rounded-md border overflow-hidden shrink-0">
                <button
                  type="button"
                  onClick={() => setLine(i, { side: "debit" })}
                  className={`px-2.5 py-1.5 text-xs ${
                    line.side === "debit"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Débit
                </button>
                <button
                  type="button"
                  onClick={() => setLine(i, { side: "credit" })}
                  className={`px-2.5 py-1.5 text-xs border-l ${
                    line.side === "credit"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Crédit
                </button>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                disabled={lines.length <= 2}
                title="Supprimer la ligne"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLines((ls) => [...ls, emptyLine("credit")])}
          >
            <Plus className="size-4 mr-1" /> Ajouter une ligne
          </Button>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-end gap-4 text-sm">
            <span>
              Total débit : <span className="font-medium">{fmtEur(totalDebit)}</span>
            </span>
            <span>
              Total crédit : <span className="font-medium">{fmtEur(totalCredit)}</span>
            </span>
            <span
              className={gap === 0 ? "text-muted-foreground" : "text-destructive font-medium"}
            >
              Écart : {fmtEur(gap)}
            </span>
            {gap !== 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={balance}
                title="Mettre la ligne opposée au montant manquant pour équilibrer l'écriture"
              >
                Équilibrer
              </Button>
            )}
          </div>
          <p className="text-right text-xs text-muted-foreground">
            Le total débit doit être égal au total crédit — c&apos;est le principe de la partie
            double.
          </p>
        </div>
      </div>
    </Modal>
  );
}
