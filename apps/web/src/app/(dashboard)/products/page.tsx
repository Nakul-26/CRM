"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { ProductForm } from "@/components/products/product-form";
import { useCurrentUser } from "@/hooks/use-auth";
import { useCreateProduct, useProducts } from "@/hooks/use-products";
import { ApiError } from "@/lib/http";
import type { CreateProductInput, ProductDto } from "@sales-platform/contracts";

export default function ProductsPage() {
  const { data: currentUser } = useCurrentUser();
  const { data: products, isLoading } = useProducts();
  const create = useCreateProduct();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = currentUser?.permissions.includes("products.create");

  const onCreate = async (input: CreateProductInput) => {
    setError(null);
    try {
      await create.mutateAsync(input);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to create product");
    }
  };

  const columns: DataTableColumn<ProductDto>[] = [
    {
      header: "Name",
      cell: (p) => (
        <Link href={`/products/${p.id}`} className="font-medium hover:underline">
          {p.name}
        </Link>
      ),
    },
    { header: "SKU", cell: (p) => p.sku ?? "—" },
    { header: "Category", cell: (p) => p.category ?? "—" },
    { header: "Unit price", cell: (p) => `${p.currency} ${p.unitPrice.toLocaleString()}` },
    { header: "Status", cell: (p) => (p.isActive ? "Active" : "Inactive") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">The catalog quotes are built from.</p>
        </div>
        {canCreate && <Button onClick={() => setDialogOpen(true)}>New Product</Button>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All products</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={products} isLoading={isLoading} emptyMessage="No products yet." rowKey={(p) => p.id} columns={columns} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="New product">
        <ProductForm onSubmit={onCreate} isPending={create.isPending} />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </Dialog>
    </div>
  );
}
