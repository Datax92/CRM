"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bell, Check, AlertTriangle, Clock, UserX, PieChart, Wallet } from "lucide-react";
import { useNotifications } from "@/hooks/useFinancials";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/clientActions";
import { formatBusinessDateTime } from "@/lib/dates";

const ALERT_META: Record<string, { label: string; icon: typeof AlertTriangle; tone: string }> = {
  RED_FLAG: { label: "Not accepted in time", icon: AlertTriangle, tone: "text-red-700 bg-red-50 border-red-200" },
  NO_FOLLOWUP: { label: "No follow-up logged", icon: Clock, tone: "text-amber-700 bg-amber-50 border-amber-200" },
  UNASSIGNED_LEAD: { label: "Needs manual assignment", icon: UserX, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  NEW_LEAD_ASSIGNED: { label: "New lead assigned", icon: Bell, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  DEAL_CLOSED_REVIEW: { label: "Deal closed — profit to distribute", icon: PieChart, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  PROFIT_SHARE_ASSIGNED: { label: "Your share of a closed deal", icon: Wallet, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
};

/**
 * Where an alert takes you when there is somewhere to go.
 *
 * Only two types have an action worth a link today, and both are new: the
 * admin's "split this deal" and the recipient's "here is your share". The rest
 * are informational, and a link that lands somewhere unhelpful is worse than
 * no link at all.
 */
function alertAction(type: string, role: string | undefined): { href: string; label: string } | null {
  if (type === "DEAL_CLOSED_REVIEW" && role === "admin") {
    return { href: "/admin/financials/distribution", label: "Finalize Profit Distribution" };
  }
  if (type === "PROFIT_SHARE_ASSIGNED") {
    return {
      href: role === "subadmin" ? "/subadmin/earnings" : "/employee/earnings",
      label: "View my earnings",
    };
  }
  return null;
}

export function NotificationsPanel({ getIdToken, uid, role }: { getIdToken: () => Promise<string>, uid: string | undefined, role: string | undefined }) {
  const { notifications } = useNotifications(uid, role);
  const [isOpen, setIsOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Add z-index to backdrop for dropdown layer ordering
  useEffect(() => {
    if (isOpen) {
      const style = document.createElement('style');
      style.id = 'dropdown-z-fix';
      style.textContent = `
        .dropdown-backdrop {
          z-index: 40;
        }
      `;
      document.head.appendChild(style);
      return () => {
        const el = document.getElementById('dropdown-z-fix');
        if (el) el.remove();
      };
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      await markNotificationRead(await getIdToken(), id);
    } catch (error) {
      console.error("[notifications] dismiss failed", error);
    } finally {
      setBusyId(null);
    }
  };

  const dismissAll = async () => {
    setBusyId("all");
    try {
      await markAllNotificationsRead(await getIdToken());
    } catch (error) {
      console.error("[notifications] dismiss all failed", error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Alerts${notifications.length ? `, ${notifications.length} unread` : ""}`}
        aria-expanded={isOpen}
        className="relative rounded-full p-2 text-slate-900 transition-colors hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      >
        <Bell size={20} />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            {notifications.length > 99 ? "99+" : notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-3 max-h-[420px] w-96 overflow-y-auto rounded-2xl border border-emerald-100 bg-white shadow-2xl page-enter">
          <div className="sticky top-0 flex items-center justify-between border-b border-emerald-100 bg-white p-4 backdrop-blur-sm">
            <h3 className="font-bold text-slate-900">Alerts</h3>
            {notifications.length > 0 && (
              <button
                onClick={dismissAll}
                disabled={busyId === "all"}
                className="text-xs font-bold text-emerald-700 hover:text-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {busyId === "all" ? "Clearing..." : "Clear all"}
              </button>
            )}
          </div>

          <div className="p-3">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-slate-500">Nothing needs your attention.</p>
            ) : (
              notifications.map((notification) => {
                const meta = ALERT_META[notification.type] ?? {
                  label: notification.type.replace(/_/g, " "),
                  icon: AlertTriangle,
                  tone: "text-slate-900 bg-slate-50 border-slate-200",
                };
                const Icon = meta.icon;
                const action = alertAction(notification.type, role);

                return (
                  <div key={notification.id} className="mb-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`flex items-center gap-2 font-bold ${meta.tone.split(" ")[0]}`}>
                        <Icon size={15} className="shrink-0" />
                        {meta.label}
                      </span>
                      <button
                        onClick={() => dismiss(notification.id)}
                        disabled={busyId === notification.id}
                        aria-label="Dismiss alert"
                        className="shrink-0 rounded-full p-1 transition-colors hover:bg-slate-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Check size={14} />
                      </button>
                    </div>
                    <p className="mt-1.5 text-slate-800">{notification.payload?.message ?? "Action required."}</p>

                    {action && (
                      <Link
                        href={action.href}
                        onClick={() => setIsOpen(false)}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                      >
                        {action.label}
                      </Link>
                    )}

                    <p className="mt-2 text-xs text-slate-500">{formatBusinessDateTime(notification.createdAt)}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
