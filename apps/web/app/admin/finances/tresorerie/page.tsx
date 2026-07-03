"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  fmtEur,
  type CashflowResponse,
  type LedgerAccount,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { DateField } from "@/components/admin/DateField";
import { HelpCard } from "@/components/admin/HelpCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const frMonth = (ym: string) =>
  new Date(ym + "-15T12:00:00").toLocaleDateString("fr-FR", {
    month: "short",
    year: "2-digit",
  });

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function TresoreriePage() {
  const [data, setData] = useState<CashflowResponse | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [error, setError] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([adminApi.cashflow(), adminApi.listAccounts()])
      .then(([cf, accs]) => {
        setData(cf);
        setAccounts(accs);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const sync = async () => {
    try {
      const r = await adminApi.syncAccounting();
      toast.success(
        r.created > 0
          ? `${r.created} écriture(s) générée(s) depuis les flux.`
          : "Comptabilité déjà à jour.",
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de synchronisation");
    }
  };

  const projected = useMemo(() => {
    if (!data) return 0;
    return data.totalCents + data.upcomingInTotalCents - data.upcomingOutTotalCents;
  }, [data]);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger la trésorerie.</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const maxFlow = Math.max(1, ...data.monthly.map((m) => Math.max(m.inCents, m.outCents)));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trésorerie</h1>
          <p className="text-sm text-muted-foreground">
            Soldes des comptes de trésorerie (classe 5), flux mensuels et prévisionnel.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setTransferOpen(true)}>
            Virement interne
          </Button>
          <Button variant="secondary" onClick={sync}>
            Synchroniser les flux
          </Button>
        </div>
      </div>

      <HelpCard id="tresorerie">
        <p>
          Cette page répond à une question simple : <b>où est l&apos;argent, et qu&apos;est-ce qui
          arrive ?</b>
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Stripe (517000)</b> = les paiements par carte déjà encaissés mais pas encore
            reversés sur votre compte bancaire. Quand Stripe fait le virement, enregistrez-le
            avec le bouton <b>Virement interne</b> : le total ne change pas, l&apos;argent change
            juste de poche.
          </li>
          <li>
            <b>Banque (512100)</b> = votre compte bancaire (chèques, virements, reversements
            Stripe, paiements fournisseurs).
          </li>
          <li>
            Le <b>prévisionnel</b> croise ce qui va rentrer (soldes des réservations, prélevés
            automatiquement 14 jours avant l&apos;arrivée) et ce qui va sortir (factures
            fournisseurs à payer).
          </li>
        </ul>
      </HelpCard>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {data.accounts.map((a) => (
          <Card key={a.accountId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <span className="font-mono text-xs mr-2">{a.code}</span>
                {a.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-semibold ${a.balanceCents < 0 ? "text-destructive" : ""}`}
              >
                {fmtEur(a.balanceCents)}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Trésorerie totale
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtEur(data.totalCents)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Projetée après échéances : {fmtEur(projected)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Flux mensuels</h2>
          <p className="text-sm text-muted-foreground">
            Encaissements et décaissements des 12 derniers mois (virements internes exclus).
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {data.monthly.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun flux enregistré — synchronisez les flux pour générer les écritures.
              </p>
            ) : (
              <div className="flex items-end gap-3 h-44 overflow-x-auto pb-1">
                {data.monthly.map((m) => (
                  <div key={m.month} className="flex flex-col items-center gap-1 min-w-[3.5rem]">
                    <div className="flex items-end gap-1 h-32">
                      <div
                        className="w-4 rounded-t bg-emerald-500/80"
                        title={`Encaissé ${fmtEur(m.inCents)}`}
                        style={{ height: `${Math.max(2, (m.inCents / maxFlow) * 100)}%` }}
                      />
                      <div
                        className="w-4 rounded-t bg-rose-400/80"
                        title={`Décaissé ${fmtEur(m.outCents)}`}
                        style={{ height: `${Math.max(2, (m.outCents / maxFlow) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {frMonth(m.month)}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        m.inCents - m.outCents >= 0 ? "text-emerald-600" : "text-rose-500"
                      }`}
                    >
                      {fmtEur(m.inCents - m.outCents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Encaissements à venir</h2>
            <p className="text-sm text-muted-foreground">
              Soldes des réservations confirmées (prélèvement à J-14) —{" "}
              {fmtEur(data.upcomingInTotalCents)} attendus.
            </p>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Réservation</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.upcomingIn.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      Aucun encaissement en attente.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.upcomingIn.map((r) => {
                    const overdue = r.dueDate < todayIso();
                    return (
                      <TableRow key={r.reference}>
                        <TableCell>
                          {frDate(r.dueDate)}{" "}
                          {overdue && <Badge variant="destructive">En retard</Badge>}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{r.reference}</span>
                          {r.customerName && (
                            <span className="ml-2 text-muted-foreground">{r.customerName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtEur(r.amountCents)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Décaissements à venir</h2>
            <p className="text-sm text-muted-foreground">
              Factures fournisseurs à payer — {fmtEur(data.upcomingOutTotalCents)} dus.
            </p>
          </div>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Fournisseur</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.upcomingOut.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm text-muted-foreground">
                      Aucune facture à payer.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.upcomingOut.map((r) => {
                    const overdue = !!r.dueDate && r.dueDate < todayIso();
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.dueDate ? frDate(r.dueDate) : "—"}{" "}
                          {overdue && <Badge variant="destructive">En retard</Badge>}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{r.supplierName}</span>
                          <span className="ml-2 text-muted-foreground">{r.label}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtEur(r.amountCents)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      <TransferDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={accounts}
        onDone={load}
      />
    </div>
  );
}

/** Virement interne entre deux comptes de trésorerie (ex. payout Stripe → Banque). */
function TransferDialog({
  open,
  onClose,
  accounts,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accounts: LedgerAccount[];
  onDone: () => void;
}) {
  const treasury = accounts.filter((a) => a.code.startsWith("5") && a.isActive);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && treasury.length > 0) {
      const stripe = treasury.find((a) => a.code === "517000");
      const bank = treasury.find((a) => a.code === "512100");
      setFromId(stripe?.id ?? treasury[0].id);
      setToId(bank?.id ?? treasury[Math.min(1, treasury.length - 1)].id);
      setDate(todayIso());
      setAmount("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cents = Math.round((parseFloat(amount.replace(",", ".")) || 0) * 100);
  const valid = fromId && toId && fromId !== toId && cents > 0 && date;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const from = treasury.find((a) => a.id === fromId);
      const to = treasury.find((a) => a.id === toId);
      await adminApi.createEntry({
        journal: "BQ",
        entryDate: date,
        label: `Virement interne ${from?.name ?? ""} → ${to?.name ?? ""}`,
        lines: [
          { accountId: toId, debitCents: cents, creditCents: 0 },
          { accountId: fromId, debitCents: 0, creditCents: cents },
        ],
      });
      toast.success("Virement enregistré.");
      onClose();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Virement interne"
      description="Mouvement entre deux comptes de trésorerie (ex. reversement Stripe vers la banque). Génère l'écriture correspondante."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!valid || busy} onClick={submit}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Depuis</Label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {treasury.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Vers</Label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            {treasury.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Date</Label>
            <DateField value={date} onChange={setDate} />
          </div>
          <div className="space-y-1">
            <Label>Montant (€)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
        </div>
        {fromId === toId && fromId && (
          <p className="text-xs text-destructive">Choisissez deux comptes différents.</p>
        )}
      </div>
    </Modal>
  );
}
