import { z } from "zod";

export interface ProductDto {
  id: string;
  organizationId: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  unitPrice: number;
  currency: string;
  taxPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PriceTierDto {
  id: string;
  organizationId: string;
  productId: string;
  minQuantity: number;
  unitPrice: number;
  createdAt: string;
  updatedAt: string;
}

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(60).optional(),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(120).optional(),
  unitPrice: z.number().nonnegative(),
  currency: z.string().trim().min(1).max(10).default("USD"),
  taxPercent: z.number().min(0).max(100).default(0),
  isActive: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const createPriceTierSchema = z.object({
  minQuantity: z.number().int().min(1),
  unitPrice: z.number().nonnegative(),
});
export type CreatePriceTierInput = z.infer<typeof createPriceTierSchema>;

export const updatePriceTierSchema = createPriceTierSchema.partial();
export type UpdatePriceTierInput = z.infer<typeof updatePriceTierSchema>;
