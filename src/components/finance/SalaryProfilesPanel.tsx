"use client";

/**
 * Salaries — everybody's pay and joining date, in one editable list.
 *
 * The simple payroll (owner, 2026-09-25): a person has a **salary**, an
 * optional **allowance** and a **joining date**, and that is all payroll needs
 * from them. The admin and HR both edit it. Salary is the same figure
 * Attendance Settings works absent-day deductions out from, and the joining
 * date is the same one the directory shows.
 */

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { listSalaryProfiles, saveSalaryProfile } from "@/lib/clientActions";
import type { SalaryProfileRecord } from "@/app/actions/payroll";
import { formatBusinessDate } from "@/lib/dates";
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
 * Loads the list once, and keeps it — the panel unmounts on every tab change,
 * and reading the whole `users` collection on each click was the salary
 * screen's slowest step.
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

function joinedLabel(dayKey: string | null): string {
  return dayKey ? formatBusinessDate(new Date(`${dayKey}T12:00:00+05:00`)) : "Not set";
}

export function SalaryProfilesPanel({
  profiles,
  error,
  reload,
  onSaved,
}: {
  profiles: SalaryProfileRecord[] | null;
  error: string | null;
  reload: () => void;
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState<SalaryProfileRecord | null>(null);
  const [search, setSearch] = useState("");
  const isMobile = useIsMobile();

  const rows = (profiles ?? []).filter((profile) =>
    profile.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <>
      {error && <Banner ok={false}>{error}</Banner>}

      <FinanceCard
        title="Salaries"
        hint="Salary, allowance and joining date — what each month is worked out from"
        action={
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            style={{
              borderRadius: 999,
              border: `1px solid ${F.line}`,
              background: "#fff",
              color: F.ink,
              padding: "6px 13px",
              fontSize: isMobile ? 16 : 13,
              outline: "none",
              minWidth: 150,
            }}
          />
        }
      >
        {profiles === null ? (
          <EmptyState>Loading salaries.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>{search ? "Nobody matches that search." : "Nobody is on the roster yet."}</EmptyState>
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
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: F.ink }}>{profile.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: F.faint }}>
                      {profile.jobTitle ?? profile.email ?? ""}
                      {profile.role === "subadmin" ? " · Manager" : ""}
                    </span>
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: F.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {rupees(profile.salary + profile.allowance)}
                  </span>
                </div>

                <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  {[
                    { label: "Salary", value: rupees(profile.salary), warn: profile.salary <= 0 },
                    { label: "Allowance", value: profile.allowance > 0 ? rupees(profile.allowance) : "—", warn: false },
                    { label: "Joined", value: joinedLabel(profile.joinedAt), warn: !profile.joinedAt },
                  ].map((item) => (
                    <span key={item.label} style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: F.faint }}>
                        {item.label}
                      </span>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: item.warn ? "#a5762a" : F.muted, fontVariantNumeric: "tabular-nums" }}>
                        {item.value}
                      </span>
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  {["Person", "Joined", "Salary", "Allowance", "Monthly", ""].map((label, index) => (
                    <th
                      key={label || index}
                      style={{
                        textAlign: index <= 1 || index === 5 ? "left" : "right",
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
                  ))}
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
                    <td style={{ ...cell, textAlign: "left", color: profile.joinedAt ? F.muted : "#a5762a" }}>
                      {joinedLabel(profile.joinedAt)}
                    </td>
                    <td style={{ ...cell, color: profile.salary > 0 ? F.muted : "#a5762a" }}>
                      {profile.salary > 0 ? rupees(profile.salary) : "Not set"}
                    </td>
                    <td style={cell}>{profile.allowance > 0 ? rupees(profile.allowance) : "—"}</td>
                    <td style={{ ...cell, color: F.ink, fontWeight: 800 }}>{rupees(profile.salary + profile.allowance)}</td>
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
        <SalaryModal
          profile={editing}
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

function SalaryModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: SalaryProfileRecord;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { getIdToken } = useAuth();
  const isMobile = useIsMobile();
  const [salary, setSalary] = useState(String(profile.salary || ""));
  const [allowance, setAllowance] = useState(String(profile.allowance || ""));
  const [joinedAt, setJoinedAt] = useState(profile.joinedAt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = (Number(salary) || 0) + (Number(allowance) || 0);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const token = await getIdToken();
    const result = await saveSalaryProfile(token, profile.uid, {
      salary: Number(salary) || 0,
      allowance: Number(allowance) || 0,
      joinedAt: joinedAt || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`${profile.name}'s salary saved.`);
  };

  const input = { ...fieldStyle, fontVariantNumeric: "tabular-nums" as const, fontSize: isMobile ? 16 : 14 };

  return (
    <OverlayPanel
      title={profile.name}
      subtitle="Salary"
      maxWidth={520}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: F.muted }}>Monthly {rupees(total)}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton onClick={onClose} tone="quiet">Cancel</PrimaryButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Pay" hint="Absent-day deductions are worked out from the salary">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Field label="Salary (monthly)">
              <input type="number" min={0} inputMode="numeric" value={salary} disabled={busy}
                onChange={(event) => setSalary(event.target.value)} style={input} />
            </Field>
            <Field label="Allowance (monthly)">
              <input type="number" min={0} inputMode="numeric" value={allowance} disabled={busy}
                onChange={(event) => setAllowance(event.target.value)} style={input} />
            </Field>
          </div>
        </OverlayCard>

        <OverlayCard title="Joining date" hint="A month they joined part-way through is paid from this day">
          <Field label="Joined on">
            <input type="date" value={joinedAt} disabled={busy}
              onChange={(event) => setJoinedAt(event.target.value)} style={input} />
          </Field>
        </OverlayCard>

        {error && <Banner ok={false}>{error}</Banner>}
      </div>
    </OverlayPanel>
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
