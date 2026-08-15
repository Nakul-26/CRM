import type { AuthenticatedUser } from "@sales-platform/contracts";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
