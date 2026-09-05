"use client";

import { useEffect, useState } from "react";
import type { NotificationEmailDeliveryMode } from "@sales-platform/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/use-notification-preferences";

const OPTIONS: { value: NotificationEmailDeliveryMode; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "In-app notifications only — no email (default)." },
  { value: "immediate", label: "Immediately", description: "Email me right away, in addition to the in-app notification." },
  { value: "daily_digest", label: "Daily digest", description: "Email me a once-daily summary of everything I missed." },
];

/**
 * The one and only user-scoped settings page so far — not part of
 * NAV_SECTIONS (that array mirrors the brief's fixed information
 * architecture), reached instead via a link in AppTopbar. See
 * docs/decisions/0019-notification-preferences-phase19-scope.md.
 */
export default function NotificationSettingsPage() {
  const { data: preferences, isLoading } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [emailDelivery, setEmailDelivery] = useState<NotificationEmailDeliveryMode>("off");

  useEffect(() => {
    if (preferences) setEmailDelivery(preferences.emailDelivery);
  }, [preferences]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notification settings</h1>
        <p className="text-sm text-muted-foreground">
          Ticket assignments, opportunity/quote outcomes, and payment results always show up in your notification bell. Choose whether you'd also
          like an email.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email delivery</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updatePreferences.mutate({ emailDelivery });
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                {OPTIONS.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
                    <input
                      type="radio"
                      name="emailDelivery"
                      value={option.value}
                      checked={emailDelivery === option.value}
                      onChange={() => setEmailDelivery(option.value)}
                      className="mt-1"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div>
                <Button type="submit" disabled={updatePreferences.isPending}>
                  {updatePreferences.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
              {updatePreferences.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
