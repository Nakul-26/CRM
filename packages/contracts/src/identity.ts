import { z } from "zod";
import type { Permission } from "./permissions";

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface UserDto {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
}

export interface RoleDto {
  id: string;
  organizationId: string;
  name: string;
  isSystemRole: boolean;
  permissions: Permission[];
}

export interface TeamDto {
  id: string;
  organizationId: string;
  name: string;
  memberIds: string[];
}

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  roleIds: z.array(z.string().uuid()).min(1),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  memberIds: z.array(z.string().uuid()).default([]),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  permissions: z.array(z.string()).min(0),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
