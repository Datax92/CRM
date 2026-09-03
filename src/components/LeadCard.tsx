"use client";

import { useEffect, useState } from "react";
import { Clock, User, ArrowRight, AlertTriangle, Phone } from "lucide-react";
import type { Lead } from "@/hooks/useLeads";
import { ACCEPT_WINDOW_MS } from "@/lib/constants/distribution";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { formatPhone } from "@/lib/phone";
import { formatBusinessDate } from "@/lib/dates";

/** PRD BR-4 / BR-7 — used only to decide gold vs alert-red pill styling (>50% remaining). */
const ADMIN_ASSIGN_WINDOW_MS = 5 * 60_000;


interface LeadCardProps {
  lead: Lead;
  onClick?: () => void;
  actionText?: string;
  /** Display name for the assigned employee, when the caller knows it. */
  assigneeName?: string;
}

/**
 * Full status list from `LeadStatus` — blue/amber for pipeline; green/red only for won/lost.
 * Never invent demo-only colors; every status in leadStatus.ts must appear here.
 */
const STATUS_STYLES: Record<LeadStatus, string> = {
  NEW: "bg-blue-50 text-blue-700 border-blue-200",
  ASSIGNED: "bg-status-amber-bg text-status-amber border-status-amber/30",
  ACCEPTED: "bg-status-blue-bg text-status-blue border-status-blue/30",
  CONTACTED: "bg-status-blue-bg text-status-blue border-status-blue/30",
  DETAILS_SENT: "bg-status-blue-bg text-status-blue border-status-blue/30",
  FOLLOW_UP: "bg-status-amber-bg text-status-amber border-status-amber/30",
  INTERESTED: "bg-status-blue-bg text-status-blue border-status-blue/30",
  NEGOTIATION: "bg-amber-600 text-white border-amber-600/30",
  // The P2 band — they turned up, which is the first real signal.
  MEETING_DONE: "bg-status-blue-bg text-status-blue border-status-blue/30",
  SITE_VISIT_DONE: "bg-status-blue-bg text-status-blue border-status-blue/30",
  // The P1 band reads as progress toward the green of a closed deal.
  DOCUMENT_RECEIVED: "bg-profit-green-light text-profit-green border-profit-green/30",
  TOKEN_RECEIVED: "bg-profit-green-light text-profit-green border-profit-green/30",
  CLOSED_WON: "bg-profit-green-light text-profit-green border-profit-green/30",
  CLOSED_LOST: "bg-alert-red-light text-alert-red border-alert-red/30",
  NOT_INTERESTED: "bg-status-amber-bg text-status-amber border-status-amber/30",
  NO_RESPONSE: "bg-status-amber-bg text-status-amber border-status-amber/30",
  UNASSIGNED_NO_CAPACITY: "bg-status-amber-bg text-status-amber border-status-amber/30",
};

export function LeadCard({ lead, onClick, actionText, assigneeName }: LeadCardProps) {
  const countdown = useCountdown(lead);
  const statusStyle =
    STATUS_STYLES[lead.status as LeadStatus] ??
    "bg-status-blue-bg text-status-blue border-status-blue/30";
  const isOverdue = countdown?.expired ?? false;
  const timerUrgent = countdown ? countdown.expired || countdown.fractionRemaining < 0.5 : false;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`group card-lift flex min-w-0 flex-col rounded-2xl border bg-white p-5 shadow-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        onClick ? "cursor-pointer hover:border-emerald-500/50" : ""
      } ${isOverdue ? "border-alert-red/50" : "border-emerald-100"}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-lg font-semibold tracking-tight text-slate-900">{lead.name}</h4>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <User size={14} className="shrink-0 text-slate-400" />
            <span className="truncate">
              {lead.assignedUserId ? (assigneeName ?? "Assigned") : "Unassigned"}
            </span>
          </p>
          {lead.phone ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <Phone size={12} className="shrink-0 text-slate-400" />
              <span className="tabular-nums">{formatPhone(lead.phone)}</span>
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <AlertTriangle size={12} className="shrink-0 text-amber-500" />
              No contact number
            </p>
          )}
        </div>

        <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyle}`}>
          {LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}
        </span>
      </div>

      {lead.campaignName && (
        <p className="mb-3 truncate text-xs text-slate-500">Campaign: {lead.campaignName}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
        {countdown ? (
          <div
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
              timerUrgent
                ? "border border-red-200 bg-red-50 text-red-600"
                : "border border-amber-200 bg-amber-50 text-amber-700"
            }`}
            aria-label={
              countdown.expired
                ? "Assignment window closed"
                : `${countdown.display} left on the timer`
            }
          >
            <Clock size={14} className="shrink-0" aria-hidden="true" />
            {/* Text always states urgency — color alone is not enough (a11y). */}
            <span>{countdown.expired ? "Window closed" : `${countdown.display} left`}</span>
          </div>
        ) : (
          <div className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
            {formatBusinessDate(lead.createdAt)}
          </div>
        )}

        {onClick && actionText && (
          <div className="flex items-center gap-1 text-sm font-bold text-emerald-700 group-hover:text-emerald-800">
            {actionText}
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1 shrink-0 text-emerald-700" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Live countdown for whichever SLA window applies (BR-4, BR-7).
 *
 * "Window closed" is shown rather than a negative number: once the deadline
 * passes the lead is queued for the next sweep, so the action is no longer
 * available even though the card is still on screen.
 *
 * `fractionRemaining` is display-only (gold vs alert pill); deadline math is unchanged.
 */
function useCountdown(lead: Lead) {
  const deadlineMs =
    lead.status === "NEW"
      ? (lead.adminAssignDeadlineAt?.toMillis?.() ?? null)
      : lead.status === "ASSIGNED"
        ? (lead.acceptDeadlineAt?.toMillis?.() ?? null)
        : null;

  const windowMs =
    lead.status === "NEW"
      ? ADMIN_ASSIGN_WINDOW_MS
      : lead.status === "ASSIGNED"
        ? ACCEPT_WINDOW_MS
        : 0;

  // The effect only advances a clock; the display is derived during render.
  // Computing the first frame inside the effect instead would set state
  // synchronously on mount and cause a cascading re-render.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineMs) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  if (!deadlineMs) return null;

  const remaining = deadlineMs - now;
  if (remaining <= 0) {
    return { display: "0:00", expired: true, fractionRemaining: 0 };
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const fractionRemaining = windowMs > 0 ? Math.min(1, remaining / windowMs) : 1;
  return {
    display: `${minutes}:${String(seconds).padStart(2, "0")}`,
    expired: false,
    fractionRemaining,
  };
}
