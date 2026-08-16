"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateProductInput, ProductDto } from "@sales-platform/contracts";

export function ProductForm({
  initial,
  onSubmit,
  submitLabel = "Create",
  isPending,
}: {
  initial?: Partial<ProductDto>;
  onSubmit: (input: CreateProductInput) => void;
  submitLabel?: string;
  isPending?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [unitPrice, setUnitPrice] = useState(initial?.unitPrice != null ? String(initial.unitPrice) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [taxPercent, setTaxPercent] = useState(initial?.taxPercent != null ? String(initial.taxPercent) : "0");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      sku: sku || undefined,
      category: category || undefined,
      description: description || undefined,
      unitPrice: Number(unitPrice || 0),
      currency,
      taxPercent: Number(taxPercent || 0),
      isActive,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prod-name">Name</Label>
        <Input id="prod-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prod-sku">SKU</Label>
          <Input id="prod-sku" value={sku ?? ""} onChange={(e) => setSku(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prod-category">Category</Label>
          <Input id="prod-category" value={category ?? ""} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prod-price">Unit price</Label>
          <Input id="prod-price" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prod-currency">Currency</Label>
          <Input id="prod-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prod-tax">Tax %</Label>
          <Input id="prod-tax" type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="prod-description">Description</Label>
        <textarea
          id="prod-description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
