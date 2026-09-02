"use client";

/**
 * The Add Lead bottom sheet, built to the `addOpen` overlay in
 * `Active Leads Mobile.dc.html` — the 28px top corners, the 44×4 grabber, the
 * close disc, the field stack and the full-width pill action.
 *
 * The mockup collects four fields and a note. **This collects everything the
 * desktop `AddLeadModal` does**, because a lead typed on a phone must be the
 * same record as one typed on a laptop:
 *
 * - client details (name, phone, email, city)
 * - the original creation date and time, so a historical lead can be backfilled
 * - the full pipeline status list, not a shortlist of three
 * - assignee and campaign
 * - the settlement block, which unfolds when the status is Closed / Won
 * - any number of backdated history notes, each with its own channel and date
 *
 * Validation mirrors the desktop's rules **rule for rule**, and the same
 * `createLead` payload is sent, so the two surfaces cannot accept different
 * records.
 */

import { useMemo, useRef, useState } from "react";
import { createLead, PAYMENT_METHODS } from "@/lib/clientActions";
import { DEAL_CATEGORIES, DEFAULT_DEAL_CATEGORY } from "@/lib/constants/deals";
import type { EmployeeData } from "@/hooks/useEmployees";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { M } from "./mobileChrome";
import { Sheet, SheetAction } from "./MobileLeadDetail";

/** Channels offered per note. Only "Phone Call" sets `callMade`. */
const NOTE_CHANNELS = ["Phone Call", "WhatsApp", "Email", "Meeting"];

type NoteRow = {
  /** Stable identity, so removing a row does not remount its siblings. */
  key: number;
  message: string;
  channel: string;
  occurredAt: string;
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
  fontFamily: "inherit",
  WebkitAppearance: "none",
};

/** `datetime-local` wants local wall-clock time with no zone suffix. */
function nowLocalInputValue(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function MobileAddLead({
  employees,
  campaigns,
  getIdToken,
  onClose,
  onCreated,
}: {
  employees: EmployeeData[];
  campaigns: Array<{ id: string; name: string }>;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [status, setStatus] = useState<LeadStatus>("NEW");
  const [assignee, setAssignee] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const [dealDesc, setDealDesc] = useState("");
  const [dealReceived, setDealReceived] = useState("");
  const [dealPayable, setDealPayable] = useState("");
  const [dealMethod, setDealMethod] = useState<string>(PAYMENT_METHODS[0] ?? "Cash");
  const [dealDate, setDealDate] = useState("");
  const [dealCategory, setDealCategory] = useState<string>(DEFAULT_DEAL_CATEGORY);
  const [dealNotes, setDealNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === "ACTIVE"), [employees]);
  const isWonAtCreation = status === "CLOSED_WON";

  const addNote = () =>
    setNotes((rows) => [
      ...rows,
      { key: nextKey.current++, message: "", channel: NOTE_CHANNELS[0], occurredAt: "" },
    ]);
  const updateNote = (key: number, patch: Partial<NoteRow>) =>
    setNotes((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const removeNote = (key: number) => setNotes((rows) => rows.filter((row) => row.key !== key));

  /** The desktop's rules, in the desktop's order, so the messages match too. */
  const validate = (): string | null => {
    if (!name.trim() || name.trim().length < 2) return "Full Name is required (minimum 2 characters).";
    if (!/^[a-zA-Z\s.'-]+$/.test(name.trim()))
      return "Full Name should only contain letters, spaces, and basic punctuation.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return "Please provide a valid email address (e.g. name@example.com).";
    if (phone.trim() && !/^[\d\s+()-]{7,}$/.test(phone.trim()))
      return "Please enter a valid phone number (at least 7 digits).";
    if (createdAt && new Date(createdAt).getTime() > Date.now())
      return "Original Creation Date cannot be in the future.";
    if (isWonAtCreation) {
      if (!dealDesc.trim()) return "Service Description is required for Closed Won deals.";
      if (dealReceived === "" || Number.isNaN(Number(dealReceived)) || Number(dealReceived) < 0)
        return "Please enter a valid received amount (number >= 0).";
      if (dealPayable !== "" && (Number.isNaN(Number(dealPayable)) || Number(dealPayable) < 0))
        return "Payable amount must be a valid positive number.";
    }
    // Picking a person is what turns a manual entry into an assignment, so the
    // two must agree — the server would reject the mismatch anyway.
    if ((status === "ASSIGNED" || status === "ACCEPTED") && !assignee)
      return "Choose who this lead goes to.";
    for (let i = 0; i < notes.length; i += 1) {
      if (!notes[i].message.trim()) return `Note #${i + 1} message cannot be blank.`;
      if (!notes[i].occurredAt) return `Note #${i + 1} date is required.`;
    }
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const matched = campaigns.find((c) => c.id === campaignId);
      const result = await createLead(await getIdToken(), {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        status,
        assignedUserId: assignee || null,
        campaignId: campaignId || null,
        campaignName: matched?.name || null,
        createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
        followUps:
          notes.length > 0
            ? notes.map((row) => ({
                message: row.message.trim(),
                callMade: row.channel === "Phone Call",
                occurredAt: new Date(row.occurredAt).toISOString(),
              }))
            : undefined,
        deal: isWonAtCreation
          ? {
              serviceDescription: dealDesc.trim(),
              amountReceived: Number(dealReceived) || 0,
              payableAmount: Number(dealPayable) || 0,
              paymentMethod: dealMethod,
              dealCategory,
              dealDate: dealDate || new Date().toISOString().slice(0, 10),
              notes: dealNotes.trim() || undefined,
            }
          : undefined,
      });

      if (result.ok) onCreated(`${name.trim()} added to the pipeline.`);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add Lead" subtitle="Manual entry into the pipeline." onClose={onClose}>
      {error && (
        <div
          role="alert"
          style={{
            borderRadius: M.fieldRadius,
            border: "1px solid #f0c4bd",
            background: "#fdeeeb",
            color: "#a33a29",
            padding: "11px 13px",
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      )}

      <SectionLabel>Client</SectionLabel>

      <label style={FIELD_LABEL}>
        <span>Full Name *</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ali Raza"
          autoComplete="name"
          style={FIELD}
        />
      </label>

      <label style={FIELD_LABEL}>
        <span>Phone Number</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 0300 1234567"
          autoComplete="tel"
          style={FIELD}
        />
      </label>

      <label style={FIELD_LABEL}>
        <span>Email</span>
        <input
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. ali@example.com"
          autoComplete="email"
          style={FIELD}
        />
      </label>

      <label style={FIELD_LABEL}>
        <span>City / Location</span>
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lahore" style={FIELD} />
      </label>

      <SectionLabel>Pipeline</SectionLabel>

      <div style={{ ...FIELD_LABEL, gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>Original Creation Date</span>
          <button
            type="button"
            onClick={() => setCreatedAt(nowLocalInputValue())}
            style={{
              border: "none",
              background: "transparent",
              color: M.tealDeep,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            Now
          </button>
        </span>
        <input
          type="datetime-local"
          value={createdAt}
          max={nowLocalInputValue()}
          onChange={(e) => setCreatedAt(e.target.value)}
          style={FIELD}
        />
        <span style={{ fontSize: 11, fontWeight: 500, color: M.fainter, lineHeight: 1.4 }}>
          {/* The split is a real business rule (BR-4), not a formatting nicety. */}
          Leave blank for a lead arriving now. A date before today files it as a historical
          backfill, so no 5-minute clock is put on a months-old record.
        </span>
      </div>

      <label style={FIELD_LABEL}>
        <span>Lead Status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as LeadStatus)}
          style={{ ...FIELD, cursor: "pointer" }}
        >
          {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((key) => (
            <option key={key} value={key}>
              {LEAD_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <label style={FIELD_LABEL}>
        <span>Assign to{status === "ASSIGNED" || status === "ACCEPTED" ? " *" : " (optional)"}</span>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ ...FIELD, cursor: "pointer" }}>
          <option value="">
            {status === "NEW" ? "Leave for auto-distribution" : "(Unassigned)"}
          </option>
          {activeEmployees.map((employee) => (
            <option key={employee.uid} value={employee.uid}>
              {employee.name} · P{employee.priority}
            </option>
          ))}
        </select>
      </label>

      <label style={FIELD_LABEL}>
        <span>Campaign</span>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={{ ...FIELD, cursor: "pointer" }}
        >
          <option value="">(No Campaign / Direct)</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </label>

      {/* Settlement — only when the lead is being backfilled as won. */}
      {isWonAtCreation && (
        <>
          <SectionLabel>Confirmed Deal</SectionLabel>
          <span style={{ fontSize: 11, fontWeight: 500, color: M.fainter, marginTop: -6, lineHeight: 1.4 }}>
            This lead is being recorded as won, so its settlement figures are required.
          </span>

          <label style={FIELD_LABEL}>
            <span>Service Description *</span>
            <input
              value={dealDesc}
              onChange={(e) => setDealDesc(e.target.value)}
              placeholder="What was sold — package, unit, service scope"
              style={FIELD}
            />
          </label>

          <label style={FIELD_LABEL}>
            <span>Amount Received (PKR) *</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={dealReceived}
              onChange={(e) => setDealReceived(e.target.value)}
              placeholder="0"
              style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
            />
          </label>

          <label style={FIELD_LABEL}>
            <span>Payable Amount (PKR)</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={dealPayable}
              onChange={(e) => setDealPayable(e.target.value)}
              placeholder="0"
              style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
            />
          </label>

          <label style={FIELD_LABEL}>
            <span>Payment Method</span>
            <select
              value={dealMethod}
              onChange={(e) => setDealMethod(e.target.value)}
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
            <span>Settlement Date</span>
            <input type="date" value={dealDate} onChange={(e) => setDealDate(e.target.value)} style={FIELD} />
          </label>

          <label style={FIELD_LABEL}>
            <span>Portfolio Category</span>
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
            <span>Deal Notes</span>
            <textarea
              rows={2}
              value={dealNotes}
              onChange={(e) => setDealNotes(e.target.value)}
              placeholder="Optional context about the settlement"
              style={{ ...FIELD, fontWeight: 500, resize: "none" }}
            />
          </label>
        </>
      )}

      {/* History — backdated with the lead. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
        <SectionLabel inline>History</SectionLabel>
        <button
          type="button"
          onClick={addNote}
          className="mob-press"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            borderRadius: 999,
            background: M.tealTint,
            color: M.tealDeep,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Add Note</span>
        </button>
      </div>

      {notes.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${M.cardBorder}`,
            borderRadius: M.fieldRadius,
            padding: "16px 14px",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 500,
            color: M.fainter,
          }}
        >
          No prior history — add a note to backdate one.
        </div>
      ) : (
        notes.map((row, index) => (
          <div
            key={row.key}
            style={{
              border: `1px solid ${M.cardBorder}`,
              background: "#f7fbfa",
              borderRadius: M.fieldRadius,
              padding: "12px 13px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: M.faint }}>Touch #{index + 1}</span>
              <button
                type="button"
                onClick={() => removeNote(row.key)}
                aria-label={`Remove note ${index + 1}`}
                style={{
                  border: "none",
                  background: "transparent",
                  color: M.red,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                Remove
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select
                value={row.channel}
                onChange={(e) => updateNote(row.key, { channel: e.target.value })}
                aria-label={`Channel for note ${index + 1}`}
                style={{ ...FIELD, background: "#fff", padding: "11px 12px", fontSize: 12.5, cursor: "pointer" }}
              >
                {NOTE_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={row.occurredAt}
                onChange={(e) => updateNote(row.key, { occurredAt: e.target.value })}
                aria-label={`Date for note ${index + 1}`}
                style={{ ...FIELD, background: "#fff", padding: "11px 12px", fontSize: 12.5 }}
              />
            </div>

            <textarea
              rows={2}
              value={row.message}
              onChange={(e) => updateNote(row.key, { message: e.target.value })}
              placeholder="What was discussed…"
              aria-label={`Message for note ${index + 1}`}
              style={{ ...FIELD, background: "#fff", fontWeight: 500, resize: "none" }}
            />
          </div>
        ))
      )}

      <SheetAction
        label={busy ? "Adding…" : "Add Lead to Pipeline"}
        disabled={busy}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}

function SectionLabel({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "1.2px",
        textTransform: "uppercase",
        color: M.tealDeep,
        marginTop: inline ? 0 : 6,
      }}
    >
      {children}
    </span>
  );
}
