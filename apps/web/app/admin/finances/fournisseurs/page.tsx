"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  adminApi,
  fmtEur,
  type LedgerAccount,
  type Supplier,
  type SupplierInvoice,
} from "@/lib/admin-api";
import { useConfirm } from "@/components/admin/dialogs";
import { DateField } from "@/components/admin/DateField";
import { HelpCard } from "@/components/admin/HelpCard";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur");

const selectCls =
  "h-9 w-full rounded-md border bg-background px-3 text-sm";

export default function FournisseursPage() {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [invoices, setInvoices] = useState<SupplierInvoice[] | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = () =>
    Promise.all([
      adminApi.listSuppliers(),
      adminApi.listSupplierInvoices(),
      adminApi.listAccounts(),
    ])
      .then(([s, i, a]) => {
        setSuppliers(s);
        setInvoices(i);
        setAccounts(a);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));

  useEffect(() => {
    reload();
  }, []);

  const expenseAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.code.startsWith("6") && a.isActive),
    [accounts],
  );
  const cashAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.code.startsWith("5") && a.isActive),
    [accounts],
  );

  if (loadError) {
    return (
      <p className="text-sm text-destructive">
        Impossible de charger les fournisseurs. Rechargez la page.
      </p>
    );
  }
  if (!suppliers || !invoices || !accounts) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  return (
    <div className="space-y-10">
      <InvoicesSection
        invoices={invoices}
        suppliers={suppliers}
        expenseAccounts={expenseAccounts}
        cashAccounts={cashAccounts}
        onChanged={reload}
      />
      <SuppliersSection
        suppliers={suppliers}
        expenseAccounts={expenseAccounts}
        onChanged={reload}
      />
    </div>
  );
}

// --- Section A : factures fournisseurs -------------------------------------

function InvoicesSection({
  invoices,
  suppliers,
  expenseAccounts,
  cashAccounts,
  onChanged,
}: {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
  expenseAccounts: LedgerAccount[];
  cashAccounts: LedgerAccount[];
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState<"all" | "a_payer" | "payee">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  // null = fermé ; { invoice: null } = création ; { invoice } = édition.
  const [invoiceModal, setInvoiceModal] = useState<{ invoice: SupplierInvoice | null } | null>(
    null,
  );
  const [payModal, setPayModal] = useState<SupplierInvoice | null>(null);

  const today = todayIso();
  const year = today.slice(0, 4);
  const isLate = (inv: SupplierInvoice) =>
    inv.status === "a_payer" && !!inv.dueDate && inv.dueDate < today;

  const totalUnpaid = invoices
    .filter((i) => i.status === "a_payer")
    .reduce((a, i) => a + i.amountCents, 0);
  const paidThisYear = invoices
    .filter((i) => i.status === "payee" && (i.paidDate ?? "").startsWith(year))
    .reduce((a, i) => a + i.amountCents, 0);
  const lateCount = invoices.filter(isLate).length;

  const rows = useMemo(
    () =>
      invoices
        .filter((i) => (statusFilter === "all" ? true : i.status === statusFilter))
        .filter((i) => (supplierFilter === "all" ? true : i.supplierId === supplierFilter))
        .slice()
        .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)),
    [invoices, statusFilter, supplierFilter],
  );

  const removeInvoice = async (inv: SupplierInvoice) => {
    if (
      !(await confirm({
        title: "Supprimer la facture ?",
        description: `« ${inv.label} » — ${inv.supplierName}, ${fmtEur(inv.amountCents)}. L'écriture d'achat associée sera annulée.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteSupplierInvoice(inv.id);
      toast.success("Facture supprimée.");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const unpay = async (inv: SupplierInvoice) => {
    if (
      !(await confirm({
        title: "Annuler le règlement ?",
        description: `« ${inv.label} » — ${inv.supplierName}, ${fmtEur(inv.amountCents)}. La facture repassera « à payer » et l'écriture de banque sera annulée.`,
        confirmLabel: "Annuler le règlement",
      }))
    )
      return;
    try {
      await adminApi.unpaySupplierInvoice(inv.id);
      toast.success("Règlement annulé.");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Charges externes (factures fournisseurs)
          </h1>
          <p className="text-sm text-muted-foreground">
            Chaque facture génère l&apos;écriture d&apos;achat, chaque règlement
            l&apos;écriture de banque.
          </p>
        </div>
        <Button onClick={() => setInvoiceModal({ invoice: null })}>Nouvelle facture</Button>
      </div>

      <HelpCard id="fournisseurs">
        <p>
          Saisissez ici toutes vos <b>dépenses</b> : électricité, copropriété, assurance,
          ménage, travaux… La comptabilité s&apos;écrit toute seule.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>1. Nouvelle facture</b> quand vous recevez une facture : choisissez le
            fournisseur, le montant et la catégorie de dépense (le « compte de charge » —
            ex. 606100 pour l&apos;électricité). Elle apparaît dans « à payer ».
          </li>
          <li>
            <b>2. Marquer payée</b> quand vous l&apos;avez réglée : indiquez la date et le
            compte utilisé (en général 512100 Banque). C&apos;est ce qui alimente la
            trésorerie et le résultat.
          </li>
          <li>
            Créez d&apos;abord chaque prestataire dans <b>Fournisseurs</b> (en bas de page),
            avec sa catégorie de dépense habituelle — elle sera proposée par défaut.
          </li>
        </ul>
      </HelpCard>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total à payer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtEur(totalUnpaid)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Payé en {year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{fmtEur(paidThisYear)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Factures en retard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={"text-2xl font-semibold" + (lateCount > 0 ? " text-destructive" : "")}>
              {lateCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "a_payer" | "payee")}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Toutes</option>
          <option value="a_payer">À payer</option>
          <option value="payee">Payées</option>
        </select>
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Tous les fournisseurs</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Date</TableHead>
              <TableHead>Fournisseur</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Compte de charge</TableHead>
              <TableHead className="w-[130px]">Échéance</TableHead>
              <TableHead className="w-[110px] text-right">Montant</TableHead>
              <TableHead className="w-[140px]">Statut</TableHead>
              <TableHead className="w-[220px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground py-6 text-center">
                  {invoices.length === 0
                    ? "Aucune facture fournisseur. Créez-en une avec « Nouvelle facture »."
                    : "Aucune facture ne correspond aux filtres."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{frDate(inv.invoiceDate)}</TableCell>
                  <TableCell className="font-medium">{inv.supplierName}</TableCell>
                  <TableCell>
                    {inv.label}
                    {inv.invoiceNumber && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {inv.invoiceNumber}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {inv.expenseAccountCode} — {inv.expenseAccountName}
                  </TableCell>
                  <TableCell>
                    {inv.dueDate ? (
                      isLate(inv) ? (
                        <Badge variant="destructive">En retard</Badge>
                      ) : (
                        frDate(inv.dueDate)
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {fmtEur(inv.amountCents)}
                  </TableCell>
                  <TableCell>
                    {inv.status === "payee" ? (
                      <Badge variant="success">
                        Payée{inv.paidDate ? ` ${frDate(inv.paidDate)}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="muted">À payer</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {inv.status === "a_payer" ? (
                        <>
                          <Button size="sm" onClick={() => setPayModal(inv)}>
                            Marquer payée
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Modifier"
                            onClick={() => setInvoiceModal({ invoice: inv })}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Supprimer"
                            onClick={() => removeInvoice(inv)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => unpay(inv)}>
                          Annuler le règlement
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {invoiceModal && (
        <InvoiceModal
          invoice={invoiceModal.invoice}
          suppliers={suppliers}
          expenseAccounts={expenseAccounts}
          onClose={() => setInvoiceModal(null)}
          onSaved={() => {
            setInvoiceModal(null);
            onChanged();
          }}
        />
      )}
      {payModal && (
        <PayModal
          invoice={payModal}
          cashAccounts={cashAccounts}
          onClose={() => setPayModal(null)}
          onSaved={() => {
            setPayModal(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function InvoiceModal({
  invoice,
  suppliers,
  expenseAccounts,
  onClose,
  onSaved,
}: {
  invoice: SupplierInvoice | null;
  suppliers: Supplier[];
  expenseAccounts: LedgerAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeSuppliers = suppliers.filter(
    (s) => s.isActive || s.id === invoice?.supplierId,
  );
  const [supplierId, setSupplierId] = useState(invoice?.supplierId ?? "");
  const [label, setLabel] = useState(invoice?.label ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? todayIso());
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [euros, setEuros] = useState(
    invoice ? (invoice.amountCents / 100).toString() : "",
  );
  const [expenseAccountId, setExpenseAccountId] = useState(invoice?.expenseAccountId ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const pickSupplier = (id: string) => {
    setSupplierId(id);
    // Présélectionne le compte de charge par défaut du fournisseur.
    const def = suppliers.find((s) => s.id === id)?.defaultAccountId;
    if (def && expenseAccounts.some((a) => a.id === def)) setExpenseAccountId(def);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) return toast.error("Choisissez un fournisseur.");
    if (!invoiceDate) return toast.error("Date de facture invalide.");
    if (!expenseAccountId) return toast.error("Choisissez un compte de charge.");
    const amountCents = Math.round(parseFloat(euros || "0") * 100);
    if (!(amountCents > 0)) return toast.error("Le montant doit être supérieur à 0.");
    setBusy(true);
    try {
      const data = {
        supplierId,
        label,
        invoiceNumber,
        invoiceDate,
        dueDate: dueDate || null,
        amountCents,
        expenseAccountId,
        notes,
      };
      if (invoice) {
        await adminApi.updateSupplierInvoice(invoice.id, data);
        toast.success("Facture modifiée.");
      } else {
        await adminApi.createSupplierInvoice(data);
        toast.success("Facture créée, écriture d'achat enregistrée.");
      }
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={invoice ? "Modifier la facture" : "Nouvelle facture fournisseur"}
      description={
        invoice
          ? undefined
          : "L'écriture d'achat (charge / 401 Fournisseurs) sera générée automatiquement."
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Fournisseur</Label>
          <select
            value={supplierId}
            onChange={(e) => pickSupplier(e.target.value)}
            className={selectCls}
            required
          >
            <option value="">— Choisir —</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {activeSuppliers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucun fournisseur actif : créez-en un dans la section « Fournisseurs ».
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Libellé</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>N° de facture</Label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Optionnel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Montant (€)</Label>
            <Input
              type="number"
              min={0.01}
              step={0.01}
              value={euros}
              onChange={(e) => setEuros(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Date de facture</Label>
            <DateField value={invoiceDate} onChange={setInvoiceDate} />
          </div>
          <div className="space-y-1.5">
            <Label>Échéance (optionnelle)</Label>
            <DateField value={dueDate} onChange={setDueDate} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Compte de charge</Label>
          <select
            value={expenseAccountId}
            onChange={(e) => setExpenseAccountId(e.target.value)}
            className={selectCls}
            required
          >
            <option value="">— Choisir —</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : invoice ? "Enregistrer" : "Créer la facture"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PayModal({
  invoice,
  cashAccounts,
  onClose,
  onSaved,
}: {
  invoice: SupplierInvoice;
  cashAccounts: LedgerAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paidDate, setPaidDate] = useState(todayIso());
  const [paymentAccountId, setPaymentAccountId] = useState(
    () =>
      cashAccounts.find((a) => a.code === "512100")?.id ?? cashAccounts[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paidDate) return toast.error("Date de paiement invalide.");
    if (!paymentAccountId) return toast.error("Choisissez un compte de trésorerie.");
    setBusy(true);
    try {
      await adminApi.paySupplierInvoice(invoice.id, { paidDate, paymentAccountId });
      toast.success("Règlement enregistré, écriture de banque générée.");
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Marquer la facture payée"
      description={`« ${invoice.label} » — ${invoice.supplierName}, ${fmtEur(invoice.amountCents)}.`}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Date de paiement</Label>
          <DateField value={paidDate} onChange={setPaidDate} />
        </div>
        <div className="space-y-1.5">
          <Label>Compte de trésorerie</Label>
          <select
            value={paymentAccountId}
            onChange={(e) => setPaymentAccountId(e.target.value)}
            className={selectCls}
            required
          >
            <option value="">— Choisir —</option>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Enregistrer le règlement"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Section B : fournisseurs -----------------------------------------------

function SuppliersSection({
  suppliers,
  expenseAccounts,
  onChanged,
}: {
  suppliers: Supplier[];
  expenseAccounts: LedgerAccount[];
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  // null = fermé ; { supplier: null } = création ; { supplier } = édition.
  const [modal, setModal] = useState<{ supplier: Supplier | null } | null>(null);

  const accountLabel = (id: string | null) => {
    if (!id) return null;
    const a = expenseAccounts.find((x) => x.id === id);
    return a ? `${a.code} — ${a.name}` : null;
  };

  const remove = async (s: Supplier) => {
    if (
      !(await confirm({
        title: "Supprimer le fournisseur ?",
        description: `« ${s.name} »`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteSupplier(s.id);
      toast.success("Fournisseur supprimé.");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Fournisseurs</h2>
          <p className="text-sm text-muted-foreground">
            Carnet d&apos;adresses des prestataires et fournisseurs de charges.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setModal({ supplier: null })}>
          Nouveau fournisseur
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Compte par défaut</TableHead>
              <TableHead className="w-[100px] text-right">Factures</TableHead>
              <TableHead className="w-[120px] text-right">Total</TableHead>
              <TableHead className="w-[130px] text-right">Dont à payer</TableHead>
              <TableHead className="w-[110px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-6 text-center">
                  Aucun fournisseur. Ajoutez-en un avec « Nouveau fournisseur ».
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {s.name}
                    {!s.isActive && (
                      <Badge variant="muted" className="ml-2">
                        Inactif
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[s.email, s.phone].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {accountLabel(s.defaultAccountId) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">{s.invoiceCount}</TableCell>
                  <TableCell className="text-right">{fmtEur(s.totalCents)}</TableCell>
                  <TableCell
                    className={
                      "text-right " +
                      (s.unpaidCents > 0 ? "font-medium text-amber-600" : "text-muted-foreground")
                    }
                  >
                    {fmtEur(s.unpaidCents)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Modifier"
                        onClick={() => setModal({ supplier: s })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Supprimer"
                        onClick={() => remove(s)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {modal && (
        <SupplierModal
          supplier={modal.supplier}
          expenseAccounts={expenseAccounts}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SupplierModal({
  supplier,
  expenseAccounts,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  expenseAccounts: LedgerAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [iban, setIban] = useState(supplier?.iban ?? "");
  const [defaultAccountId, setDefaultAccountId] = useState(supplier?.defaultAccountId ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = {
        name: name.trim(),
        email,
        phone,
        address,
        iban,
        notes,
        defaultAccountId: defaultAccountId || null,
        isActive,
      };
      if (supplier) {
        await adminApi.updateSupplier(supplier.id, data);
        toast.success("Fournisseur modifié.");
      } else {
        await adminApi.createSupplier(data);
        toast.success("Fournisseur créé.");
      }
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Nom</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optionnel"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Téléphone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Optionnel"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Adresse</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optionnel" />
        </div>
        <div className="space-y-1.5">
          <Label>IBAN</Label>
          <Input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="Optionnel" />
        </div>
        <div className="space-y-1.5">
          <Label>Compte de charge par défaut</Label>
          <select
            value={defaultAccountId}
            onChange={(e) => setDefaultAccountId(e.target.value)}
            className={selectCls}
          >
            <option value="">Aucun</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
        </div>
        {supplier && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 rounded border"
            />
            Fournisseur actif (proposé lors de la saisie de factures)
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : supplier ? "Enregistrer" : "Créer le fournisseur"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
