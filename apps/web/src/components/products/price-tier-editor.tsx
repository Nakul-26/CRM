"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatePriceTier, useDeletePriceTier, usePriceTiers } from "@/hooks/use-products";
import { ApiError } from "@/lib/http";

export function PriceTierEditor({ productId, canManage }: { productId: string; canManage: boolean }) {
  const { data: tiers, isLoading } = usePriceTiers(productId);
  const createTier = useCreatePriceTier();
  const deleteTier = useDeletePriceTier();
  const [minQuantity, setMinQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createTier.mutateAsync({ productId, input: { minQuantity: Number(minQuantity), unitPrice: Number(unitPrice) } });
      setMinQuantity("1");
      setUnitPrice("");
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to add price tier");
    }
  };

  const onDelete = async (tierId: string) => {
    setError(null);
    try {
      await deleteTier.mutateAsync({ productId, tierId });
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to remove price tier");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : tiers && tiers.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {tiers.map((t) => (
            <li key={t.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
              <span>
                {t.minQuantity}+ units → {t.unitPrice.toLocaleString()} each
              </span>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => onDelete(t.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No volume tiers — base price applies at any quantity.</p>
      )}

      {canManage && (
        <form onSubmit={onCreate} className="flex items-end gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tier-min-qty">Min quantity</Label>
            <Input id="tier-min-qty" type="number" min="1" className="w-28" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tier-price">Unit price</Label>
            <Input id="tier-price" type="number" min="0" step="0.01" className="w-32" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
          </div>
          <Button type="submit" disabled={createTier.isPending}>
            {createTier.isPending ? "Adding..." : "Add tier"}
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
