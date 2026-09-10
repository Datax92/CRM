"use client";

/**
 * Personal Expenses — what I spent, and which account paid it back.
 *
 * It used to be a reimbursement workflow: file a *claim*, pick a *claimant* off
 * the roster, have a manager approve or reject it, then reimburse. The owner
 * removed all of that — *"whats claim and claimant, make the wording simple,
 * remove employees and manager, it should be personal expense only"* — and the
 * screen is better for it. One person, one list, three states that are not
 * states anybody sets: **Unpaid · Part paid · Paid**, derived from how much an
 * account has paid back.
 *
 * Nothing here says "claim", "claimant", "submit", "approve" or "reimburse".
 * The words on screen are the words somebody would use out loud.
 *
 * **This is the Office Expenses screen** — the same hero, stat cards, filter
 * grid, rows, phone cards and detail panel, from
 * `components/finance/expensesChrome`. Two implementations of one screen drift;
 * this way the two cannot. What differs is the data behind it.
 *
 * Employees see only their own. That is a Security Rule, matched by the
 * `where('employeeUid','==',uid)` in `useMyPersonalExpenses` — an unscoped read
 * is refused outright rather than filtered.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useMyPersonalExpenses, useLedger } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { PayFromAccounts } from "./PayFromAccounts";
import { formatMoney } from "@/lib/money";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import {
  savePersonalExpense,
  deletePersonalExpense,
  countPersonalExpensePayments,
  getPersonalExpenseCategories,
} from "@/lib/clientActions";
import { ExpenseCategoriesModal } from "@/components/finance/ExpenseCategoriesModal";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { readHistoryEntry, readPaid, HISTORY_LABELS } from "@/lib/officeExpenses";
import {
  PAYMENT_STATES,
  PAYMENT_STATE_LABELS,
  paymentState,
  type PaymentState,
} from "@/lib/personalExpenses";
import {
  ChipRow,
  DetailAction,
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
  StatCards,
  TONE,
  X,
  designField,
  designLabel,
  type ExpenseRowModel,
  type FundingLeg,
  type RowAction,
  type StatCard,
  type Tone,
} from "@/components/finance/expensesChrome";
import { stamp } from "@/components/finance/OfficeExpensesView";

/** The first of the current month — the period this question usually means. */
function monthStart(): string {
  return `${karachiMonthKey()}-01`;
}

/**
 * One stored expense.
 *
 * Read defensively at every field: this collection predates the ledger, so an
 * older record has no `paidAmount` — and absent means *nothing paid back*, not
 * *broken*. The five stored statuses the module used to write are deliberately
 * **not read**: the state is derived from the money, so the two existing
 * records carrying `SUBMITTED` classify correctly with no migration.
 */
interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  dayKey: string;
  vendor: string | null;
  purpose: string | null;
  paidAmount: number;
  history: Array<{ at: string; action: string; byName: string | null; detail: string | null; amount: number | null }>;
}

function readExpense(raw: Record<string, unknown>): Expense {
  return {
    id: String(raw.id ?? ""),
    title: typeof raw.title === "string" && raw.title ? raw.title : "Untitled",
    category: typeof raw.category === "string" && raw.category ? raw.category : "Other",
    amount: typeof raw.amount === "number" ? raw.amount : 0,
    dayKey: typeof raw.dayKey === "string" && raw.dayKey.length === 10 ? raw.dayKey : karachiDayKey(),
    vendor: typeof raw.vendor === "string" ? raw.vendor : null,
    purpose: typeof raw.purpose === "string" ? raw.purpose : null,
    paidAmount: typeof raw.paidAmount === "number" ? raw.paidAmount : 0,
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

function stateTone(state: PaymentState): Tone {
  return state === "PAID" ? TONE.good : state === "PART_PAID" ? TONE.warn : TONE.quiet;
}

export function PersonalExpensesView() {
  const { user, role, getIdToken } = useAuth();
  /*
    **Everyone sees their own, and only their own.** There is no "everybody's
    claims" list any more — that was the manager's view of other people's
    money, which is exactly what came out.
  */
  const { records, loading } = useMyPersonalExpenses(user?.uid, Boolean(user?.uid));

  /*
    Paying one back moves money out of a company account, so it needs somebody
    who may read the accounts at all. Not a workflow — a permission. Where it
    is absent the row simply has no Pay button rather than one that errors.
  */
  const canPay = role === "admin" || role === "subadmin";

  /*
    The list is shared configuration — renaming a category renames it on
    everybody's records — so editing it is the admin's or HR's. Reading it is
    everybody's, because everybody has to fill the form in.
  */
  const canManageCategories = canPay;
  const ledger = useLedger(canPay);
  const isMobile = useIsMobile();

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(karachiDayKey());
  const [search, setSearch] = useState("");
  const [state, setState] = useState<PaymentState | "ALL">("ALL");
  const [category, setCategory] = useState("ALL");
  const [showPeriod, setShowPeriod] = useState(false);
  /*
    **The categories are configuration, not a constant.** The built-in seven
    are a starting list; anything the business adds is read back from
    `config/personalExpenseCategories`. Loaded through a Server Action rather
    than a live listener — the list changes about once a month, and a
    subscription would cost a read on every mount for something that does not
    move.
  */
  const [categories, setCategories] = useState<string[]>([]);
  const [managingCategories, setManagingCategories] = useState(false);
  const [categoryNonce, setCategoryNonce] = useState(0);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<{ expense: Expense; payments: number; total: number } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const expenses = useMemo(
    () => (records as Record<string, unknown>[]).map(readExpense),
    [records]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;
      const result = await getPersonalExpenseCategories(token);
      if (!cancelled && result.ok) setCategories(result.data.categories);
    })();
    return () => { cancelled = true; };
  }, [getIdToken, categoryNonce]);

  /** The range first — every figure on the screen belongs to the same period. */
  const inRange = useMemo(
    () => expenses.filter((expense) => expense.dayKey >= from && expense.dayKey <= to),
    [expenses, from, to]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((expense) => {
      if (state !== "ALL" && paymentState(expense) !== state) return false;
      if (category !== "ALL" && expense.category !== category) return false;
      if (!needle) return true;
      return (
        expense.title.toLowerCase().includes(needle) ||
        (expense.vendor ?? "").toLowerCase().includes(needle) ||
        (expense.purpose ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, state, category]);

  /*
    The headline figures describe the **range**, not the filter — a total that
    fell when somebody clicked "Unpaid" would read as having spent less, which
    is the opposite of what happened.
  */
  const summary = useMemo(() => {
    const sum = { spent: 0, count: 0, paid: 0, unpaid: 0, unpaidCount: 0, month: 0 };
    const monthKey = karachiMonthKey();
    for (const expense of inRange) {
      const { paid, outstanding } = readPaid(expense);
      sum.spent += expense.amount;
      sum.count += 1;
      sum.paid += paid;
      sum.unpaid += outstanding;
      if (outstanding > 0) sum.unpaidCount += 1;
      if (expense.dayKey.startsWith(monthKey)) sum.month += expense.amount;
    }
    return sum;
  }, [inRange]);

  const listedTotal = useMemo(
    () => filtered.reduce((total, expense) => total + expense.amount, 0),
    [filtered]
  );

  const page = usePagination(filtered, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number) => (summary.spent ? Math.round((n / summary.spent) * 100) : 0);
    return [
      { label: "Total Spent", value: formatMoney(summary.spent), note: "every record in range", pill: `${summary.count} recs`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
      { label: "This Month", value: formatMoney(summary.month), note: "your own spending", pill: null, pct: pct(summary.month), color: "#141f1e", accent: "#4fa39c", icon: ICON.calendar },
      // **The figure this screen exists for**: money still out of pocket.
      { label: "Not Paid Back", value: formatMoney(summary.unpaid), note: summary.unpaid > 0 ? `${summary.unpaidCount} still owed to you` : "everything is paid back", pill: summary.unpaid > 0 ? "Owed" : "Clear", tone: summary.unpaid > 0 ? "warn" : "good", pct: pct(summary.unpaid), color: summary.unpaid > 0 ? "#a5762a" : "#2f7d78", accent: "#c99a2e", icon: ICON.clock },
      { label: "Paid Back", value: formatMoney(summary.paid), note: `${pct(summary.paid)}% of what you spent`, pill: `${pct(summary.paid)}%`, tone: "good", pct: pct(summary.paid), color: "#2f7d78", accent: "#2f7d78", icon: ICON.check },
    ];
  }, [summary]);

  /** The payments made against each expense, by the expense they paid. */
  const legsByExpense = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "PERSONAL_EXPENSE" || !txn.sourceId) continue;
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

  /*
    **Deleting asks first, and the question names the cost.** Money may have
    been paid back against this out of a real account; those movements go with
    it and the balance is restored, so the confirmation has to say so before
    the button is pressed rather than report it afterwards.
  */
  const askDelete = useCallback(async (expense: Expense) => {
    setBusyId(expense.id);
    const result = await countPersonalExpensePayments(await getIdToken(), expense.id);
    setBusyId(null);
    setDeleting({
      expense,
      payments: result.ok ? result.data.payments : 0,
      total: result.ok ? result.data.total : 0,
    });
  }, [getIdToken]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.expense.id);
    const result = await deletePersonalExpense(await getIdToken(), deleting.expense.id);
    setBusyId(null);
    setDeleting(null);
    setOpened(null);
    setBanner(
      result.ok
        ? {
            ok: true,
            text: result.data.removedPayments > 0
              ? `"${deleting.expense.title}" deleted, and ${formatMoney(result.data.restored)} put back into ${result.data.removedPayments} account${result.data.removedPayments === 1 ? "" : "s"}.`
              : `"${deleting.expense.title}" deleted.`,
          }
        : { ok: false, text: result.error }
    );
  };

  const buildActions = useCallback((expense: Expense, compact: boolean): RowAction[] => {
    const { paid, settled } = readPaid(expense);
    const actions: RowAction[] = [];

    if (canPay && !settled) {
      actions.push({
        key: "pay",
        label: paid > 0 ? (compact ? "Pay rest" : "Pay balance") : compact ? "Pay" : "Pay from…",
        shortLabel: paid > 0 ? "Pay rest" : "Pay",
        d: ICON.wallet, tone: "good", onClick: () => setPaying(expense),
      });
    }
    actions.push({ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditing(expense) });
    actions.push({ key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void askDelete(expense), disabled: busyId === expense.id });
    return actions;
  }, [canPay, busyId, askDelete]);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((expense) => {
        const { paid, outstanding, settled } = readPaid(expense);
        const state_ = paymentState(expense);
        return {
          id: expense.id,
          title: expense.title,
          meta: [expense.dayKey, expense.category]
            .concat(expense.vendor ? [expense.vendor] : [])
            .join(" · "),
          amount: expense.amount,
          category: expense.category,
          /*
            **One pill, not two.** Office Expenses needs a status *and* a
            payment state because approving and paying are different facts. Here
            they are the same fact, so a second pill would be the same word
            twice.
          */
          status: {
            label: paid > 0 && !settled ? `${formatMoney(outstanding)} left` : PAYMENT_STATE_LABELS[state_],
            tone: stateTone(state_),
          },
          payment: null,
          notes: expense.purpose ? (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{expense.purpose}</span>
            </div>
          ) : null,
          actions: buildActions(expense, isMobile),
          onOpen: () => setOpened(expense.id),
        };
      }),
    [page.items, buildActions, isMobile]
  );

  const openedExpense = useMemo(
    () => (opened ? expenses.find((expense) => expense.id === opened) ?? null : null),
    [opened, expenses]
  );

  const download = () => {
    const header = ["Date", "What for", "Category", "Paid to", "Amount", "Paid back", "Left", "Note"];
    const rows = filtered.map((expense) => {
      const { paid, outstanding } = readPaid(expense);
      return [
        expense.dayKey, expense.title, expense.category, expense.vendor ?? "",
        String(expense.amount), String(paid), String(outstanding), expense.purpose ?? "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `personal-expenses-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Personal Expenses"
        figure={formatMoney(summary.unpaid)}
        caption={`not paid back yet · ${summary.count} record${summary.count === 1 ? "" : "s"} in range`}
        isMobile={isMobile}
        tileIcon={ICON.receipt}
        stats={[
          { label: "SPENT", value: summary.spent },
          { label: "PAID BACK", value: summary.paid },
          { label: "LEFT", value: summary.unpaid },
        ]}
        mobileAction={
          /*
            The phone gets one glass tile and Add is the floating button, so
            the tile is Categories — the same arrangement Office Expenses has.
            Where somebody may not edit the list, it is Add instead of nothing.
          */
          canManageCategories
            ? <HeroTile onClick={() => setManagingCategories(true)} label="Manage categories" d={ICON.tags} />
            : <HeroTile onClick={() => setAdding(true)} label="Add expense" d="M12 5v14M5 12h14" />
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {canManageCategories && (
              <HeroButton onClick={() => setManagingCategories(true)}
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.tags} /></svg>}>
                Categories
              </HeroButton>
            )}
            <HeroButton onClick={() => setAdding(true)} solid
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
              Add expense
            </HeroButton>
          </div>
        }
      >
        {isMobile && (
          <PeriodPill from={from} to={to} maxTo={karachiDayKey()} open={showPeriod}
            onToggle={() => setShowPeriod((open) => !open)} onFrom={setFrom} onTo={setTo} />
        )}
      </ExpenseHero>

      {banner && (
        <p role="status" style={{ borderRadius: 12, background: banner.ok ? "#e8f5f3" : "#fdeeec", border: `1px solid ${banner.ok ? "#bfe0dc" : "#f0c4bd"}`, padding: "11px 14px", fontSize: 12.5, fontWeight: 600, color: banner.ok ? X.deep : "#a33a29" }}>
          {banner.text}
        </p>
      )}

      <StatCards isMobile={isMobile} cards={statCards} />

      {isMobile ? (
        <>
          <MobileSearch value={search} onChange={setSearch} placeholder="What it was for, or who you paid" />
          <ChipRow
            chips={[
              { label: "All", active: state === "ALL" && category === "ALL", pick: () => { setState("ALL"); setCategory("ALL"); } },
              ...PAYMENT_STATES.map((value) => ({
                label: PAYMENT_STATE_LABELS[value],
                active: state === value,
                pick: () => { setState(value); setCategory("ALL"); },
              })),
              ...categories.map((value) => ({
                label: value,
                active: category === value,
                pick: () => { setCategory(value); setState("ALL"); },
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
            {
              label: "Paid back", width: "148px", value: state,
              onChange: (next) => setState(next as PaymentState | "ALL"),
              options: [{ value: "ALL", label: "All" }, ...PAYMENT_STATES.map((v) => ({ value: v, label: PAYMENT_STATE_LABELS[v] }))],
            },
            {
              label: "Category", width: "168px", value: category, onChange: setCategory,
              options: [{ value: "ALL", label: "All" }, ...categories.map((v) => ({ value: v, label: v }))],
            },
          ]}
        />
      )}

      <ExpenseList
        heading="Your Expenses"
        count={`${filtered.length} of ${inRange.length}${isMobile ? "" : " in this period"}`}
        total={listedTotal}
        rows={rowModels}
        isMobile={isMobile}
        loading={loading}
        empty={
          inRange.length === 0
            ? "Nothing in this period. Spent your own money on something for work? Add it here."
            : "Nothing matches these filters."
        }
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="expenses" />}
      />

      {isMobile && <FloatingAdd onClick={() => setAdding(true)} label="Add expense" />}

      {openedExpense && (
        <OverlayPanel
          title={openedExpense.title}
          subtitle={`${openedExpense.category} · ${openedExpense.dayKey}`}
          maxWidth={620}
          onClose={() => setOpened(null)}
        >
          <ExpenseDetail
            title={openedExpense.title}
            amountLabel={formatMoney(openedExpense.amount)}
            formatMoney={formatMoney}
            status={{ label: PAYMENT_STATE_LABELS[paymentState(openedExpense)], tone: stateTone(paymentState(openedExpense)) }}
            payment={(() => {
              const { paid, outstanding, settled } = readPaid(openedExpense);
              if (paid <= 0) return null;
              return { paid, outstanding, label: settled ? "Paid back" : `${formatMoney(outstanding)} left`, tone: settled ? TONE.good : TONE.warn };
            })()}
            fields={[
              { label: "Date", value: openedExpense.dayKey },
              { label: "Category", value: openedExpense.category },
              { label: "Amount", value: formatMoney(openedExpense.amount) },
              { label: "Paid to", value: openedExpense.vendor ?? "—" },
              { label: "Note", value: openedExpense.purpose ?? "—", wide: true },
            ]}
            legs={legsByExpense.get(openedExpense.id) ?? []}
            notFunded={
              canPay
                ? "Nothing has been paid back yet. Choose which account pays it."
                : "Nothing has been paid back yet."
            }
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
                  if (action.key === "pay" || action.key === "edit") setOpened(null);
                  action.onClick();
                }} />
            ))}
          />
        </OverlayPanel>
      )}

      {deleting && (
        <OverlayPanel title="Delete this expense?" maxWidth={440} onClose={() => setDeleting(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeleting(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Keep it
              </button>
              <button type="button" disabled={busyId === deleting.expense.id} onClick={() => void confirmDelete()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deleting.expense.id ? 0.5 : 1 }}>
                {busyId === deleting.expense.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deleting.expense.title}</strong> · {formatMoney(deleting.expense.amount)} · {deleting.expense.dayKey}
          </p>
          {deleting.payments > 0 ? (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
              {formatMoney(deleting.total)} has been paid back for this from {deleting.payments} account
              {deleting.payments === 1 ? "" : "s"}. Deleting it removes {deleting.payments === 1 ? "that movement" : "those movements"} too
              and puts the money back — otherwise the account would show cash gone for a record that no longer exists.
            </p>
          ) : (
            <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
              Nothing has been paid back for this, so nothing else changes. This cannot be undone.
            </p>
          )}
        </OverlayPanel>
      )}

      {managingCategories && (
        <ExpenseCategoriesModal
          kind="PERSONAL"
          onClose={() => setManagingCategories(false)}
          onChanged={(text) => { setBanner({ ok: true, text }); setCategoryNonce((value) => value + 1); }}
        />
      )}

      {(adding || editing) && (
        <ExpenseForm
          expense={editing}
          categories={categories}
          onClose={() => { setAdding(false); setEditing(null); }}
          getIdToken={getIdToken}
          onSaved={(text) => { setBanner({ ok: true, text }); setAdding(false); setEditing(null); }}
        />
      )}

      {/*
        **The same split control Office Expenses uses**, pointed at a different
        collection. An expense paid back out of three accounts is one expense
        and three transactions; the expense stays what was spent.
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
            module: "PERSONAL_EXPENSE",
            collection: "personalExpenses",
            id: paying.id,
            label: `Personal expense — ${paying.title}`,
            amount: paying.amount,
            alreadyPaid: readPaid(paying).paid,
            direction: "OUT",
            type: "REIMBURSEMENT",
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

/** New and Edit as one component, so the two cannot ask for different fields. */
function ExpenseForm({ expense, categories, onClose, getIdToken, onSaved }: {
  expense: Expense | null;
  categories: string[];
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({
    title: expense?.title ?? "",
    category: expense?.category ?? categories[0] ?? "Other",
    amount: expense ? String(expense.amount) : "",
    dayKey: expense?.dayKey ?? karachiDayKey(),
    vendor: expense?.vendor ?? "",
    purpose: expense?.purpose ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // 16px on the phone, or iOS Safari zooms the page on focus.
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await savePersonalExpense(
      await getIdToken(),
      {
        title: form.title, category: form.category, amount: Number(form.amount) || 0,
        dayKey: form.dayKey, vendor: form.vendor, purpose: form.purpose,
      },
      expense?.id
    );
    setBusy(false);
    if (result.ok) onSaved(expense ? "Expense updated." : "Expense added.");
    else setError(result.error);
  };

  return (
    <OverlayPanel title={expense ? "Edit expense" : "Add expense"} icon={<Wallet2 size={18} />} maxWidth={560} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="button" disabled={busy || !form.title.trim() || !(Number(form.amount) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : expense ? "Save changes" : "Add expense"}
          </button>
        </div>
      }>
      <OverlayCard title="The expense">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <L label="What was it for" wide>
            <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Petrol, client lunch, phone bill…" style={field} />
          </L>
          <L label="Date">
            <input type="date" value={form.dayKey} max={karachiDayKey()} onChange={(e) => set("dayKey", e.target.value)} style={field} />
          </L>
          <L label="Amount">
            <input type="number" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} style={field} />
          </L>
          <L label="Category">
            <select value={form.category} onChange={(e) => set("category", e.target.value)} style={{ ...field, cursor: "pointer" }}>
              {/*
                An expense filed under a category that has since been removed
                keeps it, and it is offered here so editing the record does not
                silently re-file it under something else.
              */}
              {[...new Set([...categories, form.category].filter(Boolean))].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </L>
          <L label="Paid to">
            <input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Shop, driver, restaurant…" style={field} />
          </L>
          <L label="Note" wide>
            <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Anything worth remembering about it" style={field} />
          </L>
        </div>
      </OverlayCard>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600, marginTop: 10 }}>{error}</p>}
    </OverlayPanel>
  );
}

function L({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: wide ? "1 / -1" : undefined, ...designLabel }}>
      <span>{label}</span>
      {children}
    </label>
  );
}
