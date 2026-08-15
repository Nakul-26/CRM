"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthenticatedUser } from "@sales-platform/contracts";
import { NAV_SECTIONS } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function AppSidebar({ user }: { user: AuthenticatedUser }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold">
        Sales Platform
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => !item.permission || user.permissions.includes(item.permission));
          if (items.length === 0) return null;

          return (
            <div key={section.label} className="mb-4">
              <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                      pathname === item.href ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
