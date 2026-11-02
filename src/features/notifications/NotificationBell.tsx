"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { playNotificationChime } from "@/lib/notifications/sound";

type NotificationItem = {
  id: string;
  read?: boolean;
  type?: string;
  title?: string;
  message?: string;
  deepLink?: string | null;
};

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    let loading = false;

    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        const body = await response.json();
        if (!active || !response.ok) return;
        const unread = Number(body.unreadCount ?? 0);
        const items: NotificationItem[] = Array.isArray(body.notifications)
          ? body.notifications
          : [];
        const currentIds = new Set(items.map((item) => item.id));
        const previousIds = seenIds.current;
        const freshNotifications =
          previousIds === null
            ? []
            : items.filter((item) => previousIds.has(item.id) === false && item.read !== true);
        const preferences = body.preferences ?? {};

        if (freshNotifications.length > 0) {
          if (preferences.chime !== false) playNotificationChime();
          if (
            preferences.browserAlerts === true &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            for (const item of freshNotifications.slice(0, 3)) {
              try {
                const alert = new Notification(item.title ?? "New notification", {
                  body: item.message ?? "A new notification is available.",
                  tag: item.id,
                });
                alert.onclick = () => {
                  window.focus();
                  window.location.assign(item.deepLink ?? "/notifications");
                  alert.close();
                };
              } catch {
                // Browser notifications are optional; the in-app notification remains available.
              }
            }
          }
        }

        seenIds.current = currentIds;
        setCount(unread);
      } catch {
        // The notification center displays the detailed loading error.
      } finally {
        loading = false;
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link
      className="icon-button"
      href="/notifications"
      aria-label={`${count} unread notifications`}
      title={`${count} unread notification${count === 1 ? "" : "s"}`}
      style={{ position: "relative" }}
    >
      <BellRing size={15} />
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            minWidth: 17,
            height: 17,
            padding: "0 4px",
            display: "grid",
            placeItems: "center",
            borderRadius: 999,
            background: "#315ee8",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            border: "2px solid #fff",
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
