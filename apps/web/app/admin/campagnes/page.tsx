"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Send, Trash2 } from "lucide-react";
import {
  adminApi,
  type Campaign,
  type CampaignDetail,
  type CampaignFilters,
  type CampaignPreview,
} from "@/lib/admin-api";
import { useConfirm } from "@/components/admin/dialogs";
import { DateField } from "@/components/admin/DateField";
import { HelpCard } from "@/components/admin/HelpCard";
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

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur");

const selectCls = "h-9 w-full rounded-md border bg-background px-3 text-sm";

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const frDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Résume les critères d'une campagne en badges lisibles. */
function filterBadges(f: CampaignFilters): string[] {
  const out: string[] = [];
  if (f.audience === "clients") out.push("Clients");
  else if (f.audience === "prospects") out.push("Prospects");
  else out.push("Tous les contacts");
  if (f.upcoming === true) out.push("Séjour à venir");
  if (f.upcoming === false) out.push("Sans séjour à venir");
  if (f.minStays != null) out.push(`≥ ${f.minStays} séjour${f.minStays > 1 ? "s" : ""}`);
  if (f.lastActivityAfter) out.push(`Actifs après ${frDate(f.lastActivityAfter)}`);
  if (f.lastActivityBefore) out.push(`Actifs avant ${frDate(f.lastActivityBefore)}`);
  if (f.city) out.push(`Ville : ${f.city}`);
  return out;
}

export default function CampagnesPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const confirm = useConfirm();

  // null = fermé ; { id: null } = création ; { id } = édition d'un brouillon.
  // customerIds : création en mode « sélection manuelle » (depuis la page Contacts).
  const [editModal, setEditModal] = useState<{
    id: string | null;
    customerIds?: string[];
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // ?contacts=selection (page Contacts) → ouvre la création en mode manuel avec
  // les IDs déposés en sessionStorage (une grosse sélection ne tient pas dans
  // l'URL), puis nettoie l'URL. Lecture via window.location pour éviter
  // useSearchParams (et son <Suspense> obligatoire).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("contacts");
    if (!raw) return;
    let ids: string[] = [];
    if (raw === "selection") {
      try {
        ids = JSON.parse(sessionStorage.getItem("campaignContacts") ?? "[]");
      } catch {
        ids = [];
      }
      sessionStorage.removeItem("campaignContacts");
    } else {
      ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (ids.length > 0) setEditModal({ id: null, customerIds: ids });
    router.replace("/admin/campagnes");
  }, [router]);

  const reload = () =>
    adminApi
      .listCampaigns()
      .then((c) => {
        setCampaigns(c);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));

  useEffect(() => {
    reload();
  }, []);

  const send = async (c: Campaign) => {
    if (
      !(await confirm({
        title: "Envoyer la campagne ?",
        description: `« ${c.subject} » — Envoyer à ${c.recipientCount} destinataire${c.recipientCount > 1 ? "s" : ""} ? Cette action est définitive.`,
        confirmLabel: "Envoyer",
      }))
    )
      return;
    try {
      const { sent } = await adminApi.sendCampaign(c.id);
      toast.success(`Campagne envoyée à ${sent} destinataire${sent > 1 ? "s" : ""}.`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (c: Campaign) => {
    if (
      !(await confirm({
        title: "Supprimer le brouillon ?",
        description: `« ${c.subject} »`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    try {
      await adminApi.deleteCampaign(c.id);
      toast.success("Brouillon supprimé.");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campagnes e-mails</h1>
          <p className="text-sm text-muted-foreground">
            E-mails groupés à vos clients et prospects.
          </p>
        </div>
        <Button onClick={() => setEditModal({ id: null })}>Nouvelle campagne</Button>
      </div>

      <HelpCard id="campagnes">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>1. Ciblez</b> : définissez des critères (clients / prospects, séjour à venir,
            ville…). La liste des destinataires est <b>figée à la création</b> de la campagne.
          </li>
          <li>
            <b>2. Personnalisez</b> : les variables <code className="text-[11px]">{"{{bonjour}}"}</code>,{" "}
            <code className="text-[11px]">{"{{prenom}}"}</code> et{" "}
            <code className="text-[11px]">{"{{nom}}"}</code> sont remplacées pour chaque
            destinataire, dans le sujet comme dans le message.
          </li>
          <li>
            <b>3. Envoyez</b> : l&apos;envoi utilise le gabarit e-mail du site et chaque envoi
            est tracé destinataire par destinataire.
          </li>
        </ul>
        <p className="mt-2">
          Une campagne envoyée n&apos;est pas modifiable ; l&apos;historique est conservé.
        </p>
      </HelpCard>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sujet</TableHead>
              <TableHead className="w-[110px]">Statut</TableHead>
              <TableHead className="w-[130px]">Destinataires</TableHead>
              <TableHead className="w-[130px]">Créée le</TableHead>
              <TableHead className="w-[130px]">Envoyée le</TableHead>
              <TableHead className="w-[190px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadError && (
              <TableRow>
                <TableCell colSpan={6} className="text-destructive py-6 text-center">
                  Impossible de charger les campagnes. Rechargez la page.
                </TableCell>
              </TableRow>
            )}
            {!loadError && campaigns === null && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {!loadError && campaigns?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Aucune campagne — créez la première avec « Nouvelle campagne ».
                </TableCell>
              </TableRow>
            )}
            {!loadError &&
              campaigns?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.subject}</TableCell>
                  <TableCell>
                    {c.status === "sent" ? (
                      <Badge variant="success">Envoyée</Badge>
                    ) : (
                      <Badge variant="muted">Brouillon</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.status === "sent" ? `${c.sentCount}/${c.recipientCount}` : c.recipientCount}
                  </TableCell>
                  <TableCell>{frDate(c.createdAt)}</TableCell>
                  <TableCell>
                    {c.sentAt ? frDate(c.sentAt) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Voir"
                        onClick={() => setDetailId(c.id)}
                      >
                        <Eye className="size-4" />
                      </Button>
                      {c.status === "draft" && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Modifier"
                            onClick={() => setEditModal({ id: c.id })}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Envoyer"
                            onClick={() => send(c)}
                          >
                            <Send className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Supprimer"
                            onClick={() => remove(c)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      {editModal && (
        <EditModal
          campaignId={editModal.id}
          initialCustomerIds={editModal.customerIds ?? null}
          onClose={() => setEditModal(null)}
          onSaved={() => {
            setEditModal(null);
            reload();
          }}
        />
      )}
      {detailId && <DetailModal campaignId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// --- Modale création / édition ----------------------------------------------

function EditModal({
  campaignId,
  initialCustomerIds,
  onClose,
  onSaved,
}: {
  campaignId: string | null;
  initialCustomerIds: string[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  // En édition, on charge d'abord le brouillon existant.
  const [initial, setInitial] = useState<CampaignDetail | null>(null);
  const [initialError, setInitialError] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    adminApi
      .campaignDetail(campaignId)
      .then(setInitial)
      .catch(() => setInitialError(true));
  }, [campaignId]);

  if (initialError) {
    return (
      <Modal open onClose={onClose} title="Modifier la campagne">
        <p className="text-sm text-destructive">
          Impossible de charger la campagne. Fermez et réessayez.
        </p>
      </Modal>
    );
  }
  if (campaignId && !initial) {
    return (
      <Modal open onClose={onClose} title="Modifier la campagne">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </Modal>
    );
  }
  return (
    <EditModalForm
      campaignId={campaignId}
      initial={initial}
      initialCustomerIds={initialCustomerIds}
      confirm={confirm}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditModalForm({
  campaignId,
  initial,
  initialCustomerIds,
  confirm,
  onClose,
  onSaved,
}: {
  campaignId: string | null;
  initial: CampaignDetail | null;
  initialCustomerIds: string[] | null;
  confirm: ReturnType<typeof useConfirm>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const f = initial?.filters;
  // Sélection manuelle : quand présente, elle remplace tous les critères de ciblage.
  const [customerIds, setCustomerIds] = useState<string[] | null>(
    f?.customerIds?.length ? f.customerIds : initialCustomerIds,
  );
  const manual = customerIds != null && customerIds.length > 0;
  // Ciblage
  const [audience, setAudience] = useState<"all" | "clients" | "prospects">(
    f?.audience ?? "all",
  );
  const [upcoming, setUpcoming] = useState<"any" | "yes" | "no">(
    f?.upcoming === true ? "yes" : f?.upcoming === false ? "no" : "any",
  );
  const [minStays, setMinStays] = useState(f?.minStays != null ? String(f.minStays) : "");
  const [activeAfter, setActiveAfter] = useState(f?.lastActivityAfter ?? "");
  const [activeBefore, setActiveBefore] = useState(f?.lastActivityBefore ?? "");
  const [city, setCity] = useState(f?.city ?? "");
  // Message
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");

  const [busy, setBusy] = useState(false);

  const filters: CampaignFilters = manual
    ? { customerIds }
    : {
        audience,
        upcoming: upcoming === "any" ? null : upcoming === "yes",
        minStays: minStays.trim() === "" ? null : Math.max(0, parseInt(minStays, 10) || 0),
        lastActivityAfter: activeAfter || null,
        lastActivityBefore: activeBefore || null,
        city: city.trim() || null,
      };

  // Aperçu des destinataires, recalculé (avec débounce) à chaque changement de filtre.
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const previewSeq = useRef(0);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    const t = setTimeout(() => {
      adminApi
        .previewCampaign(JSON.parse(filtersKey) as CampaignFilters)
        .then((p) => {
          if (previewSeq.current !== seq) return;
          setPreview(p);
          setPreviewLoading(false);
        })
        .catch(() => {
          if (previewSeq.current !== seq) return;
          setPreview(null);
          setPreviewLoading(false);
        });
    }, 350);
    return () => clearTimeout(t);
  }, [filtersKey]);

  const validate = () => {
    if (!subject.trim()) {
      toast.error("Le sujet est obligatoire.");
      return false;
    }
    if (!body.trim()) {
      toast.error("Le message est obligatoire.");
      return false;
    }
    return true;
  };

  const persist = async () => {
    const data = { subject: subject.trim(), body, filters };
    if (campaignId) {
      await adminApi.updateCampaign(campaignId, data);
      return campaignId;
    }
    const { id } = await adminApi.createCampaign(data);
    return id;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      await persist();
      toast.success(campaignId ? "Brouillon enregistré." : "Campagne créée en brouillon.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };

  const saveAndSend = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const id = await persist();
      // Compte réel après enregistrement (la liste vient d'être figée).
      const detail = await adminApi.campaignDetail(id);
      const n = detail.recipientCount;
      setBusy(false);
      if (
        !(await confirm({
          title: "Envoyer la campagne ?",
          description: `« ${detail.subject} » — Envoyer à ${n} destinataire${n > 1 ? "s" : ""} ? Cette action est définitive.`,
          confirmLabel: "Envoyer",
        }))
      ) {
        toast.success("Brouillon enregistré (envoi annulé).");
        onSaved();
        return;
      }
      setBusy(true);
      const { sent } = await adminApi.sendCampaign(id);
      toast.success(`Campagne envoyée à ${sent} destinataire${sent > 1 ? "s" : ""}.`);
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={campaignId ? "Modifier la campagne" : "Nouvelle campagne"}
      description="La liste des destinataires est figée à l'enregistrement, d'après les critères ci-dessous."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* --- Ciblage --- */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ciblage
          </h3>
          {manual ? (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              {previewLoading ? (
                <p className="text-sm text-muted-foreground">Calcul des destinataires…</p>
              ) : preview ? (
                <>
                  <p className="text-sm font-medium">
                    Sélection manuelle — {preview.count} contact{preview.count > 1 ? "s" : ""}
                  </p>
                  {preview.sample.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {preview.sample.slice(0, 10).map((r) => (
                        <li key={r.email} className="font-mono text-[11px]">
                          {r.email}
                        </li>
                      ))}
                      {preview.count > 10 && <li>…</li>}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-destructive">
                  Impossible de calculer la sélection.
                </p>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCustomerIds(null)}
              >
                Passer aux critères
              </Button>
            </div>
          ) : (
            <>
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as "all" | "clients" | "prospects")}
              className={selectCls}
            >
              <option value="all">Tous les contacts</option>
              <option value="clients">Clients (au moins un séjour)</option>
              <option value="prospects">Prospects (panier sans séjour)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Séjour à venir</Label>
              <select
                value={upcoming}
                onChange={(e) => setUpcoming(e.target.value as "any" | "yes" | "no")}
                className={selectCls}
              >
                <option value="any">Indifférent</option>
                <option value="yes">Oui</option>
                <option value="no">Non</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Séjours minimum</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={minStays}
                onChange={(e) => setMinStays(e.target.value)}
                placeholder="Optionnel"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Actifs après</Label>
              <DateField value={activeAfter} onChange={setActiveAfter} />
            </div>
            <div className="space-y-1.5">
              <Label>Actifs avant</Label>
              <DateField value={activeBefore} onChange={setActiveBefore} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Ville contient</Label>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Optionnel — ex. Lyon"
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">Calcul des destinataires…</p>
            ) : preview ? (
              <>
                <p className="text-sm font-medium">
                  {preview.count} destinataire{preview.count > 1 ? "s" : ""}
                </p>
                {preview.sample.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                    {preview.sample.slice(0, 10).map((r) => (
                      <li key={r.email}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ")}{" "}
                        <span className="font-mono text-[11px]">{r.email}</span>
                      </li>
                    ))}
                    {preview.count > 10 && <li>…</li>}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-destructive">
                Impossible de calculer l&apos;aperçu des destinataires.
              </p>
            )}
          </div>
            </>
          )}
        </div>

        {/* --- Message --- */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Message
          </h3>
          <div className="space-y-1.5">
            <Label>Sujet</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex. {{prenom}}, votre semaine au ski vous attend"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"{{bonjour}},\n\nNous avons le plaisir de vous annoncer…"}
            />
            <p className="text-xs text-muted-foreground">
              Commencez par <code className="text-[11px]">{"{{bonjour}}"}</code> pour saluer
              automatiquement chaque destinataire. Variables disponibles :{" "}
              <code className="text-[11px]">
                {"{{bonjour}} {{prenom}} {{nom}}"}
              </code>{" "}
              (sujet et message). L&apos;e-mail est envoyé avec le gabarit du site.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-5">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          Annuler
        </Button>
        <Button type="button" variant={campaignId ? "secondary" : "default"} onClick={save} disabled={busy}>
          {busy ? "…" : "Enregistrer"}
        </Button>
        {campaignId && (
          <Button type="button" onClick={saveAndSend} disabled={busy}>
            {busy ? "…" : "Enregistrer et envoyer"}
          </Button>
        )}
      </div>
    </Modal>
  );
}

// --- Modale détail -----------------------------------------------------------

function DetailModal({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi
      .campaignDetail(campaignId)
      .then(setDetail)
      .catch(() => setError(true));
  }, [campaignId]);

  return (
    <Modal open wide onClose={onClose} title={detail ? detail.subject : "Campagne"}>
      {error && (
        <p className="text-sm text-destructive">
          Impossible de charger la campagne. Fermez et réessayez.
        </p>
      )}
      {!error && !detail && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {detail && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {detail.status === "sent" ? (
              <Badge variant="success">Envoyée{detail.sentAt ? ` le ${frDate(detail.sentAt)}` : ""}</Badge>
            ) : (
              <Badge variant="muted">Brouillon</Badge>
            )}
            <span className="text-muted-foreground">
              Créée le {frDate(detail.createdAt)} · {detail.recipientCount} destinataire
              {detail.recipientCount > 1 ? "s" : ""}
            </span>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">Critères</h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              {detail.filters.customerIds?.length ? (
                <Badge variant="muted">
                  Sélection manuelle ({detail.filters.customerIds.length})
                </Badge>
              ) : (
                filterBadges(detail.filters).map((b) => (
                  <Badge key={b} variant="muted">
                    {b}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">Message</h3>
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-line">
              {detail.body}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">Destinataires</h3>
            <div className="rounded-md border max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead className="w-[180px]">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.recipients.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground py-4 text-center">
                        Aucun destinataire.
                      </TableCell>
                    </TableRow>
                  )}
                  {detail.recipients.map((r) => (
                    <TableRow key={r.email}>
                      <TableCell>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.email}</TableCell>
                      <TableCell>
                        {r.status === "sent" ? (
                          <Badge variant="success">
                            Envoyé{r.sentAt ? ` ${frDateTime(r.sentAt)}` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="muted">En attente</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
