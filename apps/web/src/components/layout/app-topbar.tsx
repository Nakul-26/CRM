"use client";

import { useRouter } from "next/navigation";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { Button } from "@/components/ui/button";
import { useLogout } from "@/hooks/use-auth";

export function AppTopbar({ user }: { user: AuthenticatedUser }) {
  const router = useRouter();
  const logout = useLogout();

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-4">
      <div className="text-sm text-muted-foreground">{/* Global search lands here in a later phase */}</div>
      <div className="flex items-center gap-3">
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
