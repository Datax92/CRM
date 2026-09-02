"use client";

/**
 * Add / edit a **Manager** (Sub Admin).
 *
 * A separate form from Add Employee, because a manager is a separate kind of
 * person in this product and the employee form kept implying otherwise. What is
 * *absent* here is the point:
 *
 * | not asked for | why |
 * |---|---|
 * | Lane priority | a manager is never in the distribution lane |
 * | Monthly KPI targets | their KPI is their team's, summed (`lib/managerMetrics`) |
 * | Auto-assign | they are not offered leads at all |
 * | Job title | their job title *is* Manager |
 *
 * What it adds instead is the team — the one thing that actually defines the
 * role. Assigning it here means a manager is never created in a half state
 * where they exist but manage nobody and the admin has to remember a second
 * screen.
 *
 * Styled to match the newer forms (Data Bank folder, KYC): gradient header,
 * sectioned cards, one column on a phone and two above it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Users,
  Mail,
  Phone,
  Calendar,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  Shuffle,
  AlertTriangle,
} from "lucide-react";
import {
  createEmployee,
  updateEmployee,
  setSubAdminTeam,
  disableEmployee,
  enableEmployee,
} from "@/lib/clientActions";
import { MAX_PRIORITY } from "@/lib/constants/distribution";
import type { EmployeeMetrics } from "@/lib/metrics";

const T = {
  ink: "#1f3b39",
  muted: "#5b6d6b",
  faint: "#9aacaa",
  line: "#dceae8",
  soft: "#f2f8f7",
  surface: "#ffffff",
  ground: "#f3faf9",
  teal: "#2f7d78",
  tealSoft: "#e2f0ee",
  red: "#a33a29",
  redSoft: "#fdeeeb",
};

const FIELD: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${T.line}`,
  background: T.surface,
  padding: "10px 12px",
  fontSize: 13.5,
  color: T.ink,
  outline: "none",
};

const LABEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: T.muted,
};

/** Unambiguous alphabet — no O/0, l/1 — because this gets read aloud. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

function dateInputValue(value: { toDate?: () => Date } | null | undefined): string {
  const date = value?.toDate?.();
  return date ? date.toISOString().slice(0, 10) : "";
}

export function ManagerFormModal({
  manager,
  employees,
  getIdToken,
  onClose,
  onSaved,
}: {
  /** Absent for a new manager. */
  manager?: EmployeeMetrics | null;
  /** The whole employee roster — the tick list picks their team from it. */
  employees: EmployeeMetrics[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(manager);

  const [name, setName] = useState(manager?.name ?? "");
  const [email, setEmail] = useState(manager?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState(manager?.phone ?? "");
  const [joinedAt, setJoinedAt] = useState(dateInputValue(manager?.joinedAt ?? manager?.createdAt));
  const [notes, setNotes] = useState(manager?.notes ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "DISABLED">(manager?.status ?? "ACTIVE");
  const [team, setTeam] = useState<Set<string>>(
    () => new Set(employees.filter((e) => e.subAdminUid === manager?.uid).map((e) => e.uid))
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const sortedTeam = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );

  const toggle = (uid: string) =>
    setTeam((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (name.trim().length < 2) return setError("Enter the manager's full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!editing && password.length < 8) return setError("The password must be at least 8 characters.");
    if (editing && password && password.length < 8) {
      return setError("The new password must be at least 8 characters, or leave it blank.");
    }

    setBusy(true);
    try {
      const token = await getIdToken();
      let uid = manager?.uid;

      if (!editing) {
        const created = await createEmployee(token, {
          name: name.trim(),
          email: email.trim(),
          password,
          accessRole: "subadmin",
          // The server ignores this for a manager — they are not in the lane —
          // but the input requires a number, so it is sent at the back of it.
          priority: MAX_PRIORITY,
          status,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          joinedAt: joinedAt || null,
        });

        if (!created.ok) {
          setError(created.error || "Could not create the account.");
          return;
        }
        uid = created.data.uid;
      } else {
        const updated = await updateEmployee(token, manager!.uid, {
          name: name.trim() !== manager!.name ? name.trim() : undefined,
          email: email.trim() !== manager!.email ? email.trim() : undefined,
          password: password || undefined,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          joinedAt: joinedAt || null,
        });

        if (!updated.ok) {
          setError(updated.error || "Could not update the manager.");
          return;
        }

        // Status goes through its own action: disabling reports how much work
        // the account was still holding, which an update cannot.
        if (status !== manager!.status) {
          const change =
            status === "DISABLED"
              ? await disableEmployee(token, manager!.uid)
              : await enableEmployee(token, manager!.uid);
          if (!change.ok) {
            setError(change.error || "Saved, but the status could not be changed.");
            return;
          }
        }
      }

      // The team is set in the same submit, so a manager is never left existing
      // with nobody to manage because the admin closed the dialog too early.
      if (uid) {
        const assigned = await setSubAdminTeam(token, uid, [...team]);
        if (!assigned.ok) {
          setError(`Manager saved, but the team could not be assigned: ${assigned.error}`);
          return;
        }
      }

      onSaved(
        editing
          ? `${name.trim()} updated — ${team.size} employee${team.size === 1 ? "" : "s"} on their team.`
          : `${name.trim()} added as a manager, with ${team.size} employee${team.size === 1 ? "" : "s"}.`
      );
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing ? "Edit manager" : "Add manager"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 130,
        background: "rgba(15, 42, 40, 0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "clamp(12px, 4vw, 32px)",
        overflowY: "auto",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 640,
          background: T.ground,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(15,42,40,0.28)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            padding: "18px 22px",
            color: "#fff",
            background: "linear-gradient(135deg, #2f7d78 0%, #3f8f8a 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 42,
                height: 42,
                borderRadius: 12,
                background: "rgba(255,255,255,0.18)",
                border: "1.5px solid rgba(255,255,255,0.5)",
                flexShrink: 0,
              }}
            >
              <Users size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>
                {editing ? "Edit Manager" : "Add Manager"}
              </h2>
              <p style={{ fontSize: 12.5, opacity: 0.88 }}>
                Manages a team. Takes no leads of their own.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ color: "#fff", cursor: "pointer", flexShrink: 0 }}
          >
            <X size={18} />
          </button>
        </header>

        {error && (
          <p
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              margin: "16px 22px 0",
              borderRadius: 10,
              border: "1px solid #f0c4bd",
              background: T.redSoft,
              color: T.red,
              padding: "10px 12px",
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            {error}
          </p>
        )}

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <Section title="Account">
            <div className="mgr-grid">
              <label style={LABEL}>
                <span>Full Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder="Hina Raza"
                  style={FIELD}
                />
              </label>

              <label style={LABEL}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Mail size={12} /> Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  placeholder="hina@company.com"
                  style={FIELD}
                />
              </label>

              <label style={{ ...LABEL, gridColumn: "1 / -1" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <KeyRound size={12} />
                  {editing ? "New password (leave blank to keep the current one)" : "Password"}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      placeholder={editing ? "Unchanged" : "At least 8 characters"}
                      style={{ ...FIELD, paddingRight: 38 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: T.faint,
                        cursor: "pointer",
                      }}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPassword(generatePassword());
                      // Generated to be read aloud to the person, so it is
                      // revealed — hiding what you just generated is theatre.
                      setShowPassword(true);
                    }}
                    disabled={busy}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 10,
                      border: `1px solid ${T.line}`,
                      background: T.surface,
                      padding: "0 14px",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: T.teal,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Shuffle size={13} /> Generate
                  </button>
                </div>
              </label>
            </div>
          </Section>

          <Section title="Details">
            <div className="mgr-grid">
              <label style={LABEL}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Phone size={12} /> Phone
                </span>
                <input
                  value={phone ?? ""}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={busy}
                  placeholder="03xx xxxxxxx"
                  style={FIELD}
                />
              </label>

              <label style={LABEL}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Calendar size={12} /> Joined
                </span>
                <input
                  type="date"
                  value={joinedAt}
                  onChange={(e) => setJoinedAt(e.target.value)}
                  disabled={busy}
                  style={FIELD}
                />
              </label>

              <label style={{ ...LABEL, gridColumn: "1 / -1" }}>
                <span>Notes</span>
                <textarea
                  rows={2}
                  value={notes ?? ""}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy}
                  placeholder="Territory, reporting line, anything worth recording"
                  style={{ ...FIELD, resize: "vertical" }}
                />
              </label>

              <div style={{ ...LABEL, gridColumn: "1 / -1" }}>
                <span>Status</span>
                <div style={{ display: "flex", gap: 8 }} role="radiogroup" aria-label="Status">
                  {(["ACTIVE", "DISABLED"] as const).map((value) => {
                    const on = status === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setStatus(value)}
                        disabled={busy}
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          border: `1px solid ${on ? T.teal : T.line}`,
                          background: on ? T.tealSoft : T.surface,
                          color: on ? T.teal : T.muted,
                          padding: "9px 12px",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {value === "ACTIVE" ? "Active" : "Inactive"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Team"
            hint={`${team.size} of ${sortedTeam.length} selected · unticking returns someone to the admin`}
          >
            {sortedTeam.length === 0 ? (
              <p style={{ fontSize: 12.5, color: T.faint, padding: "4px 2px" }}>
                No employees on the roster yet. Add them first, then come back and assign a team.
              </p>
            ) : (
              <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                {sortedTeam.map((person) => {
                  const checked = team.has(person.uid);
                  const elsewhere =
                    person.subAdminUid && person.subAdminUid !== manager?.uid ? person.subAdminUid : null;

                  return (
                    <label
                      key={person.uid}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "9px 11px",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: checked ? T.tealSoft : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggle(person.uid)}
                        style={{ width: 16, height: 16, accentColor: T.teal }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, color: T.ink }}>{person.name}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: T.faint }}>
                          {person.jobTitle}
                          {/* Said before the click, not after: ticking somebody
                              moves them off another manager's team. */}
                          {elsewhere ? " · currently on another manager's team" : ""}
                        </span>
                      </span>
                      {checked && <Check size={15} style={{ color: T.teal }} />}
                    </label>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 10,
            padding: "14px 22px",
            borderTop: `1px solid ${T.line}`,
            background: T.surface,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ fontSize: 13, fontWeight: 500, color: T.muted, cursor: "pointer", padding: "9px 14px" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: T.teal,
              color: "#fff",
              borderRadius: 999,
              padding: "10px 20px",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : editing ? "Save manager" : "Add manager"}
          </button>
        </footer>

        {/* One column on a phone, two above it. A media query cannot be an
            inline style, and this is the only rule the form needs. */}
        <style>{`
          .mgr-grid { display: grid; grid-template-columns: 1fr; gap: 14px 18px; }
          @media (min-width: 560px) { .mgr-grid { grid-template-columns: 1fr 1fr; } }
        `}</style>
      </form>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "11px 16px",
          borderBottom: `1px solid ${T.soft}`,
        }}
      >
        <h3 style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: T.muted }}>
          {title}
        </h3>
        {hint && <span style={{ fontSize: 11.5, color: T.faint }}>{hint}</span>}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}
