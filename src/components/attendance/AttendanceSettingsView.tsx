"use client";

/**
 * Attendance settings (§2, §4, §5, §6) — admin and HR only.
 *
 * Every rule the module enforces is on this one screen, each stated in the
 * words it is enforced in, so the person setting "09:00 + 15 minutes" can see
 * that it means "late from 09:16". A settings page that lists parameters
 * without saying what they do is a settings page nobody dares touch.
 *
 * The office IP list is checked **server-side** against the request's own
 * address; the "Use my current IP" button asks the server what it saw rather
 * than reading anything in the browser, which could be edited in seconds.
 */

import { useEffect, useState } from "react";
import { Globe, Save, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEmployees } from "@/hooks/useEmployees";
import { getAttendanceConfig, setAttendanceConfig } from "@/lib/clientActions";
import {
  DEFAULT_ATTENDANCE_POLICY,
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  formatClockLabel,
  parseClock,
  formatClockValue,
  type AttendancePolicy,
  type DeductionMode,
} from "@/lib/attendancePolicy";
import { A, AttendanceCard } from "./attendanceChrome";

export function AttendanceSettingsView() {
  const { getIdToken } = useAuth();
  const { employees } = useEmployees(true);

  const [policy, setPolicy] = useState<AttendancePolicy>(DEFAULT_ATTENDANCE_POLICY);
  const [serverIp, setServerIp] = useState<string>("");
  const [ipText, setIpText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getAttendanceConfig(token);
      if (cancelled) return;

      if (result.ok) {
        const { yourIp, ...stored } = result.data;
        setPolicy(stored);
        setIpText(stored.officeIps.join("\n"));
        setServerIp(yourIp);
      } else {
        setBanner({ ok: false, text: result.error });
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  const patch = <K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) =>
    setPolicy((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setBanner(null);

    const token = await getIdToken();
    const result = await setAttendanceConfig(token, {
      ...policy,
      officeIps: ipText
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    });
    setSaving(false);

    if (!result.ok) {
      setBanner({ ok: false, text: result.error });
      return;
    }
    setPolicy(result.data);
    setIpText(result.data.officeIps.join("\n"));
    setBanner({ ok: true, text: "Attendance rules saved. They apply from the next check-in." });
  };

  const lateAfter = formatClockValue((parseClock(policy.startTime) ?? 0) + policy.graceMinutes);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {banner && (
        <p
          role={banner.ok ? "status" : "alert"}
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 600,
            border: `1px solid ${banner.ok ? "#bfe3d2" : "#f0c4bd"}`,
            background: banner.ok ? "#e4f3ec" : "#fdeeeb",
            color: banner.ok ? "#1f7a52" : "#a33a29",
          }}
        >
          {banner.text}
        </p>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* §4 and §5 — the clock                                             */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard title="The working day" hint="Karachi time">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Field label="Start time">
            <input
              type="time"
              value={policy.startTime}
              onChange={(event) => patch("startTime", event.target.value)}
              style={fieldStyle}
            />
          </Field>
          <Field label="Grace (minutes)">
            <input
              type="number"
              min={0}
              max={120}
              value={policy.graceMinutes}
              onChange={(event) => patch("graceMinutes", Number(event.target.value))}
              style={fieldStyle}
            />
          </Field>
          <Field label="Absent after">
            <input
              type="time"
              value={policy.absentCutoff}
              onChange={(event) => patch("absentCutoff", event.target.value)}
              style={fieldStyle}
            />
          </Field>
        </div>

        {/* The rules restated in the words they are enforced in. */}
        <ul style={ruleList}>
          <li>
            A check-in at or before <strong>{formatClockLabel(lateAfter)}</strong> is on time.
            After it, the day is marked late.
          </li>
          <li>
            No check-in by <strong>{formatClockLabel(policy.absentCutoff)}</strong> and the day is
            recorded as absent automatically.
          </li>
          <li>
            An absence written by the cutoff can still be corrected afterwards — the correction
            sits beside it, and the original stays.
          </li>
        </ul>
      </AttendanceCard>

      {/* ---------------------------------------------------------------- */}
      {/* §5 — deductions                                                   */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard title="Late deductions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Field label="Lates allowed each month">
            <input
              type="number"
              min={0}
              max={31}
              value={policy.allowedLates}
              onChange={(event) => patch("allowedLates", Number(event.target.value))}
              style={fieldStyle}
            />
          </Field>
          <Field label="Then charge">
            <select
              value={policy.deductionMode}
              onChange={(event) => patch("deductionMode", event.target.value as DeductionMode)}
              style={fieldStyle}
            >
              <option value="AMOUNT">A fixed amount</option>
              <option value="PERCENT">A percentage of salary</option>
            </select>
          </Field>
          <Field label={policy.deductionMode === "PERCENT" ? "Percent of monthly salary" : "Rupees per late"}>
            <input
              type="number"
              min={0}
              value={policy.deductionValue}
              onChange={(event) => patch("deductionValue", Number(event.target.value))}
              style={fieldStyle}
            />
          </Field>
        </div>

        <ul style={ruleList}>
          <li>
            The first <strong>{policy.allowedLates}</strong> late
            {policy.allowedLates === 1 ? "" : "s"} in a month cost nothing. From late #
            {policy.allowedLates + 1} each one is charged{" "}
            <strong>
              {policy.deductionMode === "PERCENT"
                ? `${policy.deductionValue}% of monthly salary`
                : `Rs ${policy.deductionValue.toLocaleString("en-PK")}`}
            </strong>
            .
          </li>
          {policy.deductionMode === "PERCENT" && (
            <li>
              A percentage rule needs a monthly salary on the employee&apos;s record. Where there
              is none it charges nothing rather than guessing a figure.
            </li>
          )}
          <li>
            Each charge is stored with the rule it was made under, so changing this later does not
            rewrite a month that has already been paid.
          </li>
        </ul>
      </AttendanceCard>

      {/* ---------------------------------------------------------------- */}
      {/* §6 — leave allowance                                              */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard title="Leave allowance" hint="Per employee, per year">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          {LEAVE_TYPES.map((type) => (
            <Field key={type} label={LEAVE_TYPE_LABELS[type]}>
              <input
                type="number"
                min={0}
                max={365}
                value={policy.leaveAllowance[type]}
                onChange={(event) =>
                  patch("leaveAllowance", {
                    ...policy.leaveAllowance,
                    [type]: Number(event.target.value),
                  })
                }
                style={fieldStyle}
              />
            </Field>
          ))}
        </div>
        <ul style={ruleList}>
          <li>
            Raising an allowance keeps every per-person adjustment HR has granted — those are added
            on top, not instead.
          </li>
          <li>Approved leave does not count against an attendance rate. It leaves the total.</li>
        </ul>
      </AttendanceCard>

      {/* ---------------------------------------------------------------- */}
      {/* §2 — the office network                                           */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard
        title="Office network"
        icon={<Globe size={14} color={A.teal} />}
        hint={serverIp ? `This request came from ${serverIp}` : undefined}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            borderRadius: 12,
            border: `1px solid ${policy.ipRestriction ? A.teal : A.line}`,
            background: policy.ipRestriction ? A.tealSoft : A.surface,
            padding: "11px 13px",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={policy.ipRestriction}
            onChange={(event) => patch("ipRestriction", event.target.checked)}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: A.teal }}
          />
          <span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: A.ink }}>
              Only allow check-in from the office network
            </span>
            <span style={{ display: "block", fontSize: 12, color: A.muted, marginTop: 2 }}>
              Off by default. With it off, a punch from anywhere is still recorded — it is simply
              stamped Remote rather than Office, and the admin can see which.
            </span>
          </span>
        </label>

        <Field label="Office IP addresses — one per line">
          <textarea
            value={ipText}
            onChange={(event) => setIpText(event.target.value)}
            rows={3}
            placeholder="203.0.113.42"
            style={{ ...fieldStyle, width: "100%", resize: "vertical", fontFamily: "monospace" }}
          />
        </Field>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            disabled={!serverIp}
            onClick={() =>
              setIpText((current) =>
                current
                  .split(/\s+/)
                  .filter(Boolean)
                  .includes(serverIp)
                  ? current
                  : `${current ? `${current}\n` : ""}${serverIp}`
              )
            }
            style={{
              borderRadius: 999,
              border: `1px solid ${A.line}`,
              background: A.surface,
              color: serverIp ? A.teal : A.faint,
              padding: "7px 15px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: serverIp ? "pointer" : "not-allowed",
            }}
          >
            Use my current IP
          </button>
          <span style={{ fontSize: 11.5, color: A.faint, alignSelf: "center" }}>
            Add a second address if the office has a backup line — a changed IP with restriction on
            locks everybody out.
          </span>
        </div>

        {/* §2's explicit exception. */}
        <div style={{ marginTop: 14 }}>
          <Field label="Employees who may check in from anywhere">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 7,
                maxHeight: 190,
                overflowY: "auto",
                border: `1px solid ${A.line}`,
                borderRadius: 12,
                padding: 10,
              }}
            >
              {employees.length === 0 && (
                <p style={{ fontSize: 12.5, color: A.faint }}>No employees on the roster yet.</p>
              )}
              {employees.map((employee) => {
                const exempt = policy.ipExemptUids.includes(employee.uid);
                return (
                  <label
                    key={employee.uid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: A.ink,
                      cursor: "pointer",
                      minWidth: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={exempt}
                      onChange={() =>
                        patch(
                          "ipExemptUids",
                          exempt
                            ? policy.ipExemptUids.filter((uid) => uid !== employee.uid)
                            : [...policy.ipExemptUids, employee.uid]
                        )
                      }
                      style={{ width: 15, height: 15, accentColor: A.teal, flexShrink: 0 }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {employee.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
      </AttendanceCard>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: A.faint }}>
          <ShieldCheck size={14} /> Every change is recorded with who made it and when.
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !loaded}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            border: "none",
            background: A.teal,
            color: "#fff",
            padding: "11px 24px",
            fontSize: 13.5,
            fontWeight: 700,
            cursor: saving || !loaded ? "wait" : "pointer",
            opacity: saving || !loaded ? 0.7 : 1,
          }}
        >
          <Save size={16} /> {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: A.faint,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  borderRadius: 10,
  border: `1px solid ${A.line}`,
  background: "#fff",
  color: A.ink,
  padding: "9px 11px",
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
  width: "100%",
};

const ruleList: React.CSSProperties = {
  marginTop: 12,
  display: "grid",
  gap: 6,
  paddingLeft: 18,
  fontSize: 12,
  color: A.muted,
  lineHeight: 1.6,
  listStyle: "disc",
};
