"use client";

/**
 * Attendance settings (§2, §4, §5, §6) — admin and HR only.
 *
 * Every rule the module enforces is on this one screen, each stated in the
 * words it is enforced in, so the person setting "09:00 + 15 minutes" can see
 * that it means "late from 09:16". A settings page that lists parameters
 * without saying what they do is a settings page nobody dares touch.
 *
 * **The office is recognised by where the device is, and by its Wi-Fi network
 * name.** Location is the check that answers the question an owner is actually
 * asking — a saved network name travels home in somebody's pocket, a position
 * does not — and the network name corroborates it and covers the device that
 * will not share a position at all.
 *
 * The office is marked by **standing in it and pressing a button**, not by
 * typing coordinates: an admin who has to look up their own latitude will get
 * it wrong, and a wrong office refuses the entire company.
 *
 * The older idea, kept because the reasoning still holds:
 * The IP allow-list that used to sit under this card is gone: a business line's
 * public address is dynamic, so a list built from it stops matching without
 * warning and the restriction then refuses the whole company. That is the
 * mechanism being wrong for the network, not a value needing tuning.
 *
 * What the Wi-Fi check is worth is stated on the card in the same words as
 * `lib/attendance`: no browser exposes the SSID, so the name is typed once per
 * device and compared **on the server**. It stops the ordinary case and not a
 * determined one — so the card also says what makes it hold up in practice:
 * the expected names are never shown to an employee, and a refused check-in
 * notifies the admin.
 */

import { useEffect, useState } from "react";
import { MapPin, Save, ShieldCheck, Wifi } from "lucide-react";
import { readPosition, FIX_FAILURE_MESSAGES } from "@/lib/geolocation";
import { formatDistance, MAX_FIX_ACCURACY_METERS } from "@/lib/attendance";
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
  const [wifiText, setWifiText] = useState("");
  /** Set while the browser is finding the admin's position. */
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
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
        setWifiText(stored.officeWifiNames.join("\n"));
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
      // Split on newlines only, never on spaces: "Leadway Office 5G" is one
      // network, and the whitespace split the IP field uses would save it as
      // four networks that match nothing.
      officeWifiNames: wifiText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    });
    setSaving(false);

    if (!result.ok) {
      setBanner({ ok: false, text: result.error });
      return;
    }
    setPolicy(result.data);
    setWifiText(result.data.officeWifiNames.join("\n"));
    setBanner({ ok: true, text: "Attendance rules saved. They apply from the next check-in." });
  };

  const lateAfter = formatClockValue((parseClock(policy.startTime) ?? 0) + policy.graceMinutes);

  /**
   * Marks the office at wherever this browser currently is.
   *
   * The only sane way to set it. Coordinates typed from a map are transposed,
   * truncated or hemisphere-flipped often enough that a screen offering a
   * latitude box is a screen that will eventually lock a company out of its own
   * attendance — and the person who can fix it is the one who set it wrong.
   *
   * The reading is refused if it is too vague to trust: an office pinned from a
   * 2km estimate is not an office, and every employee would then be measured
   * against a point in the wrong suburb.
   */
  const markOffice = async () => {
    setLocating(true);
    setLocateNote(null);

    const { fix, failure } = await readPosition();
    setLocating(false);

    if (!fix) {
      setLocateNote(FIX_FAILURE_MESSAGES[failure ?? "UNAVAILABLE"]);
      return;
    }
    if (fix.accuracy > MAX_FIX_ACCURACY_METERS) {
      setLocateNote(
        `This browser only knows where it is to within ${formatDistance(fix.accuracy)}, which is ` +
          "too vague to pin the office to. Try from a phone while you are in the office, or turn " +
          "on precise location."
      );
      return;
    }

    setPolicy((current) => ({ ...current, officeLat: fix.lat, officeLng: fix.lng }));
    setLocateNote(
      `Office set to where this browser is now, accurate to about ${formatDistance(fix.accuracy)}. ` +
        "Press Save rules to keep it."
    );
  };

  const officeMarked = policy.officeLat !== null && policy.officeLng !== null;

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
      {/* §2 — where the office is                                          */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard
        title="Office location"
        icon={<MapPin size={14} color={A.teal} />}
        hint="Checked on check-in only"
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            borderRadius: 12,
            border: `1px solid ${policy.locationRestriction ? A.teal : A.line}`,
            background: policy.locationRestriction ? A.tealSoft : A.surface,
            padding: "11px 13px",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={policy.locationRestriction}
            onChange={(event) => patch("locationRestriction", event.target.checked)}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: A.teal }}
          />
          <span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: A.ink }}>
              Only allow check-in at the office
            </span>
            <span style={{ display: "block", fontSize: 12, color: A.muted, marginTop: 2 }}>
              The employee&rsquo;s browser asks to share its location when they press Check In, and
              the distance is worked out here. Check-<em>out</em> is never refused.
            </span>
          </span>
        </label>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            borderRadius: 12,
            border: `1px solid ${A.line}`,
            background: A.surface,
            padding: "12px 14px",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: A.faint }}>
              The office
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: officeMarked ? A.ink : A.faint, marginTop: 3 }}>
              {officeMarked
                ? `${policy.officeLat!.toFixed(5)}, ${policy.officeLng!.toFixed(5)}`
                : "Not marked yet"}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void markOffice()}
            disabled={locating}
            style={{
              borderRadius: 999,
              border: `1px solid ${A.line}`,
              background: A.surface,
              color: A.teal,
              padding: "8px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: locating ? "progress" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {locating ? "Finding…" : officeMarked ? "Move it to where I am" : "Use my current location"}
          </button>

          {officeMarked && (
            <button
              type="button"
              onClick={() => {
                setPolicy((current) => ({
                  ...current,
                  officeLat: null,
                  officeLng: null,
                  // Clearing the office while the restriction is on would save
                  // a rule with nothing behind it, which the server refuses.
                  // Switching it off here means the two always agree.
                  locationRestriction: false,
                }));
                setLocateNote("Office cleared. The location check is switched off with it.");
              }}
              style={{
                borderRadius: 999,
                border: `1px solid ${A.line}`,
                background: A.surface,
                color: A.muted,
                padding: "8px 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {locateNote && (
          <p
            role="status"
            style={{
              marginTop: 10,
              borderRadius: 10,
              border: `1px solid ${A.line}`,
              background: A.tealSoft,
              padding: "9px 12px",
              fontSize: 12,
              color: A.ink,
              lineHeight: 1.5,
            }}
          >
            {locateNote}
          </p>
        )}

        <div style={{ marginTop: 14, maxWidth: 280 }}>
          <Field label="How far from it still counts (metres)">
            <input
              type="number"
              min={20}
              max={20000}
              step={10}
              value={policy.officeRadiusMeters}
              onChange={(event) => patch("officeRadiusMeters", Number(event.target.value))}
              style={fieldStyle}
            />
          </Field>
        </div>

        <p style={{ fontSize: 11.5, color: A.muted, marginTop: 10, lineHeight: 1.55 }}>
          <strong style={{ color: A.ink }}>Set this generously.</strong> Indoors a phone is routinely
          20&ndash;60 metres out and a laptop further, so a radius tight enough to catch somebody in
          the car park will refuse people at their own desk. 150m covers a small office and its
          street; widen it rather than fight the error bars. A reading vaguer than{" "}
          {formatDistance(MAX_FIX_ACCURACY_METERS)} is never accepted either way &mdash; the employee
          is asked to try again rather than being marked away.
        </p>

        <p
          style={{
            marginTop: 10,
            borderRadius: 10,
            border: `1px solid ${A.line}`,
            background: A.surface,
            padding: "10px 12px",
            fontSize: 11.5,
            color: A.muted,
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: A.ink }}>What this proves, and what to tell your team.</strong>{" "}
          This is the check that a saved Wi-Fi name cannot pass from home. Location is read{" "}
          <em>only</em> at the moment somebody presses Check In &mdash; never in the background, never
          on any other screen &mdash; and what is stored is the distance from the office and the
          reading itself, on that day&rsquo;s record. Say that to your team before you switch it on:
          an unexplained permission prompt is one people decline, and somebody who has declined it
          cannot check in at all.
        </p>
      </AttendanceCard>

      {/* ---------------------------------------------------------------- */}
      {/* §2 — the office Wi-Fi                                             */}
      {/* ---------------------------------------------------------------- */}
      <AttendanceCard
        title="Office Wi-Fi"
        icon={<Wifi size={14} color={A.teal} />}
        hint="Checked on check-in only"
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            borderRadius: 12,
            border: `1px solid ${policy.wifiRestriction ? A.teal : A.line}`,
            background: policy.wifiRestriction ? A.tealSoft : A.surface,
            padding: "11px 13px",
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={policy.wifiRestriction}
            onChange={(event) => patch("wifiRestriction", event.target.checked)}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: A.teal }}
          />
          <span>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: A.ink }}>
              Only allow check-in on the office Wi-Fi
            </span>
            <span style={{ display: "block", fontSize: 12, color: A.muted, marginTop: 2 }}>
              A check-in from any other network is refused and the employee is told which network
              they are on. Useful alongside the location check above, and the answer for a device
              that will not share a position at all. Check-<em>out</em> is never refused — blocking
              it would strand an open day, and an open day is graded as a half day.
            </span>
          </span>
        </label>

        <Field label="Office Wi-Fi network names — one per line">
          <textarea
            value={wifiText}
            onChange={(event) => setWifiText(event.target.value)}
            rows={3}
            placeholder={"Leadway-Office\nLeadway-Office 5G"}
            style={{ ...fieldStyle, width: "100%", resize: "vertical" }}
          />
        </Field>

        <p style={{ fontSize: 11.5, color: A.faint, marginTop: 10, lineHeight: 1.5 }}>
          Type each name exactly as the router broadcasts it. Case and extra spaces do not matter;
          punctuation does — <code>Office-5G</code> and <code>Office 5G</code> are usually two
          different radios, so add both if the office runs both bands.
        </p>

        <p style={{ fontSize: 11.5, color: A.faint, marginTop: 8, lineHeight: 1.5 }}>
          The office address is <em>recorded</em> on every punch and shown on the day&rsquo;s record,
          but nothing is matched against it — {serverIp ? `this request came from ${serverIp}` : "it is read from the request itself"}.
        </p>

        <p
          style={{
            marginTop: 10,
            borderRadius: 10,
            border: `1px solid ${A.line}`,
            background: A.surface,
            padding: "10px 12px",
            fontSize: 11.5,
            color: A.muted,
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: A.ink }}>Worth knowing what this proves.</strong> No browser will
          tell a website which Wi-Fi it is on — there is no such web API — so the employee types the
          network name once on each device and the server checks it against this list. That stops
          somebody checking in from home by habit; it does not stop somebody who decides to type
          your network name instead. It is exactly as trustworthy as the check-in time beside it.
          That is why the location check above exists, and why this one is the second opinion rather
          than the rule. What does hold up here: the accepted names are never shown to an employee — not here, not in
          the box beside Check In, not in the message they get when a check-in is refused — and{" "}
          <strong style={{ color: A.ink }}>every refused check-in notifies you</strong>, naming the
          network the device claimed. Bypassable but visible is the achievable goal.
        </p>

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
