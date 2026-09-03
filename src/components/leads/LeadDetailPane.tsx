"use client";

/**
 * The right-hand lead detail pane of the leads workspace.
 *
 * Visually this is a rebuild against the approved teal design; behaviourally it
 * is the same machine as `LeadDetailModal` — identical client actions, identical
 * payloads, identical guards. That modal is deliberately left untouched because
 * nine other routes still render it.
 *
 * The pane is a fixed frame: sticky identity header, facts strip and tab bar
 * never move, and only the tab body scrolls. That is what lets a lead with
 * thirty follow-ups fit on one screen without the page growing.
 */

import { useMemo, useState } from "react";
import type { Lead } from "@/hooks/useLeads";
import { useLeadHistory } from "@/hooks/useLeads";
import { useDealForLead } from "@/hooks/useFinancials";
import { addFollowUp, updateFollowUp, setLeadStatus, reviewColdLead, closeDeal, acceptLead, PAYMENT_METHODS } from "@/lib/clientActions";
import {
  explainPipelineStage,
  pipelineStage,
  PIPELINE_STAGE_LABELS,
} from "@/lib/pipelineStage";
import { STAGE_TONES, StageIcon } from "./StageChrome";
import { KycPanel } from "./KycPanel";
import { describeLeadSource } from "@/lib/leadSource";
import { dealCustomerFromKyc, kycCompleteness } from "@/lib/kyc";
import {
  entryLabelAt,
  toChronological,
  nextEntryLabel,
  historyTabLabel,
  FOLLOW_UP_KIND_LABELS,
} from "@/lib/followUpKind";
import { ROLE_LABELS, normalizeRole } from "@/lib/constants/hierarchy";
import {
  USER_SETTABLE_STATUSES,
  STAGE_STATUSES,
  LEAD_STATUS_LABELS,
  isTerminal,
  statusLabel,
  type LeadStatus,
} from "@/lib/leadStatus";
import { whatsAppUrl, telUrl, formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { formatBusinessDate, formatBusinessDateTime, karachiDayKey } from "@/lib/dates";
import { CONNECT_MIN_SECONDS, formatDuration, isConnect } from "@/lib/kpi";
import { DEAL_CATEGORIES, DEFAULT_DEAL_CATEGORY } from "@/lib/constants/deals";
import { initialsOf } from "@/lib/leadDisplay";
import {
  Phone, Mail, MapPin, UserCheck, Clock, X, Plus, MessageCircle,
  PhoneCall, AlertTriangle, CheckCircle2, ArrowLeft, Users, Lock,
} from "lucide-react";

type Tab = "FOLLOW_UPS" | "KYC" | "AUDIT_TRAIL" | "DEAL_ENTRY";

type Banner = { tone: "error" | "success"; text: string } | null;

/**
 * Display-only pipeline progression behind the six segment track.
 * Terminal-lost states deliberately have no index — they fill the track in rose
 * instead, so "finished badly" never reads as "made it to the end".
 */
const PIPELINE_ORDER: LeadStatus[] = [
  "ASSIGNED", "CONTACTED", "FOLLOW_UP", "INTERESTED", "NEGOTIATION", "CLOSED_WON",
];

const STAGE_INDEX: Partial<Record<LeadStatus, number>> = {
  ASSIGNED: 0, ACCEPTED: 0,
  CONTACTED: 1,
  FOLLOW_UP: 2, NO_RESPONSE: 2,
  INTERESTED: 3,
  NEGOTIATION: 4,
  CLOSED_WON: 5,
};

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
  FOLLOW_UP_ADDED: "Remark / follow-up logged",
  DEAL_CLOSED: "Deal recorded & closed",
  TEMPERATURE_CHANGED: "Hot / Cold changed",
};

/** Today in Asia/Karachi, as the yyyy-mm-dd a date input expects. */
function todayInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

const INPUT_CLASS =
  "w-full rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none transition-colors placeholder:text-[#9aacaa] focus:border-[#4f9c99] focus:bg-white focus:ring-2 focus:ring-[#4f9c99]/15 disabled:opacity-60";

const FIELD_LABEL_CLASS = "flex flex-col gap-1.5 text-xs text-[#5b6d6b]";

export function LeadDetailPane({
  lead,
  onClose,
  userRole,
  getIdToken,
  assigneeName,
  onReassignRequest,
}: {
  lead: Lead;
  onClose: () => void;
  userRole: "admin" | "subadmin" | "employee";
  getIdToken: () => Promise<string>;
  assigneeName?: string;
  onReassignRequest?: () => void;
}) {
  const { followUps, events, error: historyError } = useLeadHistory(lead.id);
  const { deal } = useDealForLead(lead.id);
  const [activeTab, setActiveTab] = useState<Tab>("FOLLOW_UPS");
  const [banner, setBanner] = useState<Banner>(null);

  // No per-lead reset logic lives here: the workspace mounts this component
  // with `key={lead.id}`, so selecting a different lead gives it fresh state.
  const closed = isTerminal(lead.status);
  // A manager runs a team; they do not work leads themselves. They read the
  // whole history and can move the lead between their own people, but they do
  // not log calls or enter deals — and crediting either would be actively
  // wrong, since the server books both against the assigned employee.
  const isManagerView = userRole === "subadmin";
  const canEnterDeal =
    !closed && !isManagerView && lead.status !== "ASSIGNED" && lead.status !== "NEW";
  const waUrl = whatsAppUrl(lead.phone);
  const callUrl = telUrl(lead.phone);

  const stageIndex = STAGE_INDEX[lead.status] ?? -1;
  const kycFilled = kycCompleteness(lead.kyc).filled;
  const lostLead = lead.status === "CLOSED_LOST" || lead.status === "NOT_INTERESTED";

  const tabs: Array<{ key: Tab; label: string; count: number | null }> = [
    // "Remark" until there is something to follow up on — see `lib/followUpKind`.
    { key: "FOLLOW_UPS", label: historyTabLabel(followUps.length), count: followUps.length },
    // Next to Follow-ups, where the owner asked for it: the two things a rep
    // does after a call are write down what happened and write down who the
    // client turned out to be.
    { key: "KYC", label: "KYC", count: kycFilled || null },
    { key: "AUDIT_TRAIL", label: "Audit Trail", count: events.length },
    { key: "DEAL_ENTRY", label: deal ? "Deal Record" : "Deal Entry", count: null },
  ];

  return (
    // `grid-cols-1` is load-bearing: with only grid-rows set, the implicit
    // single column sizes to max-content, so on a phone the header's buttons
    // pushed the whole pane wider than the viewport and the frame clipped it.
    // minmax(0,1fr) lets every row shrink and its children truncate instead.
    <div className="animate-lead-pane grid h-full min-h-0 grid-cols-1 grid-rows-[auto_auto_auto_auto_1fr] overflow-hidden bg-linear-to-b from-[#f3faf9] to-[#e6f1f0]">
      {/* ---------------------------------------------------------------- */}
      {/* Identity header                                                  */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex min-h-[78px] flex-wrap items-center gap-4 bg-[#4f9c99] px-5 py-4 text-white sm:px-[26px]">
        <button
          onClick={onClose}
          aria-label="Back to lead list"
          className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border-[1.5px] border-white/55 bg-white/20 text-base font-medium">
          {initialsOf(lead.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="truncate text-xl font-medium tracking-[0.2px] text-white">{lead.name}</h2>
            <span className="rounded-full bg-white/20 px-3 py-[3px] text-[11px] tracking-[0.9px] whitespace-nowrap">
              {(LEAD_STATUS_LABELS[lead.status] ?? lead.status).toUpperCase()}
            </span>
          </div>
          {/* The exact origin, not the generic token: "Data Bank (Facile Town
              2)" rather than "DATA BANK". Which list a lead came out of is the
              whole reason the Data Bank keeps folders. See `lib/leadSource`. */}
          <p className="mt-0.5 truncate text-xs text-white/90" title={describeLeadSource(lead)}>
            Lead ID {lead.id.slice(0, 12)} &nbsp;·&nbsp; Source: {describeLeadSource(lead)}
            {lead.assignedByName && (
              <>
                &nbsp;·&nbsp; Assigned by {lead.assignedByName}
                {lead.assignedByRole ? ` (${ROLE_LABELS[normalizeRole(lead.assignedByRole)]})` : ""}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] text-[#2f7d78] transition-colors hover:bg-[#eafaf8]"
            >
              <MessageCircle size={15} className="shrink-0" />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          )}
          {callUrl && (
            <a
              href={callUrl}
              className="inline-flex items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-[13px] text-white transition-colors hover:bg-white/15"
            >
              <Phone size={15} className="shrink-0" />
              <span className="hidden sm:inline">Call</span>
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Close lead"
            className="hidden h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:flex"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Facts strip                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-px border-b border-[#dceae8] bg-[#dceae8] lg:grid-cols-4">
        <FactCell icon={<Phone size={13} />} label="PHONE">
          {lead.phone ? formatPhone(lead.phone) : <span className="text-[#9aacaa]">Not provided</span>}
        </FactCell>

        <FactCell icon={<Mail size={13} />} label="EMAIL" title={lead.email || undefined}>
          {lead.email || <span className="text-[#9aacaa]">Not provided</span>}
        </FactCell>

        <FactCell icon={<MapPin size={13} />} label="CITY / AREA">
          {lead.city || <span className="text-[#9aacaa]">Not specified</span>}
        </FactCell>

        <FactCell
          icon={<UserCheck size={13} />}
          label="ASSIGNEE"
          action={
            userRole === "admin" && !closed && onReassignRequest ? (
              <button
                onClick={onReassignRequest}
                className="text-[11.5px] text-[#2f7d78] transition-colors hover:underline"
              >
                Reassign
              </button>
            ) : undefined
          }
        >
          {lead.assignedUserId ? (assigneeName ?? "Assigned") : <span className="text-[#c08a2e]">(Unassigned)</span>}
        </FactCell>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Pipeline stage bar                                               */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[#dceae8] bg-[#eef6f5] px-5 py-2.5 sm:px-[26px]">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <div className="flex items-center gap-2">
            {/* The formal state machine is the *Status*; the commercial read
                on the same lead is the *Stage* control further along this bar.
                They were both called "stage" before, which made the two
                impossible to talk about. */}
            <label htmlFor="pipeline-stage" className="text-[12.5px] text-[#5b6d6b]">
              Pipeline Status:
            </label>
            <StageSelect lead={lead} disabled={closed} getIdToken={getIdToken} onResult={setBanner} />
          </div>

          <div className="flex items-center gap-2" aria-hidden>
            {PIPELINE_ORDER.map((stage, i) => (
              <div
                key={stage}
                title={LEAD_STATUS_LABELS[stage]}
                className={`animate-stage-dot h-1 w-[26px] rounded-sm ${
                  lostLead ? "bg-[#e0a49b]" : i <= stageIndex ? "bg-[#4f9c99]" : "bg-[#d6e7e5]"
                }`}
                style={{ animationDelay: `${i * 45}ms` }}
              />
            ))}
          </div>
          {/* Colour is never the only signal — the stage is also named in the select. */}
          <span className="sr-only">
            Stage {stageIndex + 1} of {PIPELINE_ORDER.length}
          </span>

          <PipelineStageControl lead={lead} userRole={userRole} getIdToken={getIdToken} onResult={setBanner} />
        </div>

        <div className="flex items-center gap-1.5 text-[12.5px] text-[#5b6d6b]">
          <Clock size={14} className="shrink-0 text-[#7e918f]" />
          <span>Created: {formatBusinessDateTime(lead.createdAt)}</span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Notices                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div>
        {lead.status === "ASSIGNED" && (
          <AcceptBanner lead={lead} userRole={userRole} getIdToken={getIdToken} onResult={setBanner} />
        )}

        {lead.intakeWarning && (
          <div className="flex items-center gap-2 border-b border-[#f0d9a8] bg-[#fdf6e7] px-5 py-2.5 text-xs text-[#8a6420] sm:px-[26px]">
            <AlertTriangle size={15} className="shrink-0 text-[#c08a2e]" />
            <span>Contact details could not be retrieved from Meta. Please confirm or update manually.</span>
          </div>
        )}

        {banner && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start justify-between gap-3 border-b px-5 py-2.5 text-xs sm:px-[26px] ${
              banner.tone === "error"
                ? "border-[#f0c4bd] bg-[#fdeeeb] text-[#a33a29]"
                : "border-[#bfe0dc] bg-[#eef8f7] text-[#2f7d78]"
            }`}
          >
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} className="shrink-0 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[#dceae8] bg-[#fbfdfd] px-5 sm:px-[26px]">
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-1 py-3.5 text-sm whitespace-nowrap transition-colors ${
                  active ? "border-[#3f8f8a] text-[#2f7d78]" : "border-transparent text-[#6c7d7b] hover:text-[#2f7d78]"
                } mr-6 last:mr-0`}
              >
                <span>{tab.label}</span>
                {tab.count !== null && tab.count > 0 && (
                  <span
                    className={`min-w-[22px] rounded-full px-[7px] py-px text-center text-[11.5px] ${
                      active ? "bg-[#dcecea] text-[#2f7d78]" : "bg-[#eef5f4] text-[#7e918f]"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.key === "DEAL_ENTRY" && deal && (
                  <span className="rounded-full bg-[#dcecea] px-2 py-px text-[11px] text-[#2f7d78]">Closed</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tab body — the only scrolling region                             */}
      {/* ---------------------------------------------------------------- */}
      <div className="teal-scrollbar min-h-0 overflow-y-auto px-5 pt-[22px] pb-[30px] sm:px-[26px]">
        {historyError && (
          <p className="mb-4 rounded-lg border border-[#f0c4bd] bg-[#fdeeeb] p-3.5 text-xs text-[#a33a29]">
            {historyError}
          </p>
        )}

        <div key={activeTab} className="animate-lead-tab">
          {activeTab === "FOLLOW_UPS" && (
            <FollowUpsPanel
              lead={lead}
              followUps={followUps}
              getIdToken={getIdToken}
              onResult={setBanner}
              canLog={!isManagerView}
            />
          )}

          {activeTab === "KYC" && (
            <KycPanel lead={lead} getIdToken={getIdToken} onResult={setBanner} readOnly={closed} />
          )}

          {activeTab === "AUDIT_TRAIL" && <AuditPanel events={events} />}

          {activeTab === "DEAL_ENTRY" &&
            (deal ? (
              <DealRecord deal={deal} />
            ) : canEnterDeal ? (
              <DealEntryForm
                lead={lead}
                getIdToken={getIdToken}
                onResult={setBanner}
                onDone={() => setActiveTab("FOLLOW_UPS")}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-[#cfe2e0] bg-white/70 p-8 text-center text-[13px] text-[#7e918f]">
                {closed
                  ? "This lead is closed and has no deal entry."
                  : isManagerView
                    ? "Deals are entered by the employee working the lead. You will see the record here once it is."
                    : "Accept this lead and advance its status before entering a deal."}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Facts strip cell                                                           */
/* -------------------------------------------------------------------------- */

function FactCell({
  icon,
  label,
  children,
  action,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0 bg-[#fbfdfd] px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] tracking-[0.6px] text-[#7e918f]">
          <span className="shrink-0 text-[#4f9c99]">{icon}</span>
          <span>{label}</span>
        </div>
        {action}
      </div>
      <p className="mt-1 truncate text-sm text-[#2b3a39]" title={title}>
        {children}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stage select + acceptance                                                  */
/* -------------------------------------------------------------------------- */

function StageSelect({
  lead,
  disabled,
  getIdToken,
  onResult,
}: {
  lead: Lead;
  disabled: boolean;
  getIdToken: () => Promise<string>;
  onResult: (b: Banner) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (next: string) => {
    if (!next || next === lead.status) return;
    setBusy(true);
    onResult(null);
    try {
      const result = await setLeadStatus(await getIdToken(), lead.id, next as LeadStatus);
      if (!result.ok) onResult({ tone: "error", text: result.error });
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  // The lead's own status may be a system state (NEW / ASSIGNED) that users
  // cannot set. It still has to appear, or the select would render blank.
  const orphan = useMemo(
    () => (USER_SETTABLE_STATUSES.includes(lead.status) ? null : lead.status),
    [lead.status]
  );

  // Grouped by band, so choosing a status shows what it does to the stage
  // before it is chosen (§14). The groups are the bands themselves — there is
  // no second list to keep in step with `STAGE_STATUSES`.
  return (
    <select
      id="pipeline-status"
      value={lead.status}
      disabled={disabled || busy}
      onChange={(e) => handleChange(e.target.value)}
      className="cursor-pointer rounded-md border border-[#cfe2e0] bg-white px-3 py-1.5 text-[13px] text-[#2b3a39] outline-none transition-colors focus:border-[#4f9c99] focus:ring-2 focus:ring-[#4f9c99]/15 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {orphan && <option value={orphan}>{statusLabel(orphan)}</option>}

      {(["P3", "P2", "P1"] as const).map((band) => (
        <optgroup key={band} label={`${band} — ${band === "P3" ? "talking" : band === "P2" ? "met or visited" : "closing"}`}>
          {STAGE_STATUSES[band].map((status) => (
            <option key={status} value={status}>
              {LEAD_STATUS_LABELS[status]}
            </option>
          ))}
        </optgroup>
      ))}

      <optgroup label="Closed">
        <option value="CLOSED_LOST">{LEAD_STATUS_LABELS.CLOSED_LOST}</option>
      </optgroup>
    </select>
  );
}

/**
 * The stage, and the Cold review.
 *
 * **Not a control any more (§14).** The pipeline status now decides the stage,
 * so a second widget for setting it by hand would be a way to contradict the
 * status — exactly the state this app used to reach, where a lead read
 * "Negotiation" and "Cold" at the same time and both were shown as true. What
 * is left is a read-out that says which band the status put the lead in, and
 * why.
 *
 * The one decision still open to a person is Cold (§3). A lead that has met the
 * rule is *not* moved by it: it is flagged, the admin and the lead's manager
 * are notified, and one of them rules here. The employee holding the lead sees
 * the flag but gets no buttons — it is their work being reviewed.
 */
function PipelineStageControl({
  lead,
  userRole,
  getIdToken,
  onResult,
}: {
  lead: Lead;
  userRole: "admin" | "subadmin" | "employee";
  getIdToken: () => Promise<string>;
  onResult: (b: Banner) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { value, manual, coldPending } = pipelineStage(lead);
  const canReview = userRole === "admin" || userRole === "subadmin";

  const review = async (verified: boolean) => {
    setBusy(true);
    onResult(null);
    try {
      const result = await reviewColdLead(await getIdToken(), lead.id, verified);
      if (result.ok) {
        onResult({
          tone: "success",
          text: verified
            ? "Verified. The lead is now Cold."
            : "Dismissed. The lead stays in play.",
        });
      } else {
        onResult({ tone: "error", text: result.error });
      }
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  if (!value && !coldPending) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" title={explainPipelineStage(lead)}>
      <span className="text-[12.5px] text-[#5b6d6b]">Pipeline Stage:</span>

      {value && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
          style={{ background: STAGE_TONES[value].soft, color: STAGE_TONES[value].softText }}
        >
          <StageIcon stage={value} size={11} />
          {PIPELINE_STAGE_LABELS[value]}
          {manual && (
            <span aria-hidden title="Set by a review">
              ·
            </span>
          )}
        </span>
      )}

      {/* §3 — the warning, and the decision, in the place the stage is read. */}
      {coldPending && (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-[#f0e0c0] bg-[#fdf5e6] px-2.5 py-1 text-[11.5px] text-[#a5762a]">
          <AlertTriangle size={12} className="shrink-0" />
          Requires verification before being moved to Cold
          {canReview && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => review(true)}
                className="rounded-full bg-[#4d7590] px-2.5 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                Verify Cold
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => review(false)}
                className="rounded-full border border-[#e0d0a8] px-2.5 py-0.5 text-[11px] font-semibold text-[#a5762a] disabled:opacity-50"
              >
                Keep working
              </button>
            </>
          )}
        </span>
      )}

      <span className="hidden text-[11.5px] text-[#9aacaa] xl:inline">{explainPipelineStage(lead)}</span>
      <span className="sr-only">{explainPipelineStage(lead)}</span>
    </div>
  );
}

function AcceptBanner({
  lead,
  userRole,
  getIdToken,
  onResult,
}: {
  lead: Lead;
  userRole: "admin" | "subadmin" | "employee";
  getIdToken: () => Promise<string>;
  onResult: (b: Banner) => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    onResult(null);
    try {
      const result = await acceptLead(await getIdToken(), lead.id);
      onResult(
        result.ok
          ? { tone: "success", text: "Lead accepted. You can now log the first remark." }
          : { tone: "error", text: result.error }
      );
    } catch {
      onResult({ tone: "error", text: "Could not reach the server. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cfe2e0] bg-[#e8f5f3] px-5 py-3 sm:px-[26px]">
      <div>
        <h3 className="text-[13px] font-medium text-[#2f7d78]">
          {userRole === "admin" ? "Awaiting Employee Acceptance" : "New Lead Assigned To You"}
        </h3>
        <p className="mt-0.5 text-[11.5px] text-[#5b6d6b]">
          {userRole === "admin"
            ? `Assigned employee has ${ACCEPT_WINDOW_MINUTES} minutes to accept. You can force-accept for them here.`
            : `Please accept this lead within ${ACCEPT_WINDOW_MINUTES} minutes to prevent auto-reassignment.`}
        </p>
      </div>
      <button
        onClick={handleAccept}
        disabled={busy}
        className="rounded-full bg-[#3f8f8a] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
      >
        {busy ? "Accepting…" : userRole === "admin" ? "Force Accept" : "Accept Lead"}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Follow-ups                                                                 */
/* -------------------------------------------------------------------------- */

function FollowUpsPanel({
  lead,
  followUps,
  getIdToken,
  onResult,
  canLog = true,
}: {
  lead: Lead;
  followUps: ReturnType<typeof useLeadHistory>["followUps"];
  getIdToken: () => Promise<string>;
  onResult: (b: Banner) => void;
  /** False for a manager: they read the history, they do not add to it. */
  canLog?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [callMade, setCallMade] = useState(false);
  const [callCount, setCallCount] = useState("1");
  const [callMinutes, setCallMinutes] = useState("");
  const [callSeconds, setCallSeconds] = useState("");
  const [meetingHeld, setMeetingHeld] = useState(false);
  const [siteVisit, setSiteVisit] = useState(false);
  /**
   * The entry open for editing, or null when the form is adding a new one.
   * Only ever the newest — see `lib/followUpKind` and `updateFollowUp`; the
   * rows below offer Edit on that one and on nothing else.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [whatsappNote, setWhatsappNote] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = isTerminal(lead.status);

  // The first entry on a lead is a Remark, not a follow-up — there is nothing
  // to follow up on yet. Everything the form says follows from this one flag.
  const isFirstEntry = followUps.length === 0;
  /**
   * Which entry is still editable.
   *
   * The lead names it (`latestFollowUpId`), written by the same transaction
   * that created it. Falling back to "the newest in this list" covers leads
   * whose entries predate that field, and gives the same answer.
   */
  const latestId = lead.latestFollowUpId ?? followUps[0]?.id ?? null;
  const isLatest = (id: string) => id === latestId;
  // While editing, the form speaks about the entry being edited rather than
  // the one that would come next.
  const editing = editingId ? followUps.find((entry) => entry.id === editingId) : null;
  const entryWord = editing
    ? FOLLOW_UP_KIND_LABELS[editing.kind ?? "FOLLOW_UP"]
    : nextEntryLabel(followUps.length);

  /**
   * Opens the edit form on an entry, pre-filled from it.
   *
   * The same form does both jobs: a second, near-identical editor is where the
   * two would drift on the connect rule or the meeting box.
   */
  const startEdit = (entry: (typeof followUps)[number]) => {
    setEditingId(entry.id);
    setMessage(entry.message ?? "");
    setCallMade(Boolean(entry.callMade));
    setCallCount(String(entry.callCount ?? 1));
    setCallMinutes(String(Math.floor((entry.durationSeconds ?? 0) / 60) || ""));
    setCallSeconds(String((entry.durationSeconds ?? 0) % 60 || ""));
    setMeetingHeld(Boolean(entry.meetingHeld));
    setSiteVisit(Boolean(entry.siteVisit));
    setWhatsappNote(entry.whatsappNote ?? "");
    setShowForm(true);
  };

  const durationSeconds =
    (Number(callMinutes) || 0) * 60 + (Number(callSeconds) || 0);
  const willCount = callMade && isConnect(durationSeconds);

  // The employee already logged this lead today, so the server would reject a
  // second one. Say so before they type the note rather than after.
  const loggedToday = followUps.some(
    (fu) => fu.dayKey === karachiDayKey(new Date())
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setBusy(true);
    onResult(null);
    try {
      const result = editingId
        ? await updateFollowUp(await getIdToken(), lead.id, editingId, {
            message,
            callMade,
            callCount: Number(callCount) || 1,
            durationSeconds,
            meetingHeld,
            siteVisit,
            whatsappNote: whatsappNote.trim(),
          })
        : await addFollowUp(await getIdToken(), lead.id, {
        message: message.trim(),
        callMade,
        callCount: Number(callCount) || 1,
        durationSeconds,
        meetingHeld,
        siteVisit,
        whatsappNote: whatsappNote.trim(),
      });

      if (result.ok) {
        setMessage("");
        setCallMade(false);
        setCallCount("1");
        setCallMinutes("");
        setCallSeconds("");
        setMeetingHeld(false);
        setSiteVisit(false);
        setWhatsappNote("");
        setShowForm(false);
        setEditingId(null);
        const verb = editingId ? "updated" : "logged";
        onResult({
          tone: "success",
          text: result.data?.connect
            ? `${entryWord} ${verb}. Counted as a connect.`
            : callMade
              ? `${entryWord} ${verb}. Under ${formatDuration(CONNECT_MIN_SECONDS)}, so it does not count as a connect.`
              : `${entryWord} ${verb} successfully.`,
        });
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
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[19px] font-medium text-[#2b3a39]">Communication History</h3>
          <p className="mt-0.5 text-[12.5px] text-[#7e918f]">
            Immutable log of all interactions, calls, and discussions.
          </p>
        </div>
        {!showForm && !closed && canLog && (
          <button
            onClick={() => setShowForm(true)}
            disabled={loggedToday}
            title={loggedToday ? "One entry per lead per day. Add the next one tomorrow." : undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#3f8f8a] px-4 py-2 text-[13px] text-white transition-colors hover:bg-[#2f7d78] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus size={14} />
            <span>{loggedToday ? "Logged Today" : `Add ${entryWord}`}</span>
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="mb-4 space-y-3.5 rounded-lg border border-[#e0eeec] bg-white p-4">
          <div className="flex items-center justify-between border-b border-[#f0f6f5] pb-2.5">
            <span className="text-[13.5px] text-[#2b3a39]">
              {editingId
                ? `Editing this ${entryWord.toLowerCase()}`
                : isFirstEntry
                  ? "Opening remark"
                  : "Log new follow-up"}
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-[#9aacaa]">
              <Clock size={12} className="text-[#4f9c99]" />
              {formatBusinessDateTime(new Date())}
            </span>
          </div>

          <label className={FIELD_LABEL_CLASS}>
            <span>
              Discussion Summary <span className="text-[#e05a4a]">*</span>
            </span>
            <textarea
              required
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Record client feedback, requirement specifics, or next action items…"
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>

          <div className="rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#5b6d6b]">
                <input
                  type="checkbox"
                  checked={callMade}
                  onChange={(e) => setCallMade(e.target.checked)}
                  className="h-4 w-4 accent-[#3f8f8a]"
                />
                <span>Phone Call Made</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#5b6d6b]">
                <input
                  type="checkbox"
                  checked={meetingHeld}
                  onChange={(e) => setMeetingHeld(e.target.checked)}
                  className="h-4 w-4 accent-[#3f8f8a]"
                />
                <span>Meeting Held</span>
              </label>

              {/* Counted separately from a meeting in Reports (§4): a client
                  who came to the site is a different signal from one who took
                  a meeting, and the two are often not the same visit. */}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#5b6d6b]">
                <input
                  type="checkbox"
                  checked={siteVisit}
                  onChange={(e) => setSiteVisit(e.target.checked)}
                  className="h-4 w-4 accent-[#3f8f8a]"
                />
                <span>Site Visit</span>
              </label>

              {callMade && (
                <div className="flex items-center gap-1.5 text-xs text-[#5b6d6b]">
                  <span>Count:</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={callCount}
                    onChange={(e) => setCallCount(e.target.value)}
                    aria-label="Number of calls made"
                    className="w-14 rounded border border-[#dceae8] bg-white py-1 text-center text-xs text-[#2b3a39]"
                  />
                </div>
              )}
            </div>

            {callMade && (
              <div className="mt-3 border-t border-[#e4f0ee] pt-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-xs text-[#5b6d6b]">
                    Call duration <span className="text-[#e05a4a]">*</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      max="240"
                      value={callMinutes}
                      onChange={(e) => setCallMinutes(e.target.value)}
                      placeholder="0"
                      aria-label="Call duration minutes"
                      className="w-16 rounded border border-[#dceae8] bg-white py-1 text-center text-xs text-[#2b3a39]"
                    />
                    <span className="text-xs text-[#9aacaa]">min</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={callSeconds}
                      onChange={(e) => setCallSeconds(e.target.value)}
                      placeholder="00"
                      aria-label="Call duration seconds"
                      className="w-16 rounded border border-[#dceae8] bg-white py-1 text-center text-xs text-[#2b3a39]"
                    />
                    <span className="text-xs text-[#9aacaa]">sec</span>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ${
                      willCount ? "bg-[#e8f5f3] text-[#2f7d78]" : "bg-[#f4f0ea] text-[#94836a]"
                    }`}
                  >
                    <PhoneCall size={11} />
                    {willCount ? "Counts as a connect" : "Not a connect"}
                  </span>
                </div>
                <p className="mt-2 text-[11.5px] text-[#9aacaa]">
                  A call counts towards your Connects KPI only at{" "}
                  {formatDuration(CONNECT_MIN_SECONDS)} or longer.
                </p>
              </div>
            )}

            <input
              type="text"
              value={whatsappNote}
              onChange={(e) => setWhatsappNote(e.target.value)}
              placeholder="Optional WhatsApp reference note…"
              aria-label="WhatsApp reference note"
              className={`${INPUT_CLASS} mt-3`}
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="rounded-full border border-[#cfe2e0] bg-white px-5 py-2 text-[13px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !message.trim() || (callMade && durationSeconds === 0)}
              className="rounded-full bg-[#3f8f8a] px-5 py-2 text-[13px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
            >
              {busy ? "Saving…" : `Save ${entryWord}`}
            </button>
          </div>
        </form>
      )}

      {followUps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#cfe2e0] bg-white/70 p-10 text-center">
          <MessageCircle className="mx-auto mb-2 text-[#a9cfcc]" size={28} />
          <p className="text-[13.5px] text-[#2b3a39]">Nothing logged yet</p>
          <p className="mt-0.5 text-[11.5px] text-[#9aacaa]">
            Start with a remark — your opening note on this lead. Every call and meeting after it is
            a follow-up, and the whole history is kept permanently.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Chronological: the Remark first, then each Follow-Up after it. */}
          {toChronological(followUps).map((fu, index) => (
            <article key={fu.id} className="rounded-lg border border-[#e0eeec] bg-white px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#f0f6f5] pb-2.5">
                <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-[#2b3a39]">
                  {/* The stored kind when there is one; position for entries
                      written before it was recorded. */}
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={
                      (fu.kind ? FOLLOW_UP_KIND_LABELS[fu.kind] : entryLabelAt(index, followUps.length, false)) ===
                      FOLLOW_UP_KIND_LABELS.REMARK
                        ? { background: "#fdf1e3", color: "#a4682a" }
                        : { background: "#e2f0ee", color: "#2f7d78" }
                    }
                  >
                    {fu.kind ? FOLLOW_UP_KIND_LABELS[fu.kind] : entryLabelAt(index, followUps.length, false)}
                  </span>
                  {followUps.length - index > 1 && (
                    <span className="text-[#9aacaa]">#{followUps.length - index - 1}</span>
                  )}
                  <span className="text-[#7e918f]">· {fu.authorEmail ?? "Team Member"}</span>
                  {(fu.revisions?.length ?? 0) > 0 && (
                    <span className="rounded-full bg-[#f2f8f7] px-2 py-0.5 text-[10.5px] text-[#5b6d6b]">
                      edited {fu.revisions!.length}×
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5 text-xs text-[#9aacaa]">
                  <span>{formatBusinessDateTime(fu.occurredAt ?? fu.createdAt)}</span>
                  {/* §2 — the newest entry stays editable; the rest are locked,
                      and the lock is shown rather than the button silently
                      missing. */}
                  {!closed && canLog && (
                    isLatest(fu.id) ? (
                      <button
                        type="button"
                        onClick={() => startEdit(fu)}
                        className="rounded-full border border-[#cfe2e0] px-2.5 py-0.5 text-[11px] font-medium text-[#2f7d78] transition-colors hover:bg-[#f3faf9]"
                      >
                        Edit
                      </button>
                    ) : (
                      <span
                        title="Only the latest entry can be edited. Older ones are part of the permanent record."
                        className="inline-flex items-center gap-1 text-[11px] text-[#b3c4c2]"
                      >
                        <Lock size={10} /> Locked
                      </span>
                    )
                  )}
                </div>
              </div>

              <p className="mt-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#3c4d4b]">{fu.message}</p>

              {/* §2 — what it said before, kept rather than destroyed. Oldest
                  first, so it reads as a trail toward the text above. */}
              {(fu.revisions?.length ?? 0) > 0 && (
                <details className="mt-2.5 rounded-lg border border-[#f0f6f5] bg-[#f9fcfc] px-3 py-2">
                  <summary className="cursor-pointer text-[11.5px] text-[#7e918f]">
                    Previous versions ({fu.revisions!.length})
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {fu.revisions!.map((revision, revisionIndex) => (
                      <li key={revisionIndex} className="border-l-2 border-[#dceae8] pl-2.5">
                        <p className="text-[11px] text-[#9aacaa]">
                          {revision.editedByEmail ?? "Team Member"}
                          {revision.editedAt ? ` · ${formatBusinessDateTime(revision.editedAt)}` : ""}
                        </p>
                        <p className="text-[12.5px] whitespace-pre-wrap text-[#5b6d6b]">
                          {revision.message ?? "(empty)"}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}

              {(fu.callMade || fu.meetingHeld || fu.siteVisit || fu.whatsappNote) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {fu.callMade && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-3 py-1 text-[11.5px] text-[#2f7d78]">
                      <PhoneCall size={12} />
                      <span>
                        Phone Call{fu.callCount && fu.callCount > 1 ? ` (${fu.callCount}×)` : ""}
                        {fu.durationSeconds ? ` · ${formatDuration(fu.durationSeconds)}` : ""}
                      </span>
                    </span>
                  )}
                  {fu.connect && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3f8f8a] px-3 py-1 text-[11.5px] text-white">
                      <span>Connect</span>
                    </span>
                  )}
                  {fu.meetingHeld && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-3 py-1 text-[11.5px] text-[#2f7d78]">
                      <Users size={12} />
                      <span>Meeting</span>
                    </span>
                  )}
                  {fu.siteVisit && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-3 py-1 text-[11.5px] text-[#2f7d78]">
                      <MapPin size={12} />
                      <span>Site visit</span>
                    </span>
                  )}
                  {fu.whatsappNote && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f3] px-3 py-1 text-[11.5px] text-[#2f7d78]">
                      <MessageCircle size={12} />
                      <span>{fu.whatsappNote}</span>
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                */
/* -------------------------------------------------------------------------- */

function AuditPanel({ events }: { events: ReturnType<typeof useLeadHistory>["events"] }) {
  return (
    <div>
      <h3 className="text-[19px] font-medium text-[#2b3a39]">Audit Trail</h3>
      <p className="mt-0.5 mb-4 text-[12.5px] text-[#7e918f]">
        Every system and user action on this lead, in order.
      </p>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#cfe2e0] bg-white/70 p-10 text-center text-[13px] text-[#9aacaa]">
          No audit events recorded yet.
        </div>
      ) : (
        <ol className="flex flex-col">
          {events.map((event, i) => (
            <li key={event.id} className="grid grid-cols-[20px_1fr_auto] items-start gap-4 pb-4.5">
              <div className="flex flex-col items-center gap-1 pt-1">
                <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-[#4f9c99]" />
                {i < events.length - 1 && <span className="min-h-[26px] w-px flex-1 bg-[#d6e7e5]" />}
              </div>

              <div className="min-w-0">
                <p className="text-[13.5px] text-[#2b3a39]">{EVENT_LABELS[event.type] ?? event.type}</p>
                <p className="mt-0.5 text-xs text-[#7e918f]">
                  {event.actorUid?.startsWith("system") ? "System automation" : `User ${event.actorUid.slice(0, 6)}`}
                </p>
                {event.meta && Object.keys(event.meta).length > 0 && (
                  <dl className="mt-1.5 rounded-md border border-[#e0eeec] bg-[#f7fbfa] px-2.5 py-2 text-[11.5px] text-[#5b6d6b]">
                    {Object.entries(event.meta).map(([key, value]) => (
                      <div key={key} className="truncate">
                        <dt className="inline text-[#9aacaa]">{key}:</dt>{" "}
                        <dd className="inline">{String(value ?? "—")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <span className="shrink-0 text-xs whitespace-nowrap text-[#9aacaa]">
                {formatBusinessDateTime(event.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Deal entry / record                                                        */
/* -------------------------------------------------------------------------- */

function DealEntryForm({
  lead,
  getIdToken,
  onResult,
  onDone,
}: {
  lead: Lead;
  getIdToken: () => Promise<string>;
  onResult: (b: Banner) => void;
  onDone: () => void;
}) {
  // KYC first, the lead's own columns as the fallback. The CNIC and address
  // were confirmed on the first call; asking for them again at the point of
  // sale is what the KYC feature exists to stop.
  const prefill = dealCustomerFromKyc(lead.kyc, lead);
  const [name, setName] = useState(prefill.name);
  const [phone, setPhone] = useState(prefill.phone);
  const [email, setEmail] = useState(prefill.email);
  const [cnic, setCnic] = useState(prefill.cnic);
  const [address] = useState(prefill.address);
  const [city] = useState(prefill.city);
  const [serviceDescription, setServiceDescription] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [payableAmount, setPayableAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0] ?? "Cash");
  const [dealCategory, setDealCategory] = useState<string>(DEFAULT_DEAL_CATEGORY);
  const [dealDate, setDealDate] = useState(todayInputValue());
  const [busy, setBusy] = useState(false);

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
        notes: "",
      });

      if (result.ok) {
        onResult({ tone: "success", text: `Deal closed successfully. Profit: ${formatMoney(result.data.profit)}.` });
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
    <form onSubmit={submit} className="max-w-[840px]">
      <div className="overflow-hidden rounded-xl border border-[#e0eeec] bg-white">
        <div className="border-b border-[#f0f6f5] px-6 py-5">
          <h3 className="text-lg font-medium text-[#2b3a39]">Record Won Deal</h3>
          <p className="mt-0.5 text-[12.5px] text-[#7e918f]">
            Confirm settlement figures. Closing this lead records revenue permanently.
          </p>
        </div>

        <fieldset className="border-b border-[#f0f6f5] px-6 py-5">
          <legend className="mb-3.5 text-[11.5px] tracking-[1.1px] text-[#4f9c99]">CUSTOMER DETAILS</legend>
          <div className="grid gap-x-4.5 gap-y-3.5 sm:grid-cols-2">
            <label className={FIELD_LABEL_CLASS}>
              <span>
                Full Name <span className="text-[#e05a4a]">*</span>
              </span>
              <input required value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>
                Phone Number <span className="text-[#e05a4a]">*</span>
              </span>
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Email Address</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>CNIC / ID</span>
              <input
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                placeholder="e.g. 35201-1234567-1"
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="border-b border-[#f0f6f5] px-6 py-5">
          <legend className="mb-3.5 text-[11.5px] tracking-[1.1px] text-[#4f9c99]">PACKAGE / SERVICE</legend>
          <label className={FIELD_LABEL_CLASS}>
            <span>
              Description <span className="text-[#e05a4a]">*</span>
            </span>
            <textarea
              required
              rows={2}
              value={serviceDescription}
              onChange={(e) => setServiceDescription(e.target.value)}
              placeholder="What was sold — package, unit, service scope"
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>
        </fieldset>

        <fieldset className="px-6 py-5">
          <legend className="mb-3.5 text-[11.5px] tracking-[1.1px] text-[#4f9c99]">FINANCIAL BREAKDOWN</legend>
          <div className="grid gap-x-4.5 gap-y-3.5 sm:grid-cols-2">
            <label className={FIELD_LABEL_CLASS}>
              <span>
                Amount Received (PKR) <span className="text-[#e05a4a]">*</span>
              </span>
              <input
                required
                type="number"
                min="0"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
                placeholder="0"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Payable Amount (PKR)</span>
              <input
                type="number"
                min="0"
                value={payableAmount}
                onChange={(e) => setPayableAmount(e.target.value)}
                placeholder="0"
                className={`${INPUT_CLASS} tabular-nums`}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Payment Method</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Settlement Date</span>
              <input
                type="date"
                value={dealDate}
                max={todayInputValue()}
                onChange={(e) => setDealDate(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Portfolio Category</span>
              <select
                value={dealCategory}
                onChange={(e) => setDealCategory(e.target.value)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                {DEAL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-[#bfe0dc] bg-[#eef8f7] px-4.5 py-3.5"
            aria-live="polite"
          >
            <span className="text-xs tracking-[1px] text-[#2f7d78]">CALCULATED GROSS PROFIT</span>
            <span className="text-[17px] font-medium tabular-nums text-[#2f7d78]">
              {profit === null ? "—" : formatMoney(profit)}
            </span>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-[#3f8f8a] py-3 text-sm text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
          >
            {busy ? "Saving Deal…" : "Close Deal & Settle Revenue"}
          </button>
        </fieldset>
      </div>
    </form>
  );
}

function DealRecord({ deal }: { deal: NonNullable<ReturnType<typeof useDealForLead>["deal"]> }) {
  return (
    <div className="max-w-[840px] overflow-hidden rounded-xl border border-[#bfe0dc] bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#f0f6f5] px-6 py-5">
        <CheckCircle2 className="shrink-0 text-[#3f8f8a]" size={20} />
        <div>
          <h3 className="text-lg font-medium text-[#2b3a39]">Confirmed Deal Record</h3>
          <p className="text-[12.5px] text-[#7e918f]">
            Settled {formatBusinessDate(deal.dealDate ?? deal.enteredAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[#e0eeec] sm:grid-cols-4">
        {[
          ["CUSTOMER", deal.customer?.name || "—"],
          ["CONTACT", deal.customer?.phone ? formatPhone(deal.customer.phone) : "—"],
          ["METHOD", deal.paymentMethod || "—"],
          ["CATEGORY", deal.dealCategory || "—"],
          ["CITY", deal.customer?.city || "—"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 bg-white px-5 py-3">
            <p className="text-[11px] tracking-[0.6px] text-[#7e918f]">{label}</p>
            <p className="mt-1 truncate text-sm text-[#2b3a39]">{value}</p>
          </div>
        ))}
      </div>

      {deal.serviceDescription && (
        <div className="border-t border-[#f0f6f5] px-6 py-4">
          <p className="text-[11.5px] tracking-[1.1px] text-[#4f9c99]">PACKAGE / SERVICE</p>
          <p className="mt-1 text-[13.5px] text-[#3c4d4b]">{deal.serviceDescription}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 border-t border-[#f0f6f5] px-6 py-5">
        <div className="rounded-lg bg-[#f7fbfa] px-3 py-2.5 text-center">
          <p className="text-[11px] tracking-[0.6px] text-[#7e918f]">RECEIVED</p>
          <p className="mt-0.5 text-sm tabular-nums text-[#2b3a39]">{formatMoney(deal.amountReceived)}</p>
        </div>
        <div className="rounded-lg bg-[#f7fbfa] px-3 py-2.5 text-center">
          <p className="text-[11px] tracking-[0.6px] text-[#7e918f]">PAYABLE</p>
          <p className="mt-0.5 text-sm tabular-nums text-[#2b3a39]">{formatMoney(deal.payableAmount)}</p>
        </div>
        <div className="rounded-lg border border-[#bfe0dc] bg-[#eef8f7] px-3 py-2.5 text-center">
          <p className="text-[11px] tracking-[0.6px] text-[#2f7d78]">NET PROFIT</p>
          <p className="mt-0.5 text-sm font-medium tabular-nums text-[#2f7d78]">{formatMoney(deal.profit)}</p>
        </div>
      </div>
    </div>
  );
}
