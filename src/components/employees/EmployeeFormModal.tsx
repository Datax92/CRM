"use client";

/**
 * New Employee / Edit Employee, built to the modal in
 * `Employee Directory.dc.html`.
 *
 * One component for both, because the two forms hold the same fields — a
 * separate edit dialog is how the create and edit paths drift apart until one
 * of them silently stops writing a column.
 *
 * **Three fields the design does not draw**, added in its own idiom because the
 * feature does not work without them:
 *
 * - **Temporary password.** Firebase Auth cannot create a user without one.
 *   Required when creating, optional when editing (blank keeps the current).
 * - **Lane priority.** 1–10, the position in the distribution lane (BR-6).
 * - **Monthly KPI targets.** Connects / registrations / meetings — the
 *   denominators behind every percentage on the Day End Report.
 *
 * The design's "Monthly Target (PKR)" is `targets.revenue`, and its "Lead
 * Assignment" select is `autoAssign` (see `lib/distribution`).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createEmployee,
  updateEmployee,
  disableEmployee,
  enableEmployee,
} from "@/lib/clientActions";
import { JOB_TITLES, DEFAULT_JOB_TITLE } from "@/lib/constants/roles";
import { useSubAdmins } from "@/hooks/useEmployees";
import { MAX_PRIORITY } from "@/lib/constants/distribution";
import { DEFAULT_KPI_TARGETS, KPI_METRICS, KPI_METRIC_LABELS, type KpiTargets } from "@/lib/kpi";
import type { EmployeeMetrics } from "@/lib/metrics";
import { E } from "./directoryChrome";

const FIELD: React.CSSProperties = {
  border: `1px solid ${E.border}`,
  background: E.field,
  borderRadius: 10,
  padding: "11px 13px",
  fontSize: 13.5,
  fontWeight: 500,
  color: "#22302f",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
};

const LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: E.muted,
  minWidth: 0,
};

const SECTION: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "1.2px",
  textTransform: "uppercase",
  color: E.tealInk,
  marginBottom: 14,
};

/** Readable, unambiguous characters only — this gets read aloud or copied by hand. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

/** `YYYY-MM-DD` for a date input, from a Firestore timestamp. */
function dateInputValue(value: { toDate?: () => Date } | null | undefined): string {
  const date = typeof value?.toDate === "function" ? value.toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

export function EmployeeFormModal({
  employee,
  getIdToken,
  onClose,
  onSaved,
}: {
  /** Absent creates; present edits that employee. */
  employee?: EmployeeMetrics | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(employee);

  const [name, setName] = useState(employee?.name ?? "");
  const [email, setEmail] = useState(employee?.email ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [joinedAt, setJoinedAt] = useState(dateInputValue(employee?.joinedAt ?? employee?.createdAt));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [jobTitle, setJobTitle] = useState<string>(employee?.jobTitle ?? DEFAULT_JOB_TITLE);
  const [subAdminUid, setSubAdminUid] = useState<string>(employee?.subAdminUid ?? "");
  const { subAdmins } = useSubAdmins();
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(employee?.status ?? "ACTIVE");
  const [priority, setPriority] = useState(employee?.priority ?? MAX_PRIORITY);
  const [autoAssign, setAutoAssign] = useState(employee?.autoAssign !== false);
  const [notes, setNotes] = useState(employee?.notes ?? "");
  const [targets, setTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS, ...employee?.targets });
  // The base for a percentage late deduction (§5) and the payroll figures
  // in the Money hub (§12). Zero means "not recorded", and a percentage
  // rule then charges nothing rather than guessing.
  const [monthlySalary, setMonthlySalary] = useState(employee?.monthlySalary ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

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
    if (error) errorRef.current?.focus();
  }, [error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (name.trim().length < 2) return setError("Enter the employee's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!editing && password.length < 8) return setError("The password must be at least 8 characters.");
    if (editing && password && password.length < 8)
      return setError("The new password must be at least 8 characters, or leave it blank.");

    setBusy(true);
    try {
      const token = await getIdToken();

      if (!editing) {
        const res = await createEmployee(token, {
          name: name.trim(),
          email: email.trim(),
          password,
          priority,
          jobTitle,
          subAdminUid: subAdminUid || null,
          status,
          targets,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          joinedAt: joinedAt || null,
          autoAssign,
          monthlySalary,
        });
        if (res.ok) onSaved(`${name.trim()} added to the directory.`);
        else setError(res.error || "Could not create the account.");
        return;
      }

      const current = employee!;
      const res = await updateEmployee(token, current.uid, {
        name: name.trim() !== current.name ? name.trim() : undefined,
        email: email.trim() !== current.email ? email.trim() : undefined,
        password: password || undefined,
        priority: priority !== current.priority ? priority : undefined,
        jobTitle: jobTitle !== current.jobTitle ? jobTitle : undefined,
        // Sent only when it actually changed, so an unrelated edit cannot
        // silently detach somebody from their team.
        subAdminUid:
          (subAdminUid || null) !== (current.subAdminUid ?? null) ? subAdminUid || null : undefined,
        targets,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        joinedAt: joinedAt || null,
        autoAssign,
        monthlySalary,
      });
      if (!res.ok) {
        setError(res.error || "Could not update the employee.");
        return;
      }

      // Status is a separate action because disabling has a consequence the
      // update path does not: it reports how many open leads the employee was
      // still holding.
      if (status !== current.status) {
        const change =
          status === "DISABLED"
            ? await disableEmployee(token, current.uid)
            : await enableEmployee(token, current.uid);
        if (!change.ok) {
          setError(change.error || "Saved, but the status could not be changed.");
          return;
        }
        const open = status === "DISABLED" ? (change as { data?: { openLeads: number } }).data?.openLeads ?? 0 : 0;
        onSaved(
          status === "DISABLED"
            ? `${name.trim()} paused${open > 0 ? ` — ${open} open lead${open === 1 ? "" : "s"} still assigned.` : "."}`
            : `${name.trim()} is back in the lane.`
        );
        return;
      }

      onSaved(`${name.trim()} updated.`);
    } catch {
      setError("A network error occurred. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        fontFamily: E.font,
        letterSpacing: E.tracking,
      }}
    >
      <div
        className="animate-modal-fade"
        style={{ position: "fixed", inset: 0, background: "rgba(24,52,50,0.4)" }}
        onClick={() => !busy && onClose()}
        aria-hidden
      />

      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit employee" : "New employee"}
        className="animate-modal-pop"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 680,
          maxHeight: "100%",
          background: E.surface,
          borderRadius: 20,
          boxShadow: "0 30px 80px rgba(18,54,52,0.3)",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
        }}
      >
        {/* ---- header ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "20px 26px",
            background: E.teal,
            color: "#fff",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              background: "rgba(255,255,255,0.2)",
              border: "1.5px solid rgba(255,255,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-hidden
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="10" cy="8" r="3.4" />
              <path d="M3.5 20c0-3.3 2.9-5 6.5-5 1.2 0 2.3.2 3.2.5M18 14v6M15 17h6" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.5px" }}>
              {editing ? "Edit Employee" : "New Employee"}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.86, marginTop: 2 }}>
              {editing
                ? "Changes take effect the moment you save."
                : "Add a team member and start attributing leads to them."}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* ---- body ---- */}
        <div className="teal-scrollbar" style={{ minHeight: 0, overflowY: "auto", padding: "22px 26px 26px" }}>
          {error && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                border: "1px solid #f0c4bd",
                background: E.redBg,
                borderRadius: 10,
                padding: "11px 14px",
                fontSize: 13,
                fontWeight: 500,
                color: "#a33a29",
                marginBottom: 18,
                outline: "none",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginTop: 1, flexShrink: 0 }} aria-hidden>
                <path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div style={SECTION}>Identity</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
            <label style={LABEL}>
              <span>
                Full Name <Required />
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ali Raza"
                autoComplete="name"
                disabled={busy}
                style={FIELD}
              />
            </label>
            <label style={LABEL}>
              <span>
                Email Address <Required />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. ali@example.com"
                autoComplete="off"
                disabled={busy}
                style={FIELD}
              />
            </label>
            <label style={LABEL}>
              <span>Phone Number</span>
              <input
                value={phone ?? ""}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0300 1234567"
                autoComplete="tel"
                disabled={busy}
                style={FIELD}
              />
            </label>
            <label style={LABEL}>
              <span>Date Joined</span>
              <input
                type="date"
                value={joinedAt}
                onChange={(e) => setJoinedAt(e.target.value)}
                disabled={busy}
                style={{ ...FIELD, padding: "10px 13px" }}
              />
            </label>
          </div>

          <div style={{ height: 1, background: E.softBorder, margin: "22px 0" }} />

          <div style={SECTION}>Role &amp; Access</div>

          {/* This form makes employees only. A manager is a different kind of
              record — no lane priority, no KPI targets, no leads — and has its
              own form in the Managers panel, so there is no access-level
              dropdown here to get wrong. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "14px 18px", marginBottom: 14 }}>
            <label style={LABEL}>
              <span>Reports To</span>
              <select
                value={subAdminUid}
                onChange={(e) => setSubAdminUid(e.target.value)}
                disabled={busy}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                <option value="">Admin (directly)</option>
                {subAdmins.map((person) => (
                  <option key={person.uid} value={person.uid}>
                    {person.name}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: E.faint }}>
                Their manager sees their leads, follow-ups and deals, and their numbers count toward
                that manager&rsquo;s totals.
              </span>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
            <label style={LABEL}>
              <span>Job Title</span>
              <select
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                disabled={busy}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                {JOB_TITLES.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            </label>

            <label style={LABEL}>
              {/* The base for a percentage late deduction and the payroll
                  figures. Distinct from the target below it: one is what they
                  are paid, the other is what they are asked to bring in. */}
              <span>Monthly Salary (PKR)</span>
              <input
                type="number"
                min={0}
                max={1000000000}
                value={monthlySalary}
                onChange={(e) => setMonthlySalary(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
                disabled={busy}
                style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
              />
            </label>

            <label style={LABEL}>
              <span>Monthly Target (PKR)</span>
              <input
                type="number"
                min={0}
                max={1000000000}
                value={targets.revenue}
                onChange={(e) =>
                  setTargets((prev) => ({ ...prev, revenue: Math.max(0, Number(e.target.value) || 0) }))
                }
                placeholder="0"
                disabled={busy}
                style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }}
              />
            </label>

            <div style={{ ...LABEL, gap: 7 }}>
              <span>Status</span>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }} role="radiogroup" aria-label="Status">
                {(["ACTIVE", "DISABLED"] as const).map((value) => {
                  const selected = status === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setStatus(value)}
                      disabled={busy}
                      style={{
                        padding: "10px 20px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        border: `1px solid ${selected ? E.teal : E.border}`,
                        background: selected ? E.teal : E.field,
                        color: selected ? "#fff" : E.muted,
                        transition: "background-color 160ms ease, color 160ms ease",
                      }}
                    >
                      {value === "ACTIVE" ? "Active" : "Inactive"}
                    </button>
                  );
                })}
              </div>
            </div>

            <label style={LABEL}>
              <span>Lead Assignment</span>
              <select
                value={autoAssign ? "auto" : "manual"}
                onChange={(e) => setAutoAssign(e.target.value === "auto")}
                disabled={busy}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                <option value="auto">Include in round-robin</option>
                <option value="manual">Manual assignment only</option>
              </select>
            </label>

            {/* Not in the design file — Firebase Auth cannot create a user
                without a password, and the lane needs a position. Both are
                drawn in the design's own field idiom. */}
            <div style={{ ...LABEL, gap: 6 }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {editing ? "New Password" : "Temporary Password"} {editing ? null : <Required />}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                  disabled={busy}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: E.tealInk,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  Generate
                </button>
              </span>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? "Leave blank to keep current" : "At least 8 characters"}
                  autoComplete="new-password"
                  disabled={busy}
                  style={{ ...FIELD, paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    right: 0,
                    width: 42,
                    border: "none",
                    background: "transparent",
                    color: E.label,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                    {!showPassword && <path d="m3 3 18 18" />}
                  </svg>
                </button>
              </div>
            </div>

            <label style={LABEL}>
              <span>Lane Priority (1 = first in line)</span>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                disabled={busy}
                style={{ ...FIELD, cursor: "pointer" }}
              >
                {Array.from({ length: MAX_PRIORITY }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Priority {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {editing && employee?.autoPriority === false && (
            <p style={{ fontSize: 11.5, fontWeight: 500, color: E.faint, marginTop: 10 }}>
              This priority was set by hand — automatic recalculation will not move it.
            </p>
          )}

          {/* Monthly KPI targets — the denominator of every percentage on the
              Day End Report. Changing one changes what "100%" means for this
              employee, and therefore where they rank in the lane. */}
          <div
            style={{
              marginTop: 16,
              border: `1px solid ${E.border}`,
              background: E.field,
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div style={{ ...SECTION, marginBottom: 12 }}>Monthly KPI Targets</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
              {KPI_METRICS.map((metric) => (
                <label key={metric} style={LABEL}>
                  <span>{KPI_METRIC_LABELS[metric]}</span>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={targets[metric]}
                    onChange={(e) =>
                      setTargets((prev) => ({ ...prev, [metric]: Math.max(1, Number(e.target.value) || 1) }))
                    }
                    disabled={busy}
                    style={{ ...FIELD, background: E.surface, fontVariantNumeric: "tabular-nums" }}
                  />
                </label>
              ))}
            </div>
            <p style={{ fontSize: 11.5, fontWeight: 500, color: E.faint, marginTop: 10 }}>
              Year-to-date targets are these figures multiplied by the months elapsed.
            </p>
          </div>

          <label style={{ ...LABEL, marginTop: 16 }}>
            <span>Notes</span>
            <textarea
              rows={3}
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Territory, reporting line, anything worth recording"
              disabled={busy}
              style={{ ...FIELD, resize: "vertical" }}
            />
          </label>
        </div>

        {/* ---- footer ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 11,
            padding: "16px 26px",
            background: E.field,
            borderTop: `1px solid ${E.softBorder}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "11px 22px",
              borderRadius: 10,
              border: "1px solid #d6e5e3",
              background: E.surface,
              color: E.muted,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "12px 22px",
              borderRadius: 10,
              border: "none",
              background: E.teal,
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 700,
              cursor: busy ? "progress" : "pointer",
              opacity: busy ? 0.65 : 1,
              fontFamily: "inherit",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{busy ? "Saving…" : editing ? "Save Changes" : "Add to Directory"}</span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function Required() {
  return (
    <span style={{ color: "#e05a4a" }} aria-hidden>
      *
    </span>
  );
}
