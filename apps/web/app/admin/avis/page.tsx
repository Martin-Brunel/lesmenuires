"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { adminApi, type AdminReview } from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";

const frDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </span>
  );
}

type Filter = "all" | "published" | "pending";

const FILTER_LABEL: Record<Filter, string> = {
  all: "Tous",
  pending: "À modérer",
  published: "Publiés",
};

function ReviewCard({
  review,
  onChanged,
}: {
  review: AdminReview;
  onChanged: (r: AdminReview) => void;
}) {
  const [reply, setReply] = useState(review.adminReply ?? "");
  const [busy, setBusy] = useState(false);

  const setPublished = async (published: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.updateReview(review.id, { published });
      onChanged({ ...review, published });
      toast.success(published ? "Avis publié sur le site." : "Avis retiré du site.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const saveReply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await adminApi.updateReview(review.id, { adminReply: reply });
      onChanged({ ...review, adminReply: reply.trim() || null });
      toast.success(reply.trim() ? "Réponse enregistrée." : "Réponse supprimée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Stars rating={review.rating} />
        <span className="font-medium">{review.authorName}</span>
        <span className="text-sm text-muted-foreground">
          {review.weekRange} ·{" "}
          <Link
            href={`/admin/reservations/${review.bookingReference}`}
            className="text-primary underline underline-offset-2 hover:text-foreground"
          >
            {review.bookingReference}
          </Link>{" "}
          · {frDate(review.submittedAt)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {review.published ? (
            <Badge variant="success">Publié</Badge>
          ) : (
            <Badge variant="warning">À modérer</Badge>
          )}
          <Button
            size="sm"
            variant={review.published ? "secondary" : "default"}
            disabled={busy}
            onClick={() => setPublished(!review.published)}
          >
            {review.published ? "Dépublier" : "Publier"}
          </Button>
        </span>
      </div>
      {review.comment ? (
        <p className="text-sm whitespace-pre-line">{review.comment}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Sans commentaire.</p>
      )}
      <div className="space-y-2 rounded-md bg-muted/40 p-3">
        <label className="text-xs font-medium text-muted-foreground">
          Réponse de l&apos;hôte (visible sous l&apos;avis publié)
        </label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Merci pour votre séjour…"
          className="w-full rounded-md border bg-background p-2 text-sm"
        />
        {(reply.trim() || "") !== (review.adminReply ?? "") && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={saveReply}>
            Enregistrer la réponse
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<AdminReview[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    adminApi.listReviews().then(setReviews).catch(() => setError(true));
  }, []);

  const rows = useMemo(() => {
    const all = reviews ?? [];
    if (filter === "published") return all.filter((r) => r.published);
    if (filter === "pending") return all.filter((r) => !r.published);
    return all;
  }, [reviews, filter]);

  if (error) {
    return <p className="text-sm text-destructive">Impossible de charger les avis.</p>;
  }
  if (!reviews) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const published = reviews.filter((r) => r.published);
  const avg =
    published.length > 0
      ? published.reduce((s, r) => s + r.rating, 0) / published.length
      : null;
  const pending = reviews.length - published.length;

  const onChanged = (r: AdminReview) =>
    setReviews((prev) => (prev ?? []).map((x) => (x.id === r.id ? r : x)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Avis voyageurs</h1>
        <p className="text-sm text-muted-foreground">
          {avg !== null ? (
            <>
              Note moyenne publiée : <strong>{avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/5</strong>{" "}
              ({published.length} avis publié(s))
            </>
          ) : (
            "Aucun avis publié pour l'instant"
          )}
          {pending > 0 && <> — {pending} en attente de modération.</>}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          La demande d&apos;avis est envoyée automatiquement au client après son départ. Un avis
          n&apos;apparaît sur le site qu&apos;une fois publié ici.
        </p>
      </div>

      <div className="flex gap-1">
        {(["all", "pending", "published"] as Filter[]).map((f) => (
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

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun avis dans ce filtre.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <ReviewCard key={r.id} review={r} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
