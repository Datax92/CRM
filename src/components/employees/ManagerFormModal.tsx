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

import { useMemo, useState } from "react";
import {
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
  Wallet,
} from "lucide-react";
import {
  createEmployee,
  updateEmployee,
  setSubAdminTeam,
  disableEmployee,
  enableEmployee,
} from "@/lib/clientActions";
import { MAX_PRIORITY } from "@/lib/constants/distribution";
import {
  MANAGER_KINDS,
  MANAGER_KIND_LABELS,
  type ManagerKind,
} from "@/lib/constants/hierarchy";
import { useIsMobile } from "@/hooks/useIsMobile";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
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
  const [managerKind, setManagerKind] = useState<ManagerKind>(manager?.managerKind ?? "SALES");
  const [monthlySalary, setMonthlySalary] = useState(manager?.monthlySalary ?? 0);
  const [team, setTeam] = useState<Set<string>>(
    () => new Set(employees.filter((e) => e.subAdminUid === manager?.uid).map((e) => e.uid))
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isMobile = useIsMobile();
  // Scroll lock, Escape and — the part that matters — portalling out of the
  // page's transformed wrapper all live in `OverlayPanel`.

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

  const submit = async () => {
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
          managerKind,
          monthlySalary,
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
          managerKind,
          monthlySalary,
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
    <OverlayPanel
      title={editing ? "Edit Manager" : "Add Manager"}
      subtitle="Manages a team. Takes no leads of their own."
      icon={<Users size={19} />}
      maxWidth={660}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ fontSize: 13.5, fontWeight: 500, color: T.muted, cursor: "pointer", padding: "11px 16px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{
              flex: isMobile ? 1 : undefined,
              background: T.teal,
              color: "#fff",
              borderRadius: 999,
              padding: "12px 20px",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : editing ? "Save manager" : "Add manager"}
          </button>
        </div>
      }
    >
      {error && (
        <p
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            borderRadius: 10,
            border: "1px solid #f0c4bd",
            background: T.redSoft,
            color: T.red,
            padding: "10px 12px",
            fontSize: 12.5,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          {error}
        </p>
      )}

      <OverlayCard title="Account">
        <div style={grid(isMobile)}>
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
              {editing ? "New password (blank keeps the current one)" : "Password"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
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
                  flexShrink: 0,
                }}
              >
                <Shuffle size={13} /> Generate
              </button>
            </div>
          </label>
        </div>
      </OverlayCard>

      <OverlayCard title="What this manager runs">
        <div style={{ ...LABEL, gap: 8 }}>
          <span>Manager type</span>
          <div style={{ display: "grid", gap: 8 }} role="radiogroup" aria-label="Manager type">
            {MANAGER_KINDS.map((kind) => {
              const on = managerKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setManagerKind(kind)}
                  disabled={busy}
                  style={{
                    textAlign: "left",
                    borderRadius: 12,
                    border: `1px solid ${on ? T.teal : T.line}`,
                    background: on ? T.tealSoft : T.surface,
                    color: on ? T.teal : T.muted,
                    padding: "11px 14px",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>
                    {MANAGER_KIND_LABELS[kind]}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, marginTop: 2, opacity: 0.85 }}>
                    {kind === "HR"
                      ? "Runs attendance, leave and the attendance rules for the whole company, as well as their own sales team."
                      : "Runs their own team: their leads, their folders, their attendance and their leave."}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </OverlayCard>

      <OverlayCard title="Details">
        <div style={grid(isMobile)}>
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

          <label style={LABEL}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Wallet size={12} /> Monthly salary (PKR)
            </span>
            <input
              type="number"
              min={0}
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(Math.max(0, Number(e.target.value) || 0))}
              disabled={busy}
              placeholder="0"
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
                      padding: "11px 12px",
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
      </OverlayCard>

      <OverlayCard
        title="Team"
        hint={`${team.size} of ${sortedTeam.length} · unticking returns someone to the admin`}
      >
        {sortedTeam.length === 0 ? (
          <p style={{ fontSize: 12.5, color: T.faint }}>
            No employees on the roster yet. Add them first, then come back and assign a team.
          </p>
        ) : (
          <div
            style={{
              maxHeight: isMobile ? 300 : 240,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
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
                    padding: "11px",
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
                    style={{ width: 18, height: 18, accentColor: T.teal, flexShrink: 0 }}
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
                  {checked && <Check size={15} style={{ color: T.teal, flexShrink: 0 }} />}
                </label>
              );
            })}
          </div>
        )}
      </OverlayCard>
    </OverlayPanel>
  );
}

/** One column on a phone, two above it. */
function grid(isMobile: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
    gap: "14px 18px",
  };
}
