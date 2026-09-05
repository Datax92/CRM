"use client";

/**
 * "Add Lead Manually" — the teal redesign of the historical import form that
 * used to live at /admin/leads/new.
 *
 * Every validation rule and the exact `createLead` payload from that page are
 * preserved, including deal-at-creation. The design only shows Client /
 * Pipeline / History, so the settlement block is a fourth section that unfolds
 * when the chosen status is Closed / Won — which is the only time the old page
 * required it. Nothing the import form could do was dropped.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createLead } from "@/lib/clientActions";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { PAYMENT_METHODS } from "@/lib/constants";
import { DEAL_CATEGORIES, DEFAULT_DEAL_CATEGORY } from "@/lib/constants/deals";
import type { EmployeeData } from "@/hooks/useEmployees";
import { UserPlus, X, User, Workflow, Clock, Plus, Sparkles, AlertTriangle, DollarSign } from "lucide-react";

type NoteRow = {
  /** Stable identity so removing a row doesn't remount its siblings. */
  key: number;
  message: string;
  channel: string;
  occurredAt: string;
};

/** Channels offered per note. Only "Phone Call" sets `callMade`. */
const NOTE_CHANNELS = ["Phone Call", "WhatsApp", "Email", "Meeting"];

const INPUT_CLASS =
  "w-full rounded-md border border-[#dceae8] bg-[#f7fbfa] px-3 py-2.5 text-[13.5px] text-[#2b3a39] outline-none transition-colors placeholder:text-[#9aacaa] focus:border-[#4f9c99] focus:bg-white focus:ring-2 focus:ring-[#4f9c99]/15";

const FIELD_LABEL_CLASS = "flex flex-col gap-1.5 text-xs text-[#5b6d6b]";

/** `datetime-local` wants local wall-clock time with no zone suffix. */
function nowLocalInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function AddLeadModal({
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

  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(1);
  const errorRef = useRef<HTMLDivElement>(null);

  const activeEmployees = useMemo(() => employees.filter((e) => e.status === "ACTIVE"), [employees]);
  const isWonAtCreation = status === "CLOSED_WON";

  // Lock background scroll and wire Escape, matching every other modal here.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Move focus to the error so a screen reader announces why submit failed.
  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  const addNote = () =>
    setNotes((rows) => [
      ...rows,
      { key: nextKey.current++, message: "", channel: NOTE_CHANNELS[0], occurredAt: "" },
    ]);

  const updateNote = (key: number, patch: Partial<NoteRow>) =>
    setNotes((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const removeNote = (key: number) => setNotes((rows) => rows.filter((row) => row.key !== key));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation mirrors the retired import form rule for rule.
    if (!name.trim() || name.trim().length < 2) {
      setFormError("Full Name is required (minimum 2 characters).");
      return;
    }
    if (!/^[a-zA-Z\s.'-]+$/.test(name.trim())) {
      setFormError("Full Name should only contain letters, spaces, and basic punctuation.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("Please provide a valid email address (e.g. name@example.com).");
      return;
    }
    if (phone.trim() && !/^[\d\s+()-]{7,}$/.test(phone.trim())) {
      setFormError("Please enter a valid phone number (at least 7 digits).");
      return;
    }
    if (createdAt && new Date(createdAt).getTime() > Date.now()) {
      setFormError("Original Creation Date cannot be in the future.");
      return;
    }
    if (isWonAtCreation) {
      if (!dealDesc.trim()) {
        setFormError("Service Description is required for Closed Won deals.");
        return;
      }
      if (dealReceived === "" || isNaN(Number(dealReceived)) || Number(dealReceived) < 0) {
        setFormError("Please enter a valid received amount (number >= 0).");
        return;
      }
      if (dealPayable !== "" && (isNaN(Number(dealPayable)) || Number(dealPayable) < 0)) {
        setFormError("Payable amount must be a valid positive number.");
        return;
      }
    }
    for (let i = 0; i < notes.length; i++) {
      if (!notes[i].message.trim()) {
        setFormError(`Note #${i + 1} message cannot be blank.`);
        return;
      }
      if (!notes[i].occurredAt) {
        setFormError(`Note #${i + 1} date is required.`);
        return;
      }
    }

    setBusy(true);
    try {
      const token = await getIdToken();
      const matchedCampaign = campaigns.find((c) => c.id === campaignId);

      const result = await createLead(token, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        status,
        assignedUserId: assignee || null,
        campaignId: campaignId || null,
        campaignName: matchedCampaign?.name || null,
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
              // This form is kept complete and unused (see CLAUDE.md); the two
              // money fields map onto the four-field model as price and
              // adjustment, which is exactly what the mirrors mean.
              totalPrice: Number(dealReceived) || 0,
              downPayment: Number(dealReceived) || 0,
              adjustment: Number(dealPayable) || 0,
              paymentMethod: dealMethod,
              dealCategory,
              dealDate: dealDate || new Date().toISOString().slice(0, 10),
              notes: dealNotes.trim() || undefined,
            }
          : undefined,
      });

      if (result.ok) {
        onCreated(`${name.trim()} added to the pipeline.`);
      } else {
        setFormError(result.error || "Failed to create lead.");
      }
    } catch {
      setFormError("A network error occurred while creating the lead.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-modal-fade fixed inset-0 bg-[#1e3a38]/45" onClick={onClose} aria-hidden />

      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Add lead manually"
        className="animate-modal-pop relative z-10 grid max-h-full w-full max-w-[760px] grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl bg-[#fbfdfd] shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 bg-[#4f9c99] px-6 py-4 text-white">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-white/55 bg-white/20">
            <UserPlus size={20} />
          </div>
          <div className="min-w-0 flex-1">
            {/* Explicit white: @layer base sets a colour on every heading, which
                beats the one inherited from this teal header. */}
            <h2 className="text-lg font-medium text-white">Add Lead Manually</h2>
            <p className="mt-0.5 text-[12.5px] text-white/90">
              Backfill a past lead into the pipeline with its history intact.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — the only scrolling region */}
        <div className="teal-scrollbar min-h-0 overflow-y-auto px-6 py-5">
          {formError && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-[#f0c4bd] bg-[#fdeeeb] px-3.5 py-3 text-xs text-[#a33a29] outline-none"
            >
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Client ------------------------------------------------------ */}
          <SectionHeading icon={<User size={17} />} title="Client" />
          <div className="grid gap-x-4.5 gap-y-3.5 sm:grid-cols-2">
            <label className={FIELD_LABEL_CLASS}>
              <span>
                Full Name <span className="text-[#e05a4a]">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ali Raza"
                autoComplete="name"
                className={INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Phone Number</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0300 1234567"
                autoComplete="tel"
                className={INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Email Address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. ali@example.com"
                autoComplete="email"
                className={INPUT_CLASS}
              />
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>City / Location</span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Lahore, Islamabad"
                className={INPUT_CLASS}
              />
            </label>
            <label className={`${FIELD_LABEL_CLASS} sm:col-span-2`}>
              <span>
                Original Creation Date <span className="text-[#9aacaa]">(leave blank to use current time)</span>
              </span>
              <input
                type="datetime-local"
                value={createdAt}
                max={nowLocalInputValue()}
                onChange={(e) => setCreatedAt(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <Divider />

          {/* Pipeline ---------------------------------------------------- */}
          <SectionHeading icon={<Workflow size={17} />} title="Pipeline" />
          <div className="grid gap-x-4.5 gap-y-3.5 sm:grid-cols-2">
            <label className={FIELD_LABEL_CLASS}>
              <span>Lead Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                {(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {LEAD_STATUS_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD_LABEL_CLASS}>
              <span>Assign To Team Member</span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                <option value="">(Unassigned)</option>
                {activeEmployees.map((emp) => (
                  <option key={emp.uid} value={emp.uid}>
                    {emp.name} — priority {emp.priority}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${FIELD_LABEL_CLASS} sm:col-span-2`}>
              <span>Associated Marketing Campaign</span>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className={`${INPUT_CLASS} cursor-pointer`}
              >
                <option value="">(No Campaign / Direct)</option>
                {campaigns.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Settlement — only when the lead is being backfilled as won. */}
          {isWonAtCreation && (
            <>
              <Divider />
              <SectionHeading
                icon={<DollarSign size={17} />}
                title="Confirmed Deal"
                subtitle="This lead is being recorded as won, so its settlement figures are required."
              />
              <div className="grid gap-x-4.5 gap-y-3.5 sm:grid-cols-2">
                <label className={`${FIELD_LABEL_CLASS} sm:col-span-2`}>
                  <span>
                    Service Description <span className="text-[#e05a4a]">*</span>
                  </span>
                  <input
                    value={dealDesc}
                    onChange={(e) => setDealDesc(e.target.value)}
                    placeholder="What was sold — package, unit, service scope"
                    className={INPUT_CLASS}
                  />
                </label>
                <label className={FIELD_LABEL_CLASS}>
                  <span>
                    Amount Received (PKR) <span className="text-[#e05a4a]">*</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={dealReceived}
                    onChange={(e) => setDealReceived(e.target.value)}
                    placeholder="0"
                    className={`${INPUT_CLASS} tabular-nums`}
                  />
                </label>
                <label className={FIELD_LABEL_CLASS}>
                  <span>Payable Amount (PKR)</span>
                  <input
                    type="number"
                    min="0"
                    value={dealPayable}
                    onChange={(e) => setDealPayable(e.target.value)}
                    placeholder="0"
                    className={`${INPUT_CLASS} tabular-nums`}
                  />
                </label>
                <label className={FIELD_LABEL_CLASS}>
                  <span>Payment Method</span>
                  <select
                    value={dealMethod}
                    onChange={(e) => setDealMethod(e.target.value)}
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
                <label className={`${FIELD_LABEL_CLASS} sm:col-span-2`}>
                  <span>Deal Notes</span>
                  <textarea
                    rows={2}
                    value={dealNotes}
                    onChange={(e) => setDealNotes(e.target.value)}
                    placeholder="Optional context about the settlement"
                    className={`${INPUT_CLASS} resize-y`}
                  />
                </label>
              </div>
            </>
          )}

          <Divider />

          {/* History ----------------------------------------------------- */}
          <div className="mb-3.5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-[#4f9c99]">
                  <Clock size={17} />
                </span>
                <span className="text-[15px] font-medium text-[#2b3a39]">History</span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-[#7e918f]">
                Record of prior calls or notes, backdated with the lead.
              </p>
            </div>
            <button
              type="button"
              onClick={addNote}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#e8f5f3] px-4 py-2 text-[12.5px] text-[#2f7d78] transition-colors hover:bg-[#daeeeb]"
            >
              <Plus size={13} />
              <span>Add Note</span>
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {notes.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#cfe2e0] px-4 py-4.5 text-center text-[12.5px] text-[#9aacaa]">
                No prior history — add a note to backdate one.
              </p>
            ) : (
              notes.map((row, index) => (
                <div key={row.key} className="rounded-lg border border-[#dceae8] bg-[#f7fbfa] px-3.5 py-3">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[#7e918f]">Touch #{index + 1}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={row.channel}
                        onChange={(e) => updateNote(row.key, { channel: e.target.value })}
                        aria-label={`Channel for note ${index + 1}`}
                        className="cursor-pointer rounded border border-[#dceae8] bg-white px-2 py-1 text-xs text-[#5b6d6b] outline-none focus:border-[#4f9c99]"
                      >
                        {NOTE_CHANNELS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={row.occurredAt}
                        onChange={(e) => updateNote(row.key, { occurredAt: e.target.value })}
                        aria-label={`Date for note ${index + 1}`}
                        className="rounded border border-[#dceae8] bg-white px-2 py-1 text-xs text-[#5b6d6b] outline-none focus:border-[#4f9c99]"
                      />
                      <button
                        type="button"
                        onClick={() => removeNote(row.key)}
                        aria-label={`Remove note ${index + 1}`}
                        className="flex h-7 w-7 items-center justify-center rounded text-[#9aacaa] transition-colors hover:bg-[#e9f1f0] hover:text-[#e05a4a]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={row.message}
                    onChange={(e) => updateNote(row.key, { message: e.target.value })}
                    placeholder="What was discussed…"
                    aria-label={`Message for note ${index + 1}`}
                    className="w-full resize-y rounded-md border border-[#dceae8] bg-white px-3 py-2 text-[13px] text-[#2b3a39] outline-none transition-colors placeholder:text-[#9aacaa] focus:border-[#4f9c99] focus:ring-2 focus:ring-[#4f9c99]/15"
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-[#dceae8] bg-[#eef6f5] px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#cfe2e0] bg-white px-5 py-2.5 text-[13.5px] text-[#5b6d6b] transition-colors hover:bg-[#f3faf9]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-[#3f8f8a] px-6 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[#2f7d78] disabled:opacity-50"
          >
            <Sparkles size={15} />
            <span>{busy ? "Adding…" : "Add Lead to Pipeline"}</span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function SectionHeading({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[#4f9c99]">{icon}</span>
        <span className="text-[15px] font-medium text-[#2b3a39]">{title}</span>
      </div>
      {subtitle && <p className="mt-0.5 text-[12.5px] text-[#7e918f]">{subtitle}</p>}
    </div>
  );
}

function Divider() {
  return <div className="my-5.5 h-px bg-[#e6f1f0]" />;
}
