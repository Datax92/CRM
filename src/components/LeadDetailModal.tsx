"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Lead } from "@/hooks/useLeads";
import { useLeadHistory } from "@/hooks/useLeads";
import { useDealForLead } from "@/hooks/useFinancials";
import { addFollowUp, setLeadStatus, closeDeal, PAYMENT_METHODS, acceptLead } from "@/lib/clientActions";
import { USER_SETTABLE_STATUSES, LEAD_STATUS_LABELS, isTerminal, type LeadStatus } from "@/lib/leadStatus";
import { whatsAppUrl, telUrl, formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { formatBusinessDate, formatBusinessDateTime } from "@/lib/dates";
import { CONNECT_MIN_SECONDS, formatDuration, isConnect } from "@/lib/kpi";
import { DEFAULT_DEAL_CATEGORY } from "@/lib/constants/deals";
import {
  Phone,
  Mail,
  MessageCircle,
  Clock,
  Tag,
  Plus,
  DollarSign,
  History,
  User,
  Activity,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  X,
  UserCheck,
  PhoneCall,
  FileText,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { CustomSelect } from "@/components/ui/CustomSelect";

interface LeadDetailModalProps {
  lead: Lead | null;
  onClose: () => void;
  userRole: "admin" | "employee";
  getIdToken: () => Promise<string>;
  assigneeName?: string;
  onReassignRequest?: () => void;
}

type Tab = "FOLLOW_UPS" | "AUDIT_TRAIL" | "DEAL_ENTRY";

/** Today in Asia/Karachi, as the yyyy-mm-dd a date input expects. */
function todayInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

const STATUS_PILL_STYLES: Record<string, string> = {
  NEW: "bg-sky-50 text-sky-700 border-sky-200",
  ASSIGNED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ACCEPTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CONTACTED: "bg-blue-50 text-blue-700 border-blue-200",
  FOLLOW_UP: "bg-violet-50 text-violet-700 border-violet-200",
  INTERESTED: "bg-amber-50 text-amber-700 border-amber-200",
  NEGOTIATION: "bg-orange-50 text-orange-700 border-orange-200",
  CLOSED_WON: "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold",
  CLOSED_LOST: "bg-rose-50 text-rose-700 border-rose-200",
  NOT_INTERESTED: "bg-slate-100 text-slate-700 border-slate-200",
  NO_RESPONSE: "bg-slate-100 text-slate-600 border-slate-200",
  UNASSIGNED_NO_CAPACITY: "bg-rose-50 text-rose-700 border-rose-200",
};

export function LeadDetailModal({
  lead,
  onClose,
  userRole,
  getIdToken,
  assigneeName,
  onReassignRequest,
}: LeadDetailModalProps) {
  const { followUps, events, error: historyError } = useLeadHistory(lead?.id ?? null);
  const { deal } = useDealForLead(lead?.id ?? null);
  const [activeTab, setActiveTab] = useState<Tab>("FOLLOW_UPS");
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // Prevent background scroll and escape listener
  useEffect(() => {
    if (!lead) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [lead, onClose]);

  const statusOptions = useMemo(() => {
    return USER_SETTABLE_STATUSES.map((status) => ({
      value: status,
      label: LEAD_STATUS_LABELS[status] ?? status,
      badge: {
        text: LEAD_STATUS_LABELS[status] ?? status,
        className: STATUS_PILL_STYLES[status] || "bg-slate-100 text-slate-700 border-slate-200",
      },
    }));
  }, []);

  if (!lead || typeof document === "undefined") return null;

  const waUrl = whatsAppUrl(lead.phone);
  const callUrl = telUrl(lead.phone);
  const closed = isTerminal(lead.status);
  const canEnterDeal = !closed && lead.status !== "ASSIGNED" && lead.status !== "NEW";
  const pillStyle = STATUS_PILL_STYLES[lead.status] || "bg-slate-100 text-slate-700 border-slate-200";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 md:p-8">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-fade"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal Dialog Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Lead: ${lead.name}`}
        className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-15px_rgba(15,23,42,0.35)] animate-modal-pop"
      >
        {/* Header Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-white px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/20 text-base">
              {lead.name ? lead.name.charAt(0).toUpperCase() : "L"}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="truncate text-xl font-bold text-slate-900 tracking-tight">{lead.name}</h2>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${pillStyle}`}>
                  {LEAD_STATUS_LABELS[lead.status] ?? lead.status}
                </span>
              </div>
              <p className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <Tag size={12} className="text-slate-400 shrink-0" />
                <span>Source: <strong className="text-slate-600 font-semibold">{lead.source === "MANUAL_ENTRY" ? "Manual Intake" : lead.source}</strong></span>
                {lead.campaignName && (
                  <span>• Campaign: <strong className="text-slate-600 font-semibold">{lead.campaignName}</strong></span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
              >
                <MessageCircle size={14} className="text-white" />
                <span>WhatsApp</span>
              </a>
            )}
            {callUrl && (
              <a
                href={callUrl}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <Phone size={14} className="text-emerald-600" />
                <span>Call</span>
              </a>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Lead Acceptance Banner (if assigned to employee) */}
        {lead.status === "ASSIGNED" && (
          <AcceptLeadBanner lead={lead} userRole={userRole} getIdToken={getIdToken} onResult={setBanner} />
        )}

        {/* Warning if missing contact details */}
        {lead.intakeWarning && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">
            <AlertTriangle size={15} className="shrink-0 text-amber-600" />
            <span>Contact details could not be automatically retrieved from Meta. Please confirm or update manually.</span>
          </div>
        )}

        {/* Info Cards Row */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-6 py-4 sm:px-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Phone Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                <Phone size={12} className="text-emerald-600" />
                <span>Phone</span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-slate-800">
                {lead.phone ? formatPhone(lead.phone) : <span className="text-slate-400 font-normal">Not provided</span>}
              </p>
            </div>

            {/* Email Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                <Mail size={12} className="text-emerald-600" />
                <span>Email</span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-slate-800" title={lead.email || ""}>
                {lead.email || <span className="text-slate-400 font-normal">Not provided</span>}
              </p>
            </div>

            {/* City Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                <MapPin size={12} className="text-emerald-600" />
                <span>City / Area</span>
              </div>
              <p className="mt-1 truncate text-xs font-bold text-slate-800">
                {lead.city || <span className="text-slate-400 font-normal">Not specified</span>}
              </p>
            </div>

            {/* Assigned Rep Card */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                  <UserCheck size={12} className="text-emerald-600" />
                  <span>Assignee</span>
                </div>
                {userRole === "admin" && !closed && onReassignRequest && (
                  <button
                    onClick={onReassignRequest}
                    className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 transition-colors"
                  >
                    Reassign
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-xs font-bold text-slate-800">
                {lead.assignedUserId ? (assigneeName ?? "Assigned") : <span className="text-amber-600 font-semibold">(Unassigned)</span>}
              </p>
            </div>
          </div>

          {/* Status & Created Date Bar */}
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 pt-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="font-semibold text-slate-500">Pipeline Stage:</span>
              <div className="w-48">
                <StatusSelect
                  lead={lead}
                  disabled={closed}
                  getIdToken={getIdToken}
                  onResult={setBanner}
                  statusOptions={statusOptions}
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock size={12} className="text-slate-400" />
              <span>Created: <strong className="text-slate-600 font-medium">{formatBusinessDateTime(lead.createdAt)}</strong></span>
            </div>
          </div>
        </div>

        {banner && (
          <div
            className={`px-6 py-2.5 text-xs font-semibold ${
              banner.tone === "error"
                ? "border-b border-rose-200 bg-rose-50 text-rose-700"
                : "border-b border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {banner.text}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex shrink-0 border-b border-slate-100 bg-white px-6 sm:px-8">
          <button
            onClick={() => setActiveTab("FOLLOW_UPS")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all ${
              activeTab === "FOLLOW_UPS"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <History size={15} />
            <span>Follow-ups</span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
              {followUps.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("AUDIT_TRAIL")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all ${
              activeTab === "AUDIT_TRAIL"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <Activity size={15} />
            <span>Audit Trail</span>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
              {events.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("DEAL_ENTRY")}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all ${
              activeTab === "DEAL_ENTRY"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <DollarSign size={15} />
            <span>{deal ? "Deal Record" : "Deal Entry"}</span>
            {deal && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                Closed
              </span>
            )}
          </button>
        </div>

        {/* Scrollable Tab Body */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto bg-slate-50/50 p-6 sm:p-8">
          {historyError && (
            <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700">
              {historyError}
            </p>
          )}

          {activeTab === "FOLLOW_UPS" && (
            <FollowUpsTab
              lead={lead}
              followUps={followUps}
              getIdToken={getIdToken}
              onResult={setBanner}
            />
          )}

          {activeTab === "AUDIT_TRAIL" && <AuditTrailTab events={events} />}

          {activeTab === "DEAL_ENTRY" && (
            deal ? (
              <DealRecordView deal={deal} />
            ) : canEnterDeal ? (
              <DealEntryForm
                lead={lead}
                userRole={userRole}
                getIdToken={getIdToken}
                onResult={setBanner}
                onDone={() => setActiveTab("FOLLOW_UPS")}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                {closed
                  ? "This lead is closed and has no deal entry."
                  : "Accept this lead and advance its stage before entering a deal."}
              </div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/* Status & Acceptance Subcomponents                                          */
/* -------------------------------------------------------------------------- */

function AcceptLeadBanner({
  lead,
  userRole,
  getIdToken,
  onResult,
}: {
  lead: Lead;
  userRole: "admin" | "employee";
  getIdToken: () => Promise<string>;
  onResult: (b: { tone: "error" | "success"; text: string } | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    onResult(null);
    try {
      const result = await acceptLead(await getIdToken(), lead.id);
      if (result.ok) {
        onResult({ tone: "success", text: "Lead accepted successfully. You can now log follow-ups." });
      } else {
        onResult({ tone: "error", text: result.error });
      }
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-indigo-100 bg-indigo-50/90 px-6 py-3.5 sm:px-8">
      <div>
        <h3 className="text-xs font-bold text-indigo-900">
          {userRole === "admin" ? "Awaiting Employee Acceptance" : "New Lead Assigned To You"}
        </h3>
        <p className="text-[11px] text-indigo-700 mt-0.5">
          {userRole === "admin"
            ? `Assigned employee has ${ACCEPT_WINDOW_MINUTES} minutes to accept. You can force-accept for them here.`
            : `Please accept this lead within ${ACCEPT_WINDOW_MINUTES} minutes to prevent auto-reassignment.`}
        </p>
      </div>
      <button
        onClick={handleAccept}
        disabled={busy}
        className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "Accepting..." : "Accept Lead"}
      </button>
    </div>
  );
}

function StatusSelect({
  lead,
  disabled,
  getIdToken,
  onResult,
  statusOptions,
}: {
  lead: Lead;
  disabled: boolean;
  getIdToken: () => Promise<string>;
  onResult: (b: { tone: "error" | "success"; text: string } | null) => void;
  statusOptions: Array<{ value: LeadStatus; label: string; badge?: { text: string; className: string } }>;
}) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (next: LeadStatus) => {
    if (!next || next === lead.status) return;
    setBusy(true);
    onResult(null);
    try {
      const result = await setLeadStatus(await getIdToken(), lead.id, next);
      if (!result.ok) onResult({ tone: "error", text: result.error });
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomSelect<LeadStatus>
      value={lead.status}
      onChange={handleChange}
      options={statusOptions}
      disabled={disabled || busy}
      placeholder="Select status..."
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Follow-ups Component                                                       */
/* -------------------------------------------------------------------------- */

function FollowUpsTab({
  lead,
  followUps,
  getIdToken,
  onResult,
}: {
  lead: Lead;
  followUps: ReturnType<typeof useLeadHistory>["followUps"];
  getIdToken: () => Promise<string>;
  onResult: (b: { tone: "error" | "success"; text: string } | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [callMade, setCallMade] = useState(false);
  const [callCount, setCallCount] = useState("1");
  const [callMinutes, setCallMinutes] = useState("");
  const [callSeconds, setCallSeconds] = useState("");
  const [meetingHeld, setMeetingHeld] = useState(false);
  const [whatsappNote, setWhatsappNote] = useState("");

  const durationSeconds = (Number(callMinutes) || 0) * 60 + (Number(callSeconds) || 0);
  const willCount = callMade && isConnect(durationSeconds);
  const [busy, setBusy] = useState(false);
  const closed = isTerminal(lead.status);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setBusy(true);
    onResult(null);
    try {
      const result = await addFollowUp(await getIdToken(), lead.id, {
        message: message.trim(),
        callMade,
        callCount: Number(callCount) || 1,
        durationSeconds,
        meetingHeld,
        whatsappNote: whatsappNote.trim(),
      });

      if (result.ok) {
        setMessage("");
        setCallMade(false);
        setCallCount("1");
        setWhatsappNote("");
        setShowForm(false);
        onResult({ tone: "success", text: "Follow-up logged successfully." });
      } else {
        onResult({ tone: "error", text: result.error });
      }
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Communication History</h3>
          <p className="text-xs text-slate-500">
            Immutable log of all interactions, calls, and discussions.
          </p>
        </div>
        {!showForm && !closed && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors"
          >
            <Plus size={14} />
            <span>Add Note</span>
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold text-slate-800">Log New Discussion</span>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-emerald-600" />
                <span>{formatBusinessDateTime(new Date())}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="font-bold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fu-message" className="block text-xs font-semibold text-slate-700">
              Discussion Summary <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="fu-message"
              required
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Record client feedback, requirement specifics, or next action items..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs font-normal text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={callMade}
                  onChange={(e) => setCallMade(e.target.checked)}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500/20"
                />
                <span>Phone Call Made</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={meetingHeld}
                  onChange={(e) => setMeetingHeld(e.target.checked)}
                  className="h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500/20"
                />
                <span>Meeting Held</span>
              </label>

              {callMade && (
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <span>Count:</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={callCount}
                    onChange={(e) => setCallCount(e.target.value)}
                    className="w-12 rounded-lg border border-slate-200 bg-white py-1 text-center text-xs font-bold"
                  />
                </div>
              )}
            </div>

            {callMade && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-200 pt-3">
                <span className="text-xs font-semibold text-slate-700">Call duration *</span>
                <input
                  type="number"
                  min="0"
                  max="240"
                  value={callMinutes}
                  onChange={(e) => setCallMinutes(e.target.value)}
                  placeholder="0"
                  aria-label="Call duration minutes"
                  className="w-14 rounded-lg border border-slate-200 bg-white py-1 text-center text-xs font-bold"
                />
                <span className="text-xs text-slate-500">min</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={callSeconds}
                  onChange={(e) => setCallSeconds(e.target.value)}
                  placeholder="00"
                  aria-label="Call duration seconds"
                  className="w-14 rounded-lg border border-slate-200 bg-white py-1 text-center text-xs font-bold"
                />
                <span className="text-xs text-slate-500">sec</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    willCount ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {willCount
                    ? "Counts as a connect"
                    : `Under ${formatDuration(CONNECT_MIN_SECONDS)} — not a connect`}
                </span>
              </div>
            )}

            <input
              type="text"
              value={whatsappNote}
              onChange={(e) => setWhatsappNote(e.target.value)}
              placeholder="Optional WhatsApp reference note..."
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-xs font-normal text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !message.trim()}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {busy ? "Saving..." : "Save Follow-up"}
            </button>
          </div>
        </form>
      )}

      {followUps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <MessageCircle className="mx-auto mb-2 text-slate-300" size={28} />
          <p className="text-xs font-bold text-slate-700">No follow-ups logged yet</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Log every phone call and meeting note to keep the history audit intact.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {followUps.map((fu, index) => (
            <div key={fu.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">Touch #{followUps.length - index}</span>
                  <span className="text-slate-400">• {fu.authorEmail ?? "Team Member"}</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  {formatBusinessDateTime(fu.occurredAt ?? fu.createdAt)}
                </span>
              </div>

              <p className="mt-2.5 whitespace-pre-wrap text-xs text-slate-800 leading-relaxed font-normal">{fu.message}</p>

              {(fu.callMade || fu.meetingHeld || fu.whatsappNote) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {fu.callMade && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                      <PhoneCall size={11} className="text-emerald-700" />
                      <span>
                        Phone Call{fu.callCount && fu.callCount > 1 ? ` (${fu.callCount}×)` : ""}
                        {fu.durationSeconds ? ` · ${formatDuration(fu.durationSeconds)}` : ""}
                        {fu.connect ? " · Connect" : ""}
                      </span>
                    </span>
                  )}
                  {fu.whatsappNote && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-800">
                      <MessageCircle size={11} className="text-sky-700" />
                      <span>{fu.whatsappNote}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit Trail Component                                                      */
/* -------------------------------------------------------------------------- */

const EVENT_LABELS: Record<string, string> = {
  LEAD_INGESTED: "Lead received from Meta",
  MANUALLY_CREATED: "Historical lead created by Admin",
  MANUALLY_ASSIGNED: "Assigned by Admin",
  AUTO_ASSIGNED: "Auto-assigned by rotation",
  MANUALLY_REASSIGNED: "Reassigned by Admin",
  AUTO_REASSIGNED: "Reassigned automatically",
  LEAD_ACCEPTED: "Accepted by Employee",
  FORCE_ACCEPTED: "Force-accepted — end of priority lane",
  EXPIRED: "Acceptance window expired",
  AUTO_ASSIGN_FAILED: "No active employee available",
  STATUS_CHANGED: "Status changed",
  FOLLOW_UP_ADDED: "Follow-up logged",
  DEAL_CLOSED: "Deal recorded & closed",
};

function AuditTrailTab({ events }: { events: ReturnType<typeof useLeadHistory>["events"] }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Audit Trail</h3>
        <p className="text-xs text-slate-500">Full system timeline of automated triggers and admin actions.</p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-xs text-slate-400">
          No audit events recorded yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          {events.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-4 p-4 text-xs">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{EVENT_LABELS[event.type] ?? event.type}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {event.actorUid?.startsWith("system") ? "System Auto" : "User " + event.actorUid.slice(0, 6)}
                  </span>
                </div>
                {event.meta && Object.keys(event.meta).length > 0 && (
                  <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-600">
                    {Object.entries(event.meta).map(([key, value]) => (
                      <div key={key} className="truncate">
                        <span className="text-slate-400">{key}:</span> {String(value ?? "—")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-slate-400">
                {formatBusinessDateTime(event.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Deal Entry / Record Components                                             */
/* -------------------------------------------------------------------------- */

function DealEntryForm({
  lead,
  userRole,
  getIdToken,
  onResult,
  onDone,
}: {
  lead: Lead;
  userRole: "admin" | "employee";
  getIdToken: () => Promise<string>;
  onResult: (b: { tone: "error" | "success"; text: string } | null) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(lead.name ?? "");
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [cnic, setCnic] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState(lead.city ?? "");
  const [serviceDescription, setServiceDescription] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [payableAmount, setPayableAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [dealCategory, setDealCategory] = useState<string>(DEFAULT_DEAL_CATEGORY);
  const [dealDate, setDealDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const paymentOptions = useMemo(() => {
    return PAYMENT_METHODS.map((m) => ({ value: m, label: m }));
  }, []);

  const received = Number(amountReceived);
  const payable = Number(payableAmount);
  const profit =
    Number.isFinite(received) && Number.isFinite(payable) && amountReceived !== "" && payableAmount !== ""
      ? received - payable
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onResult(null);
    try {
      const result = await closeDeal(await getIdToken(), lead.id, {
        customer: { name, phone, email, cnic, address, city },
        serviceDescription,
        amountReceived: Number(amountReceived),
        payableAmount: Number(payableAmount),
        paymentMethod,
        dealCategory,
        dealDate,
        notes,
      });

      if (result.ok) {
        onResult({
          tone: "success",
          text: `Deal closed successfully. Profit: ${formatMoney(result.data.profit)}.`,
        });
        onDone();
      } else {
        onResult({ tone: "error", text: result.error });
      }
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
      <div className="border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-900">Record Won Deal</h3>
        <p className="text-xs text-slate-500">
          Confirm settlement figures. Closing this lead will record financial revenue permanently.
        </p>
      </div>

      <div className="space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Customer Details</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Full Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Phone Number *</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">CNIC / ID</label>
            <input
              type="text"
              value={cnic}
              onChange={(e) => setCnic(e.target.value)}
              placeholder="e.g. 35201-1234567-1"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-slate-100 pt-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Package / Service</h4>
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-700">Description *</label>
          <input
            type="text"
            required
            value={serviceDescription}
            onChange={(e) => setServiceDescription(e.target.value)}
            placeholder="e.g. 5 Marla Executive Plot Booking"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
          />
        </div>
      </div>

      <div className="space-y-4 border-t border-slate-100 pt-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Financial Breakdown</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Amount Received (PKR) *</label>
            <input
              type="number"
              required
              min="0"
              value={amountReceived}
              onChange={(e) => setAmountReceived(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Payable Amount (PKR)</label>
            <input
              type="number"
              min="0"
              value={payableAmount}
              onChange={(e) => setPayableAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Payment Method</label>
            <CustomSelect
              value={paymentMethod}
              onChange={(v) => setPaymentMethod(v)}
              options={paymentOptions}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700">Settlement Date</label>
            <DateTimePicker
              id="d-date"
              mode="date"
              value={dealDate}
              max={todayInputValue()}
              onChange={setDealDate}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Calculated Gross Profit</span>
          <span className="text-lg font-black tabular-nums text-emerald-700">
            {profit === null ? "—" : formatMoney(profit)}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "Saving Deal..." : "Close Deal & Settle Revenue"}
      </button>
    </form>
  );
}

function DealRecordView({ deal }: { deal: NonNullable<ReturnType<typeof useDealForLead>["deal"]> }) {
  return (
    <div className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-emerald-200/90 bg-white p-6 shadow-xs">
      <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
        <CheckCircle2 className="text-emerald-600 shrink-0" size={20} />
        <div>
          <h3 className="text-sm font-bold text-slate-900">Confirmed Deal Record</h3>
          <p className="text-[11px] text-slate-400">Settled {formatBusinessDate(deal.dealDate ?? deal.enteredAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase">Customer</span>
          <p className="font-bold text-slate-800 truncate">{deal.customer?.name || "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase">Contact</span>
          <p className="font-bold text-slate-800 truncate">{deal.customer?.phone ? formatPhone(deal.customer.phone) : "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase">Method</span>
          <p className="font-bold text-slate-800 truncate">{deal.paymentMethod || "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase">City</span>
          <p className="font-bold text-slate-800 truncate">{deal.customer?.city || "—"}</p>
        </div>
      </div>

      {deal.serviceDescription && (
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
          <p className="text-[11px] font-semibold text-slate-400">Package / Service</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-800">{deal.serviceDescription}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">Received</p>
          <p className="text-sm font-bold text-slate-800">{formatMoney(deal.amountReceived)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">Payable</p>
          <p className="text-sm font-bold text-slate-800">{formatMoney(deal.payableAmount)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-200/80">
          <p className="text-[10px] font-bold uppercase text-emerald-800">Net Profit</p>
          <p className="text-sm font-black text-emerald-700">{formatMoney(deal.profit)}</p>
        </div>
      </div>
    </div>
  );
}
