"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ProductForm } from "@/components/products/product-form";
import { PriceTierEditor } from "@/components/products/price-tier-editor";
import { useCurrentUser } from "@/hooks/use-auth";
import { useDeleteProduct, useProduct, useUpdateProduct } from "@/hooks/use-products";
import { ApiError } from "@/lib/http";
import type { UpdateProductInput } from "@sales-platform/contracts";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();
  const { data: product, isLoading } = useProduct(id);
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = currentUser?.permissions.includes("products.edit");
  const canDelete = currentUser?.permissions.includes("products.delete");
  const canManagePricing = currentUser?.permissions.includes("products.pricing.manage") ?? false;

  const onUpdate = async (input: UpdateProductInput) => {
    if (!product) return;
    setError(null);
    try {
      await updateProduct.mutateAsync({ id: product.id, input });
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.body.error.message : "Failed to update product");
    }
  };

  const onDelete = async () => {
    if (!product) return;
    if (!window.confirm(`Delete product "${product.name}"? This cannot be undone.`)) return;
    await deleteProduct.mutateAsync(product.id);
    router.push("/products");
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!product) return <p className="text-sm text-muted-foreground">Product not found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/products" className="text-sm text-muted-foreground hover:underline">
            ← Products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-sm text-muted-foreground">{product.sku ?? "No SKU"}</p>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Unit price</p>
            <p>
              {product.currency} {product.unitPrice.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Tax</p>
            <p>{product.taxPercent}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Category</p>
            <p>{product.category ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <p>{product.isActive ? "Active" : "Inactive"}</p>
          </div>
          {product.description && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Description</p>
              <p className="whitespace-pre-wrap">{product.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume pricing tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceTierEditor productId={product.id} canManage={canManagePricing} />
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit product">
        <ProductForm initial={product} onSubmit={onUpdate} submitLabel="Save changes" isPending={updateProduct.isPending} />
      </Dialog>
    </div>
  );
}
