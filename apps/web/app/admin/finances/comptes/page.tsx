"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  adminApi,
  fmtEur,
  type BalanceRow,
  type LedgerAccount,
  type LedgerResponse,
} from "@/lib/admin-api";
import { csvDate, csvEur, downloadCsv } from "@/lib/csv";
import { DateField } from "@/components/admin/DateField";
import { HelpCard } from "@/components/admin/HelpCard";
import { useConfirm } from "@/components/admin/dialogs";
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
import { cn } from "@/lib/utils";

// --- Helpers ---------------------------------------------------------------

const frDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const startOfYearIso = () => `${new Date().getFullYear()}-01-01`;

/** Solde avec sens comptable : "1 250 € D", "1 250 € C" ou "—". */
const fmtSens = (cents: number) => {
  if (cents === 0) return "—";
  return cents > 0 ? `${fmtEur(cents)} D` : `${fmtEur(-cents)} C`;
};

/** Montant seul, cellule vide si nul (lisibilité des tableaux). */
const fmtCell = (cents: number) => (cents === 0 ? "" : fmtEur(cents));

/** Explication du sens comptable, affichée au survol des soldes. */
const SENS_TITLES: Record<"D" | "C", string> = {
  D: "Solde débiteur : le compte porte cette valeur (avoir en banque, créance client, dépense cumulée…)",
  C: "Solde créditeur : dette, collecte à reverser ou revenu cumulé",
};

/** Solde avec sens D/C mis en retrait (span muted) plutôt que collé au montant. */
function SoldeSens({ cents }: { cents: number }) {
  if (cents === 0) return <>—</>;
  const sens: "D" | "C" = cents > 0 ? "D" : "C";
  return (
    <>
      {fmtEur(Math.abs(cents))}{" "}
      <span className="text-xs text-muted-foreground">{sens}</span>
    </>
  );
}

/** « À quoi sert ce compte ? » — descriptions des comptes usuels pour non-initiés. */
const ACCOUNT_HINTS: Record<string, string> = {
  "411000": "Ce que les clients doivent",
  "401000": "Ce que vous devez aux fournisseurs",
  "447800": "Taxe collectée pour la commune",
  "512100": "Compte bancaire",
  "517000": "Solde chez Stripe avant reversement",
  "530000": "Espèces",
  "108000": "Apports et retraits du propriétaire",
  "706000": "Loyers des séjours",
  "708300": "Ménage, linge, options",
  "708800": "Cautions retenues pour dégâts",
  "627000": "Frais Stripe et commissions bancaires",
  "218000": "Mobilier et équipement durable",
  "165000": "Cautions conservées en dépôt",
  "681100": "Usure annuelle du mobilier (amortissement)",
};

const CLASS_LABELS: Record<string, string> = {
  "1": "Capitaux",
  "2": "Immobilisations",
  "3": "Stocks",
  "4": "Tiers",
  "5": "Trésorerie",
  "6": "Charges",
  "7": "Produits",
  "8": "Comptes spéciaux",
};

const JOURNAL_VARIANTS: Record<
  string,
  "default" | "secondary" | "warning" | "muted" | "success"
> = {
  VE: "success",
  AC: "warning",
  BQ: "secondary",
  OD: "muted",
};

type Tab = "plan" | "balance" | "ledger";

const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Plan comptable" },
  { key: "balance", label: "Balance" },
  { key: "ledger", label: "Grand livre" },
];

// --- Page ------------------------------------------------------------------

export default function ComptesPage() {
  const [tab, setTab] = useState<Tab>("plan");
  const [accounts, setAccounts] = useState<LedgerAccount[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = () =>
    adminApi
      .listAccounts()
      .then((a) => {
        setAccounts(a);
        setLoadError(false);
      })
      .catch(() => {
        setLoadError(true);
        toast.error("Impossible de charger le plan comptable.");
      });

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Comptes & états</h1>
        <p className="text-sm text-muted-foreground">
          Plan comptable, balance des comptes et grand livre.
        </p>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plan" && (
        <HelpCard id="comptes-plan" title="Comprendre le plan comptable">
          <p>
            Le <b>plan comptable</b> est la liste des &laquo;&nbsp;tiroirs&nbsp;&raquo; où
            sont rangées les opérations&nbsp;: classe 4 = tiers (clients, fournisseurs), 5 =
            trésorerie (banque, Stripe), 6 = dépenses, 7 = revenus, 1/2 = capitaux et
            équipement. Les comptes <b>système</b> sont utilisés par la génération
            automatique — ils sont renommables mais pas supprimables. Le solde indique où en
            est chaque tiroir&nbsp;: <b>D (débiteur)</b> = le compte
            &laquo;&nbsp;porte&nbsp;&raquo; de l&apos;argent ou une créance (banque positive,
            client qui vous doit)&nbsp;; <b>C (créditeur)</b> = dette ou revenu (facture à
            payer, loyers gagnés, taxe à reverser).
          </p>
        </HelpCard>
      )}
      {tab === "balance" && (
        <HelpCard id="comptes-balance" title="Comprendre la balance">
          <p>
            La <b>balance</b> additionne tous les mouvements par compte sur la période.
            Vérité fondamentale&nbsp;: total débit = total crédit, toujours. Lecture
            utile&nbsp;: classe 7 (produits) &minus; classe 6 (charges) = <b>résultat</b> de
            la période&nbsp;; classe 5 = votre trésorerie&nbsp;; 411 = ce que les clients
            vous doivent encore&nbsp;; 401 = ce que vous devez aux fournisseurs&nbsp;;
            447800 = taxe de séjour à reverser à la commune.
          </p>
        </HelpCard>
      )}
      {tab === "ledger" && (
        <HelpCard id="comptes-grand-livre" title="Comprendre le grand livre">
          <p>
            Le <b>grand livre</b> est le relevé détaillé d&apos;un compte, comme un relevé
            bancaire&nbsp;: chaque mouvement, dans l&apos;ordre, avec le solde après chaque
            ligne. Le <b>report à nouveau</b> est le solde accumulé avant la période
            affichée.
          </p>
        </HelpCard>
      )}

      {tab === "plan" && (
        <PlanComptable accounts={accounts} loadError={loadError} onChanged={reload} />
      )}
      {tab === "balance" && <Balance />}
      {tab === "ledger" && <GrandLivre accounts={accounts} />}
    </div>
  );
}

// --- A. Plan comptable -------------------------------------------------------

function PlanComptable({
  accounts,
  loadError,
  onChanged,
}: {
  accounts: LedgerAccount[] | null;
  loadError: boolean;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<LedgerAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts ?? [];
    return (accounts ?? []).filter(
      (a) => a.code.includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const toggleActive = async (a: LedgerAccount) => {
    setBusyId(a.id);
    try {
      await adminApi.updateAccount(a.id, { isActive: !a.isActive });
      toast.success(a.isActive ? "Compte désactivé." : "Compte réactivé.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: LedgerAccount) => {
    if (
      !(await confirm({
        title: "Supprimer le compte ?",
        description: `${a.code} — ${a.name}\nCette action est définitive.`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    setBusyId(a.id);
    try {
      await adminApi.deleteAccount(a.id);
      toast.success("Compte supprimé.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer par code ou libellé…"
          className="max-w-xs"
        />
        <Button onClick={() => setCreateOpen(true)}>Nouveau compte</Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Code</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-[160px] text-right">Solde</TableHead>
              <TableHead className="w-[260px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadError && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-destructive">
                  Impossible de charger les comptes. Rechargez la page.
                </TableCell>
              </TableRow>
            )}
            {!loadError && accounts === null && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {!loadError && accounts !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  {query ? "Aucun compte ne correspond au filtre." : "Aucun compte."}
                </TableCell>
              </TableRow>
            )}
            {!loadError &&
              filtered.map((a) => (
                <TableRow key={a.id} className={cn(!a.isActive && "opacity-60")}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>
                    <span className="font-medium">{a.name}</span>
                    {a.isSystem && (
                      <Badge variant="secondary" className="ml-2">
                        système
                      </Badge>
                    )}
                    {!a.isActive && (
                      <Badge variant="muted" className="ml-2">
                        inactif
                      </Badge>
                    )}
                    {ACCOUNT_HINTS[a.code] && (
                      <p className="text-xs text-muted-foreground">
                        {ACCOUNT_HINTS[a.code]}
                      </p>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    title={
                      a.balanceCents === 0
                        ? undefined
                        : SENS_TITLES[a.balanceCents > 0 ? "D" : "C"]
                    }
                  >
                    <SoldeSens cents={a.balanceCents} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === a.id}
                        onClick={() => setRenaming(a)}
                      >
                        Renommer
                      </Button>
                      {!a.isSystem && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === a.id}
                          onClick={() => toggleActive(a)}
                        >
                          {a.isActive ? "Désactiver" : "Réactiver"}
                        </Button>
                      )}
                      {!a.isSystem && a.balanceCents === 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Supprimer"
                          disabled={busyId === a.id}
                          onClick={() => remove(a)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <CreateAccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onChanged}
      />
      <RenameAccountModal
        account={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={onChanged}
      />
    </div>
  );
}

function CreateAccountModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCode("");
    setName("");
    setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!/^[1-8]\d{2,7}$/.test(c)) {
      setError("Le code doit comporter 3 à 8 chiffres et commencer par une classe 1 à 8.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.createAccount({ code: c, name: name.trim() });
      toast.success("Compte créé.");
      close();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Nouveau compte">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Code</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="512200"
            inputMode="numeric"
            required
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            3 à 8 chiffres, classes 1 à 8 (ex. 606, 512200).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Libellé</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fournitures diverses"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Créer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RenameAccountModal({
  account,
  onClose,
  onRenamed,
}: {
  account: LedgerAccount | null;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(account?.name ?? "");
    setError(null);
  }, [account]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateAccount(account.id, { name: name.trim() });
      toast.success("Compte renommé.");
      onClose();
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={account !== null}
      onClose={onClose}
      title="Renommer le compte"
      description={account ? `${account.code} — ${account.name}` : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Nouveau libellé</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Renommer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- B. Balance --------------------------------------------------------------

function Balance() {
  const [from, setFrom] = useState(startOfYearIso());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .trialBalance({ from: from || undefined, to: to || undefined })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erreur de chargement de la balance");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const groups = useMemo(() => {
    const map = new Map<string, BalanceRow[]>();
    for (const r of rows ?? []) {
      const cls = r.code[0];
      const arr = map.get(cls);
      if (arr) arr.push(r);
      else map.set(cls, [r]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    let soldeD = 0;
    let soldeC = 0;
    for (const r of rows ?? []) {
      debit += r.debitCents;
      credit += r.creditCents;
      if (r.balanceCents > 0) soldeD += r.balanceCents;
      else soldeC += -r.balanceCents;
    }
    return { debit, credit, soldeD, soldeC };
  }, [rows]);

  const produits = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.code.startsWith("7"))
        .reduce((a, r) => a + (r.creditCents - r.debitCents), 0),
    [rows],
  );
  const charges = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.code.startsWith("6"))
        .reduce((a, r) => a + (r.debitCents - r.creditCents), 0),
    [rows],
  );
  const resultat = produits - charges;

  const exportCsv = () =>
    downloadCsv(
      `balance-${from || "debut"}-${to || "fin"}.csv`,
      ["Code", "Libellé", "Total débit", "Total crédit", "Solde débiteur", "Solde créditeur"],
      (rows ?? []).map((r) => [
        r.code,
        r.name,
        csvEur(r.debitCents),
        csvEur(r.creditCents),
        r.balanceCents > 0 ? csvEur(r.balanceCents) : "",
        r.balanceCents < 0 ? csvEur(-r.balanceCents) : "",
      ]),
    );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label>Du</Label>
            <DateField value={from} onChange={setFrom} className="w-[130px]" />
          </div>
          <div className="space-y-1.5">
            <Label>Au</Label>
            <DateField value={to} onChange={setTo} className="w-[130px]" />
          </div>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!rows || rows.length === 0}>
          Exporter CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Code</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="text-right">Total débit</TableHead>
              <TableHead className="text-right">Total crédit</TableHead>
              <TableHead className="text-right">Solde débiteur</TableHead>
              <TableHead className="text-right">Solde créditeur</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows === null && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {!loading && rows !== null && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Aucun mouvement sur la période.
                </TableCell>
              </TableRow>
            )}
            {groups.map(([cls, list]) => {
              const sub = list.reduce(
                (acc, r) => {
                  acc.debit += r.debitCents;
                  acc.credit += r.creditCents;
                  if (r.balanceCents > 0) acc.soldeD += r.balanceCents;
                  else acc.soldeC += -r.balanceCents;
                  return acc;
                },
                { debit: 0, credit: 0, soldeD: 0, soldeC: 0 },
              );
              return (
                <SectionRows
                  key={cls}
                  cls={cls}
                  list={list}
                  sub={sub}
                />
              );
            })}
            {rows !== null && rows.length > 0 && (
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell colSpan={2}>Totaux</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEur(totals.debit)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEur(totals.credit)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEur(totals.soldeD)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEur(totals.soldeC)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Résultat de la période</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Produits (classe 7)</p>
              <p className="text-xl font-semibold tabular-nums">{fmtEur(produits)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Charges (classe 6)</p>
              <p className="text-xl font-semibold tabular-nums">{fmtEur(charges)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Résultat</p>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  resultat > 0 && "text-emerald-600",
                  resultat < 0 && "text-destructive",
                )}
              >
                {fmtEur(resultat)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Revenus (classe 7) &minus; dépenses (classe 6) sur la période. Un résultat
            positif = activité bénéficiaire&nbsp;; ce n&apos;est pas votre trésorerie (voir
            l&apos;onglet Trésorerie).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionRows({
  cls,
  list,
  sub,
}: {
  cls: string;
  list: BalanceRow[];
  sub: { debit: number; credit: number; soldeD: number; soldeC: number };
}) {
  return (
    <>
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={6} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Classe {cls} — {CLASS_LABELS[cls] ?? "Autres"}
        </TableCell>
      </TableRow>
      {list.map((r) => (
        <TableRow key={r.accountId}>
          <TableCell className="font-mono text-xs">{r.code}</TableCell>
          <TableCell>{r.name}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtCell(r.debitCents)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtCell(r.creditCents)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {r.balanceCents > 0 ? fmtEur(r.balanceCents) : ""}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {r.balanceCents < 0 ? fmtEur(-r.balanceCents) : ""}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/20 hover:bg-muted/20">
        <TableCell colSpan={2} className="py-1.5 text-xs font-medium text-muted-foreground">
          Sous-total classe {cls}
        </TableCell>
        <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
          {fmtCell(sub.debit)}
        </TableCell>
        <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
          {fmtCell(sub.credit)}
        </TableCell>
        <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
          {fmtCell(sub.soldeD)}
        </TableCell>
        <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
          {fmtCell(sub.soldeC)}
        </TableCell>
      </TableRow>
    </>
  );
}

// --- C. Grand livre ------------------------------------------------------------

function GrandLivre({ accounts }: { accounts: LedgerAccount[] | null }) {
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(startOfYearIso());
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    adminApi
      .accountLedger(accountId, { from: from || undefined, to: to || undefined })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Erreur de chargement du grand livre");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, from, to]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `grand-livre-${data.accountCode}-${from || "debut"}-${to || "fin"}.csv`,
      ["Date", "Journal", "Pièce", "Libellé", "Débit", "Crédit", "Solde"],
      [
        ["", "", "", "Report à nouveau", "", "", csvEur(data.openingCents)],
        ...data.rows.map((r) => [
          csvDate(r.entryDate),
          r.journal,
          r.piece,
          r.lineLabel || r.entryLabel,
          csvEur(r.debitCents),
          csvEur(r.creditCents),
          csvEur(r.runningCents),
        ]),
        ["", "", "", "Totaux", csvEur(data.totalDebitCents), csvEur(data.totalCreditCents), csvEur(data.closingCents)],
      ],
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label>Compte</Label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-9 w-[280px] rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Sélectionnez un compte…</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Du</Label>
            <DateField value={from} onChange={setFrom} className="w-[130px]" />
          </div>
          <div className="space-y-1.5">
            <Label>Au</Label>
            <DateField value={to} onChange={setTo} className="w-[130px]" />
          </div>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!data}>
          Exporter CSV
        </Button>
      </div>

      {!accountId && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sélectionnez un compte pour afficher son grand livre.
          </CardContent>
        </Card>
      )}

      {accountId && loading && !data && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Chargement…
          </CardContent>
        </Card>
      )}

      {accountId && data && (
        <Card className="overflow-hidden">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold">
              <span className="font-mono">{data.accountCode}</span> — {data.accountName}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Date</TableHead>
                <TableHead className="w-[110px]">Pièce</TableHead>
                <TableHead className="w-[70px]">Journal</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead className="text-right">Débit</TableHead>
                <TableHead className="text-right">Crédit</TableHead>
                <TableHead className="w-[140px] text-right">Solde</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                className="bg-muted/30 hover:bg-muted/30"
                title="Solde accumulé avant la période affichée"
              >
                <TableCell colSpan={4} className="text-sm font-medium">
                  Report à nouveau
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-medium tabular-nums">
                  {fmtSens(data.openingCents)}
                </TableCell>
              </TableRow>
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    Aucun mouvement sur la période.
                  </TableCell>
                </TableRow>
              )}
              {data.rows.map((r, i) => (
                <TableRow key={`${r.entryId}-${i}`}>
                  <TableCell className="whitespace-nowrap">{frDate(r.entryDate)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.piece}</TableCell>
                  <TableCell>
                    <Badge variant={JOURNAL_VARIANTS[r.journal] ?? "outline"}>{r.journal}</Badge>
                  </TableCell>
                  <TableCell>{r.lineLabel || r.entryLabel}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCell(r.debitCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtCell(r.creditCents)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmtSens(r.runningCents)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-semibold">
                <TableCell colSpan={4}>Totaux — solde final</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(data.totalDebitCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtEur(data.totalCreditCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtSens(data.closingCents)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
