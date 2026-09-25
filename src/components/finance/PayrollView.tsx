"use client";

/**
 * Salary / Payroll — the simple version (owner, 2026-09-25).
 *
 * Same screen as before — `expensesChrome`'s hero, stat cards, rows and detail
 * panel, cards on the phone — with the machinery behind it taken out:
 *
 * - **A month is always live.** Salary + allowance (cut for a mid-month
 *   joining) + finalised commission − the deduction Attendance Settings
 *   produces. No Generate, no Review, no Approve, no Delete.
 * - **Pay from…** on each person, the admin's alone, out of any account. The
 *   first payment freezes that person's figures for the month and releases
 *   their payslip.
 * - **Salaries** is the second tab: salary, allowance, joining date — the admin
 *   and HR both edit it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLedger } from "@/hooks/useLedger";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { getPayroll, payPayrollLine } from "@/lib/clientActions";
import type { PayrollPeriod } from "@/app/actions/payroll";
import type { PayrollLine } from "@/lib/payroll";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, karachiMonthKey } from "@/lib/dates";
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
import { SalaryModal, SalaryProfilesPanel, useSalaryProfiles } from "./SalaryProfilesPanel";
import { PayslipPanel } from "./PayslipPanel";

const CUTS = ["ALL", "UNPAID", "PAID", "COMMISSION", "DEDUCTIONS"] as const;
type Cut = (typeof CUTS)[number];

const CUT_LABELS: Record<Cut, string> = {
  ALL: "Everyone",
  UNPAID: "Still to pay",
  PAID: "Paid",
  COMMISSION: "With commission",
  DEDUCTIONS: "With deductions",
};

const SALARIES_ICON = "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6";

function joinedPhrase(line: PayrollLine): string | null {
  if (!line.joinedAt || !line.paidDays || !line.monthDays || line.paidDays >= line.monthDays) return null;
  return `Joined ${formatBusinessDate(new Date(`${line.joinedAt}T12:00:00+05:00`))} · paid ${line.paidDays} of ${line.monthDays} days`;
}

export function PayrollView() {
  const { role, getIdToken } = useAuth();
  // Paying is the admin's; HR enters salaries and sees the figures (owner, 2026-09-25).
  const isAdmin = role === "admin";
  const isMobile = useIsMobile();

  const [monthKey, setMonthKey] = useState(() => shiftMonth(karachiMonthKey(), 0));
  const [tab, setTab] = useState<"PAYROLL" | "SALARIES">("PAYROLL");
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [slipFor, setSlipFor] = useState<PayrollLine | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayrollLine | null>(null);
  const [editingSalary, setEditingSalary] = useState<PayrollLine | null>(null);
  const [nonce, setNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [cut, setCut] = useState<Cut>("ALL");

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  // The accounts a salary is paid from. Only the admin pays, so only the admin
  // opens this listener.
  const ledger = useLedger(isAdmin);

  const [salariesWanted, setSalariesWanted] = useState(false);
  const salaries = useSalaryProfiles(salariesWanted);
  const openSalaries = () => {
    setTab("SALARIES");
    setSalariesWanted(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      setLoadedKey(`${monthKey}:${nonce}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [monthKey, getIdToken, nonce]);

  const loading = loadedKey !== `${monthKey}:${nonce}`;
  const allLines = useMemo(() => (period?.monthKey === monthKey ? period.lines : []), [period, monthKey]);

  const paymentFor = useCallback(
    (line: PayrollLine) => period?.payments?.[line.uid] ?? { amount: line.net, paidAmount: 0, status: "UNPAID" as const },
    [period]
  );
  const isSettled = useCallback(
    (line: PayrollLine) => {
      const payment = paymentFor(line);
      return payment.amount <= 0 || payment.paidAmount >= payment.amount;
    },
    [paymentFor]
  );

  const totals = useMemo(() => {
    let net = 0, gross = 0, commission = 0, deductions = 0, paid = 0;
    for (const line of allLines) {
      net += line.net;
      gross += line.basic + line.allowances + line.bonus + line.extraAdditions + line.commission;
      commission += line.commission;
      deductions += line.attendanceDeduction + line.otherDeductions;
      paid += paymentFor(line).paidAmount;
    }
    return { people: allLines.length, net, gross, commission, deductions, paid, outstanding: Math.max(0, net - paid) };
  }, [allLines, paymentFor]);

  const unpaidPeople = allLines.filter((line) => !isSettled(line)).length;
  const unsalaried = allLines.filter((line) => (line.salary ?? line.basic) <= 0).map((line) => line.name);

  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allLines.filter((line) => {
      if (cut === "UNPAID" && isSettled(line)) return false;
      if (cut === "PAID" && paymentFor(line).paidAmount <= 0) return false;
      if (cut === "COMMISSION" && line.commission <= 0) return false;
      if (cut === "DEDUCTIONS" && line.attendanceDeduction + line.otherDeductions <= 0) return false;
      if (!needle) return true;
      return (
        line.name.toLowerCase().includes(needle) ||
        (line.jobTitle ?? "").toLowerCase().includes(needle) ||
        (line.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [allLines, search, cut, isSettled, paymentFor]);

  const page = usePagination(lines, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number, of: number) => (of ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
    return [
      {
        label: "On The Payroll", value: String(totals.people),
        note: `${formatMoney(totals.gross)} before deductions`,
        pill: monthLabel(monthKey), pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.user,
      },
      {
        label: "Commission", value: formatMoney(totals.commission),
        note: "from finalised deal splits", pill: `${pct(totals.commission, totals.gross)}%`,
        tone: "good", pct: pct(totals.commission, totals.gross),
        color: "#2f7d78", accent: "#4fa39c", icon: ICON.bars,
      },
      {
        label: "Attendance Deductions", value: formatMoney(totals.deductions),
        note: "late and absent days, by Attendance Settings",
        pill: `${pct(totals.deductions, totals.gross)}%`, tone: "warn",
        pct: pct(totals.deductions, totals.gross),
        color: "#a5762a", accent: "#c99a2e", icon: ICON.clock,
      },
      {
        label: totals.outstanding > 0 ? "Left To Pay" : "Paid",
        value: formatMoney(totals.outstanding > 0 ? totals.outstanding : totals.paid),
        note: totals.paid > 0
          ? `${formatMoney(totals.paid)} of ${formatMoney(totals.net)} paid · ${unpaidPeople} still owed`
          : `${unpaidPeople} ${unpaidPeople === 1 ? "person" : "people"} still to be paid`,
        pill: totals.outstanding > 0 ? "Owing" : "Settled",
        tone: totals.outstanding > 0 ? "warn" : "good",
        pct: pct(totals.paid, totals.net),
        color: totals.outstanding > 0 ? "#a5762a" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet,
      },
    ];
  }, [totals, monthKey, unpaidPeople]);

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

  /** Every figure behind a net, in the order a payslip reads them. */
  const figuresFor = useCallback((line: PayrollLine): Figure[] => {
    const cut = joinedPhrase(line);
    const figures: Figure[] = [
      { label: "Salary", value: formatMoney(line.basic), tone: "muted", hint: cut ? `${line.paidDays}/${line.monthDays} days` : null },
    ];
    if (line.allowances) figures.push({ label: "Allowance", value: formatMoney(line.allowances), tone: "muted" });
    if (line.bonus + line.extraAdditions) figures.push({ label: "Bonus", value: formatMoney(line.bonus + line.extraAdditions), tone: "muted" });
    if (line.commission) figures.push({ label: "Commission", value: formatMoney(line.commission), tone: "good" });
    if (line.attendanceDeduction) {
      figures.push({
        label: "Attendance", value: `− ${formatMoney(line.attendanceDeduction)}`, tone: "warn",
        hint: [line.lateCount ? `${line.lateCount} late` : null, line.absentCount ? `${line.absentCount} absent` : null]
          .filter(Boolean).join(" · ") || null,
      });
    }
    if (line.otherDeductions) figures.push({ label: "Other deductions", value: `− ${formatMoney(line.otherDeductions)}`, tone: "warn" });
    figures.push({ label: "Net pay", value: formatMoney(line.net), tone: "good", strong: true });
    return figures;
  }, []);

  const statusFor = useCallback((line: PayrollLine) => {
    const payment = paymentFor(line);
    if (payment.amount > 0 && payment.paidAmount >= payment.amount) return { label: "Paid", tone: TONE.good };
    if (payment.paidAmount > 0) return { label: "Part paid", tone: TONE.warn };
    return { label: "Not paid", tone: TONE.quiet };
  }, [paymentFor]);

  const buildActions = useCallback((line: PayrollLine): RowAction[] => {
    const actions: RowAction[] = [
      { key: "slip", label: "Payslip", d: ICON.receipt, tone: "quiet", onClick: () => setSlipFor(line) },
    ];
    // Admin and HR both set salaries. Not once somebody has been paid: their
    // month is frozen, and a changed salary would only reach next month.
    if (paymentFor(line).paidAmount <= 0) {
      actions.push({ key: "salary", label: "Edit salary", d: ICON.edit, tone: "quiet", onClick: () => setEditingSalary(line) });
    }
    // Absent, not disabled, once somebody is settled or for anybody but the admin.
    if (isAdmin && !isSettled(line)) {
      actions.push({ key: "pay", label: "Pay from…", d: ICON.wallet, tone: "good", onClick: () => setPaying(line) });
    }
    return actions;
  }, [isAdmin, isSettled, paymentFor]);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((line) => {
        const payment = paymentFor(line);
        const left = Math.max(0, payment.amount - payment.paidAmount);
        return {
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
          status: statusFor(line),
          payment: left > 0 && payment.paidAmount > 0 ? { label: `${formatMoney(left)} left`, tone: TONE.warn } : null,
          notes: joinedPhrase(line)
            ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{joinedPhrase(line)}</span></div>
            : null,
          detail: <FigureStrip figures={figuresFor(line)} isMobile={isMobile} />,
          actions: buildActions(line),
          onOpen: () => setOpened(line.uid),
        };
      }),
    [page.items, buildActions, figuresFor, isMobile, paymentFor, statusFor]
  );

  const openedLine = useMemo(
    () => (opened ? allLines.find((line) => line.uid === opened) ?? null : null),
    [opened, allLines]
  );

  const download = () => {
    const header = ["Month", "Name", "Role", "Joined", "Paid days", "Salary", "Allowance", "Commission",
      "Attendance deduction", "Present", "Late", "Absent", "Leave", "Net", "Paid"];
    const rows = lines.map((line) => [
      monthKey, line.name, line.jobTitle ?? "", line.joinedAt ?? "",
      line.paidDays && line.monthDays ? `${line.paidDays}/${line.monthDays}` : "",
      String(line.basic), String(line.allowances), String(line.commission), String(line.attendanceDeduction),
      String(line.presentCount), String(line.lateCount), String(line.absentCount), String(line.leaveCount),
      String(line.net), String(paymentFor(line).paidAmount),
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

  const heroCaption = loading
    ? "Working out the month…"
    : totals.people === 0
      ? "Nobody on the payroll for this month."
      : totals.outstanding > 0
        ? `${totals.people} people · ${formatMoney(totals.outstanding)} still to pay to ${unpaidPeople}`
        : `${totals.people} people · paid in full`;

  const salariesIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d={SALARIES_ICON} /></svg>
  );

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
          { label: "GROSS", value: totals.gross },
          { label: "NET", value: totals.net },
        ]}
        mobileAction={<HeroTile onClick={openSalaries} label="Salaries" d={SALARIES_ICON} />}
        actions={<HeroButton onClick={openSalaries} icon={salariesIcon}>Salaries</HeroButton>}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 999, padding: "3px 6px" }}>
            <MonthStepper monthKey={monthKey} onChange={setMonthKey} />
          </div>
          {totals.people > 0 && !loading && (
            <span style={{ borderRadius: 999, border: "1px solid rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.18)", padding: "5px 14px", fontSize: 12, fontWeight: 700 }}>
              {totals.outstanding > 0 ? `${formatMoney(totals.outstanding)} due` : "Paid in full"}
            </span>
          )}
        </div>
      </ExpenseHero>

      {banner && (
        <p role="status" style={{ borderRadius: 12, background: banner.ok ? "#e8f5f3" : "#fdeeec", border: `1px solid ${banner.ok ? "#bfe0dc" : "#f0c4bd"}`, padding: "11px 14px", fontSize: 12.5, fontWeight: 600, color: banner.ok ? X.deep : "#a33a29" }}>
          {banner.text}
        </p>
      )}

      <ChipRow
        chips={[
          { label: "Monthly payroll", active: tab === "PAYROLL", pick: () => setTab("PAYROLL") },
          { label: "Salaries", active: tab === "SALARIES", pick: openSalaries },
        ]}
      />

      {tab === "PAYROLL" && !loading && unsalaried.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderRadius: 12, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "12px 15px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
            <strong>{unsalaried.length} {unsalaried.length === 1 ? "person has" : "people have"} no salary set</strong>
            {" — "}{unsalaried.slice(0, 4).join(", ")}{unsalaried.length > 4 ? "…" : ""}.
          </span>
          <button type="button" onClick={openSalaries}
            style={{ flexShrink: 0, borderRadius: 999, border: "none", background: X.teal, color: "#fff", padding: "9px 18px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Set salaries
          </button>
        </div>
      )}

      {tab === "SALARIES" ? (
        <SalaryProfilesPanel
          profiles={salaries.profiles}
          error={salaries.error}
          reload={() => { salaries.reload(); reload(); }}
          onSaved={(text) => setBanner({ ok: true, text })}
        />
      ) : (
        <>
          <StatCards isMobile={isMobile} cards={statCards} />

          <MobileSearch value={search} onChange={setSearch} placeholder="Name, role or email" />
          <ChipRow chips={CUTS.map((value) => ({ label: CUT_LABELS[value], active: cut === value, pick: () => setCut(value) }))} />

          <ExpenseList
            heading={`Payroll · ${monthLabel(monthKey)}`}
            count={`${lines.length} of ${allLines.length}`}
            total={lines.reduce((sum, line) => sum + line.net, 0)}
            rows={rowModels}
            isMobile={isMobile}
            loading={loading}
            empty={allLines.length === 0 ? `Nobody is on the payroll for ${monthLabel(monthKey)}.` : "Nobody matches these filters."}
            formatMoney={formatMoney}
            pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="people" />}
          />

          {allLines.length > 0 && (
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
            status={statusFor(openedLine)}
            payment={{
              paid: paymentFor(openedLine).paidAmount,
              outstanding: Math.max(0, paymentFor(openedLine).amount - paymentFor(openedLine).paidAmount),
              label: statusFor(openedLine).label,
              tone: statusFor(openedLine).tone,
            }}
            legsHeading={`Where ${openedLine.name}'s salary was paid from`}
            legs={legsFor(openedLine.uid)}
            notFunded={isAdmin ? "Not paid out of any account yet — use Pay from…" : "Not paid yet. The admin pays salaries."}
            extra={
              <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
                  How this net was reached
                </div>
                <FigureStrip figures={figuresFor(openedLine)} isMobile={isMobile} />
                {(openedLine.deductionBasis ?? []).length > 0 && (
                  <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 12, color: X.body, lineHeight: 1.6 }}>
                    {(openedLine.deductionBasis ?? []).map((basis, index) => <li key={index}>{basis}</li>)}
                  </ul>
                )}
              </section>
            }
            fields={[
              { label: "Month", value: monthLabel(monthKey) },
              { label: "Role", value: openedLine.jobTitle ?? "—" },
              { label: "Monthly salary", value: formatMoney((openedLine.salary ?? openedLine.basic) + (openedLine.allowance ?? openedLine.allowances)) },
              { label: "Joined", value: openedLine.joinedAt ? formatBusinessDate(new Date(`${openedLine.joinedAt}T12:00:00+05:00`)) : "—" },
              { label: "Attendance", value: `${openedLine.presentCount} present · ${openedLine.lateCount} late · ${openedLine.absentCount} absent · ${openedLine.leaveCount} leave`, wide: true },
            ]}
            history={[]}
            actions={buildActions(openedLine).map((action) => (
              <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                onClick={() => { setOpened(null); action.onClick(); }} />
            ))}
          />
        </OverlayPanel>
      )}

      {paying && isAdmin && (
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

      {editingSalary && (
        <SalaryModal
          profile={{
            uid: editingSalary.uid,
            name: editingSalary.name,
            email: editingSalary.email,
            jobTitle: editingSalary.jobTitle,
            role: "",
            salary: editingSalary.salary ?? editingSalary.basic,
            allowance: editingSalary.allowance ?? editingSalary.allowances,
            joinedAt: editingSalary.joinedAt ?? null,
          }}
          onClose={() => setEditingSalary(null)}
          onSaved={(text) => {
            setEditingSalary(null);
            setBanner({ ok: true, text });
            salaries.reload();
            reload();
          }}
        />
      )}

      {slipFor && (
        <PayslipPanel
          line={slipFor}
          monthKey={monthKey}
          status={isSettled(slipFor) ? "PAID" : paymentFor(slipFor).paidAmount > 0 ? "APPROVED" : "DRAFT"}
          onClose={() => setSlipFor(null)}
        />
      )}
    </div>
  );
}
