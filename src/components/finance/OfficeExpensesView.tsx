"use client";

/**
 * Office Expenses — dashboard, ledger and reports on one screen.
 *
 * **Admin and HR only.** The route guards it, the Server Actions refuse
 * everybody else, and the Security Rule refuses the read — three layers,
 * because the brief is unusually firm that managers and employees must not see
 * this at all.
 *
 * Three tabs rather than three routes: the filters are shared, and a person
 * who has just filtered to "Marketing, this quarter" should be able to see the
 * ledger and the breakdown of that same selection without setting it twice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOfficeExpenses } from "@/hooks/useOfficeExpenses";
import {
  deleteOfficeExpense,
  getExpenseCategories,
  setOfficeExpenseStatus,
} from "@/lib/clientActions";
import {
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  expenseRecorders,
  expensesByCategory,
  expensesByPeriod,
  readPaid,
  summarizeExpenses,
  trendPercent,
  type ExpenseStatus,
  type OfficeExpense,
} from "@/lib/officeExpenses";
import { useSubAdmins } from "@/hooks/useEmployees";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import {
  Banner,
  F,
  FinanceCard,
  EmptyState,
  ShareBar,
  rupees,
} from "./financeChrome";
import {
  ChipRow,
  ExpenseDetail,
  ExpenseHero,
  ExpenseList,
  FilterPanel,
  FloatingAdd,
  HeroButton,
  HeroTile,
  ICON,
  MobileSearch,
  PeriodPill,
  Segmented,
  StatCards,
  TONE,
  DetailAction,
  type ExpenseRowModel,
  type FundingLeg,
  type RowAction,
  type StatCard,
} from "./expensesChrome";
import { HISTORY_LABELS } from "@/lib/officeExpenses";
import { ExpenseFormModal } from "./ExpenseFormModal";
import { PayFromAccounts } from "@/components/accounts/PayFromAccounts";
import { PayPeriodTotal } from "@/components/accounts/PayPeriodTotal";
import { monthLabel } from "@/lib/groupFinance";
import { useLedger } from "@/hooks/useLedger";
import { ExpenseCategoriesModal } from "./ExpenseCategoriesModal";
import { OverlayPanel } from "@/components/ui/OverlayPanel";

/** The first of the current month — the period an expense question usually means. */
function monthStart(): string {
  return `${karachiMonthKey()}-01`;
}

/**
 * The category and status palettes, transcribed from `Office Expenses.dc.html`.
 *
 * The design names four categories; this project's are **editable** and there
 * can be any number of them, so an unlisted one falls to `Office` rather than
 * rendering with no colour at all. Matching is case-insensitive because a
 * category typed as "marketing" is the same spend as one typed "Marketing".
 */

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                         */
/* -------------------------------------------------------------------------- */

/** An inline 16px stroke icon, for the hero pills. */
function Glyph({ d, width = 1.9, size = 16 }: { d: string; width?: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The three status tones, in the design's tag palette. */
function statusTone(status: ExpenseStatus) {
  return status === "APPROVED" ? TONE.good : status === "REJECTED" ? TONE.bad : TONE.warn;
}

/**
 * The second line under a row: the description, a decision note, a receipt.
 *
 * Absent entirely when there is none — an empty element would still take the
 * 6px margin and push every row apart for nothing.
 */
function renderNotes(expense: OfficeExpense) {
  if (!expense.description && !expense.decisionNote && !expense.receiptUrl) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 6 }}>
      {expense.description && <span style={{ fontSize: 11.5, color: "#6c7d7b", fontWeight: 500 }}>{expense.description}</span>}
      {expense.decisionNote && (
        <span style={{ fontSize: 11, color: "#6c7d7b", fontWeight: 500 }}>
          {expense.decidedByName ?? "Decision"}: {expense.decisionNote}
        </span>
      )}
      {expense.receiptUrl && (
        <a href={expense.receiptUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#2f7d78" }}>
          <Paperclip size={12} /> {expense.receiptName ?? "Receipt"}
        </a>
      )}
    </div>
  );
}

/** `2026-09-10T15:11:34.298Z` → `10 Sep 2026, 20:11` in Karachi. */
export function stamp(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function OfficeExpensesView({ isAdmin: routeIsAdmin }: { isAdmin: boolean }) {
  const { getIdToken, user, role } = useAuth();
  /*
    **The role decides, not the route.** `/admin/accounts/office-expenses`
    renders this with `isAdmin` hardcoded, and an HR manager may open it — which
    would run the unscoped query their rule refuses and leave the screen empty.
    The prop is a ceiling, never the answer: both have to agree.
  */
  const isAdmin = routeIsAdmin && role === "admin";
  /*
    **HR reads only what HR recorded; the admin reads everything.** The clause
    is in the query because a Firestore *list* is checked against the rules
    before it runs — an unscoped read here is refused outright rather than
    trimmed, and the screen would render empty.
  */
  const { expenses, loading, error } = useOfficeExpenses(true, isAdmin ? null : user?.uid ?? null);
  // Mobile is the primary surface here: the filters stack, the two header
  // actions go full width, and every action stays present rather than
  // being dropped for space.
  const isMobile = useIsMobile();

  const [tab, setTab] = useState<"LEDGER" | "REPORTS">("LEDGER");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(karachiDayKey());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ExpenseStatus | "ALL">("ALL");
  const [category, setCategory] = useState("ALL");
  /**
   * Whose expenses the screen is about — `ALL`, or one recorder's uid.
   *
   * **This is a subject, not a cut, and that is why every figure follows it.**
   * Status and category narrow the list inside the record and deliberately
   * leave the headline alone, because a total that fell when somebody clicked
   * "Pending" would read as the company having spent less. "Whose are these"
   * is a different question — the same one Reports asks with its subject
   * selector — and the honest answer to *Tayyab's, this month* is Tayyab's
   * totals, not the company's with his rows listed underneath.
   */
  const [recordedBy, setRecordedBy] = useState<string>("ALL");
  /**
   * The expense being funded. `paidOf` reads what has already been paid
   * against it, so a part-paid expense offers "Pay balance" and the modal only
   * lets the remainder be allocated — the obligation itself never changes.
   */
  const [paying, setPaying] = useState<OfficeExpense | null>(null);
  const ledger = useLedger(true);
  const [grain, setGrain] = useState<"day" | "month" | "year">("month");

  const [categories, setCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<OfficeExpense | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingCategories, setManagingCategories] = useState(false);
  const [showPeriod, setShowPeriod] = useState(false);
  /** The expense whose detail panel is open. Opened by clicking its row. */
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reloadCategories = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;

      const result = await getExpenseCategories(token);
      if (cancelled) return;
      if (result.ok) setCategories(result.data.categories);
    })();

    return () => {
      cancelled = true;
    };
  }, [getIdToken, nonce]);

  /*
    **Who may be selected, from the expenses themselves.** The admin reads
    everybody's, so the recorders are whoever has actually submitted something —
    usually the admin and the HR manager. Names come from the manager roster
    (one shared listener, already open elsewhere) with the email stored on the
    expense as the fallback, so somebody who has since left is still named.
    For an HR manager the query is already scoped to their own uid, so there is
    one recorder and the control hides itself.
  */
  const { subAdmins } = useSubAdmins(isAdmin);
  const recorderNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const manager of subAdmins) map[manager.uid] = manager.name;
    return map;
  }, [subAdmins]);
  const recorders = useMemo(
    () => expenseRecorders(expenses, { selfUid: user?.uid, names: recorderNames }),
    [expenses, user?.uid, recorderNames]
  );
  const subjectLabel =
    recordedBy === "ALL"
      ? null
      : (recorders.find((person) => person.uid === recordedBy)?.label ?? "That person");

  /** The subject first: every figure below describes this person's expenses. */
  const subject = useMemo(
    () =>
      recordedBy === "ALL"
        ? expenses
        : expenses.filter((expense) => (expense.addedByUid ?? "") === recordedBy),
    [expenses, recordedBy]
  );

  /** Then the range — every figure on the screen belongs to the same period. */
  const inRange = useMemo(
    () => subject.filter((expense) => expense.dayKey >= from && expense.dayKey <= to),
    [subject, from, to]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((expense) => {
      if (status !== "ALL" && expense.status !== status) return false;
      if (category !== "ALL" && expense.category !== category) return false;
      if (!needle) return true;
      return (
        expense.title.toLowerCase().includes(needle) ||
        (expense.paidBy ?? "").toLowerCase().includes(needle) ||
        (expense.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, status, category]);

  // The dashboard describes the **range**, not the filter. A total that fell
  // when somebody clicked "Pending" would read as the company having spent
  // less, which is the opposite of what happened.
  const summary = useMemo(() => summarizeExpenses(inRange), [inRange]);
  // This month's figure follows the subject too — "This Month" beside Tayyab's
  // totals can only mean Tayyab's month.
  const monthSummary = useMemo(
    () =>
      summarizeExpenses(
        subject.filter((expense) => expense.dayKey.startsWith(karachiMonthKey()))
      ),
    [subject]
  );
  const byCategory = useMemo(() => expensesByCategory(inRange), [inRange]);
  const byPeriod = useMemo(() => expensesByPeriod(inRange, grain), [inRange, grain]);
  const trend = useMemo(() => trendPercent(byPeriod), [byPeriod]);

  /** What the rows on screen come to — the design prints it beside the count. */
  const listedTotal = useMemo(
    () => filtered.reduce((sum, expense) => sum + expense.amount, 0),
    [filtered]
  );

  const decide = useCallback(async (expense: OfficeExpense, next: ExpenseStatus) => {
    setBusyId(expense.id);
    const token = await getIdToken();
    const result = await setOfficeExpenseStatus(token, expense.id, next);
    setBusyId(null);
    setBanner(
      result.ok
        ? { ok: true, text: `"${expense.title}" ${EXPENSE_STATUS_LABELS[next].toLowerCase()}.` }
        : { ok: false, text: result.error }
    );
  }, [getIdToken]);

  const remove = useCallback(async (expense: OfficeExpense) => {
    setBusyId(expense.id);
    const token = await getIdToken();
    const result = await deleteOfficeExpense(token, expense.id);
    setBusyId(null);
    setBanner(
      result.ok
        ? { ok: true, text: `"${expense.title}" deleted.` }
        : { ok: false, text: result.error }
    );
  }, [getIdToken]);

  const page = usePagination(filtered, 12);

  /**
   * The five headline figures.
   *
   * Built here rather than in the chrome because the arithmetic is this
   * screen's — `StatCards` draws whatever it is handed, which is what lets
   * Personal Expenses use the same five tiles for a different set of numbers.
   */
  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number) => (summary.total ? Math.round((n / summary.total) * 100) : 0);
    return [
      { label: "Total Invoiced", value: rupees(summary.total), note: "every record in range", pill: `${summary.count} recs`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
      { label: "This Month", value: rupees(monthSummary.spend), note: "approved", pill: null, pct: pct(monthSummary.spend), color: "#141f1e", accent: "#4fa39c", icon: ICON.calendar },
      { label: "Pending", value: rupees(summary.pending), note: `${summary.pendingCount} awaiting a decision`, pill: summary.pendingCount ? "Action" : "Clear", tone: summary.pendingCount ? "warn" : "quiet", pct: pct(summary.pending), color: "#a5762a", accent: "#c99a2e", icon: ICON.clock },
      { label: "Approved", value: rupees(summary.approved), note: `${summary.approvedCount} records`, pill: `${pct(summary.approved)}%`, tone: "good", pct: pct(summary.approved), color: "#2f7d78", accent: "#2f7d78", icon: ICON.check },
    ];
  }, [summary, monthSummary]);

  /** The funding movements, by the expense they paid for. */
  const legsByExpense = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "OFFICE_EXPENSE" || !txn.sourceId) continue;
      const list = map.get(txn.sourceId) ?? [];
      list.push({
        id: txn.id,
        accountName: names.get(txn.accountId) ?? "A deleted account",
        amount: txn.amount,
        dayKey: txn.dayKey,
        note: txn.note ?? null,
        by: txn.createdByName ?? null,
      });
      map.set(txn.sourceId, list);
    }
    return map;
  }, [ledger.transactions, ledger.accounts]);

  /**
   * One expense, as a row.
   *
   * The design draws exactly three action pills. The real screen has up to
   * five, because approving, paying and deleting are separate acts here — they
   * take the design's pill shape and its three tones rather than being cut to
   * fit the drawing.
   */
  const buildActions = useCallback((expense: OfficeExpense, compact: boolean): RowAction[] => {
    const { paid, settled } = readPaid(expense);
    const actions: RowAction[] = [];

    /*
      **Approving is the admin's.** For HR the two buttons are *absent* rather
      than present and failing — offering a control whose only outcome is
      "That action is for administrators" is worse than not offering it. The
      server refuses it either way; this is what the screen says about it.
    */
    if (isAdmin && expense.status !== "APPROVED") {
      actions.push({ key: "approve", label: "Approve", d: ICON.check, tone: "good", onClick: () => void decide(expense, "APPROVED"), disabled: busyId === expense.id });
    }
    if (isAdmin && expense.status !== "REJECTED") {
      actions.push({ key: "reject", label: "Reject", d: ICON.cross, tone: "bad", onClick: () => void decide(expense, "REJECTED"), disabled: busyId === expense.id });
    }
    // **A settled expense offers no Pay button at all.** It used to offer one
    // reading "Paid", which opened the split panel on an expense with nothing
    // left to allocate — every submission from it could only be refused.
    /*
      **Paying stays open to HR, and deliberately.** They cannot approve, and
      only an approved expense can be funded — so an HR expense has already been
      through the admin by the time this appears. Hiding it would also put the
      screen at odds with the server, which allows it: a control missing for a
      thing you are permitted to do is as confusing as one that errors.
    */
    if (expense.status === "APPROVED" && !settled) {
      actions.push({
        key: "pay",
        label: paid > 0 ? (compact ? "Pay rest" : "Pay balance") : compact ? "Pay" : "Pay from…",
        shortLabel: paid > 0 ? "Pay rest" : "Pay",
        d: ICON.wallet, tone: "good", onClick: () => setPaying(expense),
      });
    }
    actions.push({ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditing(expense) });
    if (isAdmin && expense.status !== "APPROVED") {
      actions.push({ key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void remove(expense), disabled: busyId === expense.id });
    }
    return actions;
  }, [busyId, isAdmin, decide, remove]);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((expense) => {
        const { paid, outstanding, settled } = readPaid(expense);
        return {
          id: expense.id,
          title: expense.title,
          meta: [expense.dayKey, expense.category]
            .concat(expense.paidBy ? [`paid by ${expense.paidBy}`] : [])
            .concat(expense.paymentMethod ? [expense.paymentMethod] : [])
            .join(" · "),
          amount: expense.amount,
          category: expense.category,
          status: { label: EXPENSE_STATUS_LABELS[expense.status], tone: statusTone(expense.status) },
          /*
            **The payment state is its own pill, because it is its own
            question.** Approved says the company agreed to the cost; paid says
            the money has actually left an account. An approved-but-unfunded
            expense is the normal state and needs no pill, so one appears only
            once money has moved — and it names the balance still owed rather
            than only the fact of a part payment, which is the figure somebody
            acts on.
          */
          payment: paid > 0
            ? { label: settled ? "Paid" : `${rupees(outstanding)} due`, tone: settled ? TONE.good : TONE.warn }
            : null,
          notes: renderNotes(expense),
          actions: buildActions(expense, isMobile),
          onOpen: () => setOpened(expense.id),
        };
      }),
    [page.items, buildActions, isMobile]
  );

  /** The opened expense, resolved live so a change behind the panel shows. */
  const openedExpense = useMemo(
    () => (opened ? expenses.find((expense) => expense.id === opened) ?? null : null),
    [opened, expenses]
  );

  const download = () => {
    // **Recorded by** is a column now, because the export is the thing somebody
    // takes away and a per-person file with no per-person column cannot be
    // checked against the screen it came from.
    const header = ["Date", "Title", "Category", "Amount", "Status", "Paid by", "Method", "Recorded by", "Notes"];
    const rows = filtered.map((expense) => [
      expense.dayKey,
      expense.title,
      expense.category,
      expense.amount,
      EXPENSE_STATUS_LABELS[expense.status],
      expense.paidBy ?? "",
      expense.paymentMethod ?? "",
      recorders.find((person) => person.uid === (expense.addedByUid ?? ""))?.label ??
        expense.addedByEmail ??
        "",
      expense.description ?? "",
    ]);

    // Every field quoted: a description with a comma would otherwise shift
    // every column after it by one, silently.
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `office-expenses${
      subjectLabel ? `-${subjectLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""
    }-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ExpenseHero
        /*
          The subject rides in the eyebrow on the desktop and in the caption
          alone on the phone: at 10.5px uppercase, "OFFICE EXPENSES · TAYYAB
          ALI" wraps to two shouty lines on a 390px screen and pushes the
          figure down. The caption says it either way, so nothing is lost.
        */
        eyebrow={subjectLabel && !isMobile ? `Office Expenses · ${subjectLabel}` : "Office Expenses"}
        figure={rupees(summary.spend)}
        /*
          The caption names the subject, because the figure above it is now
          that person's. A screen showing one person's total under a heading
          that says nothing about them is how somebody reads a part as the
          whole and takes it to a meeting.
        */
        caption={`${
          subjectLabel
            ? subjectLabel === "Me"
              ? "your expenses, approved"
              : `${subjectLabel}'s expenses, approved`
            : isAdmin
              ? "approved"
              : "your expenses, approved"
        }${isMobile ? "" : " in this period"} · ${summary.count} record${summary.count === 1 ? "" : "s"}`}
        isMobile={isMobile}
        tileIcon={ICON.receipt}
        stats={[
          { label: "INVOICED", value: summary.total },
          { label: "PENDING", value: summary.pending },
          { label: "REJECTED", value: summary.rejected },
        ]}
        mobileAction={<HeroTile onClick={() => setManagingCategories(true)} label="Manage categories" d={ICON.tags} />}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HeroButton onClick={() => setManagingCategories(true)} icon={<Glyph d={ICON.tags} />}>Categories</HeroButton>
            <HeroButton onClick={() => setCreating(true)} icon={<Glyph d="M12 5v14M5 12h14" width={2.4} />} solid>Add expense</HeroButton>
          </div>
        }
      >
        {isMobile && (
          <PeriodPill from={from} to={to} maxTo={karachiDayKey()} open={showPeriod}
            onToggle={() => setShowPeriod((open) => !open)} onFrom={setFrom} onTo={setTo} />
        )}
      </ExpenseHero>

      {banner && <Banner ok={banner.ok}>{banner.text}</Banner>}
      {error && <Banner ok={false}>{error}</Banner>}

      {/* Every approved, unpaid expense in the period, paid at once. */}
      <PayPeriodTotal
        kind="OFFICE"
        rows={inRange
          .filter((expense) => expense.status === "APPROVED")
          .map((expense) => ({ id: expense.id, amount: expense.amount, paid: readPaid(expense).paid }))}
        /*
          Named for the subject as well as the period. With one person
          selected this pays **their** approved expenses and nobody else's —
          the rows it covers are the ones on screen, and a button that says
          only "this month" would not say so.
        */
        periodLabel={`${
          from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")
            ? monthLabel(from.slice(0, 7))
            : `${from} → ${to}`
        }${subjectLabel ? ` · ${subjectLabel === "Me" ? "mine" : subjectLabel}` : ""}`}
        accounts={ledger.accounts}
        balances={ledger.balances}
        getIdToken={getIdToken}
        isMobile={isMobile}
        onPaid={(text) => setBanner({ ok: true, text })}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Dashboard — describes the range, never the filter                   */}
      {/* ------------------------------------------------------------------ */}
      <StatCards isMobile={isMobile} cards={statCards} />

      {/* ------------------------------------------------------------------ */}
      {/* Filters — shared by both tabs                                       */}
      {/* ------------------------------------------------------------------ */}
      {isMobile ? (
        /*
          The phone file has no filter grid at all: a search pill, then one row
          of chips that scrolls by thumb. Status and category share the row —
          picking one clears the other, so the row always reads as a single
          selection, exactly as the design's `filter` state does.
        */
        <>
          <MobileSearch value={search} onChange={setSearch} placeholder="Title, payee or note" />
          {/*
            Whose expenses, on its own labelled row above the cuts — it changes
            every figure on the screen, and an unlabelled second chip row would
            read as one more way to filter the list. The desktop says this in
            the select's own "Recorded by" label; the phone has no labels, so
            it gets one here.
          */}
          {recorders.length > 1 && (
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#93a5a3" }}>
                Whose expenses
              </span>
              <ChipRow
                chips={[
                  { label: "Everyone", active: recordedBy === "ALL", pick: () => setRecordedBy("ALL") },
                  ...recorders.map((person) => ({
                    label: `${person.label} · ${person.count}`,
                    active: recordedBy === person.uid,
                    pick: () => setRecordedBy(person.uid),
                  })),
                ]}
              />
            </div>
          )}
          <ChipRow
            chips={[
              { label: "All", active: status === "ALL" && category === "ALL", pick: () => { setStatus("ALL"); setCategory("ALL"); } },
              ...EXPENSE_STATUSES.map((value) => ({
                label: EXPENSE_STATUS_LABELS[value],
                active: status === value,
                pick: () => { setStatus(value); setCategory("ALL"); },
              })),
              ...categories.map((value) => ({
                label: value,
                active: category === value,
                pick: () => { setCategory(value); setStatus("ALL"); },
              })),
            ]}
          />
        </>
      ) : (
        <FilterPanel
          from={from} to={to} maxTo={karachiDayKey()} onFrom={setFrom} onTo={setTo}
          search={search} onSearch={setSearch}
          onDownload={download} canDownload={filtered.length > 0}
          selects={[
            // Absent when there is only one person recording expenses: a
            // selector with a single choice is furniture, not a control.
            ...(recorders.length > 1
              ? [
                  {
                    label: "Recorded by", width: "168px", value: recordedBy, onChange: setRecordedBy,
                    options: [
                      { value: "ALL", label: `Everyone (${expenses.length})` },
                      ...recorders.map((person) => ({
                        value: person.uid,
                        label: `${person.label} (${person.count})`,
                      })),
                    ],
                  },
                ]
              : []),
            {
              label: "Status", width: "148px", value: status,
              onChange: (next) => setStatus(next as ExpenseStatus | "ALL"),
              options: [{ value: "ALL", label: "All" }, ...EXPENSE_STATUSES.map((v) => ({ value: v, label: EXPENSE_STATUS_LABELS[v] }))],
            },
            {
              label: "Category", width: "168px", value: category, onChange: setCategory,
              options: [{ value: "ALL", label: "All" }, ...categories.map((v) => ({ value: v, label: v }))],
            },
          ]}
        />
      )}

      <Segmented
        isMobile={isMobile}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "LEDGER", label: "Expense history", d: ICON.list },
          { key: "REPORTS", label: "Reports", d: ICON.bars },
        ] as const}
      />

      {tab === "LEDGER" ? (
        <ExpenseList
          heading="Expense History"
          count={`${filtered.length} of ${inRange.length}${isMobile ? "" : " in this period"}`}
          total={listedTotal}
          rows={rowModels}
          isMobile={isMobile}
          loading={loading}
          empty={inRange.length === 0 ? "No expenses recorded in this period." : "No expenses match these filters."}
          formatMoney={rupees}
          pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="expenses" />}
        />
      ) : (
        <>
          <FinanceCard
            title="Expenses over time"
            hint="Approved spend"
            action={
              <div style={{ display: "flex", gap: 4, background: F.hair, borderRadius: 999, padding: 3 }}>
                {(["day", "month", "year"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGrain(value)}
                    style={{
                      borderRadius: 999,
                      border: "none",
                      background: grain === value ? F.surface : "transparent",
                      color: grain === value ? F.teal : F.muted,
                      padding: "5px 13px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {value === "day" ? "Daily" : value === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            }
          >
            {byPeriod.length === 0 ? (
              <EmptyState>No approved spend in this period.</EmptyState>
            ) : (
              <>
                {trend !== null && (
                  <p
                    style={{
                      marginBottom: 12,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: trend > 0 ? "#a33a29" : "#1f7a52",
                    }}
                  >
                    {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% against the previous{" "}
                    {grain === "day" ? "day" : grain}
                  </p>
                )}
                <div style={{ display: "grid", gap: 11 }}>
                  {byPeriod
                    .slice(-14)
                    .map((row) => (
                      <ShareBar
                        key={row.key}
                        label={row.key}
                        amount={row.amount}
                        max={Math.max(...byPeriod.map((entry) => entry.amount))}
                        hint={`${row.count} record${row.count === 1 ? "" : "s"}`}
                      />
                    ))}
                </div>
              </>
            )}
          </FinanceCard>

          <FinanceCard title="By category" hint="Approved spend only">
            {byCategory.length === 0 ? (
              <EmptyState>No approved spend to break down.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 11 }}>
                {byCategory.map((row) => (
                  <ShareBar
                    key={row.category}
                    label={row.category}
                    amount={row.amount}
                    max={byCategory[0].amount}
                    hint={`${row.share}% · ${row.count}`}
                  />
                ))}
              </div>
            )}
          </FinanceCard>
        </>
      )}

      {isMobile && <FloatingAdd onClick={() => setCreating(true)} label="Add expense" />}

      {/*
        **Clicking a row opens the record**, which is where the facts the list
        cannot fit have always lived: who approved it and with what note, which
        accounts funded it and on which day, and the whole audit trail the
        Server Actions have been appending to since the ledger shipped. Every
        one of those was being written and none had a reader.
      */}
      {openedExpense && (
        <OverlayPanel
          title={openedExpense.title}
          subtitle={`${openedExpense.category} · ${openedExpense.dayKey}`}
          maxWidth={620}
          onClose={() => setOpened(null)}
        >
          <ExpenseDetail
            title={openedExpense.title}
            amountLabel={rupees(openedExpense.amount)}
            formatMoney={rupees}
            status={{ label: EXPENSE_STATUS_LABELS[openedExpense.status], tone: statusTone(openedExpense.status) }}
            payment={(() => {
              const { paid, outstanding, settled } = readPaid(openedExpense);
              if (paid <= 0) return null;
              return { paid, outstanding, label: settled ? "Paid" : `${rupees(outstanding)} due`, tone: settled ? TONE.good : TONE.warn };
            })()}
            fields={[
              { label: "Date", value: openedExpense.dayKey },
              { label: "Category", value: openedExpense.category },
              { label: "Amount", value: rupees(openedExpense.amount) },
              { label: "Paid by", value: openedExpense.paidBy ?? "—" },
              { label: "Method", value: openedExpense.paymentMethod ?? "—" },
              { label: "Recorded by", value: openedExpense.addedByEmail ?? "—" },
              { label: "Description", value: openedExpense.description ?? "—", wide: true },
              ...(openedExpense.decisionNote
                ? [{ label: `Note from ${openedExpense.decidedByName ?? "the approver"}`, value: openedExpense.decisionNote, wide: true }]
                : []),
            ]}
            legs={legsByExpense.get(openedExpense.id) ?? []}
            notFunded="Nothing has been paid against this yet. Approve it, then choose which accounts fund it."
            history={openedExpense.history.map((entry) => ({
              at: stamp(entry.at),
              action: HISTORY_LABELS[entry.action] ?? entry.action,
              by: entry.byName,
              detail: entry.detail,
              amount: entry.amount,
            }))}
            actions={buildActions(openedExpense, false).map((action) => (
              <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                disabled={action.disabled}
                onClick={() => {
                  // Editing or paying replaces this panel rather than stacking
                  // a second overlay on top of it.
                  if (action.key === "edit" || action.key === "pay") setOpened(null);
                  action.onClick();
                }} />
            ))}
          />
        </OverlayPanel>
      )}

      {(creating || editing) && (
        <ExpenseFormModal
          expense={editing}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(text) => {
            setCreating(false);
            setEditing(null);
            setBanner({ ok: true, text });
          }}
        />
      )}

      {managingCategories && (
        <ExpenseCategoriesModal
          onClose={() => setManagingCategories(false)}
          onChanged={(text) => {
            setBanner({ ok: true, text });
            reloadCategories();
          }}
        />
      )}

      {/*
        **The link the whole rebuild is for.** Choosing which accounts fund this
        expense posts one ledger transaction per account — so a 50,000 expense
        paid 30/10/10 leaves three rows and stays a 50,000 expense. If one of
        those accounts is the Committee, the Committee's statement shows its
        -10,000 named for this expense, without a line of Committee-specific
        code anywhere.
      */}
      {paying && (
        <PayFromAccounts
          open
          onClose={() => setPaying(null)}
          onPaid={(text) => setBanner({ ok: true, text })}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          source={{
            module: "OFFICE_EXPENSE",
            collection: "expenses",
            id: paying.id,
            label: paying.title,
            amount: paying.amount,
            alreadyPaid: readPaid(paying).paid,
            direction: "OUT",
            type: "EXPENSE",
          }}
        />
      )}
    </div>
  );
}


