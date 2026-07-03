"use client";

import { useEffect, useState } from "react";
import { adminApi, type GlobalSettings } from "@/lib/admin-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/admin/dialogs";
import { HelpCard } from "@/components/admin/HelpCard";
import { cn } from "@/lib/utils";

export default function ReglagesPage() {
  const confirm = useConfirm();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Brouillons locaux des instructions (sauvegarde explicite, pas à la frappe).
  const [instrVirement, setInstrVirement] = useState("");
  const [instrCheque, setInstrCheque] = useState("");
  const [instrBusy, setInstrBusy] = useState(false);

  useEffect(() => {
    adminApi
      .getSettings()
      .then((s) => {
        setSettings(s);
        setInstrVirement(s.instructionsVirement);
        setInstrCheque(s.instructionsCheque);
      })
      .catch(() => setError(true));
  }, []);

  /** Applique un patch immédiatement (switches). Le backend peut refuser (400). */
  const apply = async (patch: Partial<GlobalSettings>) => {
    if (!settings || busy) return;
    setBusy(true);
    try {
      setSettings(await adminApi.updateSettings(patch));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleOnlineBooking = async () => {
    if (!settings || busy) return;
    const next = !settings.onlineBookingEnabled;
    if (
      !next &&
      !(await confirm({
        title: "Fermer la réservation en ligne ?",
        description:
          "Le site affichera un message d'indisponibilité et refusera les nouvelles réservations. Les dossiers en cours ne sont pas affectés.",
        danger: true,
        confirmLabel: "Fermer la réservation",
      }))
    )
      return;
    if (await apply({ onlineBookingEnabled: next }))
      toast.success(next ? "Réservation en ligne ouverte." : "Réservation en ligne fermée.");
  };

  const togglePay = async (
    key: "payCardEnabled" | "payChequeEnabled" | "payVirementEnabled",
    labels: [string, string],
  ) => {
    if (!settings || busy) return;
    const next = !settings[key];
    if (await apply({ [key]: next })) toast.success(next ? labels[0] : labels[1]);
  };

  const toggleTransactional = async () => {
    if (!settings || busy) return;
    const next = !settings.transactionalEmailsEnabled;
    if (
      !next &&
      !(await confirm({
        title: "Couper tous les e-mails automatiques ?",
        description:
          "Plus aucun e-mail automatique ne partira (confirmation, pré-notification et reçu de solde, relances panier, e-mails planifiés, demandes d'avis). Les prélèvements continuent normalement.",
        danger: true,
        confirmLabel: "Couper les e-mails",
      }))
    )
      return;
    if (await apply({ transactionalEmailsEnabled: next }))
      toast.success(next ? "E-mails automatiques réactivés." : "E-mails automatiques coupés.");
  };

  const saveInstructions = async () => {
    if (!settings || instrBusy) return;
    setInstrBusy(true);
    try {
      const s = await adminApi.updateSettings({
        instructionsVirement: instrVirement,
        instructionsCheque: instrCheque,
      });
      setSettings(s);
      setInstrVirement(s.instructionsVirement);
      setInstrCheque(s.instructionsCheque);
      toast.success("Instructions enregistrées.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setInstrBusy(false);
    }
  };

  if (error)
    return <p className="text-sm text-destructive">Impossible de charger les réglages.</p>;
  if (settings === null)
    return <p className="text-sm text-muted-foreground">Chargement…</p>;

  const instrDirty =
    instrVirement !== settings.instructionsVirement ||
    instrCheque !== settings.instructionsCheque;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
        <p className="text-sm text-muted-foreground">Paramètres globaux de la plateforme</p>
      </div>

      <HelpCard id="reglages">
        <p>
          Ces réglages agissent sur <b>toute la plateforme</b> : le site public (ouverture des
          réservations, moyens de règlement proposés au client) et les envois automatiques
          d&apos;e-mails. Les switches s&apos;appliquent immédiatement ; seules les instructions
          de virement et de chèque demandent un enregistrement explicite.
        </p>
        <p>
          On retrouve aussi le switch « Réservation en ligne » sur la page Dispos &amp; tarifs et
          celui des e-mails automatiques sur la page E-mails auto — c&apos;est le même réglage.
        </p>
      </HelpCard>

      {/* ---------------------------------------------------------- Réservation */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Réservation en ligne</h2>
              <p className="text-sm text-muted-foreground">
                Ouverture des réservations sur le site public
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {settings.onlineBookingEnabled ? "Ouverte" : "Fermée"}
              </span>
              <Switch
                checked={settings.onlineBookingEnabled}
                disabled={busy}
                onChange={toggleOnlineBooking}
                label="Réservation en ligne"
              />
            </div>
          </div>
          {!settings.onlineBookingEnabled && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Réservation en ligne fermée — le site affiche un message d&apos;indisponibilité et
              refuse les nouvelles réservations.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------- Moyens de règlement */}
      <Card className={cn(!settings.onlineBookingEnabled && "opacity-60")}>
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="font-medium">Moyens de règlement</h2>
            <p className="text-sm text-muted-foreground">
              Moyens proposés au client au moment de la réservation en ligne
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Carte bancaire (Stripe)</div>
              <p className="text-sm text-muted-foreground">Confirmation immédiate</p>
            </div>
            <Switch
              checked={settings.payCardEnabled}
              disabled={busy}
              onChange={() =>
                togglePay("payCardEnabled", [
                  "Carte bancaire activée.",
                  "Carte bancaire désactivée.",
                ])
              }
              label="Carte bancaire (Stripe)"
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Virement</div>
                <p className="text-sm text-muted-foreground">
                  La réservation reste en attente jusqu&apos;au pointage de l&apos;encaissement
                </p>
              </div>
              <Switch
                checked={settings.payVirementEnabled}
                disabled={busy}
                onChange={() =>
                  togglePay("payVirementEnabled", ["Virement activé.", "Virement désactivé."])
                }
                label="Virement"
              />
            </div>
            {settings.payVirementEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="instr-virement">
                  Instructions virement (IBAN, BIC, titulaire)
                </Label>
                <textarea
                  id="instr-virement"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={4}
                  value={instrVirement}
                  onChange={(e) => setInstrVirement(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Chèque</div>
                <p className="text-sm text-muted-foreground">
                  La réservation reste en attente jusqu&apos;au pointage de l&apos;encaissement
                </p>
              </div>
              <Switch
                checked={settings.payChequeEnabled}
                disabled={busy}
                onChange={() =>
                  togglePay("payChequeEnabled", ["Chèque activé.", "Chèque désactivé."])
                }
                label="Chèque"
              />
            </div>
            {settings.payChequeEnabled && (
              <div className="space-y-1.5">
                <Label htmlFor="instr-cheque">
                  Instructions chèque (ordre, adresse d&apos;envoi)
                </Label>
                <textarea
                  id="instr-cheque"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={4}
                  value={instrCheque}
                  onChange={(e) => setInstrCheque(e.target.value)}
                />
              </div>
            )}
          </div>

          {(settings.payVirementEnabled || settings.payChequeEnabled) && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                Ces instructions sont affichées au client et envoyées dans l&apos;e-mail de mise
                en attente.
              </p>
              <Button size="sm" onClick={saveInstructions} disabled={instrBusy || !instrDirty}>
                {instrBusy ? "…" : "Enregistrer les instructions"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------ E-mails transactionnels */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">E-mails transactionnels automatiques</h2>
              <p className="text-sm text-muted-foreground">
                Confirmations, rappels de paiement, e-mails planifiés, demandes d&apos;avis
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {settings.transactionalEmailsEnabled ? "Actifs" : "Coupés"}
              </span>
              <Switch
                checked={settings.transactionalEmailsEnabled}
                disabled={busy}
                onChange={toggleTransactional}
                label="E-mails transactionnels automatiques"
              />
            </div>
          </div>
          {!settings.transactionalEmailsEnabled && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Tous les e-mails automatiques sont coupés (confirmation, pré-notification et reçu
              de solde, relances panier, e-mails planifiés, demandes d&apos;avis). Les
              prélèvements continuent normalement. Les envois manuels et liens de connexion
              restent actifs.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-emerald-500" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
