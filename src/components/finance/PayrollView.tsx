"use client";

/**
 * Salary / Payroll.
 *
 * One month at a time, because payroll is a monthly act — the stepper is the
 * primary control and everything on screen belongs to the month it names.
 *
 * **Rebuilt on `expensesChrome`**, the language every other money screen now
 * speaks: the same hero, stat cards, search, rows and detail panel as Office
 * Expenses, Personal Expenses, StateLife, Marketing Income and Car Sale. That
 * is not decoration — it is what gives payroll the phone layout for free, out
 * of one implementation rather than a second that could drift.
 *
 * **Approving a payroll and paying it are two different facts, and the screen
 * shows both.** `status` says the company agreed the figures; `paidAmount` says
 * how much has actually left an account. So a month reads `Approved · Rs 180,000
 * due` until the money moves, exactly as an office expense does — and the money
 * moves through the same split control: *Pay salaries* opens `PayFromAccounts`
 * and the month can be funded from the Committee, Car Sale, Mahziyar Marketing,
 * a bank, or several at once. Paying the last rupee is what marks the month
 * paid and releases the payslips; see `payPayrollFromAccounts` for why that
 * lives on the server rather than here.
 *
 * **Nothing here recomputes commission or attendance.** Both arrive on the
 * generated line from the modules that own them, and once the period is
 * approved the figures are frozen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLedger } from "@/hooks/useLedger";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import {
  adjustPayrollLine,
  generatePayroll,
  getPayroll,
  payPayrollLine,
  deletePayroll,
  setPayrollStatus,
} from "@/lib/clientActions";
import type { PayrollPeriod } from "@/app/actions/payroll";
import {
  PAYROLL_STATUS_LABELS,
  allowedTransitions,
  isEditable,
  payrollTotals,
  type PayrollLine,
  type PayrollStatus,
} from "@/lib/payroll";
import { formatMoney } from "@/lib/money";
import { karachiMonthKey } from "@/lib/dates";
import { monthLabel, shiftMonth } from "@/lib/attendanceCalendar";
import { MonthStepper } from "@/components/attendance/MyAttendanceView";
import { OverlayPanel } from "@/components/ui/OverlayPanel";
import { PayFromAccounts } from "@/components/accounts/PayFromAccounts";
import {
  ChipRow,
  DetailAction,
  ExpenseDetail,
  ExpenseHero,
  ExpenseList,
  FigureStrip,
  HeroButton,
  HeroTile,
  ICON,
  MobileSearch,
  StatCards,
  TONE,
  X,
  type ExpenseRowModel,
  type Figure,
  type FundingLeg,
  type RowAction,
  type StatCard,
} from "./expensesChrome";
import { stamp } from "./OfficeExpensesView";
import { PayrollLineModal } from "./PayrollLineModal";
import { SalaryProfilesPanel, useSalaryProfiles } from "./SalaryProfilesPanel";
import { PayslipPanel } from "./PayslipPanel";

/**
 * The single next step, **in the words of the person about to press it**.
 *
 * It depends who that is. The admin approves their own payroll directly — a
 * one-person chain of Draft → Reviewed → Approved is three presses to say one
 * thing. HR prepares it and sends it up, and the button says exactly that
 * rather than "Send for review", which never said to whom.
 *
 * There is no "Mark as paid": paying is an act with money behind it, so the
 * status follows the money rather than the other way round.
 */
function nextLabel(to: PayrollStatus, isAdmin: boolean): string {
  if (to === "APPROVED") return "Approve payroll";
  if (to === "REVIEWED") return isAdmin ? "" : "Send to admin for approval";
  return "";
}

const STATUS_TONE: Record<PayrollStatus, keyof typeof TONE> = {
  DRAFT: "quiet",
  REVIEWED: "warn",
  APPROVED: "good",
  PAID: "good",
};

/** Which cut of the payroll the chips are showing. */
const CUTS = ["ALL", "COMMISSION", "DEDUCTIONS", "ADJUSTED"] as const;
type Cut = (typeof CUTS)[number];

const CUT_LABELS: Record<Cut, string> = {
  ALL: "Everyone",
  COMMISSION: "With commission",
  DEDUCTIONS: "With deductions",
  ADJUSTED: "Adjusted by hand",
};

export function PayrollView() {
  const { role, getIdToken } = useAuth();
  const isAdmin = role === "admin";
  // A nine-column money table at 390px is unreadable, so the phone gets cards
  // carrying the same figures — the same row model, not a reduced version.
  const isMobile = useIsMobile();

  const [monthKey, setMonthKey] = useState(() => shiftMonth(karachiMonthKey(), 0));
  const [tab, setTab] = useState<"PAYROLL" | "PROFILES">("PAYROLL");
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<PayrollLine | null>(null);
  const [slipFor, setSlipFor] = useState<PayrollLine | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayrollLine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [cut, setCut] = useState<Cut>("ALL");

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  // The accounts a payroll can be funded from. Only the admin can pay, so only
  // the admin opens this listener.
  const ledger = useLedger(isAdmin);

  /**
   * Salary profiles, loaded **once** the first time the tab is opened and kept
   * afterwards. Fetching them on the panel's mount meant re-reading the whole
   * roster on every tab click.
   */
  const [profilesWanted, setProfilesWanted] = useState(false);
  const salaryProfiles = useSalaryProfiles(profilesWanted);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // First statement is an await, so nothing sets state synchronously in
      // the effect — and the screen never paints last month's figures under
      // this month's heading.
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getPayroll(token, monthKey);
      if (cancelled) return;

      if (result.ok) {
        setPeriod(result.data);
        setBanner(null);
      } else {
        setPeriod(null);
        setBanner({ ok: false, text: result.error });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [monthKey, getIdToken, nonce]);

  const status = period?.status ?? "DRAFT";
  const editable = isEditable(status);
  const next = allowedTransitions(status, isAdmin).find((value) => nextLabel(value, isAdmin) !== "");
  // Only ever backwards, and only for somebody allowed to make the move.
  const back = allowedTransitions(status, isAdmin).includes("DRAFT")
    ? ("DRAFT" as PayrollStatus)
    : isAdmin && status === "APPROVED"
      ? ("REVIEWED" as PayrollStatus)
      : null;

  const totals = useMemo(() => payrollTotals(period?.lines ?? []), [period]);

  /*
    **What the month owes against what has actually gone out.** `amount` is the
    figure frozen when the payroll was generated; `totals.net` recomputes it. A
    period generated before the field existed has no `amount`, so the net stands
    in — the same fallback the server applies.
  */
  const payable = period?.amount || totals.net;
  const paid = period?.paidAmount ?? 0;
  const outstanding = Math.max(0, Math.round((payable - paid) * 100) / 100);

  /**
   * What one person is owed and what they have been paid.
   *
   * Empty until the month is approved, because the payslip each figure comes
   * from does not exist until then — which is exactly when paying becomes
   * allowed, so the Pay from control appears at the right moment without
   * needing a rule of its own.
   */
  const paymentFor = useCallback(
    (line: PayrollLine) =>
      period?.payments?.[line.uid] ?? { amount: line.net, paidAmount: 0, status: "UNPAID" },
    [period]
  );
  const approved = status === "APPROVED" || status === "PAID";
  const canPay = isAdmin && approved;

  /**
   * Who has no basic salary recorded.
   *
   * The one figure payroll cannot derive from anything else, and the reason a
   * generated month can come out full of zeroes.
   */
  const unsalaried = (period?.lines ?? []).filter((line) => line.basic <= 0).map((line) => line.name);

  /** How many people are still owed — the figure that says what is left to do. */
  const unpaidPeople = (period?.lines ?? []).filter((line) => {
    const payment = period?.payments?.[line.uid];
    return !payment || payment.paidAmount < payment.amount;
  }).length;

  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (period?.lines ?? []).filter((line) => {
      if (cut === "COMMISSION" && line.commission <= 0) return false;
      if (cut === "DEDUCTIONS" && line.attendanceDeduction + line.otherDeductions <= 0) return false;
      if (cut === "ADJUSTED" && !line.note && line.extraAdditions === 0) return false;
      if (!needle) return true;
      return (
        line.name.toLowerCase().includes(needle) ||
        (line.jobTitle ?? "").toLowerCase().includes(needle) ||
        (line.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [period, search, cut]);

  const page = usePagination(lines, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number, of: number) => (of ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
    return [
      {
        label: "On The Payroll", value: String(totals.people),
        note: `${formatMoney(totals.additions)} gross this month`,
        pill: monthLabel(monthKey), pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.user,
      },
      {
        label: "Commission", value: formatMoney(totals.commission),
        note: "from finalised deal splits", pill: `${pct(totals.commission, totals.additions)}%`,
        tone: "good", pct: pct(totals.commission, totals.additions),
        color: "#2f7d78", accent: "#4fa39c", icon: ICON.bars,
      },
      {
        label: "Deductions", value: formatMoney(totals.deductions),
        note: `${formatMoney(totals.attendanceDeduction)} from attendance`,
        pill: `${pct(totals.deductions, totals.additions)}%`, tone: "warn",
        pct: pct(totals.deductions, totals.additions),
        color: "#a5762a", accent: "#c99a2e", icon: ICON.clock,
      },
      // **The figure that says whether anybody has actually been paid.**
      // Approving a payroll moves no money; only a payment does.
      {
        label: !approved ? "Net Payable" : outstanding > 0 ? "Left To Pay" : "Net Paid",
        value: formatMoney(outstanding > 0 ? outstanding : payable),
        note: !approved
          ? "approve the month to start paying people"
          : paid > 0
            ? `${formatMoney(paid)} of ${formatMoney(payable)} paid · ${unpaidPeople} still owed`
            : `${unpaidPeople} ${unpaidPeople === 1 ? "person" : "people"} still to be paid`,
        pill: !approved ? "Not yet" : outstanding > 0 ? "Owing" : "Settled",
        tone: outstanding > 0 ? "warn" : "good",
        pct: payable > 0 ? pct(paid, payable) : 0,
        color: outstanding > 0 ? "#a5762a" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet,
      },
    ];
  }, [totals, monthKey, payable, paid, outstanding, approved, unpaidPeople]);

  /** Which accounts one person's salary actually came out of. */
  const legsFor = useCallback(
    (uid: string): FundingLeg[] => {
      const names = new Map(ledger.accounts.map((entry) => [entry.id, entry.name]));
      return ledger.transactions
        .filter((txn) => txn.sourceModule === "PAYROLL" && txn.sourceId === `${uid}_${monthKey}`)
        .map((txn) => ({
          id: txn.id,
          accountName: names.get(txn.accountId) ?? "A deleted account",
          amount: txn.amount,
          dayKey: txn.dayKey,
          note: txn.note ?? null,
          by: txn.createdByName ?? null,
        }));
    },
    [ledger.transactions, ledger.accounts, monthKey]
  );

  const run = async (work: (token: string) => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true);
    setBanner(null);
    const token = await getIdToken();
    const outcome = await work(token);
    setBusy(false);
    setBanner(outcome);
    reload();
  };

  const generate = () =>
    run(async (token) => {
      const result = await generatePayroll(token, monthKey);
      return result.ok
        ? {
            ok: true,
            text: `${monthLabel(monthKey)} generated — ${result.data.people} people, ${formatMoney(result.data.net)} net.`,
          }
        : { ok: false, text: result.error };
    });

  const move = (to: PayrollStatus) =>
    run(async (token) => {
      const result = await setPayrollStatus(token, monthKey, to);
      return result.ok
        ? {
            ok: true,
            text:
              to === "APPROVED"
                ? `${monthLabel(monthKey)} approved. Everybody can now see their payslip, the figures are fixed, and you can pay each person from an account.`
                : to === "REVIEWED"
                  ? `${monthLabel(monthKey)} sent to the admin for approval.`
                  : `${monthLabel(monthKey)} reopened — the figures can be edited again.`,
          }
        : { ok: false, text: result.error };
    });

  /** The five figures behind every net, in the order a payslip reads them. */
  const figuresFor = useCallback((line: PayrollLine): Figure[] => {
    const figures: Figure[] = [
      { label: "Basic", value: formatMoney(line.basic), tone: "muted" },
    ];
    if (line.allowances) figures.push({ label: "Allowances", value: formatMoney(line.allowances), tone: "muted" });
    if (line.bonus + line.extraAdditions) {
      figures.push({
        label: "Bonus", value: formatMoney(line.bonus + line.extraAdditions), tone: "muted",
        hint: line.extraAdditions ? `${formatMoney(line.extraAdditions)} one-off` : null,
      });
    }
    if (line.commission) figures.push({ label: "Commission", value: formatMoney(line.commission), tone: "good" });
    if (line.attendanceDeduction) {
      figures.push({
        label: "Attendance", value: `− ${formatMoney(line.attendanceDeduction)}`, tone: "warn",
        hint: [line.lateCount ? `${line.lateCount} late` : null, line.absentCount ? `${line.absentCount} absent` : null]
          .filter(Boolean).join(" · ") || null,
      });
    }
    if (line.otherDeductions) {
      figures.push({ label: "Other deductions", value: `− ${formatMoney(line.otherDeductions)}`, tone: "warn" });
    }
    figures.push({ label: "Net pay", value: formatMoney(line.net), tone: "good", strong: true });
    return figures;
  }, []);

  const buildActions = useCallback((line: PayrollLine): RowAction[] => {
    const actions: RowAction[] = [
      { key: "slip", label: "Payslip", d: ICON.receipt, tone: "quiet", onClick: () => setSlipFor(line) },
    ];
    // Absent rather than disabled once the month is finalised: a button whose
    // only outcome is a refusal reads as something having gone wrong.
    if (editable) {
      actions.push({ key: "edit", label: "Adjust", d: ICON.edit, tone: "quiet", onClick: () => setEditing(line) });
    }
    /*
      **Pay from… on every person, once the month is approved.** A settled
      salary offers no button at all rather than one that could only be
      refused — the same rule an office expense follows.
    */
    const payment = paymentFor(line);
    if (canPay && payment.paidAmount < payment.amount) {
      actions.push({ key: "pay", label: "Pay from…", d: ICON.wallet, tone: "good", onClick: () => setPaying(line) });
    }
    return actions;
  }, [editable, canPay, paymentFor]);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((line) => ({
        id: line.uid,
        title: line.name,
        meta: [line.jobTitle ?? line.email ?? "", `${line.presentCount} present`]
          .concat(line.lateCount ? [`${line.lateCount} late`] : [])
          .concat(line.absentCount ? [`${line.absentCount} absent`] : [])
          .concat(line.leaveCount ? [`${line.leaveCount} leave`] : [])
          .filter(Boolean)
          .join(" · "),
        amount: line.net,
        category: "Salary",
        status: { label: PAYROLL_STATUS_LABELS[status], tone: TONE[STATUS_TONE[status]] },
        /*
          **The payment pill names the balance, not the fact.** An approved but
          unpaid salary is the normal state and gets a plain "Rs 35,000 due";
          a pill appearing at all means the month has been approved, and a paid
          one says so. Before approval there is no payslip and so no payment to
          report — which is the truth, not an omission.
        */
        payment: !approved
          ? null
          : paymentFor(line).paidAmount >= paymentFor(line).amount
            ? { label: "Paid", tone: TONE.good }
            : paymentFor(line).paidAmount > 0
              ? { label: `${formatMoney(paymentFor(line).amount - paymentFor(line).paidAmount)} left`, tone: TONE.warn }
              : { label: `${formatMoney(paymentFor(line).amount)} due`, tone: TONE.warn },
        notes: line.note
          ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{line.note}</span></div>
          : null,
        detail: <FigureStrip figures={figuresFor(line)} isMobile={isMobile} />,
        actions: buildActions(line),
        onOpen: () => setOpened(line.uid),
      })),
    [page.items, status, buildActions, figuresFor, isMobile, approved, paymentFor]
  );

  const openedLine = useMemo(
    () => (opened ? (period?.lines ?? []).find((line) => line.uid === opened) ?? null : null),
    [opened, period]
  );

  const download = () => {
    const header = ["Month", "Name", "Role", "Basic", "Allowances", "Bonus", "One-off",
      "Commission", "Attendance deduction", "Other deductions", "Present", "Late", "Absent", "Leave", "Note", "Net"];
    const rows = lines.map((line) => [
      monthKey, line.name, line.jobTitle ?? "", String(line.basic), String(line.allowances),
      String(line.bonus), String(line.extraAdditions), String(line.commission),
      String(line.attendanceDeduction), String(line.otherDeductions),
      String(line.presentCount), String(line.lateCount), String(line.absentCount), String(line.leaveCount),
      line.note ?? "", String(line.net),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payroll-${monthKey}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /*
    **"Still to pay" is only true once the month is approved.** Before that
    nothing is payable — there are no payslips and every Pay from is absent — so
    saying it on a draft describes an obligation that does not exist yet.
  */
  const heroCaption = !period?.exists
    ? "Not generated yet — generating pulls every salary profile, commission and attendance deduction for the month."
    : !approved
      ? `${PAYROLL_STATUS_LABELS[status]} · ${totals.people} people · ${formatMoney(payable)} net, not payable until approved`
      : outstanding > 0
        ? `${PAYROLL_STATUS_LABELS[status]} · ${totals.people} people · ${formatMoney(outstanding)} still to pay to ${unpaidPeople}`
        : `${PAYROLL_STATUS_LABELS[status]} · ${totals.people} people · paid in full`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Salary & Payroll"
        figure={formatMoney(totals.net)}
        caption={heroCaption}
        isMobile={isMobile}
        tileIcon={ICON.wallet}
        stats={[
          { label: "PEOPLE", value: totals.people },
          { label: "GROSS", value: totals.additions },
          { label: "NET", value: totals.net },
        ]}
        mobileAction={
          editable
            ? <HeroTile onClick={generate} label="Generate payroll" d="M12 5v14M5 12h14" />
            : undefined
        }
        actions={
          <>
            {editable && (
              <HeroButton onClick={generate} disabled={busy}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M20 11A8 8 0 1 0 12 20M20 4v7h-7" /></svg>}>
                {period?.exists ? "Regenerate" : "Generate payroll"}
              </HeroButton>
            )}
            {back && status !== "DRAFT" && (
              <HeroButton onClick={() => void move(back)} disabled={busy}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4" /></svg>}>
                Send back
              </HeroButton>
            )}
            {period?.exists && next && (
              <HeroButton solid onClick={() => void move(next)} disabled={busy}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>}>
                {nextLabel(next, isAdmin)}
              </HeroButton>
            )}
            {/* **Deleting a payroll is the admin's alone.** HR prepares one and
                does not throw one away. Refused on the server once anything
                has been paid, and the message says who. */}
            {isAdmin && period?.exists && (
              <HeroButton onClick={() => setConfirmDelete(true)} disabled={busy}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.trash} /></svg>}>
                Delete payroll
              </HeroButton>
            )}
          </>
        }
      >
        {/* The month is this screen's period control, so it sits where every
            other money screen puts its period pill. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 999, padding: "3px 6px" }}>
            <MonthStepper monthKey={monthKey} onChange={setMonthKey} />
          </div>
          <span style={{ borderRadius: 999, border: "1px solid rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.18)", padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>
            {PAYROLL_STATUS_LABELS[status]}
          </span>
          {paid > 0 && (
            <span style={{ borderRadius: 999, border: "1px solid rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.18)", padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>
              {outstanding > 0 ? `${formatMoney(outstanding)} due` : "Paid in full"}
            </span>
          )}
        </div>
      </ExpenseHero>

      {banner && (
        <p role="status" style={{ borderRadius: 12, background: banner.ok ? "#e8f5f3" : "#fdeeec", border: `1px solid ${banner.ok ? "#bfe0dc" : "#f0c4bd"}`, padding: "11px 14px", fontSize: 12.5, fontWeight: 600, color: banner.ok ? X.deep : "#a33a29" }}>
          {banner.text}
        </p>
      )}

      {/* Two screens, one month: the payroll itself and the recurring pay
          behind it. Chips rather than the old tab row, so the control reads the
          same as every other filter on this screen. */}
      <ChipRow
        chips={[
          { label: "Monthly payroll", active: tab === "PAYROLL", pick: () => setTab("PAYROLL") },
          {
            // **Named for what it does, not for what it is.** "Salary profiles"
            // is where you set what somebody earns, and calling it that left the
            // owner asking where the option to add salaries was.
            label: "Set employee salaries",
            active: tab === "PROFILES",
            pick: () => { setTab("PROFILES"); setProfilesWanted(true); },
          },
        ]}
      />

      {/*
        **The one thing that stops a payroll being right, said on the payroll
        itself.** Everything else is derived — commission comes off finalised
        deal splits, deductions off attendance — so a basic salary of zero is
        the only input a person has to type, and somebody who has not typed it
        gets a month of zeroes with nothing on screen explaining why.
      */}
      {tab === "PAYROLL" && period?.exists && unsalaried.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderRadius: 12, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "12px 15px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
            <strong>{unsalaried.length} {unsalaried.length === 1 ? "person has" : "people have"} no salary set</strong>
            {" — "}{unsalaried.slice(0, 4).join(", ")}{unsalaried.length > 4 ? "…" : ""}. They will be
            paid nothing until a basic salary is entered.
          </span>
          <button type="button"
            onClick={() => { setTab("PROFILES"); setProfilesWanted(true); }}
            style={{ flexShrink: 0, borderRadius: 999, border: "none", background: X.teal, color: "#fff", padding: "9px 18px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Set their salaries
          </button>
        </div>
      )}

      {tab === "PROFILES" ? (
        <SalaryProfilesPanel
          profiles={salaryProfiles.profiles}
          error={salaryProfiles.error}
          reload={salaryProfiles.reload}
          onSaved={(text) => setBanner({ ok: true, text })}
          isAdmin={isAdmin}
        />
      ) : (
        <>
          <StatCards isMobile={isMobile} cards={statCards} />

          <MobileSearch value={search} onChange={setSearch} placeholder="Name, role or email" />
          <ChipRow
            chips={CUTS.map((value) => ({
              label: CUT_LABELS[value],
              active: cut === value,
              pick: () => setCut(value),
            }))}
          />

          <ExpenseList
            heading={`Payroll · ${monthLabel(monthKey)}`}
            count={`${lines.length} of ${period?.lines.length ?? 0}`}
            total={lines.reduce((sum, line) => sum + line.net, 0)}
            rows={rowModels}
            isMobile={isMobile}
            loading={false}
            empty={
              !period?.exists
                ? `Nothing generated for ${monthLabel(monthKey)} yet. Generating pulls each employee's salary profile, their commission from finalised deal splits, and their attendance deductions for the month.`
                : "Nobody matches these filters."
            }
            formatMoney={formatMoney}
            pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="people" />}
          />

          {period?.exists && (
            <button type="button" onClick={download}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 999, border: `1px solid ${X.line}`, background: "#fff", color: X.deep, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" /></svg>
              Download this month
            </button>
          )}
        </>
      )}

      {openedLine && (
        <OverlayPanel
          title={openedLine.name}
          subtitle={`${monthLabel(monthKey)} · ${formatMoney(openedLine.net)} net`}
          maxWidth={640}
          onClose={() => setOpened(null)}
        >
          <ExpenseDetail
            title={openedLine.name}
            amountLabel={formatMoney(openedLine.net)}
            formatMoney={formatMoney}
            status={{ label: PAYROLL_STATUS_LABELS[status], tone: TONE[STATUS_TONE[status]] }}
            payment={
              approved
                ? {
                    paid: paymentFor(openedLine).paidAmount,
                    outstanding: Math.max(0, paymentFor(openedLine).amount - paymentFor(openedLine).paidAmount),
                    label:
                      paymentFor(openedLine).paidAmount >= paymentFor(openedLine).amount ? "Paid" : "Part paid",
                    tone:
                      paymentFor(openedLine).paidAmount >= paymentFor(openedLine).amount ? TONE.good : TONE.warn,
                  }
                : null
            }
            legsHeading={`Where ${openedLine.name}'s salary was paid from`}
            legs={legsFor(openedLine.uid)}
            notFunded={
              approved
                ? "This salary has not been paid out of any account yet — use Pay from\u2026"
                : "Salaries can be paid once the month is approved."
            }
            extra={
              <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
                  How this net was reached
                </div>
                <FigureStrip figures={figuresFor(openedLine)} isMobile={isMobile} />
              </section>
            }
            fields={[
              { label: "Month", value: monthLabel(monthKey) },
              { label: "Role", value: openedLine.jobTitle ?? "—" },
              { label: "Email", value: openedLine.email ?? "—" },
              { label: "Attendance", value: `${openedLine.presentCount} present · ${openedLine.lateCount} late · ${openedLine.absentCount} absent · ${openedLine.leaveCount} leave` },
              { label: "Note", value: openedLine.note ?? "—", wide: true },
            ]}
            history={(period?.history ?? [])
              .filter((entry) => !entry.detail || entry.detail.includes(openedLine.name) || entry.action.startsWith("STATUS_") || entry.action.endsWith("GENERATED"))
              .map((entry) => ({
                at: stamp(entry.at ?? ""),
                action: entry.action.replace(/_/g, " ").toLowerCase(),
                by: entry.byName,
                detail: entry.detail,
                amount: null,
              }))}
            actions={buildActions(openedLine).map((action) => (
              <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                onClick={() => { setOpened(null); action.onClick(); }} />
            ))}
          />
        </OverlayPanel>
      )}

      {/*
        **One person, any accounts.** Sundus's salary can come out of the
        Committee and Rafia's out of Car Sale, on different days — the same
        split control, the same arithmetic and the same duplicate-payment guard
        every other module uses. `submit` routes it through payroll's own
        action, which is what enforces "approved first, admin only, and the
        month turns Paid when the last person is settled".
      */}
      {paying && period?.exists && (
        <PayFromAccounts
          open
          onClose={() => setPaying(null)}
          onPaid={(text) => { setBanner({ ok: true, text }); setPaying(null); reload(); }}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          submit={async ({ allocations, dayKey, note }) => {
            const result = await payPayrollLine(await getIdToken(), monthKey, paying.uid, { allocations, dayKey, note });
            return result.ok
              ? { ok: true as const, fullyPaid: result.data.fullyPaid, posted: result.data.posted }
              : { ok: false as const, error: result.error };
          }}
          source={{
            module: "PAYROLL",
            collection: "payslips",
            id: `${paying.uid}_${monthKey}`,
            label: `${paying.name} — salary ${monthLabel(monthKey)}`,
            amount: paymentFor(paying).amount,
            alreadyPaid: paymentFor(paying).paidAmount,
          }}
        />
      )}

      {confirmDelete && (
        <OverlayPanel title="Delete this payroll?" maxWidth={440} onClose={() => setConfirmDelete(false)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setConfirmDelete(false)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busy}
                onClick={() => void run(async (token) => {
                  const result = await deletePayroll(token, monthKey);
                  setConfirmDelete(false);
                  return result.ok
                    ? { ok: true, text: `${monthLabel(monthKey)} deleted, along with ${result.data.slipsRemoved} payslip${result.data.slipsRemoved === 1 ? "" : "s"}. Generate it again whenever you like.` }
                    : { ok: false, text: result.error };
                })}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
                {busy ? "Deleting…" : "Delete payroll"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{monthLabel(monthKey)}</strong> · {totals.people} people · {formatMoney(totals.net)} net
          </p>
          <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
            The generated payroll and every payslip it produced are removed. Nothing that has
            already been paid is touched — if any salary has gone out, the delete is refused and
            names who was paid. You can generate the month again afterwards.
          </p>
        </OverlayPanel>
      )}

      {editing && (
        <PayrollLineModal
          line={editing}
          monthKey={monthKey}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setBanner({ ok: true, text });
            reload();
          }}
          save={adjustPayrollLine}
        />
      )}

      {slipFor && (
        <PayslipPanel
          line={slipFor}
          monthKey={monthKey}
          status={status}
          onClose={() => setSlipFor(null)}
        />
      )}
    </div>
  );
}
