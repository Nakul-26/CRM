"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadCount } from "@/hooks/use-notifications";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { data: unread } = useUnreadCount();
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const count = unread?.count ?? 0;

  return (
    <div className="relative" ref={panelRef}>
      <Button variant="ghost" size="sm" className="relative" onClick={() => setOpen((v) => !v)}>
        Notifications
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-md border border-border bg-card text-card-foreground shadow-md">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="text-sm font-medium">Notifications</span>
            {count > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => markAllRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!notifications?.length ? (
              <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="flex w-full flex-col items-start gap-1 border-b border-border p-3 text-left text-sm last:border-b-0 hover:bg-muted"
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    {n.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
