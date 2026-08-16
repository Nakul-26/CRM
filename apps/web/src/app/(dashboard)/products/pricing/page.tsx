"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useProducts } from "@/hooks/use-products";
import type { ProductDto } from "@sales-platform/contracts";

export default function PricingPage() {
  const { data: products, isLoading } = useProducts();

  const columns: DataTableColumn<ProductDto>[] = [
    {
      header: "Product",
      cell: (p) => (
        <Link href={`/products/${p.id}`} className="font-medium hover:underline">
          {p.name}
        </Link>
      ),
    },
    { header: "Base price", cell: (p) => `${p.currency} ${p.unitPrice.toLocaleString()}` },
    { header: "Tax", cell: (p) => `${p.taxPercent}%` },
    { header: "Status", cell: (p) => (p.isActive ? "Active" : "Inactive") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">
          Base prices across the catalog. Open a product to manage its volume discount tiers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All products</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={products} isLoading={isLoading} emptyMessage="No products yet." rowKey={(p) => p.id} columns={columns} />
        </CardContent>
      </Card>
    </div>
  );
}
