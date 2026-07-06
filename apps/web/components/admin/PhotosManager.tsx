"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical, Trash2, Upload } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { adminApi, type AdminMedia } from "@/lib/admin-api";
import { useConfirm } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { mediaUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PhotosManager({ slug }: { slug: string }) {
  const confirm = useConfirm();
  const [media, setMedia] = useState<AdminMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => adminApi.listMedia(slug).then(setMedia).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) await adminApi.uploadMedia(slug, f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      // Toujours recharger : si le 2e fichier d'un lot échoue, les précédents
      // sont déjà en base — sans reload ils resteraient invisibles et
      // l'admin les re-uploaderait en doublon.
      await load();
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Persist the new order: write the new sequential position of each moved item.
  const persistOrder = async (arr: AdminMedia[]) => {
    const changed = arr
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => m.position !== idx);
    setMedia(arr.map((m, idx) => ({ ...m, position: idx })));
    if (changed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(
        changed.map(({ m, idx }) => adminApi.updateMedia(m.id, { position: idx })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      load();
    } finally {
      setBusy(false);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = media.findIndex((m) => m.id === active.id);
    const to = media.findIndex((m) => m.id === over.id);
    if (from === -1 || to === -1) return;
    persistOrder(arrayMove(media, from, to));
  };

  const saveAlt = async (m: AdminMedia, alt: string) => {
    if (alt === m.alt) return;
    try {
      await adminApi.updateMedia(m.id, { alt });
      setMedia((ms) => ms.map((x) => (x.id === m.id ? { ...x, alt } : x)));
    } catch {
      /* ignore */
    }
  };

  const remove = async (m: AdminMedia) => {
    if (
      !(await confirm({
        title: "Supprimer cette photo ?",
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    setBusy(true);
    try {
      await adminApi.deleteMedia(m.id);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between p-6 pb-0">
        <div>
          <div className="font-semibold leading-none tracking-tight">Photos</div>
          {media.length > 1 && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Glissez une photo entre deux autres pour la réordonner. La 1ʳᵉ est la photo
              principale.
            </p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={onPick}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-4" />
          {busy ? "…" : "Ajouter"}
        </Button>
      </div>
      <CardContent className="pt-4">
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        {media.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune photo. Les images par défaut sont affichées sur le site tant qu&apos;aucune
            photo n&apos;est ajoutée.
          </p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={media.map((m) => m.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {media.map((m, i) => (
                <SortableTile
                  key={m.id}
                  media={m}
                  index={i}
                  busy={busy}
                  onAlt={saveAlt}
                  onRemove={remove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function SortableTile({
  media,
  index,
  busy,
  onAlt,
  onRemove,
}: {
  media: AdminMedia;
  index: number;
  busy: boolean;
  onAlt: (m: AdminMedia, alt: string) => void;
  onRemove: (m: AdminMedia) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: media.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border overflow-hidden bg-muted/30",
        isDragging && "opacity-60 z-10 shadow-lg",
      )}
    >
      <div
        className="relative aspect-[4/3] bg-cover bg-center"
        style={{ backgroundImage: `url('${mediaUrl(media.url)}')` }}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Déplacer la photo"
          className="absolute top-2 left-2 rounded bg-black/45 text-white p-1 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="size-4" />
        </button>
        {index === 0 && (
          <div className="absolute bottom-2 left-2 rounded bg-black/55 text-white text-[10px] font-medium px-2 py-0.5">
            Principale
          </div>
        )}
      </div>
      <div className="p-2 flex items-center gap-2">
        <Input
          defaultValue={media.alt}
          placeholder="Texte alternatif"
          className="h-8"
          onBlur={(e) => onAlt(media, e.target.value)}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          disabled={busy}
          onClick={() => onRemove(media)}
          title="Supprimer"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
