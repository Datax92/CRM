"use client";

/**
 * The phone lead detail, built to the `detailOpen` overlay in
 * `Active Leads Mobile.dc.html`.
 *
 * The design's own structure is kept exactly — 56px/radius-18 avatar, the
 * `1fr 1fr 44px` action row, the 2-up facts grid hairlined with `#dceae8`, the
 * pill segmented control, 18px note cards, and one sticky primary action whose
 * label follows the open tab.
 *
 * **Every field the desktop pane has is here**, which is more than the mockup's
 * four facts: email, source, campaign and created time join phone/city/
 * assignee/stage in the same grid; the accept window, the intake warning, the
 * stage select, the Hot/Cold control, the full follow-up form (call count,
 * duration with the live connect verdict, meeting, WhatsApp note) and the full
 * deal form (customer, CNIC, description, amounts, method, date, category) are
 * all present. Nothing was dropped to make the screen fit — it scrolls.
 *
 * Writes go through the same `clientActions` the desktop calls, with identical
 * payloads, so the two surfaces cannot drift.
 */

import { useMemo, useState } from "react";
import type { Lead, FollowUpRecord } from "@/hooks/useLeads";
import { useLeadHistory } from "@/hooks/useLeads";
import { useAuth } from "@/context/AuthContext";
import { useDealForLead } from "@/hooks/useFinancials";
import {
  acceptLead,
  addFollowUp,
  closeDeal,
  setLeadStatus,
  updateFollowUp,
  reviewColdLead,
  PAYMENT_METHODS,
} from "@/lib/clientActions";
import { USER_SETTABLE_STATUSES, LEAD_STATUS_LABELS, isTerminal, type LeadStatus } from "@/lib/leadStatus";
import { whatsAppUrl, telUrl, formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { ACCEPT_WINDOW_MINUTES } from "@/lib/constants/distribution";
import { formatBusinessDateTime, karachiDayKey } from "@/lib/dates";
import { CONNECT_MIN_SECONDS, formatDuration, isConnect } from "@/lib/kpi";
import { DEAL_CATEGORIES, DEFAULT_DEAL_CATEGORY } from "@/lib/constants/deals";
import { initialsOf } from "@/lib/leadDisplay";
import {
  pipelineStage,
  awaitingFirstEntry,
  explainPipelineStage,
  PIPELINE_STAGE_LABELS,
} from "@/lib/pipelineStage";
import { STAGE_TONES, StageIcon } from "@/components/leads/StageChrome";
import { KycPanel } from "@/components/leads/KycPanel";
import { describeLeadSource } from "@/lib/leadSource";
import { dealCustomerFromKyc } from "@/lib/kyc";
import {
  entryLabelAt,
  toChronological,
  nextEntryLabel,
  historyTabLabel,
  FOLLOW_UP_KIND_LABELS,
} from "@/lib/followUpKind";
import { STAGE_STATUSES, statusLabel } from "@/lib/leadStatus";
import { M, MobileCard, MobileHeader, Segmented } from "./mobileChrome";

type Tab = "notes" | "kyc" | "audit" | "deal";
type Banner = { tone: "error" | "success"; text: string } | null;

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
  PIPELINE_STAGE_CHANGED: "Pipeline stage changed",
  KYC_UPDATED: "Client record updated",
};

const FIELD_LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: M.muted,
};

const FIELD: React.CSSProperties = {
  border: `1px solid ${M.cardBorder}`,
  background: "#f7fbfa",
  borderRadius: M.fieldRadius,
  padding: "13px 14px",
  fontSize: 14,
  fontWeight: 600,
  color: M.ink,
  outline: "none",
  width: "100%",
  // 14px+ everywhere: iOS Safari zooms the whole page when a focused input's
  // text is under 16px, and 14px with this font measures large enough to avoid
  // it while matching the design.
  WebkitAppearance: "none",
};

function todayInputValue(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}

export function MobileLeadDetail({
  lead,
  onClose,
  userRole,
  getIdToken,
  assigneeName,
  onReassign,
}: {
  lead: Lead;
  onClose: () => void;
  userRole: "admin" | "subadmin" | "employee";
  getIdToken: () => Promise<string>;
  assigneeName?: string;
  onReassign?: () => void;
}) {
  const { followUps, events, error: historyError } = useLeadHistory(lead.id);
  const { user } = useAuth();
  const { deal } = useDealForLead(lead.id);
  const [tab, setTab] = useState<Tab>("notes");
  const [banner, setBanner] = useState<Banner>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** The entry the sheet is editing, or null when it is adding a new one. */
  const [editingEntry, setEditingEntry] = useState<FollowUpRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const closed = isTerminal(lead.status);
  const waUrl = whatsAppUrl(lead.phone);
  const callUrl = telUrl(lead.phone);
  const stage = pipelineStage(lead);

  const loggedToday = followUps.some((fu) => fu.dayKey === karachiDayKey(new Date()));
  // A manager runs a team; they do not work *their team's* leads. Same rule
  // the desktop pane applies — they read everything and log nothing, because
  // the server books a follow-up and a deal against the assigned employee —
  // and the same exception: a lead assigned to the manager themselves (a
  // Client-section promotion, or a record handed to them) is their own work,
  // credited to them, so they work it like anybody else.
  const isManagerView = userRole === "subadmin" && lead.assignedUserId !== user?.uid;
  const canEnterDeal =
    !closed && !isManagerView && lead.status !== "ASSIGNED" && lead.status !== "NEW";

  /** Everything the desktop facts strip carries, plus what its header carries. */
  const facts = useMemo(
    () =>
      [
        { label: "PHONE", value: lead.phone ? formatPhone(lead.phone) : "Not provided" },
        { label: "CITY / AREA", value: lead.city || "Not specified" },
        { label: "EMAIL", value: lead.email || "Not provided" },
        { label: "ASSIGNEE", value: lead.assignedUserId ? (assigneeName ?? "Assigned") : "Unassigned" },
        { label: "STAGE", value: LEAD_STATUS_LABELS[lead.status] ?? lead.status },
        // The exact origin, folder and all (§1) — the phone shows the same
        // string the desktop pane does rather than the bare token.
        { label: "SOURCE", value: describeLeadSource(lead) },
        { label: "CAMPAIGN", value: lead.campaignName || "—" },
        { label: "CREATED", value: formatBusinessDateTime(lead.createdAt) },
      ] as const,
    [lead, assigneeName]
  );

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    setBanner(null);
    try {
      const result = await fn();
      if (result.ok) {
        if (success) setBanner({ tone: "success", text: success });
      } else {
        setBanner({ tone: "error", text: result.error ?? "That did not work." });
      }
      return result.ok;
    } catch {
      setBanner({ tone: "error", text: "Could not reach the server. Check your connection." });
      return false;
    }
  };

  return (
    <div
      className="mob-slide-in"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        background: M.page,
        display: "flex",
        flexDirection: "column",
      }}
      role="dialog"
      aria-label={`Lead ${lead.name}`}
    >
      <MobileHeader style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to leads"
            className="mob-press"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: M.circleBg,
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" aria-hidden>
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "1.3px", textTransform: "uppercase", opacity: 0.82 }}>
            Lead Detail
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Lead actions"
            aria-expanded={menuOpen}
            className="mob-press"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: M.circleBg,
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden>
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div
            className="mob-rise"
            style={{
              position: "absolute",
              right: 20,
              top: "calc(env(safe-area-inset-top, 0px) + 58px)",
              zIndex: 5,
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 14px 34px rgba(18,54,52,0.24)",
              padding: 6,
              minWidth: 190,
            }}
          >
            <MenuItem
              label="Copy phone number"
              onSelect={() => {
                if (lead.phone) void navigator.clipboard?.writeText(lead.phone);
                setMenuOpen(false);
                setBanner({ tone: "success", text: "Phone number copied." });
              }}
            />
            {userRole !== "employee" && !closed && onReassign && (
              <MenuItem
                label="Reassign lead"
                onSelect={() => {
                  setMenuOpen(false);
                  onReassign();
                }}
              />
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              background: "rgba(255,255,255,0.2)",
              border: "1.5px solid rgba(255,255,255,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              fontWeight: 700,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {initialsOf(lead.name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 21,
                fontWeight: 800,
                letterSpacing: "-0.6px",
                color: "#fff",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {lead.name}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
              <span
                style={{
                  padding: "3px 11px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.24)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.7px",
                }}
              >
                {(LEAD_STATUS_LABELS[lead.status] ?? lead.status).toUpperCase()}
              </span>
              {stage.value && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.24)",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.4px",
                  }}
                >
                  <StageIcon stage={stage.value} size={10} />
                  {PIPELINE_STAGE_LABELS[stage.value]}
                </span>
              )}
              <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
                ID {lead.id.slice(0, 10)}
              </span>
            </div>
          </div>
        </div>

        {/* Call / WhatsApp / email — the design's own 1fr 1fr 44px row. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 44px", gap: 9, marginTop: 16 }}>
          <ActionPill href={callUrl} filled label="Call" disabledLabel="No phone">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
              <path d="M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3 6.2 2 2 0 0 1 5 4Z" />
            </svg>
          </ActionPill>
          <ActionPill href={waUrl} label="WhatsApp" disabledLabel="No phone">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
              <path d="M21 12a9 9 0 1 1-4.2-7.6L21 4l-1 4.2A8.9 8.9 0 0 1 21 12Z" />
            </svg>
          </ActionPill>
          <a
            href={lead.email ? `mailto:${lead.email}` : undefined}
            aria-label={lead.email ? `Email ${lead.email}` : "No email address"}
            className="mob-press"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              border: "1.5px solid rgba(255,255,255,0.65)",
              color: "#fff",
              opacity: lead.email ? 1 : 0.4,
              pointerEvents: lead.email ? "auto" : "none",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <path d="m3.6 6.5 8.4 6 8.4-6" />
            </svg>
          </a>
        </div>
      </MobileHeader>

      <Segmented
        variant="white"
        style={{ margin: "14px 18px 0", flexShrink: 0 }}
        value={tab}
        onChange={setTab}
        options={[
          {
            key: "notes",
            label: `${historyTabLabel(followUps.length)}${followUps.length ? ` (${followUps.length})` : ""}`,
          },
          { key: "kyc", label: "KYC" },
          { key: "audit", label: "Audit" },
          { key: "deal", label: deal ? "Deal ✓" : "Deal" },
        ]}
      />

      {/* The only scrolling region. */}
      <div
        style={{
          minHeight: 0,
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "14px 18px 22px",
        }}
      >
        {(banner || historyError) && (
          <div
            role="status"
            style={{
              marginBottom: 12,
              borderRadius: M.rowRadius,
              padding: "11px 13px",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.45,
              border: `1px solid ${banner?.tone === "success" ? "#bfe0dc" : "#f0c4bd"}`,
              background: banner?.tone === "success" ? "#eef8f7" : "#fdeeeb",
              color: banner?.tone === "success" ? M.tealDeep : "#a33a29",
            }}
          >
            {banner?.text ?? historyError}
          </div>
        )}

          {/*
            The design pins this grid between the header and the tabs. It carries
            four facts there and eight here — every field the desktop pane shows —
            which on a 390px screen is four rows, tall enough to push the sticky
            action off the bottom of the frame. So it scrolls with the tab body
            instead. The header and the tab bar stay pinned, which is what makes
            the screen feel like the design.
          */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 1,
            background: M.cardBorder,
            marginBottom: 14,
            border: `1px solid ${M.cardBorder}`,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {facts.map((fact) => (
            <div key={fact.label} style={{ background: M.cardBg, padding: "12px 14px", minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "1px", color: M.faint }}>{fact.label}</div>
              <div
                title={fact.value}
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: M.ink,
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {fact.value}
              </div>
            </div>
          ))}
        </div>

        {lead.intakeWarning && (
          <div
            style={{
              marginBottom: 12,
              borderRadius: M.rowRadius,
              border: `1px solid ${M.amberBorder}`,
              background: M.amberBg,
              color: M.amberInk,
              padding: "11px 13px",
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            Contact details could not be retrieved from Meta. Confirm or update them manually.
          </div>
        )}

        {lead.status === "ASSIGNED" && (
          <MobileCard radius={M.rowRadius} style={{ padding: "14px 15px", marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: M.tealDeep }}>
              {userRole === "admin" ? "Awaiting employee acceptance" : "New lead assigned to you"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: M.faint, marginTop: 3, lineHeight: 1.45 }}>
              {userRole === "admin"
                ? `${ACCEPT_WINDOW_MINUTES} minutes to accept. You can force-accept here.`
                : `Accept within ${ACCEPT_WINDOW_MINUTES} minutes or this lead is reassigned.`}
            </div>
            <button
              type="button"
              className="mob-press"
              onClick={() =>
                void run(async () => acceptLead(await getIdToken(), lead.id), "Lead accepted.")
              }
              style={{
                marginTop: 12,
                width: "100%",
                padding: 13,
                borderRadius: 999,
                border: "none",
                background: M.teal,
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 700,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {userRole === "admin" ? "Force Accept" : "Accept Lead"}
            </button>
          </MobileCard>
        )}

        {/* Status + stage, which the mockup leaves to the desktop but the
            phone needs if it is to be a complete product. */}
        {!closed && (
          <MobileCard radius={M.rowRadius} style={{ padding: "14px 15px", marginBottom: 12 }}>
            <label style={{ ...FIELD_LABEL, marginBottom: 12 }}>
              <span>Pipeline Status</span>
              <select
                value={lead.status}
                onChange={(event) => {
                  /**
                   * **Read the value before the first `await`, not after it.**
                   *
                   * This select is controlled by `lead.status`. The handler used
                   * to be `async () => setLeadStatus(await getIdToken(), lead.id,
                   * event.target.value)`, which awaits the token *first* — and by
                   * the time that resolves React has already re-rendered the
                   * select back to `lead.status`, because no state changed. So
                   * `event.target.value` read the **old** status, the server saw
                   * "you asked for the status it already has" and returned
                   * without writing, and the dropdown snapped back. The change
                   * appeared to do nothing, with no error, every time.
                   */
                  const next = event.target.value as LeadStatus;
                  void run(async () => setLeadStatus(await getIdToken(), lead.id, next));
                }}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                {/* Grouped by band, so choosing a status shows what it does
                    to the stage before it is chosen (§14). */}
                {!USER_SETTABLE_STATUSES.includes(lead.status) && (
                  <option value={lead.status}>{statusLabel(lead.status)}</option>
                )}
                {(["P3", "P2", "P1"] as const).map((band) => (
                  <optgroup
                    key={band}
                    label={`${band} — ${band === "P3" ? "talking" : band === "P2" ? "met or visited" : "closing"}`}
                  >
                    {/* Deal Closed is deliberately absent — `setLeadStatus`
                        refuses it, and a won deal is recorded through Deal
                        Entry. See `LeadDetailPane`. */}
                    {STAGE_STATUSES[band]
                      .filter((status) => status !== "CLOSED_WON")
                      .map((status) => (
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
            </label>

            {/* §14 — the stage is read off the status, so this is a
                read-out rather than a second control that could contradict it.
                The one decision still open to a person is the Cold review. */}
            <div style={{ ...FIELD_LABEL, gap: 8 }}>
              <span>Pipeline Stage</span>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {/* Accepted but not yet worked. Saying nothing would leave the
                    rep wondering why the lead has no band. */}
                {awaitingFirstEntry(lead) && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      border: `1px solid ${M.cardBorder}`,
                      background: M.tealTint,
                      padding: "8px 13px",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: M.body,
                    }}
                  >
                    Not started — add the first Remark to reach P3
                  </span>
                )}

                {stage.value && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 999,
                      padding: "8px 13px",
                      fontSize: 12.5,
                      fontWeight: 700,
                      background: STAGE_TONES[stage.value].soft,
                      color: STAGE_TONES[stage.value].softText,
                    }}
                  >
                    <StageIcon stage={stage.value} size={12} />
                    {PIPELINE_STAGE_LABELS[stage.value]}
                    {stage.manual && <span aria-hidden>·</span>}
                  </span>
                )}

                {stage.coldPending && (
                  <span
                    style={{
                      display: "inline-flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 14,
                      border: `1px solid ${M.amberBorder}`,
                      background: M.amberBg,
                      color: M.amberInk,
                      padding: "9px 12px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      flex: "1 1 100%",
                    }}
                  >
                    Requires verification before being moved to Cold
                    {userRole !== "employee" && (
                      <>
                        <button
                          type="button"
                          className="mob-press"
                          onClick={() =>
                            void run(async () => reviewColdLead(await getIdToken(), lead.id, true))
                          }
                          style={{
                            borderRadius: 999,
                            background: "#4d7590",
                            color: "#fff",
                            padding: "6px 12px",
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Verify Cold
                        </button>
                        <button
                          type="button"
                          className="mob-press"
                          onClick={() =>
                            void run(async () => reviewColdLead(await getIdToken(), lead.id, false))
                          }
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${M.amberBorder}`,
                            padding: "6px 12px",
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: M.amberInk,
                            cursor: "pointer",
                          }}
                        >
                          Keep working
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 500, color: M.fainter }}>
                {explainPipelineStage(lead)}
              </span>
            </div>
          </MobileCard>
        )}

        {tab === "notes" && (
          <FollowUpList
            followUps={followUps}
            // The lead names its editable entry; the newest in the list is the
            // fallback for leads whose entries predate that field.
            latestId={lead.latestFollowUpId ?? followUps[0]?.id ?? null}
            canEdit={!closed && !isManagerView}
            onEdit={(entry) => setEditingEntry(entry)}
          />
        )}

        {/* The same component the desktop pane renders, one column wide. A
            second phone-only implementation would be where the two surfaces
            start collecting different fields. */}
        {tab === "kyc" && (
          <KycPanel
            lead={lead}
            getIdToken={getIdToken}
            onResult={setBanner}
            compact
            readOnly={closed}
          />
        )}

        {tab === "audit" && <AuditTrail events={events} />}

        {tab === "deal" &&
          (deal ? (
            <DealRecord deal={deal} />
          ) : canEnterDeal ? (
            <DealForm lead={lead} getIdToken={getIdToken} onResult={setBanner} onDone={() => setTab("notes")} />
          ) : (
            <div
              style={{
                borderRadius: M.cardRadius,
                border: `1px dashed ${M.cardBorder}`,
                background: "rgba(255,255,255,0.7)",
                padding: "34px 16px",
                textAlign: "center",
                fontSize: 13,
                fontWeight: 500,
                color: M.faint,
                lineHeight: 1.5,
              }}
            >
              {closed
                ? "This lead is closed and has no deal entry."
                : "Accept this lead and move its stage before entering a deal."}
            </div>
          ))}
      </div>

      {/* Sticky primary action — label follows the tab, exactly as the design
          does with its `primaryAction`. */}
      {!closed && !isManagerView && (
        <div
          style={{
            padding: "12px 18px calc(env(safe-area-inset-bottom, 0px) + 14px)",
            background: M.cardBg,
            borderTop: `1px solid ${M.cardBorder}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="mob-press"
            disabled={tab !== "deal" && loggedToday}
            onClick={() => (tab === "deal" ? setTab("deal") : setFormOpen(true))}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              padding: 15,
              borderRadius: 999,
              border: "none",
              background: M.teal,
              color: "#fff",
              fontSize: 14.5,
              fontWeight: 700,
              cursor: "pointer",
              opacity: tab !== "deal" && loggedToday ? 0.45 : 1,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {tab !== "deal" && (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
            <span>
              {tab === "deal"
                ? "Close Deal & Settle"
                : loggedToday
                  ? "Logged Today"
                  // The first entry is a Remark — see `lib/followUpKind`.
                  : `Add ${nextEntryLabel(followUps.length)}`}
            </span>
          </button>
        </div>
      )}

      {(formOpen || editingEntry) && (
        <FollowUpSheet
          lead={lead}
          entryCount={followUps.length}
          editing={editingEntry}
          getIdToken={getIdToken}
          onClose={() => {
            setFormOpen(false);
            setEditingEntry(null);
          }}
          onResult={setBanner}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "11px 13px",
        borderRadius: 11,
        border: "none",
        background: "transparent",
        fontSize: 13.5,
        fontWeight: 600,
        color: M.body,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

function ActionPill({
  href,
  label,
  filled,
  disabledLabel,
  children,
}: {
  href: string | null;
  label: string;
  filled?: boolean;
  disabledLabel: string;
  children: React.ReactNode;
}) {
  const disabled = !href;
  return (
    <a
      href={href ?? undefined}
      aria-label={disabled ? disabledLabel : label}
      className="mob-press"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 11,
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 700,
        background: filled ? "#fff" : "transparent",
        color: filled ? M.tealDeep : "#fff",
        border: filled ? "none" : "1.5px solid rgba(255,255,255,0.65)",
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

function FollowUpList({
  followUps,
  latestId,
  canEdit,
  onEdit,
}: {
  followUps: ReturnType<typeof useLeadHistory>["followUps"];
  /** The one entry still open for editing (§2). */
  latestId: string | null;
  canEdit: boolean;
  onEdit: (entry: FollowUpRecord) => void;
}) {
  if (followUps.length === 0) {
    return (
      <div
        style={{
          borderRadius: M.cardRadius,
          border: `1px dashed ${M.cardBorder}`,
          background: "rgba(255,255,255,0.7)",
          padding: "38px 16px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: M.ink }}>Nothing logged yet</div>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: M.fainter, marginTop: 4, lineHeight: 1.5 }}>
          Start with a remark. Every call and meeting after it is a follow-up.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Chronological: the Remark first, then each Follow-Up after it. */}
      {toChronological(followUps).map((note, index) => (
        <MobileCard key={note.id} radius={M.rowRadius} style={{ padding: "14px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* The stored kind when there is one; position for entries
                  written before it was recorded. */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "2px 8px",
                  ...((note.kind ? FOLLOW_UP_KIND_LABELS[note.kind] : entryLabelAt(index, followUps.length, false)) ===
                  FOLLOW_UP_KIND_LABELS.REMARK
                    ? { background: "#fdf1e3", color: "#a4682a" }
                    : { background: "#e2f0ee", color: M.tealDeep }),
                }}
              >
                {note.kind ? FOLLOW_UP_KIND_LABELS[note.kind] : entryLabelAt(index, followUps.length, false)}
              </span>
              {/* Chronological index — see `LeadDetailPane`. Counting down
                  from `length` left the newest entry unnumbered. */}
              {index > 0 && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: M.fainter }}>#{index}</span>
              )}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: M.fainter, fontVariantNumeric: "tabular-nums" }}>
                {formatBusinessDateTime(note.occurredAt ?? note.createdAt)}
              </span>
              {/* §2 — the newest entry stays editable, the rest are locked, and
                  the lock is shown rather than the button silently missing. */}
              {canEdit &&
                (note.id === latestId ? (
                  <button
                    type="button"
                    className="mob-press"
                    onClick={() => onEdit(note)}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${M.cardBorder}`,
                      background: "#fff",
                      color: M.tealDeep,
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <span
                    title="Only the latest entry can be edited."
                    style={{ fontSize: 10.5, fontWeight: 700, color: "#b3c4c2" }}
                  >
                    Locked
                  </span>
                ))}
            </span>
          </div>
          <p
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              lineHeight: 1.5,
              color: M.body,
              marginTop: 8,
              whiteSpace: "pre-wrap",
            }}
          >
            {note.message}
          </p>
          {(note.revisions?.length ?? 0) > 0 && (
            <details style={{ marginTop: 9 }}>
              <summary style={{ fontSize: 11, fontWeight: 600, color: M.fainter, cursor: "pointer" }}>
                Previous versions ({note.revisions!.length})
              </summary>
              <ol style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 7 }}>
                {note.revisions!.map((revision, revisionIndex) => (
                  <li
                    key={revisionIndex}
                    style={{ borderLeft: `2px solid ${M.cardBorder}`, paddingLeft: 9 }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: M.ghost }}>
                      {revision.editedByEmail ?? "Team member"}
                      {revision.editedAt ? ` · ${formatBusinessDateTime(revision.editedAt)}` : ""}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: M.muted, whiteSpace: "pre-wrap" }}>
                      {revision.message ?? "(empty)"}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {(note.callMade || note.meetingHeld || note.siteVisit || note.whatsappNote || note.connect) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
              {note.callMade && (
                <Chip>
                  Phone Call
                  {note.callCount && note.callCount > 1 ? ` (${note.callCount}×)` : ""}
                  {note.durationSeconds ? ` · ${formatDuration(note.durationSeconds)}` : ""}
                </Chip>
              )}
              {note.connect && <Chip solid>Connect</Chip>}
              {note.meetingHeld && <Chip>Meeting</Chip>}
              {note.siteVisit && <Chip>Site visit</Chip>}
              {note.whatsappNote && <Chip>{note.whatsappNote}</Chip>}
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 500, color: M.ghost, marginTop: 8 }}>
            {note.authorEmail ?? "Team member"}
          </div>
        </MobileCard>
      ))}
    </div>
  );
}

function Chip({ children, solid }: { children: React.ReactNode; solid?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 11px",
        borderRadius: 999,
        background: solid ? M.teal : M.tealTint,
        color: solid ? "#fff" : M.tealDeep,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.3px",
      }}
    >
      {children}
    </span>
  );
}

function AuditTrail({ events }: { events: ReturnType<typeof useLeadHistory>["events"] }) {
  if (events.length === 0) {
    return (
      <div
        style={{
          borderRadius: M.cardRadius,
          border: `1px dashed ${M.cardBorder}`,
          background: "rgba(255,255,255,0.7)",
          padding: "38px 16px",
          textAlign: "center",
          fontSize: 13,
          fontWeight: 500,
          color: M.fainter,
        }}
      >
        No audit events recorded yet.
      </div>
    );
  }

  return (
    <ol>
      {events.map((event, index) => (
        <li key={event.id} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 12, paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: M.teal }} />
            {index < events.length - 1 && (
              <div style={{ width: 1.5, flex: 1, minHeight: 22, background: "#d6e7e5" }} />
            )}
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: M.ink }}>
              {EVENT_LABELS[event.type] ?? event.type}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: M.faint, marginTop: 2 }}>
              {event.actorUid?.startsWith("system") ? "System automation" : `User ${event.actorUid.slice(0, 6)}`}
            </div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: M.ghost,
                marginTop: 3,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatBusinessDateTime(event.at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Follow-up form — every field the desktop form has                          */
/* -------------------------------------------------------------------------- */

function FollowUpSheet({
  lead,
  entryCount,
  editing,
  getIdToken,
  onClose,
  onResult,
}: {
  lead: Lead;
  /** How many entries the lead already has — decides Remark vs Follow-Up. */
  entryCount: number;
  /** The entry being edited, when the sheet was opened from a row (§2). */
  editing?: FollowUpRecord | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onResult: (b: Banner) => void;
}) {
  // Pre-filled when editing, blank when adding. One sheet does both jobs; a
  // second editor is where the two would drift on the connect rule.
  const [message, setMessage] = useState(editing?.message ?? "");
  const [callMade, setCallMade] = useState(Boolean(editing?.callMade));
  const [callCount, setCallCount] = useState(String(editing?.callCount ?? 1));
  const [minutes, setMinutes] = useState(
    editing?.durationSeconds ? String(Math.floor(editing.durationSeconds / 60)) : ""
  );
  const [seconds, setSeconds] = useState(
    editing?.durationSeconds ? String(editing.durationSeconds % 60) : ""
  );
  const [meetingHeld, setMeetingHeld] = useState(Boolean(editing?.meetingHeld));
  const [siteVisit, setSiteVisit] = useState(Boolean(editing?.siteVisit));
  const [whatsappNote, setWhatsappNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Remark for the first entry on a lead, Follow-Up thereafter — or the kind
  // of the entry being edited.
  const entryWord = editing
    ? FOLLOW_UP_KIND_LABELS[editing.kind ?? "FOLLOW_UP"]
    : nextEntryLabel(entryCount);

  const durationSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  const willCount = callMade && isConnect(durationSeconds);

  const submit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      const result = editing
        ? await updateFollowUp(await getIdToken(), lead.id, editing.id, {
            message: message.trim(),
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
        onResult({
          tone: "success",
          text: result.data?.connect
            ? `${entryWord} ${editing ? "updated" : "logged"}. Counted as a connect.`
            : callMade
              ? `${entryWord} ${editing ? "updated" : "logged"}. Under ${formatDuration(CONNECT_MIN_SECONDS)}, so it is not a connect.`
              : `${entryWord} ${editing ? "updated" : "logged"}.`,
        });
        onClose();
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
    <Sheet
      title={editing ? `Edit this ${entryWord.toLowerCase()}` : entryCount === 0 ? "Opening remark" : "Log a follow-up"}
      subtitle="Every call and note, kept permanently."
      onClose={onClose}
    >
      <label style={FIELD_LABEL}>
        <span>Discussion summary *</span>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Client feedback, requirements, next steps…"
          style={{ ...FIELD, fontWeight: 500, resize: "none" }}
        />
      </label>

      <div style={{ display: "flex", gap: 10 }}>
        <Toggle checked={callMade} onChange={setCallMade} label="Phone call" />
        <Toggle checked={meetingHeld} onChange={setMeetingHeld} label="Meeting held" />
        {/* Counted separately from a meeting in Reports (§4) — a client who
            came to the site is a different signal, and often a different day. */}
        <Toggle checked={siteVisit} onChange={setSiteVisit} label="Site visit" />
      </div>

      {callMade && (
        <div className="mob-rise" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
            <label style={FIELD_LABEL}>
              <span>Calls</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="50"
                value={callCount}
                onChange={(e) => setCallCount(e.target.value)}
                style={{ ...FIELD, textAlign: "center" }}
              />
            </label>
            <label style={FIELD_LABEL}>
              <span>Minutes *</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="240"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="0"
                style={{ ...FIELD, textAlign: "center" }}
              />
            </label>
            <label style={FIELD_LABEL}>
              <span>Seconds *</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="59"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                placeholder="00"
                style={{ ...FIELD, textAlign: "center" }}
              />
            </label>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "11px 13px",
              borderRadius: M.fieldRadius,
              background: willCount ? M.tealTint : M.amberBg,
              color: willCount ? M.tealDeep : M.amberInk,
              fontSize: 12,
              fontWeight: 700,
            }}
            aria-live="polite"
          >
            <span>{willCount ? "Counts as a connect" : "Not a connect"}</span>
            <span style={{ fontWeight: 500, fontSize: 11.5 }}>
              needs {formatDuration(CONNECT_MIN_SECONDS)}+
            </span>
          </div>
        </div>
      )}

      <label style={FIELD_LABEL}>
        <span>WhatsApp reference (optional)</span>
        <input
          value={whatsappNote}
          onChange={(e) => setWhatsappNote(e.target.value)}
          placeholder="e.g. Sent the floor plan"
          style={FIELD}
        />
      </label>

      <SheetAction
        label={busy ? "Saving…" : `Save ${entryWord}`}
        disabled={busy || !message.trim() || (callMade && durationSeconds === 0)}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Deal                                                                        */
/* -------------------------------------------------------------------------- */

function DealForm({
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
  // KYC first, the lead's own columns as the fallback — the same prefill the
  // desktop deal form uses, so a sale entered on a phone carries the CNIC and
  // address the rep already confirmed.
  const kycPrefill = dealCustomerFromKyc(lead.kyc, lead);
  const [name, setName] = useState(kycPrefill.name);
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [email, setEmail] = useState(lead.email ?? "");
  const [cnic, setCnic] = useState(kycPrefill.cnic);
  const [serviceDescription, setServiceDescription] = useState("");
  const [received, setReceived] = useState("");
  const [payable, setPayable] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHODS[0] ?? "Cash");
  const [dealCategory, setDealCategory] = useState<string>(DEFAULT_DEAL_CATEGORY);
  const [dealDate, setDealDate] = useState(todayInputValue());
  const [busy, setBusy] = useState(false);

  const r = Number(received);
  const p = Number(payable);
  const profit =
    Number.isFinite(r) && received !== "" ? r - (Number.isFinite(p) && payable !== "" ? p : 0) : null;

  const submit = async () => {
    setBusy(true);
    try {
      const result = await closeDeal(await getIdToken(), lead.id, {
        customer: { name, phone, email, cnic, address: kycPrefill.address, city: kycPrefill.city },
        serviceDescription,
        amountReceived: Number(received),
        payableAmount: Number(payable) || 0,
        paymentMethod,
        dealCategory,
        dealDate,
        notes: "",
      });
      if (result.ok) {
        onResult({ tone: "success", text: `Deal closed. Profit ${formatMoney(result.data.profit)}.` });
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
    <MobileCard style={{ padding: 16 }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.2px", color: M.ink }}>Record Won Deal</div>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: M.faint, marginTop: 3, lineHeight: 1.45 }}>
        Closing this lead records revenue permanently.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        <label style={FIELD_LABEL}>
          <span>Customer name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={FIELD} />
        </label>
        <label style={FIELD_LABEL}>
          <span>Phone *</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={FIELD} />
        </label>
        <label style={FIELD_LABEL}>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={FIELD} />
        </label>
        <label style={FIELD_LABEL}>
          <span>CNIC / ID</span>
          <input
            value={cnic}
            onChange={(e) => setCnic(e.target.value)}
            placeholder="35201-1234567-1"
            style={FIELD}
          />
        </label>
        <label style={FIELD_LABEL}>
          <span>Package / service *</span>
          <textarea
            rows={2}
            value={serviceDescription}
            onChange={(e) => setServiceDescription(e.target.value)}
            placeholder="What was sold"
            style={{ ...FIELD, fontWeight: 500, resize: "none" }}
          />
        </label>
        <label style={FIELD_LABEL}>
          <span>Amount received (PKR) *</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="0"
            style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
          />
        </label>
        <label style={FIELD_LABEL}>
          <span>Payable amount (PKR)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={payable}
            onChange={(e) => setPayable(e.target.value)}
            placeholder="0"
            style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
          />
        </label>
        <label style={FIELD_LABEL}>
          <span>Payment method</span>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            style={{ ...FIELD, cursor: "pointer" }}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_LABEL}>
          <span>Portfolio category</span>
          <select
            value={dealCategory}
            onChange={(e) => setDealCategory(e.target.value)}
            style={{ ...FIELD, cursor: "pointer" }}
          >
            {DEAL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label style={FIELD_LABEL}>
          <span>Settlement date</span>
          <input
            type="date"
            value={dealDate}
            max={todayInputValue()}
            onChange={(e) => setDealDate(e.target.value)}
            style={FIELD}
          />
        </label>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 14,
          padding: "13px 15px",
          borderRadius: 16,
          background: "#eef8f7",
          border: "1px solid #bfe0dc",
        }}
        aria-live="polite"
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.9px", color: M.tealDeep }}>
          GROSS PROFIT
        </span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: "-0.4px",
            color: M.tealDeep,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {profit === null ? "—" : formatMoney(profit)}
        </span>
      </div>

      <button
        type="button"
        className="mob-press"
        disabled={busy || !name.trim() || !phone.trim() || !serviceDescription.trim() || received === ""}
        onClick={() => void submit()}
        style={{
          marginTop: 14,
          width: "100%",
          padding: 15,
          borderRadius: 999,
          border: "none",
          background: M.teal,
          color: "#fff",
          fontSize: 14.5,
          fontWeight: 700,
          cursor: "pointer",
          opacity: busy || !name.trim() || !phone.trim() || !serviceDescription.trim() || received === "" ? 0.5 : 1,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {busy ? "Saving…" : "Close Deal & Settle"}
      </button>
    </MobileCard>
  );
}

function DealRecord({ deal }: { deal: NonNullable<ReturnType<typeof useDealForLead>["deal"]> }) {
  return (
    <MobileCard style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={M.teal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: M.ink }}>Confirmed deal</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {[
          ["Customer", deal.customer?.name || "—"],
          ["Contact", deal.customer?.phone ? formatPhone(deal.customer.phone) : "—"],
          ["Method", deal.paymentMethod || "—"],
          ["Category", deal.dealCategory || "—"],
          ["Received", formatMoney(deal.amountReceived)],
          ["Payable", formatMoney(deal.payableAmount)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: M.faint }}>{label}</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: M.ink,
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
                minWidth: 0,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          padding: "13px 15px",
          borderRadius: 16,
          background: "#eef8f7",
          border: "1px solid #bfe0dc",
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.9px", color: M.tealDeep }}>NET PROFIT</span>
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: M.tealDeep,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatMoney(deal.profit)}
        </span>
      </div>
    </MobileCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bottom sheet                                                         */
/* -------------------------------------------------------------------------- */

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mob-fade"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "rgba(24,52,50,0.42)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        className="mob-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{
          width: "100%",
          maxHeight: "88%",
          background: M.cardBg,
          borderRadius: `${M.sheetRadius}px ${M.sheetRadius}px 0 0`,
          display: "grid",
          gridTemplateRows: "auto 1fr",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 20px 12px" }}>
          <div style={{ width: 44, height: 4, borderRadius: 999, background: M.cardBorder, margin: "0 auto 14px" }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.5px", color: M.ink }}>{title}</div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: M.faint, marginTop: 2 }}>{subtitle}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "#eef5f4",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={M.muted} strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          style={{
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: "6px 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
            display: "flex",
            flexDirection: "column",
            gap: 13,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SheetAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="mob-press"
      disabled={disabled}
      onClick={onPress}
      style={{
        marginTop: 4,
        width: "100%",
        padding: 15,
        borderRadius: 999,
        border: "none",
        background: M.teal,
        color: "#fff",
        fontSize: 14.5,
        fontWeight: 700,
        cursor: "pointer",
        opacity: disabled ? 0.5 : 1,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {label}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="mob-press"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "12px 10px",
        borderRadius: M.fieldRadius,
        border: `1px solid ${checked ? M.teal : M.cardBorder}`,
        background: checked ? M.tealTint : "#f7fbfa",
        color: checked ? M.tealDeep : M.muted,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 5,
          border: `1.5px solid ${checked ? M.teal : "#c4d6d4"}`,
          background: checked ? M.teal : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}
