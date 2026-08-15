import { z } from "zod";

export const registerOrganizationSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[0-9]/, "Password must contain a digit"),
});
export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  // Only required if the same email is registered under more than one
  // organization (e.g. a consultant who owns two separate workspaces).
  organizationSlug: z.string().trim().toLowerCase().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  permissions: string[];
}

export interface AuthResponse {
  tokens: AuthTokens;
  user: AuthenticatedUser;
}
