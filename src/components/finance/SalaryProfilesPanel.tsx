"use client";

/**
 * Salary profiles — everybody's recurring pay, in one editable list.
 *
 * A profile is what payroll draws from every month, so it is configured here
 * once rather than re-typed into each period. The two switches matter more
 * than they look: an employee whose commission is settled outside payroll, or
 * who is not subject to attendance deductions, would otherwise have to be
 * corrected by hand every single month.
 *
 * **`Basic` is the same field the attendance module uses** for percentage late
 * deductions. Saving here writes both, so the two can never disagree.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  listSalaryProfiles,
  saveSalaryProfile,
  setSalaryAccess,
} from "@/lib/clientActions";
import type { SalaryProfileRecord } from "@/app/actions/payroll";
import { computeLineTotals, type SalaryProfile } from "@/lib/payroll";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import {
  Banner,
  F,
  Field,
  FinanceCard,
  EmptyState,
  PrimaryButton,
  fieldStyle,
  rupees,
} from "./financeChrome";

/**
 * Loads every salary profile once, and keeps them.
 *
 * **Why the state is not inside the panel.** The panel unmounts whenever the
 * screen switches back to the payroll tab, so a fetch on mount meant reading
 * the whole `users` collection again on every tab click — the single biggest
 * cause of the salary screen feeling slow. The parent holds the data, the
 * fetch runs once, and `reload` is called only after a write actually changes
 * something.
 */
export function useSalaryProfiles(enabled: boolean) {
  const { getIdToken } = useAuth();
  const [profiles, setProfiles] = useState<SalaryProfileRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      // First statement is an await, so nothing sets state synchronously in
      // the effect.
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await listSalaryProfiles(token);
      if (cancelled) return;

      if (result.ok) {
        setProfiles(result.data.profiles);
        setError(null);
      } else {
        setProfiles([]);
        setError(result.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, enabled, nonce]);

  return { profiles, error, reload };
}

export function SalaryProfilesPanel({
  profiles,
  error,
  reload,
  onSaved,
  isAdmin,
}: {
  profiles: SalaryProfileRecord[] | null;
  error: string | null;
  reload: () => void;
  onSaved: (message: string) => void;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<SalaryProfileRecord | null>(null);
  const [search, setSearch] = useState("");
  // Seven columns of money at 390px is a table nobody can read. Cards carry
  // the same figures and the same Edit action.
  const isMobile = useIsMobile();

  const rows = (profiles ?? []).filter((profile) =>
    profile.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <>
      {error && <Banner ok={false}>{error}</Banner>}

      <FinanceCard
        title="Salary profiles"
        hint="What payroll draws from each month"
        action={
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search employee"
            style={{
              borderRadius: 999,
              border: `1px solid ${F.line}`,
              background: "#fff",
              color: F.ink,
              padding: "6px 13px",
              fontSize: 13,
              outline: "none",
              minWidth: 150,
            }}
          />
        }
      >
        {profiles === null ? (
          <EmptyState>Loading salary profiles.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>
            {search ? "Nobody matches that search." : "Nobody is on the roster yet."}
          </EmptyState>
        ) : isMobile ? (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((profile) => (
              <button
                key={profile.uid}
                type="button"
                onClick={() => setEditing(profile)}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${F.line}`,
                  background: F.surface,
                  padding: "12px 14px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: F.ink }}>
                      {profile.name}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: F.faint }}>
                      {profile.jobTitle ?? profile.email ?? ""}
                      {profile.role === "subadmin" ? " · Manager" : ""}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: F.ink,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rupees(profile.basic)}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 9,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
                    gap: 8,
                  }}
                >
                  {[
                    { label: "Allowances", value: rupees(profile.allowances) },
                    { label: "Bonus", value: rupees(profile.bonus + profile.otherAdditions) },
                    {
                      label: "Standing",
                      value:
                        profile.otherDeductions > 0 ? `− ${rupees(profile.otherDeductions)}` : "—",
                      tone: profile.otherDeductions > 0 ? "#a33a29" : undefined,
                    },
                  ].map((item) => (
                    <span key={item.label} style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          textTransform: "uppercase",
                          color: F.faint,
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: item.tone ?? F.muted,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {item.value}
                      </span>
                    </span>
                  ))}
                </div>

                <span style={{ marginTop: 9, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  <Tag on={profile.includeCommission} label="Commission" />
                  <Tag on={profile.applyAttendanceDeductions} label="Attendance" />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr>
                  {["Employee", "Basic", "Allowances", "Bonus", "Standing deductions", "Rules", ""].map(
                    (label, index) => (
                      <th
                        key={label || index}
                        style={{
                          textAlign: index === 0 || index >= 5 ? "left" : "right",
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.6px",
                          textTransform: "uppercase",
                          color: F.faint,
                          padding: "0 10px 8px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((profile) => (
                  <tr key={profile.uid} style={{ borderTop: `1px solid ${F.hair}` }}>
                    <td style={{ padding: "10px" }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: F.ink }}>{profile.name}</p>
                      <p style={{ fontSize: 11, color: F.faint }}>
                        {profile.jobTitle ?? profile.email ?? ""}
                        {profile.role === "subadmin" ? " · Manager" : ""}
                      </p>
                    </td>
                    <td style={cell}>{rupees(profile.basic)}</td>
                    <td style={cell}>{rupees(profile.allowances)}</td>
                    <td style={cell}>{rupees(profile.bonus + profile.otherAdditions)}</td>
                    <td style={{ ...cell, color: profile.otherDeductions > 0 ? "#a33a29" : F.faint }}>
                      {profile.otherDeductions > 0 ? `− ${rupees(profile.otherDeductions)}` : "—"}
                    </td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        <Tag on={profile.includeCommission} label="Commission" />
                        <Tag on={profile.applyAttendanceDeductions} label="Attendance" />
                      </div>
                    </td>
                    <td style={{ padding: "10px" }}>
                      <button
                        type="button"
                        onClick={() => setEditing(profile)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          borderRadius: 999,
                          border: `1px solid ${F.line}`,
                          background: F.surface,
                          color: F.muted,
                          padding: "4px 11px",
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FinanceCard>

      {editing && (
        <ProfileModal
          profile={editing}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            onSaved(message);
            reload();
          }}
        />
      )}
    </>
  );
}

function Tag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      style={{
        borderRadius: 999,
        border: `1px solid ${on ? "#bfe3d2" : F.line}`,
        background: on ? "#e4f3ec" : F.hair,
        color: on ? "#1f7a52" : F.faint,
        padding: "2px 9px",
        fontSize: 10.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {on ? label : `No ${label.toLowerCase()}`}
    </span>
  );
}

function ProfileModal({
  profile,
  isAdmin,
  onClose,
  onSaved,
}: {
  profile: SalaryProfileRecord;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { getIdToken } = useAuth();

  const [values, setValues] = useState<SalaryProfile>({
    basic: profile.basic,
    allowances: profile.allowances,
    bonus: profile.bonus,
    otherAdditions: profile.otherAdditions,
    otherDeductions: profile.otherDeductions,
    includeCommission: profile.includeCommission,
    applyAttendanceDeductions: profile.applyAttendanceDeductions,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A preview of a month with no commission and no deductions — the floor of
  // what this person is paid, which is what a profile actually decides.
  const preview = computeLineTotals({
    basic: values.basic,
    allowances: values.allowances,
    bonus: values.bonus,
    extraAdditions: values.otherAdditions,
    commission: 0,
    attendanceDeduction: 0,
    otherDeductions: values.otherDeductions,
  });

  const submit = async () => {
    setError(null);
    setBusy(true);
    const token = await getIdToken();
    const result = await saveSalaryProfile(token, profile.uid, values);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`${profile.name}'s salary profile saved.`);
  };

  const grantAccess = async (granted: boolean) => {
    setBusy(true);
    const token = await getIdToken();
    const result = await setSalaryAccess(token, profile.uid, granted);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(
      granted
        ? `${profile.name} can now see salary figures.`
        : `${profile.name}'s salary access was removed.`
    );
  };

  const numberField = (key: keyof SalaryProfile, label: string, deduction = false) => (
    <Field label={deduction ? `${label} (−)` : label}>
      <input
        type="number"
        min={0}
        value={values[key] as number}
        onChange={(event) =>
          setValues((current) => ({
            ...current,
            [key]: Math.max(0, Number(event.target.value) || 0),
          }))
        }
        disabled={busy}
        style={{
          ...fieldStyle,
          fontVariantNumeric: "tabular-nums",
          color: deduction ? "#a33a29" : F.ink,
        }}
      />
    </Field>
  );

  return (
    <OverlayPanel
      title={profile.name}
      subtitle="Salary profile"
      maxWidth={640}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: F.muted }}>
            Base month {rupees(preview.net)}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton onClick={onClose} tone="quiet">
              Cancel
            </PrimaryButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Monthly pay" hint="Basic is shared with attendance deductions">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            {numberField("basic", "Basic salary")}
            {numberField("allowances", "Fixed allowances")}
            {numberField("bonus", "Recurring bonus")}
            {numberField("otherAdditions", "Other additions")}
            {numberField("otherDeductions", "Standing deduction", true)}
          </div>
        </OverlayCard>

        <OverlayCard title="What payroll pulls in each month">
          <div style={{ display: "grid", gap: 10 }}>
            <Switch
              on={values.includeCommission}
              disabled={busy}
              onChange={(on) => setValues((current) => ({ ...current, includeCommission: on }))}
              title="Pay deal commission through payroll"
              detail="Their share of finalised deal splits is added to the month it was approved in. Switch off if commission is settled separately."
            />
            <Switch
              on={values.applyAttendanceDeductions}
              disabled={busy}
              onChange={(on) =>
                setValues((current) => ({ ...current, applyAttendanceDeductions: on }))
              }
              title="Apply attendance deductions"
              detail="Late arrivals past the monthly allowance are deducted, using the figures the attendance module already calculated."
            />
          </div>
        </OverlayCard>

        {/* The brief's "unless explicitly granted by Admin", as an actual
            control — and only the admin gets to press it. */}
        {isAdmin && profile.role === "subadmin" && (
          <OverlayCard title="Salary visibility" hint="Managers see no salary figures by default">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <ShieldCheck size={16} color={F.teal} />
              <span style={{ flex: "1 1 220px", fontSize: 12.5, color: F.muted, lineHeight: 1.5 }}>
                Granting access lets {profile.name} open Salary &amp; Payroll for the whole company.
                It is not limited to their own team.
              </span>
              <PrimaryButton onClick={() => void grantAccess(true)} disabled={busy} tone="quiet">
                <Check size={14} /> Grant
              </PrimaryButton>
              <PrimaryButton onClick={() => void grantAccess(false)} disabled={busy} tone="danger">
                Revoke
              </PrimaryButton>
            </div>
          </OverlayCard>
        )}

        {error && <Banner ok={false}>{error}</Banner>}
      </div>
    </OverlayPanel>
  );
}

function Switch({
  on,
  onChange,
  title,
  detail,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        borderRadius: 12,
        border: `1px solid ${on ? F.teal : F.line}`,
        background: on ? F.tealSoft : F.surface,
        padding: "11px 13px",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: F.teal, flexShrink: 0 }}
      />
      <span>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: F.ink }}>
          {title}
        </span>
        <span style={{ display: "block", fontSize: 12, color: F.muted, marginTop: 2, lineHeight: 1.5 }}>
          {detail}
        </span>
      </span>
    </label>
  );
}

const cell: React.CSSProperties = {
  padding: "10px",
  textAlign: "right",
  fontSize: 12.5,
  fontWeight: 600,
  color: F.muted,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
