"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { adminApi, type AdminProduct } from "@/lib/admin-api";
import { useConfirm } from "@/components/admin/dialogs";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function PrestationsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);

  const reload = () => adminApi.listProducts().then(setProducts).catch(() => setProducts([]));
  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prestations</h1>
        <p className="text-sm text-muted-foreground">
          Produits complémentaires proposés au moment de la réservation.
        </p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Clé</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[120px]">Prix</TableHead>
              <TableHead className="w-[110px]">Statut</TableHead>
              <TableHead className="w-[140px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products === null && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {products?.map((p) => (
              <ProductRow key={p.id} product={p} onChanged={reload} />
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateProduct nextPosition={(products?.length ?? 0)} onCreated={reload} />
    </div>
  );
}

function ProductRow({
  product,
  onChanged,
}: {
  product: AdminProduct;
  onChanged: () => void;
}) {
  const [label, setLabel] = useState(product.label);
  const [description, setDescription] = useState(product.description);
  const [euros, setEuros] = useState((product.priceCents / 100).toString());
  const [active, setActive] = useState(product.active);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    label !== product.label ||
    description !== product.description ||
    Math.round(parseFloat(euros || "0") * 100) !== product.priceCents ||
    active !== product.active;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateProduct(product.id, {
        key: product.key,
        label,
        description,
        priceCents: Math.round(parseFloat(euros || "0") * 100),
        active,
        position: product.position,
      });
      toast.success("Prestation enregistrée.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: "Supprimer la prestation ?",
        description: `« ${product.label} »`,
        danger: true,
        confirmLabel: "Supprimer",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteProduct(product.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs text-muted-foreground">{product.key}</TableCell>
      <TableCell>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
      </TableCell>
      <TableCell>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-8"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            step={5}
            value={euros}
            onChange={(e) => setEuros(e.target.value)}
            className="h-8"
          />
          <span className="text-muted-foreground text-sm">€</span>
        </div>
      </TableCell>
      <TableCell>
        <button type="button" onClick={() => setActive((a) => !a)}>
          <Badge variant={active ? "success" : "muted"}>{active ? "Actif" : "Inactif"}</Badge>
        </button>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" onClick={save} disabled={!dirty || busy}>
            {busy ? "…" : "Enregistrer"}
          </Button>
          <Button size="icon" variant="ghost" onClick={remove} disabled={busy} title="Supprimer">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
        {error && <div className="text-xs text-destructive mt-1">{error}</div>}
      </TableCell>
    </TableRow>
  );
}

function CreateProduct({
  nextPosition,
  onCreated,
}: {
  nextPosition: number;
  onCreated: () => void;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [euros, setEuros] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createProduct({
        key: key.trim(),
        label,
        description,
        priceCents: Math.round(parseFloat(euros || "0") * 100),
        active: true,
        position: nextPosition,
      });
      setKey("");
      setLabel("");
      setDescription("");
      setEuros("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nouvelle prestation</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={create} className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="space-y-1.5">
            <Label>Clé</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="spa" required />
          </div>
          <div className="space-y-1.5">
            <Label>Libellé</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Prix (€)</Label>
            <Input
              type="number"
              min={0}
              step={5}
              value={euros}
              onChange={(e) => setEuros(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Ajouter"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
      </CardContent>
    </Card>
  );
}
