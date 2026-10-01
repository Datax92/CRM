"use client";

/**
 * One person's month, every figure editable — and only that month.
 *
 * The owner's instruction (2026-10-01): *"in the edit option there should be
 * option of every single thing to be edited, deduction and everything … this
 * month should be separate from september."* The row's Edit used to open the
 * standing salary, which changes every month not yet paid. This form changes
 * **the month on screen and nothing else**; the standing salary is one button
 * away, and says what it is.
 *
 * What is typed is what is paid: a hand-set salary is not cut again for a
 * mid-month joining. A figure left as it was keeps following attendance and
 * the standing salary — the server stores only what differs.
 */

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { savePayrollMonth } from "@/lib/clientActions";
import {
  MONTH_ADJUSTABLE,
  MONTH_ADJUSTABLE_LABELS,
  computeLineTotals,
  monthFigures,
  type MonthAdjustable,
  type PayrollLine,
} from "@/lib/payroll";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { Banner, F, Field, PrimaryButton, fieldStyle, rupees } from "./financeChrome";

const ADDITIONS: MonthAdjustable[] = ["basic", "allowances", "bonus", "commission"];
const DEDUCTIONS: MonthAdjustable[] = ["attendanceDeduction", "otherDeductions"];

export function PayrollMonthModal({
  line,
  monthKey,
  monthName,
  onClose,
  onSaved,
  onStandingSalary,
}: {
  line: PayrollLine;
  monthKey: string;
  /** "September 2026" — the month is named on every surface of this form. */
  monthName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Opens the standing salary and dates instead. */
  onStandingSalary: () => void;
}) {
  const { getIdToken } = useAuth();
  const isMobile = useIsMobile();

  /** What the month worked out to before any hand change — the reset target. */
  const calculated = line.calculated ?? monthFigures(line);
  const current = monthFigures(line);

  const [values, setValues] = useState<Record<MonthAdjustable, string>>(
    () => Object.fromEntries(MONTH_ADJUSTABLE.map((key) => [key, String(current[key])])) as Record<MonthAdjustable, string>
  );
  const [note, setNote] = useState(line.adjusted?.length ? (line.note ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberOf = (key: MonthAdjustable) => Math.max(0, Math.round(Number(values[key]) || 0));
  const net = computeLineTotals({
    basic: numberOf("basic"),
    allowances: numberOf("allowances"),
    bonus: numberOf("bonus"),
    extraAdditions: 0,
    commission: numberOf("commission"),
    attendanceDeduction: numberOf("attendanceDeduction"),
    otherDeductions: numberOf("otherDeductions"),
  }).net;
  const changed = MONTH_ADJUSTABLE.filter((key) => numberOf(key) !== calculated[key]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await savePayrollMonth(await getIdToken(), monthKey, line.uid, {
        figures: Object.fromEntries(MONTH_ADJUSTABLE.map((key) => [key, numberOf(key)])),
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(
        result.data.adjusted > 0
          ? `${line.name}'s ${monthName} saved — net ${rupees(result.data.net)}. Other months are unchanged.`
          : `${line.name}'s ${monthName} is back to the calculated figures — net ${rupees(result.data.net)}.`
      );
    } catch {
      setError("Could not reach the server. Nothing may have changed — reopen the month and check.");
    } finally {
      setBusy(false);
    }
  };

  const input = { ...fieldStyle, fontVariantNumeric: "tabular-nums" as const, fontSize: isMobile ? 16 : 14 };

  const field = (key: MonthAdjustable) => {
    const differs = numberOf(key) !== calculated[key];
    return (
      <Field key={key} label={MONTH_ADJUSTABLE_LABELS[key]}>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={values[key]}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            setValues((all) => ({ ...all, [key]: value }));
          }}
          style={{ ...input, borderColor: differs ? F.teal : undefined }}
        />
        <span style={{ display: "block", marginTop: 5, fontSize: 11, fontWeight: 600, color: differs ? F.teal : F.faint }}>
          {differs ? (
            <>
              Calculated {rupees(calculated[key])} ·{" "}
              <button type="button" disabled={busy}
                onClick={() => setValues((all) => ({ ...all, [key]: String(calculated[key]) }))}
                style={{ border: "none", background: "transparent", padding: 0, color: F.teal, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 11, textDecoration: "underline" }}>
                use it
              </button>
            </>
          ) : (
            "As calculated"
          )}
        </span>
      </Field>
    );
  };

  const attendance = [
    `${line.presentCount} present`,
    line.lateCount ? `${line.lateCount} late` : null,
    line.absentCount ? `${line.absentCount} absent` : null,
    line.leaveCount ? `${line.leaveCount} leave` : null,
  ].filter(Boolean).join(" · ");

  return (
    <OverlayPanel
      title={line.name}
      subtitle={`${monthName} only — other months are not changed`}
      maxWidth={560}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: F.ink }}>
            Net {rupees(net)}
            <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: F.faint }}>
              {changed.length > 0 ? `${changed.length} changed by hand` : "all as calculated"}
            </span>
          </span>
          <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
            <PrimaryButton onClick={onClose} tone="quiet">Cancel</PrimaryButton>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : `Save ${monthName}`}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <OverlayCard title="Pay" hint="What is typed is what is paid for this month">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {ADDITIONS.map(field)}
          </div>
        </OverlayCard>

        <OverlayCard title="Deductions" hint={attendance}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            {DEDUCTIONS.map(field)}
          </div>
        </OverlayCard>

        <OverlayCard title="Note" hint="Why a figure was changed — printed on the payslip">
          <textarea
            value={note}
            disabled={busy}
            maxLength={300}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional"
            style={{ ...fieldStyle, fontSize: isMobile ? 16 : 14, resize: "vertical", width: "100%" }}
          />
        </OverlayCard>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <button type="button" disabled={busy || changed.length === 0}
            onClick={() => setValues(Object.fromEntries(MONTH_ADJUSTABLE.map((key) => [key, String(calculated[key])])) as Record<MonthAdjustable, string>)}
            style={{ border: "none", background: "transparent", padding: 0, color: changed.length ? F.teal : F.faint, fontSize: 12.5, fontWeight: 700, cursor: changed.length ? "pointer" : "default", fontFamily: "inherit" }}>
            Reset every figure to calculated
          </button>
          <button type="button" disabled={busy} onClick={onStandingSalary}
            style={{ border: "none", background: "transparent", padding: 0, color: F.teal, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Standing salary and dates (every month) →
          </button>
        </div>

        {error && <Banner ok={false}>{error}</Banner>}
      </div>
    </OverlayPanel>
  );
}
