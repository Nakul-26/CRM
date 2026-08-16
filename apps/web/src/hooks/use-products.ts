"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePriceTierInput,
  CreateProductInput,
  PriceTierDto,
  ProductDto,
  UpdatePriceTierInput,
  UpdateProductInput,
} from "@sales-platform/contracts";
import { apiFetch } from "@/lib/http";

export interface ProductFilters {
  category?: string;
  isActive?: boolean;
}

function toQuery(filters: ProductFilters) {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useProducts(filters: ProductFilters = {}) {
  return useQuery<ProductDto[]>({
    queryKey: ["products", filters],
    queryFn: () => apiFetch<ProductDto[]>(`products${toQuery(filters)}`),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery<ProductDto>({
    queryKey: ["products", id],
    queryFn: () => apiFetch<ProductDto>(`products/${id}`),
    enabled: Boolean(id),
  });
}

export function usePriceTiers(productId: string | undefined) {
  return useQuery<PriceTierDto[]>({
    queryKey: ["products", productId, "price-tiers"],
    queryFn: () => apiFetch<PriceTierDto[]>(`products/${productId}/price-tiers`),
    enabled: Boolean(productId),
  });
}

/** Suggested unit price for a quantity, from the product's volume tiers (or its base price). */
export async function fetchSuggestedPrice(productId: string, quantity: number): Promise<number> {
  const { unitPrice } = await apiFetch<{ unitPrice: number }>(`products/${productId}/price?quantity=${quantity}`);
  return unitPrice;
}

function invalidateProduct(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  queryClient.invalidateQueries({ queryKey: ["products"] });
  queryClient.invalidateQueries({ queryKey: ["products", id] });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => apiFetch<ProductDto>("products", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      apiFetch<ProductDto>(`products/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => invalidateProduct(queryClient, variables.id),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`products/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useCreatePriceTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: CreatePriceTierInput }) =>
      apiFetch<PriceTierDto>(`products/${productId}/price-tiers`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["products", variables.productId, "price-tiers"] }),
  });
}

export function useUpdatePriceTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, tierId, input }: { productId: string; tierId: string; input: UpdatePriceTierInput }) =>
      apiFetch<PriceTierDto>(`products/${productId}/price-tiers/${tierId}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["products", variables.productId, "price-tiers"] }),
  });
}

export function useDeletePriceTier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, tierId }: { productId: string; tierId: string }) =>
      apiFetch<void>(`products/${productId}/price-tiers/${tierId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["products", variables.productId, "price-tiers"] }),
  });
}
