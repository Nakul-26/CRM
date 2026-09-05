"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-auth";
import { NotificationBell } from "./notification-bell";

export function AppTopbar({ user }: { user: AuthenticatedUser }) {
  const router = useRouter();
  const logout = useLogout();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <div className="text-sm text-muted-foreground">{/* Global search lands here in a later phase */}</div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        {/* Not part of NAV_SECTIONS (that array mirrors the brief's fixed IA)
            — a user-scoped settings page, same "authenticated user, not
            brief-IA" precedent the bell itself set. See
            docs/decisions/0019-notification-preferences-phase19-scope.md. */}
        <Link href="/settings/notifications" className="text-sm text-muted-foreground hover:text-foreground">
          Notification settings
        </Link>
        <span className="text-sm text-muted-foreground">{user.fullName}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout.mutateAsync();
            router.push("/login");
          }}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
