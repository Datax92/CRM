"use client";

import type React from "react";
import { AlertTriangle, DollarSign } from "lucide-react";
import type { Lead } from "@/hooks/useLeads";
import { LeadCard } from "@/components/LeadCard";
import { DateTimePicker } from "@/components/ui/DateTimePicker";

export type RunAction = (fn: () => Promise<{ ok: boolean; error?: string }>, successText: string) => Promise<boolean>;

export function ResponsiveTableWrapper({ children, minWidth }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="max-w-full overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_2px_15px_rgba(0,0,0,0.03)]">
      <div className="admin-table-scroll max-w-full overflow-x-auto">
        <div className="w-full" style={{ minWidth }}>{children}</div>
      </div>
    </div>
  );
}

export function TableRow({ children, onClick, className = "" }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={`transition-colors hover:bg-slate-50/70 ${onClick ? "cursor-pointer" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  label: _label,
  numeric = false,
  tone,
  className = "",
}: {
  children: React.ReactNode;
  label?: string;
  numeric?: boolean;
  tone?: "positive" | "negative" | "loss" | "default";
  className?: string;
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-600 font-semibold" :
      tone === "negative" || tone === "loss" ? "text-rose-600 font-semibold" :
        "text-slate-800";
  return (
    <td
      className={`px-5 py-4 align-middle text-sm ${numeric ? "text-right tabular-nums" : "text-left"} ${toneClass} ${className}`}
    >
      {children}
    </td>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-emerald-600" />
    </div>
  );
}

export function Banner({ tone, text, onDismiss }: { tone: "error" | "success"; text: string; onDismiss?: () => void }) {
  return (
    <div className={`mb-3 flex items-start justify-between gap-3 rounded-xl border p-3.5 text-xs font-medium ${tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}>
      <span className="flex items-start gap-2">
        {tone === "error" && <AlertTriangle size={15} className="mt-px shrink-0 text-rose-500" />}
        {text}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded font-bold text-slate-800 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone = "default" }: {
  label: string; value: string; hint: string; icon: typeof DollarSign;
  tone?: "default" | "positive" | "negative";
}) {
  const valueColor =
    tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-slate-800";
  const iconColor =
    tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-slate-400";

  return (
    <div className="min-w-0 space-y-2 rounded-2xl border border-slate-100 bg-white p-5 shadow-xs transition-all hover:shadow-md">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span className="truncate text-slate-700">{label}</span>
        <Icon size={16} className={`shrink-0 ${iconColor}`} aria-hidden="true" />
      </div>
      <p className={`whitespace-nowrap text-2xl font-bold tabular-nums tracking-tight md:text-3xl ${valueColor}`}>{value}</p>
      <p className="text-xs text-slate-400 font-medium">{hint}</p>
    </div>
  );
}

function getStatusBadgeStyle(status: string) {
  switch (status) {
    case "ASSIGNED":
      return "bg-blue-50 text-blue-700 border-blue-200/60";
    case "ACCEPTED":
      return "bg-indigo-50 text-indigo-700 border-indigo-200/60";
    case "CONTACTED":
      return "bg-sky-50 text-sky-700 border-sky-200/60";
    case "INTERESTED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200/60";
    case "NEGOTIATION":
      return "bg-amber-50 text-amber-700 border-amber-200/60";
    case "NO_RESPONSE":
      return "bg-slate-100 text-slate-600 border-slate-200/60";
    case "CLOSED_WON":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "CLOSED_LOST":
    case "NOT_INTERESTED":
      return "bg-rose-50 text-rose-700 border-rose-200/60";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export function LeadSection({
  title, subtitle, leads, actionText, onLeadClick, employeeName, emptyText, tone = "default", onReassignClick
}: {
  title: string; subtitle?: string; leads: Lead[]; actionText: string;
  onLeadClick: (lead: Lead) => void; employeeName: (uid?: string | null) => string | undefined;
  emptyText?: string; tone?: "default" | "urgent" | "critical";
  onReassignClick?: (lead: Lead) => void;
}) {
  const badgeColor =
    tone === "critical"
      ? "border-rose-200 bg-rose-50 text-rose-600"
      : tone === "urgent"
        ? "border-amber-200 bg-amber-50 text-amber-600"
        : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
          <span>{title}</span>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
            {leads.length}
          </span>
        </h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>

      {leads.length === 0 ? (
        emptyText && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
            {emptyText}
          </div>
        )
      ) : (
        <ResponsiveTableWrapper minWidth={720}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3.5">Lead Details</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Assignee</th>
                <th className="px-5 py-3.5">Source / Campaign</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <TableRow key={lead.id} onClick={() => onLeadClick(lead)}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{lead.name}</div>
                    <div className="text-xs text-slate-400 font-normal mt-0.5">{lead.phone || lead.email || "No contact info"}</div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${getStatusBadgeStyle(lead.status)}`}>
                      {lead.status.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-700 font-medium text-xs">
                      {employeeName(lead.assignedUserId) || "Unassigned"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-slate-800 font-medium capitalize text-xs">{lead.source.replace(/_/g, " ").toLowerCase()}</div>
                    {lead.campaignName && <div className="text-[11px] text-slate-400 mt-0.5">{lead.campaignName}</div>}
                  </TableCell>
                  <TableCell numeric>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); onLeadClick(lead); }}
                        className="rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        {actionText}
                      </button>
                      {onReassignClick && lead.status !== "CLOSED_WON" && lead.status !== "CLOSED_LOST" && lead.status !== "NOT_INTERESTED" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onReassignClick(lead); }}
                          className="rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-1.5 text-xs font-semibold transition-colors"
                        >
                          Reassign
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}
    </section>
  );
}

export function LabelledInput({
  label, value, onChange, type = "text", required, placeholder, hint, min, max, minLength, step, autoComplete, disabled, id,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  required?: boolean; placeholder?: string; hint?: string; min?: string; max?: string; minLength?: number; step?: string; autoComplete?: string; disabled?: boolean; id?: string;
}) {
  const generatedId = `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const finalId = id || generatedId;

  if (type === "date" || type === "datetime-local") {
    return (
      <div className="space-y-1.5 w-full">
        <label htmlFor={finalId} className="block text-sm font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
          {hint && <span className="ml-1.5 font-normal text-slate-400 text-xs">{hint}</span>}
        </label>
        <DateTimePicker
          id={finalId}
          mode={type === "date" ? "date" : "datetime"}
          value={value}
          onChange={onChange}
          placeholder={placeholder || (type === "date" ? "Select date..." : "Select date & time...")}
          disabled={disabled}
          required={required}
          min={min}
          max={max}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5 w-full">
      <label htmlFor={finalId} className="block text-sm font-semibold text-slate-700">
        {label} {required && <span className="text-rose-500">*</span>}
        {hint && <span className="ml-1.5 font-normal text-slate-400 text-xs">{hint}</span>}
      </label>
      <input
        id={finalId}
        type={type}
        required={required}
        min={min}
        max={max}
        minLength={minLength}
        step={step}
        autoComplete={autoComplete}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10 outline-none transition-all placeholder:text-slate-400 placeholder:font-normal disabled:bg-slate-50 disabled:text-slate-400"
      />
    </div>
  );
}