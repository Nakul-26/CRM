"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProducts, fetchSuggestedPrice } from "@/hooks/use-products";
import type { LineItemInput } from "@sales-platform/contracts";

export function lineTotal(item: LineItemInput): number {
  const gross = item.quantity * item.unitPrice;
  const discount = gross * ((item.discountPercent ?? 0) / 100);
  const net = gross - discount;
  const tax = net * ((item.taxPercent ?? 0) / 100);
  return net + tax;
}

export function LineItemEditor({ value, onChange }: { value: LineItemInput[]; onChange: (items: LineItemInput[]) => void }) {
  const { data: products } = useProducts({ isActive: true });

  const update = (index: number, patch: Partial<LineItemInput>) => {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const add = () => onChange([...value, { name: "", quantity: 1, unitPrice: 0, discountPercent: 0, taxPercent: 0 }]);

  const onProductSelect = async (index: number, productId: string) => {
    if (!productId) {
      update(index, { productId: undefined });
      return;
    }
    const product = products?.find((p) => p.id === productId);
    const quantity = value[index].quantity || 1;
    const suggested = await fetchSuggestedPrice(productId, quantity);
    update(index, { productId, name: product?.name ?? "", unitPrice: suggested, taxPercent: product?.taxPercent ?? 0 });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Product</th>
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="w-16 py-2 pr-2 font-medium">Qty</th>
              <th className="w-24 py-2 pr-2 font-medium">Price</th>
              <th className="w-20 py-2 pr-2 font-medium">Disc %</th>
              <th className="w-20 py-2 pr-2 font-medium">Tax %</th>
              <th className="w-24 py-2 pr-2 font-medium text-right">Total</th>
              <th className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.map((item, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                <td className="py-2 pr-2">
                  <select
                    value={item.productId ?? ""}
                    onChange={(e) => onProductSelect(index, e.target.value)}
                    className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Custom</option>
                    {products?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <Input value={item.name} onChange={(e) => update(index, { name: e.target.value })} required className="w-40" />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => update(index, { quantity: Number(e.target.value) || 1 })}
                    className="w-16"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => update(index, { unitPrice: Number(e.target.value) || 0 })}
                    className="w-24"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={item.discountPercent ?? 0}
                    onChange={(e) => update(index, { discountPercent: Number(e.target.value) || 0 })}
                    className="w-20"
                  />
                </td>
                <td className="py-2 pr-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={item.taxPercent ?? 0}
                    onChange={(e) => update(index, { taxPercent: Number(e.target.value) || 0 })}
                    className="w-20"
                  />
                </td>
                <td className="py-2 pr-2 text-right">{lineTotal(item).toFixed(2)}</td>
                <td className="py-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" onClick={add} className="self-start">
        Add line item
      </Button>
    </div>
  );
}
