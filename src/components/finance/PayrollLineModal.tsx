"use client";

/**
 * Adjusting one line before the month is finalised.
 *
 * The net recalculates **on the keystroke**, from the same `computeLineTotals`
 * the server uses, so the figure being approved is the figure on screen. It is
 * called straight from the render body rather than memoised: it is six
 * additions, and a memo could show a stale rupee total beside a fresh input.
 *
 * A reason is required for anything that moves money. An adjusted salary with
 * no explanation is the record that cannot answer the question it will
 * eventually be asked.
 */

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { computeLineTotals, type PayrollLine } from "@/lib/payroll";
import type { ActionResult } from "@/lib/actionResult";
import { F, Field, PrimaryButton, fieldStyle, rupees } from "./financeChrome";

type SaveFn = (
  token: string,
  monthKey: string,
  uid: string,
  patch: Partial<PayrollLine>
) => Promise<ActionResult<{ net: number }>>;

/** The fields an approver may move, and what each one means on the slip. */
const EDITABLE = [
  { key: "basic", label: "Basic salary", kind: "add" },
  { key: "allowances", label: "Allowances", kind: "add" },
  { key: "bonus", label: "Bonus", kind: "add" },
  { key: "extraAdditions", label: "Other additions", kind: "add" },
  { key: "commission", label: "Commission", kind: "add" },
  { key: "attendanceDeduction", label: "Attendance deduction", kind: "deduct" },
  { key: "otherDeductions", label: "Other deductions", kind: "deduct" },
] as const;

export function PayrollLineModal({
  monthKey,
  line,
  onClose,
  onSaved,
  save,
}: {
  monthKey: string;
  line: PayrollLine;
  onClose: () => void;
  onSaved: (message: string) => void;
  save: SaveFn;
}) {
  const { getIdToken } = useAuth();

  const [values, setValues] = useState({
    basic: line.basic,
    allowances: line.allowances,
    bonus: line.bonus,
    extraAdditions: line.extraAdditions,
    commission: line.commission,
    attendanceDeduction: line.attendanceDeduction,
    otherDeductions: line.otherDeductions,
  });
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = computeLineTotals(values);
  const changed = EDITABLE.some(({ key }) => values[key] !== line[key]);

  const submit = async () => {
    setError(null);
    if (!changed && note.trim() === (line.note ?? "")) {
      setError("Nothing has changed.");
      return;
    }
    if (changed && !note.trim()) {
      setError("Say why the figure is being adjusted — the change is kept on the record.");
      return;
    }

    setBusy(true);
    const token = await getIdToken();
    const result = await save(token, monthKey, line.uid, { ...values, note });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`${line.name}'s net salary is now ${rupees(result.data.net)}.`);
  };

  return (
    <OverlayPanel
      title={line.name}
      subtitle={`Adjusting ${monthKey}`}
      maxWidth={620}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: F.ink }}>
            Net {rupees(totals.net)}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <PrimaryButton onClick={onClose} tone="quiet">
              Cancel
            </PrimaryButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Save adjustment"}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {/* The attendance figures behind the deduction, so an approver can see
            what they are overriding rather than taking the number on trust. */}
        <OverlayCard title="This month's attendance" hint="From the attendance module">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
              gap: 10,
            }}
          >
            {[
              { label: "Present", value: line.presentCount },
              { label: "Late", value: line.lateCount },
              { label: "Absent", value: line.absentCount },
              { label: "Leave", value: line.leaveCount },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: 10,
                  border: `1px solid ${F.line}`,
                  padding: "8px 11px",
                  minWidth: 0,
                }}
              >
                <p style={{ fontSize: 10.5, fontWeight: 700, color: F.faint, letterSpacing: "0.5px" }}>
                  {item.label.toUpperCase()}
                </p>
                <p style={{ fontSize: 18, fontWeight: 800, color: F.ink }}>{item.value}</p>
              </div>
            ))}
          </div>
        </OverlayCard>

        <OverlayCard title="Figures">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            {EDITABLE.map(({ key, label, kind }) => (
              <Field key={key} label={kind === "deduct" ? `${label} (−)` : label}>
                <input
                  type="number"
                  min={0}
                  value={values[key]}
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
                    color: kind === "deduct" ? "#a33a29" : F.ink,
                  }}
                />
              </Field>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "space-between",
              borderTop: `1px solid ${F.hair}`,
              paddingTop: 12,
            }}
          >
            <span style={{ fontSize: 12.5, color: F.muted, fontWeight: 600 }}>
              Additions {rupees(totals.additions)} · Deductions {rupees(totals.deductions)}
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: F.teal }}>
              Net {rupees(totals.net)}
            </span>
          </div>
        </OverlayCard>

        <OverlayCard title="Reason" hint="Kept on the payroll's history">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={busy}
            placeholder="Late excused, advance recovered, arrears paid…"
            style={{ ...fieldStyle, resize: "vertical" }}
          />
          {error && (
            <p role="alert" style={{ marginTop: 8, fontSize: 12.5, color: "#a33a29", fontWeight: 600 }}>
              {error}
            </p>
          )}
        </OverlayCard>
      </div>
    </OverlayPanel>
  );
}
