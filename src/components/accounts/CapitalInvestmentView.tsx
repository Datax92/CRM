"use client";

/**
 * Capital Investment — a venture, what went into it, and what it cost.
 *
 * Built from the owner's own `CAPITAL INVESTMENT` sheet. Each block on it is a
 * named pot with **two columns side by side** — `Amount Received | Description`
 * and `SPENDINGS: Amount Spent | Description` — and this screen is that, in the
 * language every other money screen here now speaks
 * (`components/finance/expensesChrome`).
 *
 * Two things the sheet says that shape the whole thing:
 *
 * - **The money goes in more than once.** Three rows and a gap for the next:
 *   1,192,500 "STATE LIFE LOAN", then 428,000 "DADDY 8 MARCH", then 130,000
 *   "APIL COMMITTEE 270". So a venture is a pot somebody keeps adding to, and a
 *   contribution is an ordinary money-in movement on its account.
 * - **A spending names what it was, not where it came from.** Which account
 *   funds it is a separate decision, taken with the same split control an
 *   office expense uses — so a spending on this venture can be paid out of the
 *   Committee, out of StateLife commission, or out of the venture's own pot.
 *
 * Which is why the venture shows **two totals that are not the same number**,
 * and both are true: what the pot still holds, and what the venture has cost.
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet2, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLedger, useFinanceCollection, type TransactionDoc } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { PayFromAccounts } from "./PayFromAccounts";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  createAccount,
  updateAccount,
  addManualTransaction,
  updateTransaction,
  deleteTransaction,
  saveCapitalSpending,
  deleteCapitalSpending,
  countCapitalSpendingPayments,
  listDeletedForAccount,
  payBackSpending,
  setSpendingLoan,
  recordLoanReturn,
} from "@/lib/clientActions";
import { canPayBack, readPaidBack } from "@/lib/ledger";
import { readLoan, normalizeBorrower, type LoanReading } from "@/lib/spendingLoan";
import { isContribution, isDirectSpending, isLentOut, isRoundReturn, potCash } from "@/lib/capitalPot";
import type { DeletedLedgerRow } from "@/app/actions/ledger";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { readHistoryEntry, readPaid, HISTORY_LABELS } from "@/lib/officeExpenses";
import {
  ChipRow,
  DetailAction,
  ExpenseDetail,
  ExpenseHero,
  ExpenseList,
  FloatingAdd,
  HeroButton,
  HeroTile,
  ICON,
  MobileSearch,
  StatCards,
  Tag,
  TONE,
  X,
  designField,
  designLabel,
  type ExpenseRowModel,
  type FundingLeg,
  type RowAction,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { stamp } from "@/components/finance/OfficeExpensesView";

/*
  What each row on a pot's statement means — a contribution, a round coming
  back, money only passing through, or a spending of the pot's own — lives in
  `lib/capitalPot`, with the cash figures, so the list and the cards cannot
  disagree and both are unit-tested.
*/

/** One account's part of a pay-back, as the spending's panel lists it. */
interface PayBackLine {
  /** The leg that brought the money into this pot; Remove takes it and its pair. */
  id: string;
  fromName: string;
  amount: number;
  dayKey: string;
  note: string | null;
  by: string | null;
}

/** One repayment on a loan, as the loan's panel lists it. */
interface LoanReturnLine {
  id: string;
  intoName: string;
  amount: number;
  dayKey: string;
  note: string | null;
  by: string | null;
}

/** A spending marked (or about to be marked) as a loan, as the loan forms need it. */
interface LoanTarget {
  kind: "TXN" | "TICKET";
  id: string;
  label: string;
  loan: LoanReading;
}

const BACK_ARROW = "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11";
/** An open hand: money handed to somebody. */
const HAND = "M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.6 14.6a1.5 1.5 0 0 1 2.4-1.8L7 14";

/** The pill a loan's row carries: what is still owed, or that it is all back. */
function loanPill(loan: LoanReading): { label: string; tone: (typeof TONE)[keyof typeof TONE] } | null {
  if (!loan.isLoan || loan.lent <= 0) return null;
  return loan.settled
    ? { label: "Loan returned", tone: TONE.good }
    : { label: `${formatMoney(loan.owed)} owed`, tone: TONE.warn };
}

interface Spending {
  id: string;
  investmentId: string;
  title: string;
  amount: number;
  dayKey: string;
  description: string | null;
  paidAmount: number;
  /** Money lent out rather than spent: who to, and how much is back (`lib/spendingLoan`). */
  loanTo: string | null;
  loanReturned: number;
  history: Array<{ at: string; action: string; byName: string | null; detail: string | null; amount: number | null }>;
}

function readSpending(raw: Record<string, unknown>): Spending {
  return {
    id: String(raw.id ?? ""),
    investmentId: String(raw.investmentId ?? ""),
    title: typeof raw.title === "string" && raw.title ? raw.title : "Untitled",
    amount: typeof raw.amount === "number" ? raw.amount : 0,
    dayKey: typeof raw.dayKey === "string" && raw.dayKey.length === 10 ? raw.dayKey : karachiDayKey(),
    description: typeof raw.description === "string" ? raw.description : null,
    paidAmount: typeof raw.paidAmount === "number" ? raw.paidAmount : 0,
    loanTo: typeof raw.loanTo === "string" && raw.loanTo.trim() ? raw.loanTo : null,
    loanReturned: typeof raw.loanReturned === "number" ? raw.loanReturned : 0,
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

/* -------------------------------------------------------------------------- */
/* The list of ventures                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The router between the two screens.
 *
 * Deliberately holds **no list state of its own**: `usePagination` lives in
 * whichever screen is rendering, so it can never be called conditionally.
 */
export function CapitalInvestmentView({ accountId }: { accountId?: string }) {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const ledger = useLedger(ready);
  const spendingsRaw = useFinanceCollection("capitalSpendings", ready);
  const isMobile = useIsMobile();
  const router = useRouter();

  const pots = useMemo(
    () => ledger.accounts.filter((account) => account.kind === "INVESTMENT"),
    [ledger.accounts]
  );

  const spendings = useMemo(
    () => (spendingsRaw.records as Record<string, unknown>[]).map(readSpending),
    [spendingsRaw.records]
  );

  /**
   * Per venture, the two figures the sheet totals — and they are not the same
   * question. `inPot` is cash: contributions less whatever was paid **out of**
   * this account. `cost` is the venture's: every spending filed against it,
   * whoever funded it.
   */
  const byPot = useMemo(() => {
    const rowsByPot = new Map<string, TransactionDoc[]>(pots.map((pot) => [pot.id, []]));
    for (const txn of ledger.transactions) rowsByPot.get(txn.accountId)?.push(txn);

    const map = new Map<string, { received: number; paidFromPot: number; cost: number; funded: number; count: number }>();
    for (const pot of pots) {
      const rows = rowsByPot.get(pot.id) ?? [];
      const cash = potCash(pot.openingBalance ?? 0, rows);
      // A round's capital coming back offsets the round going out, so it is
      // not a cost — the same reading the venture's own screen makes.
      const returned = rows.filter(isRoundReturn).reduce((sum, txn) => sum + txn.amount, 0);
      const direct = rows.filter(isDirectSpending);
      // Money lent out is owed back, not spent (`lib/spendingLoan`).
      const directCost = Math.max(0, direct.filter((txn) => !isLentOut(txn)).reduce((sum, txn) => sum + txn.amount, 0) - returned);
      map.set(pot.id, { received: cash.received, paidFromPot: cash.paidFromPot, cost: directCost, funded: directCost, count: direct.length });
    }
    for (const spending of spendings) {
      const entry = map.get(spending.investmentId);
      if (!entry) continue;
      if (spending.loanTo) { entry.count += 1; continue; }
      const { paid } = readPaid(spending);
      entry.cost += spending.amount;
      entry.funded += paid;
      entry.count += 1;
    }
    return map;
  }, [pots, ledger.transactions, spendings]);

  const selected = accountId ? pots.find((pot) => pot.id === accountId) ?? null : null;

  /* ---------------------------------------------------------------------- */
  /* One venture                                                            */
  /* ---------------------------------------------------------------------- */

  if (accountId) {
    if (ledger.loading) {
      return <p style={{ padding: "22px 20px", fontSize: 13.5, color: X.faint }}>Loading…</p>;
    }
    if (!selected) {
      return (
        <p style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: "#fff", padding: "22px 20px", fontSize: 13.5, color: X.faint }}>
          That investment no longer exists. <button type="button" onClick={() => router.push("/admin/accounts/capital-investments")} style={{ border: "none", background: "none", color: X.deep, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, padding: 0 }}>Back to the list</button>.
        </p>
      );
    }
    return (
      <VentureView
        pot={selected}
        ledger={ledger}
        spendings={spendings.filter((spending) => spending.investmentId === accountId)}
        loading={spendingsRaw.loading}
        getIdToken={getIdToken}
        isMobile={isMobile}
        onBack={() => router.push("/admin/accounts/capital-investments")}
      />
    );
  }

  return (
    <PotList
      pots={pots}
      byPot={byPot}
      loading={ledger.loading}
      ready={ready}
      getIdToken={getIdToken}
      isMobile={isMobile}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Every venture                                                               */
/* -------------------------------------------------------------------------- */

interface PotTotals { received: number; paidFromPot: number; cost: number; funded: number; count: number }

function PotList({ pots, byPot, loading, ready, getIdToken, isMobile }: {
  pots: Ledger["accounts"];
  byPot: Map<string, PotTotals>;
  loading: boolean;
  ready: boolean;
  getIdToken: () => Promise<string>;
  isMobile: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const totals = [...byPot.values()].reduce(
    (sum, entry) => ({
      received: sum.received + entry.received,
      inPot: sum.inPot + (entry.received - entry.paidFromPot),
      cost: sum.cost + entry.cost,
      unfunded: sum.unfunded + Math.max(0, entry.cost - entry.funded),
    }),
    { received: 0, inPot: 0, cost: 0, unfunded: 0 }
  );

  const needle = search.trim().toLowerCase();
  const filtered = pots.filter((pot) => !needle || pot.name.toLowerCase().includes(needle));

  const statCards: StatCard[] = [
    { label: "Put In", value: formatMoney(totals.received), note: `${pots.length} investment${pots.length === 1 ? "" : "s"}`, pill: `${pots.length}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
    { label: "Still In Hand", value: formatMoney(totals.inPot), note: "not yet spent out of the pots", pill: null, pct: totals.received ? Math.round((totals.inPot / totals.received) * 100) : 0, color: "#2f7d78", accent: "#4fa39c", icon: ICON.wallet },
    { label: "Spent On Them", value: formatMoney(totals.cost), note: "every spending, whoever paid it", pill: null, pct: totals.cost && totals.received ? Math.min(100, Math.round((totals.cost / totals.received) * 100)) : 0, color: "#141f1e", accent: "#c99a2e", icon: ICON.bars },
    { label: "Not Paid Yet", value: formatMoney(totals.unfunded), note: totals.unfunded > 0 ? "spendings with no account behind them" : "every spending is funded", pill: totals.unfunded > 0 ? "Owed" : "Clear", tone: totals.unfunded > 0 ? "warn" : "good", pct: totals.cost ? Math.round((totals.unfunded / totals.cost) * 100) : 0, color: totals.unfunded > 0 ? "#a5762a" : "#2f7d78", accent: "#c0574a", icon: ICON.clock },
  ];

  const rows: ExpenseRowModel[] = filtered.map((pot) => {
    const entry = byPot.get(pot.id)!;
    const left = entry.received - entry.paidFromPot;
    return {
      id: pot.id,
      title: pot.name,
      meta: [
        `${formatMoney(entry.received)} put in`,
        `${entry.count} spending${entry.count === 1 ? "" : "s"}`,
        `${formatMoney(entry.cost)} spent`,
      ].join(" · "),
      amount: left,
      category: "Marketing",
      status: { label: left < 0 ? "Overdrawn" : left > 0 ? "In hand" : "All spent", tone: left < 0 ? TONE.bad : left > 0 ? TONE.good : TONE.quiet },
      payment: entry.cost > entry.funded
        ? { label: `${formatMoney(entry.cost - entry.funded)} unpaid`, tone: TONE.warn }
        : null,
      notes: pot.status === "ARCHIVED"
        ? <div style={{ marginTop: 6 }}><Tag label="Archived" tone={TONE.quiet} /></div>
        : null,
      actions: [
        { key: "open", label: "Open", d: ICON.list, tone: "good", onClick: () => router.push(`/admin/accounts/capital-investments/${pot.id}`) },
      ],
      onOpen: () => router.push(`/admin/accounts/capital-investments/${pot.id}`),
    };
  });

  const page = usePagination(rows, 12);

  if (!ready) {
    return (
      <p style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: "#fff", padding: "22px 20px", fontSize: 13.5, color: X.faint }}>
        Capital Investment is for administrators and HR.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Capital Investment"
        figure={formatMoney(totals.inPot)}
        caption={`still in hand · ${formatMoney(totals.received)} put in across ${pots.length} investment${pots.length === 1 ? "" : "s"}`}
        isMobile={isMobile}
        tileIcon={ICON.bars}
        stats={[
          { label: "PUT IN", value: totals.received },
          { label: "SPENT", value: totals.cost },
          { label: "IN HAND", value: totals.inPot },
        ]}
        mobileAction={<HeroTile onClick={() => setCreating(true)} label="New investment" d="M12 5v14M5 12h14" />}
        actions={
          <HeroButton onClick={() => setCreating(true)} solid
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
            New investment
          </HeroButton>
        }
      />

      {banner && (
        <p role="status" style={{ borderRadius: 12, background: banner.ok ? "#e8f5f3" : "#fdeeec", border: `1px solid ${banner.ok ? "#bfe0dc" : "#f0c4bd"}`, padding: "11px 14px", fontSize: 12.5, fontWeight: 600, color: banner.ok ? X.deep : "#a33a29" }}>
          {banner.text}
        </p>
      )}

      <StatCards isMobile={isMobile} cards={statCards} />

      <MobileSearch value={search} onChange={setSearch} placeholder="Which investment?" />

      <ExpenseList
        heading="Investments"
        count={`${filtered.length} of ${pots.length}`}
        total={totals.inPot}
        rows={page.items}
        isMobile={isMobile}
        loading={loading}
        empty={pots.length === 0
          ? "No investments yet. Create one, then record what goes into it and what it is spent on."
          : "Nothing matches that search."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="investments" />}
      />

      {isMobile && <FloatingAdd onClick={() => setCreating(true)} label="New investment" />}

      {creating && (
        <PotForm
          getIdToken={getIdToken}
          onClose={() => setCreating(false)}
          onSaved={(text) => { setBanner({ ok: true, text }); setCreating(false); }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One venture: what went in, and what it cost                                 */
/* -------------------------------------------------------------------------- */

type Ledger = ReturnType<typeof useLedger>;

/**
 * A row's trail, in words: what each field was before an edit, and every
 * pay-back made or taken off, with the account it came from.
 */
function txnHistory(
  txn: TransactionDoc,
  names: ReadonlyMap<string, string> = new Map()
): { at: string; action: string; by: string | null; detail: string | null; amount: number | null }[] {
  const created = { at: stamp(txnCreatedIso(txn)), action: "Recorded", by: txn.createdByName ?? null, detail: null, amount: null };
  const edits = (txn.history ?? []).map((entry) => {
    if (entry.action === "PAID_BACK") {
      const from = (entry.allocations ?? [])
        .map((line) => `${formatMoney(line.amount)} from ${line.accountName ?? names.get(line.accountId) ?? "another account"}`)
        .join(", ");
      return { at: stamp(entry.at), action: "Paid back", by: entry.byName ?? null, detail: from || null, amount: entry.amount ?? null };
    }
    if (entry.action === "PAY_BACK_REMOVED") {
      const from = entry.accountId ? names.get(entry.accountId) : undefined;
      return {
        at: stamp(entry.at),
        action: "Pay-back removed",
        by: entry.byName ?? null,
        detail: from ? `It went back into ${from}.` : null,
        amount: entry.amount ?? null,
      };
    }
    if (HISTORY_LABELS[entry.action] && entry.action !== "EDITED") {
      return { at: stamp(entry.at), action: HISTORY_LABELS[entry.action], by: entry.byName ?? null, detail: entry.detail ?? null, amount: entry.amount ?? null };
    }
    const prev = entry.previous ?? {};
    const parts: string[] = [];
    if (prev.amount !== undefined) parts.push(`amount was ${formatMoney(Number(prev.amount) || 0)}`);
    if (prev.sourceLabel !== undefined) parts.push(`description was "${String(prev.sourceLabel ?? "")}"`);
    if (prev.dayKey !== undefined) parts.push(`date was ${String(prev.dayKey)}`);
    if (prev.note !== undefined) parts.push(prev.note ? `note was "${String(prev.note)}"` : "had no note");
    return { at: stamp(entry.at), action: entry.action === "EDITED" ? "Edited" : entry.action, by: entry.byName ?? null, detail: parts.join(" · ") || null, amount: null };
  });
  return [created, ...edits];
}

function txnCreatedIso(txn: TransactionDoc): string {
  const raw = txn.createdAt as unknown;
  if (raw && typeof raw === "object") {
    const value = raw as { toDate?: () => Date; seconds?: number };
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  }
  return typeof raw === "string" ? raw : "";
}

function VentureView({ pot, ledger, spendings, loading, getIdToken, isMobile, onBack }: {
  pot: Ledger["accounts"][number];
  ledger: Ledger;
  spendings: Spending[];
  loading: boolean;
  getIdToken: () => Promise<string>;
  isMobile: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"SPENDINGS" | "RECEIVED" | "REMOVED">("SPENDINGS");
  const [removed, setRemoved] = useState<DeletedLedgerRow[] | null>(null);
  const [removedError, setRemovedError] = useState<string | null>(null);
  const [editingContribution, setEditingContribution] = useState<TransactionDoc | null>(null);
  const [openedContribution, setOpenedContribution] = useState<TransactionDoc | null>(null);
  const [addingSpending, setAddingSpending] = useState(false);
  const [editingSpending, setEditingSpending] = useState<Spending | null>(null);
  const [editingDirectTxn, setEditingDirectTxn] = useState<TransactionDoc | null>(null);
  const [deletingDirectTxn, setDeletingDirectTxn] = useState<TransactionDoc | null>(null);
  const [openedDirectTxn, setOpenedDirectTxn] = useState<TransactionDoc | null>(null);
  const [addingContribution, setAddingContribution] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [paying, setPaying] = useState<Spending | null>(null);
  const [payingBack, setPayingBack] = useState<TransactionDoc | null>(null);
  const [removingPayBack, setRemovingPayBack] = useState<PayBackLine | null>(null);
  const [markingLoan, setMarkingLoan] = useState<LoanTarget | null>(null);
  const [returningLoan, setReturningLoan] = useState<LoanTarget | null>(null);
  const [removingLoanReturn, setRemovingLoanReturn] = useState<LoanReturnLine | null>(null);
  const [deleting, setDeleting] = useState<{ spending: Spending; payments: number; total: number } | null>(null);
  const [removingContribution, setRemovingContribution] = useState<{ id: string; label: string; amount: number } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Money in and money out **of this pot** — the account's own statement. */
  const movements = useMemo(
    () => ledger.transactions.filter((txn) => txn.accountId === pot.id),
    [ledger.transactions, pot.id]
  );
  const returns = useMemo(() => movements.filter(isRoundReturn), [movements]);
  const returnedTotal = useMemo(
    () => returns.reduce((sum, txn) => sum + txn.amount, 0),
    [returns]
  );
  const returnedRoundIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of returns) {
      if (r.sourceId) ids.add(r.sourceId);
    }
    return ids;
  }, [returns]);
  const returnedGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of returns) {
      if (r.groupId) ids.add(r.groupId);
    }
    return ids;
  }, [returns]);

  const contributions = useMemo(() => movements.filter(isContribution), [movements]);
  const directSpendings = useMemo(() => movements.filter(isDirectSpending), [movements]);

  const figures = useMemo(() => {
    // In hand is the pot's cash — what its account holds — so money that came
    // back (a reversed payment, a pay-back) counts, not only round returns.
    const { received, paidFromPot, inHand } = potCash(pot.openingBalance ?? 0, movements);
    // A loan is owed back, not spent: it is counted under Lent Out instead.
    const spent = directSpendings.filter((txn) => !isLentOut(txn));
    const directCost = Math.max(0, spent.reduce((sum, txn) => sum + txn.amount, 0) - returnedTotal);
    const tickets = spendings.filter((spending) => !spending.loanTo);
    const ticketCost = tickets.reduce((sum, spending) => sum + spending.amount, 0);
    const cost = ticketCost + directCost;
    const funded = tickets.reduce((sum, spending) => sum + readPaid(spending).paid, 0) + directCost;
    const loans = [
      ...directSpendings.filter(isLentOut).map((txn) => readLoan(txn, txn.amount)),
      ...spendings.filter((spending) => spending.loanTo).map((spending) => readLoan(spending, readPaid(spending).paid)),
    ];
    const lentOut = loans.reduce((sum, loan) => sum + loan.owed, 0);
    const lentTotal = loans.reduce((sum, loan) => sum + loan.lent, 0);
    return { received, paidFromPot, inHand, cost, funded, unfunded: Math.max(0, cost - funded), lentOut, lentTotal, loanCount: loans.length };
  }, [pot.openingBalance, movements, spendings, directSpendings, returnedTotal]);

  /**
   * Every repayment on a loan, by loan — read from all accounts, since the
   * borrower may have paid it back into a different one.
   */
  const loanReturnsBy = useMemo(() => {
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    const map = new Map<string, LoanReturnLine[]>();
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "LOAN_RETURN" || !txn.sourceId) continue;
      const list = map.get(txn.sourceId) ?? [];
      list.push({
        id: txn.id,
        intoName: names.get(txn.accountId) ?? "A deleted account",
        amount: txn.amount,
        dayKey: txn.dayKey,
        note: txn.note ?? null,
        by: txn.createdByName ?? null,
      });
      map.set(txn.sourceId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    return map;
  }, [ledger.transactions, ledger.accounts]);

  /**
   * Every pay-back made against a spending of this pot, by spending — read
   * from the legs that brought the money **in** to this pot, one per account
   * it came from. The spending's own `paidBack` is the figure; these are where
   * that money came from, and what Remove takes off again.
   */
  const payBacksBySpending = useMemo(() => {
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    const map = new Map<string, PayBackLine[]>();
    for (const txn of movements) {
      if (txn.sourceModule !== "PAY_BACK" || txn.direction !== "IN" || !txn.sourceId) continue;
      const list = map.get(txn.sourceId) ?? [];
      list.push({
        id: txn.id,
        fromName: names.get(txn.counterAccountId ?? "") ?? "A deleted account",
        amount: txn.amount,
        dayKey: txn.dayKey,
        note: txn.note ?? null,
        by: txn.createdByName ?? null,
      });
      map.set(txn.sourceId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
    return map;
  }, [movements, ledger.accounts]);

  const accountNames = useMemo(
    () => new Map(ledger.accounts.map((account) => [account.id, account.name])),
    [ledger.accounts]
  );

  /** The payments made against each spending, by the spending they funded. */
  const legsBySpending = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "CAPITAL_INVESTMENT" || !txn.sourceId) continue;
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

  const askDelete = useCallback(async (spending: Spending) => {
    setBusyId(spending.id);
    const result = await countCapitalSpendingPayments(await getIdToken(), spending.id);
    setBusyId(null);
    setDeleting({
      spending,
      payments: result.ok ? result.data.payments : 0,
      total: result.ok ? result.data.total : 0,
    });
  }, [getIdToken]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.spending.id);
    const result = await deleteCapitalSpending(await getIdToken(), deleting.spending.id);
    setBusyId(null);
    setDeleting(null);
    setOpened(null);
    setRemoved(null);
    setBanner(result.ok
      ? { ok: true, text: result.data.removedPayments > 0
          ? `"${deleting.spending.title}" deleted, and ${formatMoney(result.data.restored)} put back into ${result.data.removedPayments} account${result.data.removedPayments === 1 ? "" : "s"}.`
          : `"${deleting.spending.title}" deleted.` }
      : { ok: false, text: result.error });
  };

  const confirmDeleteDirect = async () => {
    if (!deletingDirectTxn) return;
    setBusyId(deletingDirectTxn.id);
    const result = await deleteTransaction(await getIdToken(), deletingDirectTxn.id);
    setBusyId(null);
    setDeletingDirectTxn(null);
    setOpenedDirectTxn(null);
    setRemoved(null);
    const { paidBack } = readPaidBack(deletingDirectTxn);
    setBanner(
      result.ok
        ? {
            ok: true,
            text: `"${deletingDirectTxn.sourceLabel ?? "Spending"}" deleted, and ${formatMoney(deletingDirectTxn.amount)} put back into ${pot.name}.`
              + (paidBack > 0 ? ` Its ${formatMoney(paidBack)} of pay-backs went back where they came from.` : ""),
          }
        : { ok: false, text: result.error }
    );
  };

  /** Takes one account's pay-back off: out of this pot, back into that account. */
  const confirmRemovePayBack = async () => {
    if (!removingPayBack) return;
    const line = removingPayBack;
    setBusyId(line.id);
    const result = await deleteTransaction(await getIdToken(), line.id);
    setBusyId(null);
    setRemovingPayBack(null);
    setRemoved(null);
    setBanner(result.ok
      ? { ok: true, text: `${formatMoney(line.amount)} pay-back removed — it went back into ${line.fromName}.` }
      : { ok: false, text: result.error });
  };

  /** Takes one repayment off: out of the account it came into, and the borrower owes it again. */
  const confirmRemoveLoanReturn = async () => {
    if (!removingLoanReturn) return;
    const line = removingLoanReturn;
    setBusyId(line.id);
    const result = await deleteTransaction(await getIdToken(), line.id);
    setBusyId(null);
    setRemovingLoanReturn(null);
    setRemoved(null);
    setBanner(result.ok
      ? { ok: true, text: `${formatMoney(line.amount)} return removed — it came out of ${line.intoName} and is owed again.` }
      : { ok: false, text: result.error });
  };

  /** Every row removed from this pot, read on demand from the archive. */
  const loadRemoved = useCallback(async () => {
    setRemovedError(null);
    const result = await listDeletedForAccount(await getIdToken(), pot.id);
    if (result.ok) setRemoved(result.data);
    else setRemovedError(result.error);
  }, [getIdToken, pot.id]);

  const removeContribution = async () => {
    if (!removingContribution) return;
    setBusyId(removingContribution.id);
    const result = await deleteTransaction(await getIdToken(), removingContribution.id);
    setBusyId(null);
    setRemovingContribution(null);
    setOpenedContribution(null);
    setRemoved(null);
    setBanner(result.ok
      ? { ok: true, text: `${formatMoney(removingContribution.amount)} removed from ${pot.name}.` }
      : { ok: false, text: result.error });
  };

  const buildActions = useCallback((spending: Spending, compact: boolean): RowAction[] => {
    const { paid, settled } = readPaid(spending);
    const actions: RowAction[] = [];
    if (!settled) {
      actions.push({
        key: "pay",
        label: paid > 0 ? (compact ? "Pay rest" : "Pay balance") : compact ? "Pay" : "Pay from…",
        shortLabel: paid > 0 ? "Pay rest" : "Pay",
        d: ICON.wallet, tone: "good", onClick: () => setPaying(spending),
      });
    }
    const target: LoanTarget = { kind: "TICKET", id: spending.id, label: spending.title, loan: readLoan(spending, paid) };
    if (target.loan.isLoan) {
      if (target.loan.owed > 0) {
        actions.push({ key: "loanback", label: compact ? "Returned" : "Loan returned", shortLabel: "Returned", d: BACK_ARROW, tone: "good", onClick: () => setReturningLoan(target) });
      }
      actions.push({ key: "loan", label: "Loan", d: HAND, tone: "quiet", onClick: () => setMarkingLoan(target) });
    } else {
      actions.push({ key: "loan", label: compact ? "Loan" : "Mark as loan", shortLabel: "Loan", d: HAND, tone: "quiet", onClick: () => setMarkingLoan(target) });
    }
    actions.push({ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditingSpending(spending) });
    // A loan with money already back cannot be deleted; the server refuses it too.
    if (target.loan.returned <= 0) {
      actions.push({ key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void askDelete(spending), disabled: busyId === spending.id });
    }
    return actions;
  }, [busyId, askDelete]);

  const buildDirectActions = useCallback((txn: TransactionDoc): RowAction[] => {
    const actions: RowAction[] = [];
    /*
      **Pay back** — the owner's "UBL CC covered September's 249,000; pay part
      of it back from the Investment with X profit". Offered on any spending
      typed straight out of the pot, until it is paid back in full.
    */
    const loan = readLoan(txn, txn.amount);
    if (txn.type === "LOAN" && loan.isLoan) {
      /*
        **A loan** — the owner's "the money went to Muhammad Hussain; when it
        comes back I record it here". Repaid by the borrower, never paid back
        from another of the company's own accounts.
      */
      const target: LoanTarget = { kind: "TXN", id: txn.id, label: txn.sourceLabel ?? "Spending", loan };
      if (loan.owed > 0) {
        actions.push({ key: "loanback", label: "Loan returned", shortLabel: "Returned", d: BACK_ARROW, tone: "good", onClick: () => setReturningLoan(target) });
      }
      actions.push({ key: "loan", label: "Loan", d: HAND, tone: "quiet", onClick: () => setMarkingLoan(target) });
    } else if (canPayBack(txn) && !readPaidBack(txn).settled) {
      const started = readPaidBack(txn).paidBack > 0;
      actions.push({
        key: "payback",
        label: started ? "Pay back rest" : "Pay back",
        shortLabel: "Pay back",
        d: BACK_ARROW,
        tone: "good",
        onClick: () => setPayingBack(txn),
      });
      if (!started) {
        actions.push({
          key: "loan",
          label: "Mark as loan",
          shortLabel: "Loan",
          d: HAND,
          tone: "quiet",
          onClick: () => setMarkingLoan({ kind: "TXN", id: txn.id, label: txn.sourceLabel ?? "Spending", loan }),
        });
      }
    }
    if (txn.sourceModule === "MANUAL" && !txn.reversedBy && !txn.reversalOf) {
      actions.push({
        key: "edit",
        label: "Edit",
        d: ICON.edit,
        tone: "quiet",
        onClick: () => setEditingDirectTxn(txn),
      });
      if (loan.returned <= 0) {
        actions.push({
          key: "delete",
          label: "Delete",
          d: ICON.trash,
          tone: "bad",
          onClick: () => setDeletingDirectTxn(txn),
          disabled: busyId === txn.id,
        });
      }
    }
    return actions;
  }, [busyId]);

  type SpendingUnified =
    | { kind: "TICKET"; spending: Spending }
    | { kind: "DIRECT"; txn: TransactionDoc };

  const unifiedSpendings = useMemo(() => {
    const list: SpendingUnified[] = [
      ...spendings.map((spending) => ({ kind: "TICKET" as const, spending })),
      ...directSpendings.map((txn) => ({ kind: "DIRECT" as const, txn })),
    ];
    return list.sort((a, b) => {
      const dayA = a.kind === "TICKET" ? a.spending.dayKey : a.txn.dayKey;
      const dayB = b.kind === "TICKET" ? b.spending.dayKey : b.txn.dayKey;
      return dayB.localeCompare(dayA);
    });
  }, [spendings, directSpendings]);

  const spendingRows: ExpenseRowModel[] = unifiedSpendings.map((item) => {
    if (item.kind === "TICKET") {
      const spending = item.spending;
      const { paid, outstanding, settled } = readPaid(spending);
      const legs = legsBySpending.get(spending.id) ?? [];
      const loan = readLoan(spending, paid);
      return {
        id: spending.id,
        title: spending.title,
        meta: [spending.dayKey]
          .concat(loan.isLoan ? [`Lent to ${loan.to}`] : [])
          .concat(legs.length ? [`from ${legs.map((leg) => leg.accountName).join(", ")}`] : ["not paid from anywhere yet"])
          .join(" · "),
        amount: spending.amount,
        category: "Utilities",
        status: {
          label: settled ? "Paid" : paid > 0 ? `${formatMoney(outstanding)} left` : "Unpaid",
          tone: settled ? TONE.good : paid > 0 ? TONE.warn : TONE.quiet,
        },
        payment: loanPill(loan),
        notes: spending.description
          ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{spending.description}</span></div>
          : null,
        actions: buildActions(spending, isMobile),
        onOpen: () => setOpened(spending.id),
      };
    }
    const txn = item.txn;
    const isReturned = (txn.sourceId && returnedRoundIds.has(txn.sourceId)) || (txn.groupId && returnedGroupIds.has(txn.groupId));
    const returnTxn = isReturned
      ? returns.find((r) => (txn.sourceId && r.sourceId === txn.sourceId) || (txn.groupId && r.groupId === txn.groupId))
      : null;
    const back = readPaidBack(txn);
    const backLines = payBacksBySpending.get(txn.id) ?? [];
    const backFrom = [...new Set(backLines.map((line) => line.fromName))].join(", ");
    const loan = txn.type === "LOAN" ? readLoan(txn, txn.amount) : null;
    if (loan?.isLoan) {
      return {
        id: txn.id,
        title: txn.sourceLabel ?? "Loan",
        meta: [txn.dayKey, `Lent to ${loan.to}`, `from ${pot.name}`].join(" · "),
        amount: txn.amount,
        category: "Utilities",
        status: { label: "Loan", tone: TONE.quiet },
        payment: loanPill(loan),
        notes: txn.note
          ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{txn.note}</span></div>
          : null,
        actions: buildDirectActions(txn),
        onOpen: () => setOpenedDirectTxn(txn),
      };
    }
    return {
      id: txn.id,
      title: txn.sourceLabel ?? "Spending",
      meta: [
        txn.dayKey,
        `Paid from ${pot.name}`,
        isReturned ? (returnTxn?.dayKey ? `Returned ${returnTxn.dayKey}` : "Returned") : (txn.createdByName ?? null),
      ].filter(Boolean).join(" · "),
      amount: txn.amount,
      category: isReturned ? "Marketing" : "Utilities",
      status: isReturned ? { label: "Returned", tone: TONE.quiet } : { label: "Paid", tone: TONE.good },
      // Only once something has been paid back: most spendings are never
      // repaid, and a "Rs 249,000 to pay back" pill on all of them would nag.
      payment: back.paidBack > 0
        ? back.settled
          ? { label: "Paid back", tone: TONE.good }
          : { label: `${formatMoney(back.left)} left to pay back`, tone: TONE.warn }
        : null,
      notes: (
        <>
          {isReturned && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>Capital returned to pot (reinvested)</span>
            </div>
          )}
          {back.paidBack > 0 && (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11.5, color: X.deep, fontWeight: 600 }}>
                {formatMoney(back.paidBack)} paid back{backFrom ? ` from ${backFrom}` : ""}
              </span>
            </div>
          )}
          {txn.note && (
            <div style={{ marginTop: isReturned ? 2 : 6 }}>
              <span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{txn.note}</span>
            </div>
          )}
        </>
      ),
      actions: isReturned ? [] : buildDirectActions(txn),
      onOpen: () => setOpenedDirectTxn(txn),
    };
  });

  /*
    **Only a manual contribution may be edited or removed here.** A money-in row
    that came from another module — a StateLife slab received into this pot —
    belongs to that module's record, and changing it from this side would leave
    the two disagreeing.
  */
  function contributionActions(txn: TransactionDoc): RowAction[] {
    if (txn.sourceModule !== "MANUAL" || txn.reversedBy || txn.reversalOf) return [];
    return [
      { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditingContribution(txn) },
      { key: "remove", label: "Remove", d: ICON.trash, tone: "bad", onClick: () => setRemovingContribution({ id: txn.id, label: txn.sourceLabel ?? "Money in", amount: txn.amount }), disabled: busyId === txn.id },
    ];
  }

  const contributionRows: ExpenseRowModel[] = contributions
    .slice()
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
    .map((txn) => ({
      id: txn.id,
      title: txn.sourceLabel ?? "Money in",
      meta: [txn.dayKey, txn.createdByName ?? null].filter(Boolean).join(" · "),
      amount: txn.amount,
      category: "Salaries",
      status: { label: "Received", tone: TONE.good },
      payment: null,
      notes: txn.note ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{txn.note}</span></div> : null,
      actions: contributionActions(txn),
      onOpen: () => setOpenedContribution(txn),
    }));

  const removedRows: ExpenseRowModel[] = (removed ?? []).map((row) => ({
    id: row.id,
    title: row.label ?? "Removed entry",
    meta: [
      row.dayKey,
      row.direction === "IN" ? "Money in" : row.direction === "OUT" ? "Spending" : null,
      row.deletedAt ? `removed ${stamp(row.deletedAt)}` : "removed",
      row.deletedByName ? `by ${row.deletedByName}` : null,
    ].filter(Boolean).join(" · "),
    amount: row.amount,
    category: "Salaries",
    status: { label: "Removed", tone: TONE.bad },
    payment: null,
    notes: row.note ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{row.note}</span></div> : null,
    actions: [],
    onOpen: () => { /* A removed row is kept for the record; nothing to act on. */ },
  }));

  const openedSpending = opened ? spendings.find((spending) => spending.id === opened) ?? null : null;
  const rows = tab === "SPENDINGS" ? spendingRows : tab === "RECEIVED" ? contributionRows : removedRows;
  const page = usePagination(rows, 12);

  const statCards: StatCard[] = [
    { label: "Put In", value: formatMoney(figures.received), note: `${contributions.length} contribution${contributions.length === 1 ? "" : "s"}`, pill: `${contributions.length}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
    { label: "Still In Hand", value: formatMoney(figures.inHand), note: "in this pot, not yet spent", pill: null, pct: figures.received ? Math.max(0, Math.round((figures.inHand / figures.received) * 100)) : 0, color: figures.inHand < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet },
    {
      label: "Spent On It",
      value: formatMoney(figures.cost),
      note: returns.length > 0
        ? `${spendingRows.length} spending${spendingRows.length === 1 ? "" : "s"} (${returns.length} returned)`
        : `${spendingRows.length} spending${spendingRows.length === 1 ? "" : "s"}, whoever paid`,
      pill: null,
      pct: figures.received ? Math.min(100, Math.round((figures.cost / figures.received) * 100)) : 0,
      color: "#141f1e",
      accent: "#c99a2e",
      icon: ICON.bars,
    },
    ...(figures.loanCount > 0
      ? [{
          label: "Lent Out",
          value: formatMoney(figures.lentOut),
          note: figures.lentOut > 0
            ? `still owed on ${figures.loanCount} loan${figures.loanCount === 1 ? "" : "s"} · not counted as spent`
            : "every loan has come back",
          pill: figures.lentOut > 0 ? "Owed" : "Back",
          tone: (figures.lentOut > 0 ? "warn" : "good") as "warn" | "good",
          pct: figures.lentTotal ? Math.round((figures.lentOut / figures.lentTotal) * 100) : 0,
          color: figures.lentOut > 0 ? "#a5762a" : "#2f7d78",
          accent: "#4f9c99",
          icon: HAND,
        } satisfies StatCard]
      : []),
    { label: "Not Paid Yet", value: formatMoney(figures.unfunded), note: figures.unfunded > 0 ? "no account behind them yet" : "every spending is funded", pill: figures.unfunded > 0 ? "Owed" : "Clear", tone: figures.unfunded > 0 ? "warn" : "good", pct: figures.cost ? Math.round((figures.unfunded / figures.cost) * 100) : 0, color: figures.unfunded > 0 ? "#a5762a" : "#2f7d78", accent: "#c0574a", icon: ICON.clock },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <button type="button" onClick={onBack}
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 7, border: "none", background: "none", color: X.muted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        All investments
      </button>

      <ExpenseHero
        eyebrow="Capital Investment"
        figure={formatMoney(figures.inHand)}
        caption={`${pot.name} · ${formatMoney(figures.received)} put in · ${formatMoney(figures.cost)} spent`}
        isMobile={isMobile}
        tileIcon={ICON.bars}
        stats={[
          { label: "PUT IN", value: figures.received },
          { label: "SPENT", value: figures.cost },
          { label: "IN HAND", value: figures.inHand },
        ]}
        mobileAction={<HeroTile onClick={() => setAddingContribution(true)} label="Add money in" d="M12 5v14M5 12h14" />}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HeroButton onClick={() => setRenaming(true)}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.edit} /></svg>}>
              Rename
            </HeroButton>
            <HeroButton onClick={() => setAddingContribution(true)}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>}>
              Add money in
            </HeroButton>
            <HeroButton onClick={() => setAddingSpending(true)} solid
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
              Add spending
            </HeroButton>
          </div>
        }
      />

      {banner && (
        <p role="status" style={{ borderRadius: 12, background: banner.ok ? "#e8f5f3" : "#fdeeec", border: `1px solid ${banner.ok ? "#bfe0dc" : "#f0c4bd"}`, padding: "11px 14px", fontSize: 12.5, fontWeight: 600, color: banner.ok ? X.deep : "#a33a29" }}>
          {banner.text}
        </p>
      )}

      <StatCards isMobile={isMobile} cards={statCards} />

      {/*
        The sheet puts Received and Spendings side by side. Two columns of rows
        do not survive a phone, and on a desktop they would each get half the
        width a row needs — so they are two tabs of the same list instead, in
        the section's own segmented control.
      */}
      <ChipRow
        chips={[
          { label: `Spendings (${spendingRows.length})`, active: tab === "SPENDINGS", pick: () => setTab("SPENDINGS") },
          { label: `Money in (${contributions.length})`, active: tab === "RECEIVED", pick: () => setTab("RECEIVED") },
          {
            label: removed ? `Removed (${removed.length})` : "Removed",
            active: tab === "REMOVED",
            pick: () => { setTab("REMOVED"); if (!removed) void loadRemoved(); },
          },
        ]}
      />

      {tab === "REMOVED" && (
        <p style={{ fontSize: 12, color: removedError ? "#a33a29" : X.faint, fontWeight: 600, lineHeight: 1.6 }}>
          {removedError ?? "Everything removed from this pot is kept here with who removed it and when. It no longer counts in the figures above."}
        </p>
      )}

      <ExpenseList
        heading={tab === "SPENDINGS" ? "Spendings" : tab === "RECEIVED" ? "Money in" : "Removed"}
        count={`${rows.length}`}
        total={tab === "SPENDINGS" ? figures.cost : tab === "RECEIVED" ? figures.received : removedRows.reduce((sum, row) => sum + row.amount, 0)}
        rows={page.items}
        isMobile={isMobile}
        loading={loading || ledger.loading || (tab === "REMOVED" && !removed && !removedError)}
        empty={tab === "SPENDINGS"
          ? "Nothing spent on this yet. Add a spending, then choose which account pays it."
          : tab === "RECEIVED"
            ? "Nothing put in yet. Add money in to start the pot."
            : "Nothing has been removed from this pot."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun={tab === "SPENDINGS" ? "spendings" : "entries"} />}
      />

      {isMobile && tab !== "REMOVED" && (
        <FloatingAdd
          onClick={() => (tab === "SPENDINGS" ? setAddingSpending(true) : setAddingContribution(true))}
          label={tab === "SPENDINGS" ? "Add spending" : "Add money in"}
        />
      )}

      {openedSpending && (() => {
        const { paid, outstanding, settled } = readPaid(openedSpending);
        return (
          <OverlayPanel
            title={openedSpending.title}
            subtitle={`${pot.name} · ${openedSpending.dayKey}`}
            maxWidth={620}
            onClose={() => setOpened(null)}
          >
            <ExpenseDetail
              title={openedSpending.title}
              amountLabel={formatMoney(openedSpending.amount)}
              formatMoney={formatMoney}
              status={{ label: settled ? "Paid" : paid > 0 ? "Part paid" : "Unpaid", tone: settled ? TONE.good : paid > 0 ? TONE.warn : TONE.quiet }}
              payment={paid > 0 ? { paid, outstanding, label: settled ? "Paid" : `${formatMoney(outstanding)} left`, tone: settled ? TONE.good : TONE.warn } : null}
              fields={[
                { label: "Investment", value: pot.name },
                { label: "Date", value: openedSpending.dayKey },
                { label: "Amount", value: formatMoney(openedSpending.amount) },
                { label: "Note", value: openedSpending.description ?? "—", wide: true },
              ]}
              legs={legsBySpending.get(openedSpending.id) ?? []}
              extra={openedSpending.loanTo ? (
                <LoanPanel
                  loan={readLoan(openedSpending, paid)}
                  lines={loanReturnsBy.get(openedSpending.id) ?? []}
                  busyId={busyId}
                  onRemove={(line) => { setOpened(null); setRemovingLoanReturn(line); }}
                />
              ) : undefined}
              notFunded="Nothing has paid for this yet. Choose which account funds it — it does not have to be this investment."
              history={openedSpending.history.map((entry) => ({
                at: stamp(entry.at),
                action: HISTORY_LABELS[entry.action] ?? entry.action,
                by: entry.byName,
                detail: entry.detail,
                amount: entry.amount,
              }))}
              actions={buildActions(openedSpending, false).map((action) => (
                <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                  disabled={action.disabled}
                  onClick={() => {
                    if (action.key !== "delete") setOpened(null);
                    action.onClick();
                  }} />
              ))}
            />
          </OverlayPanel>
        );
      })()}

      {openedDirectTxn && (() => {
        const isReturned = (openedDirectTxn.sourceId && returnedRoundIds.has(openedDirectTxn.sourceId)) || (openedDirectTxn.groupId && returnedGroupIds.has(openedDirectTxn.groupId));
        const returnTxn = isReturned
          ? returns.find((r) => (openedDirectTxn.sourceId && r.sourceId === openedDirectTxn.sourceId) || (openedDirectTxn.groupId && r.groupId === openedDirectTxn.groupId))
          : null;
        const back = readPaidBack(openedDirectTxn);
        const backLines = payBacksBySpending.get(openedDirectTxn.id) ?? [];
        return (
          <OverlayPanel
            title={openedDirectTxn.sourceLabel ?? "Direct spending"}
            subtitle={`${pot.name} · ${openedDirectTxn.dayKey}`}
            maxWidth={620}
            onClose={() => setOpenedDirectTxn(null)}
          >
            <ExpenseDetail
              title={openedDirectTxn.sourceLabel ?? "Direct spending"}
              amountLabel={formatMoney(openedDirectTxn.amount)}
              formatMoney={formatMoney}
              status={isReturned ? { label: "Returned", tone: TONE.quiet } : openedDirectTxn.type === "LOAN" ? { label: "Loan", tone: TONE.quiet } : { label: "Paid", tone: TONE.good }}
              payment={back.paidBack > 0
                ? {
                    paid: back.paidBack,
                    outstanding: back.left,
                    label: back.settled ? "Paid back" : `${formatMoney(back.left)} left to pay back`,
                    tone: back.settled ? TONE.good : TONE.warn,
                  }
                : { paid: openedDirectTxn.amount, outstanding: 0, label: isReturned ? "Returned" : "Paid", tone: isReturned ? TONE.quiet : TONE.good }}
              figureLabels={back.paidBack > 0 ? { paid: "Paid back", outstanding: "Left to pay back" } : undefined}
              extra={openedDirectTxn.type === "LOAN" && openedDirectTxn.loanTo ? (
                <LoanPanel
                  loan={readLoan(openedDirectTxn, openedDirectTxn.amount)}
                  lines={loanReturnsBy.get(openedDirectTxn.id) ?? []}
                  busyId={busyId}
                  onRemove={(line) => { setOpenedDirectTxn(null); setRemovingLoanReturn(line); }}
                />
              ) : backLines.length > 0 ? (
                <PayBackList
                  potName={pot.name}
                  lines={backLines}
                  busyId={busyId}
                  onRemove={(line) => { setOpenedDirectTxn(null); setRemovingPayBack(line); }}
                />
              ) : undefined}
              fields={[
                { label: "Investment", value: pot.name },
                { label: "Date", value: openedDirectTxn.dayKey },
                { label: "Amount", value: formatMoney(openedDirectTxn.amount) },
                ...(isReturned && returnTxn ? [{ label: "Returned on", value: returnTxn.dayKey }] : []),
                { label: "Note", value: openedDirectTxn.note ?? (isReturned ? "Capital returned to pot (reinvested)" : "—"), wide: true },
                ...(openedDirectTxn.createdByName ? [{ label: "Recorded by", value: openedDirectTxn.createdByName }] : []),
              ]}
              legs={[
                {
                  id: openedDirectTxn.id,
                  accountName: pot.name,
                  amount: openedDirectTxn.amount,
                  dayKey: openedDirectTxn.dayKey,
                  note: openedDirectTxn.note ?? null,
                  by: openedDirectTxn.createdByName ?? null,
                },
              ]}
              notFunded=""
              history={txnHistory(openedDirectTxn, accountNames)}
              actions={buildDirectActions(openedDirectTxn).map((action) => (
                <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                  disabled={action.disabled}
                  onClick={() => {
                    setOpenedDirectTxn(null);
                    action.onClick();
                  }} />
              ))}
            />
          </OverlayPanel>
        );
      })()}

      {(addingSpending || editingSpending) && (
        <SpendingForm
          spending={editingSpending}
          pot={pot}
          getIdToken={getIdToken}
          onClose={() => { setAddingSpending(false); setEditingSpending(null); }}
          onSaved={(text) => { setBanner({ ok: true, text }); setAddingSpending(false); setEditingSpending(null); }}
        />
      )}

      {editingDirectTxn && (
        <DirectSpendingForm
          existing={editingDirectTxn}
          pot={pot}
          getIdToken={getIdToken}
          onClose={() => setEditingDirectTxn(null)}
          onSaved={(text) => { setBanner({ ok: true, text }); setEditingDirectTxn(null); }}
        />
      )}

      {openedContribution && (
        <OverlayPanel
          title={openedContribution.sourceLabel ?? "Money in"}
          subtitle={`${pot.name} · ${openedContribution.dayKey}`}
          maxWidth={620}
          onClose={() => setOpenedContribution(null)}
        >
          <ExpenseDetail
            title={openedContribution.sourceLabel ?? "Money in"}
            amountLabel={formatMoney(openedContribution.amount)}
            formatMoney={formatMoney}
            status={{ label: "Received", tone: TONE.good }}
            payment={null}
            fields={[
              { label: "Investment", value: pot.name },
              { label: "Date", value: openedContribution.dayKey },
              { label: "Amount", value: formatMoney(openedContribution.amount) },
              { label: "Note", value: openedContribution.note ?? "—", wide: true },
              ...(openedContribution.createdByName ? [{ label: "Recorded by", value: openedContribution.createdByName }] : []),
            ]}
            legs={[]}
            notFunded=""
            history={txnHistory(openedContribution)}
            actions={contributionActions(openedContribution).map((action) => (
              <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                disabled={action.disabled}
                onClick={() => { setOpenedContribution(null); action.onClick(); }} />
            ))}
          />
        </OverlayPanel>
      )}

      {editingContribution && (
        <ContributionForm
          existing={editingContribution}
          inHand={figures.inHand}
          pot={pot}
          getIdToken={getIdToken}
          onClose={() => setEditingContribution(null)}
          onSaved={(text) => { setBanner({ ok: true, text }); setEditingContribution(null); }}
        />
      )}

      {addingContribution && (
        <ContributionForm
          pot={pot}
          getIdToken={getIdToken}
          onClose={() => setAddingContribution(false)}
          onSaved={(text) => { setBanner({ ok: true, text }); setAddingContribution(false); }}
        />
      )}

      {renaming && (
        <PotForm
          pot={pot}
          getIdToken={getIdToken}
          onClose={() => setRenaming(false)}
          onSaved={(text) => { setBanner({ ok: true, text }); setRenaming(false); }}
        />
      )}

      {deleting && (
        <OverlayPanel title="Delete this spending?" maxWidth={440} onClose={() => setDeleting(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeleting(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === deleting.spending.id} onClick={() => void confirmDelete()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deleting.spending.id ? 0.5 : 1 }}>
                {busyId === deleting.spending.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deleting.spending.title}</strong> · {formatMoney(deleting.spending.amount)} · {deleting.spending.dayKey}
          </p>
          {deleting.payments > 0 ? (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
              {formatMoney(deleting.total)} has been paid for this from {deleting.payments} account{deleting.payments === 1 ? "" : "s"}.
              Deleting it removes {deleting.payments === 1 ? "that movement" : "those movements"} too and puts the money back —
              otherwise the account would show cash gone for a record that no longer exists.
            </p>
          ) : (
            <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
              Nothing has been paid for this, so no account changes. This cannot be undone.
            </p>
          )}
        </OverlayPanel>
      )}

      {deletingDirectTxn && (
        <OverlayPanel title="Delete this spending?" maxWidth={440} onClose={() => setDeletingDirectTxn(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeletingDirectTxn(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === deletingDirectTxn.id} onClick={() => void confirmDeleteDirect()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deletingDirectTxn.id ? 0.5 : 1 }}>
                {busyId === deletingDirectTxn.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deletingDirectTxn.sourceLabel ?? "Spending"}</strong> · {formatMoney(deletingDirectTxn.amount)} · {deletingDirectTxn.dayKey}
          </p>
          <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
            Deleting this removes the entry and restores {formatMoney(deletingDirectTxn.amount)} back into {pot.name}. A copy is kept under Removed, with who removed it and when.
          </p>
          {readPaidBack(deletingDirectTxn).paidBack > 0 && (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
              {formatMoney(readPaidBack(deletingDirectTxn).paidBack)} has been paid back against this
              {(() => {
                const from = [...new Set((payBacksBySpending.get(deletingDirectTxn.id) ?? []).map((line) => line.fromName))];
                return from.length ? ` from ${from.join(", ")}` : "";
              })()}.
              Deleting it removes those pay-backs too: the money goes back where it came from and comes out of {pot.name} again.
            </p>
          )}
        </OverlayPanel>
      )}

      {removingPayBack && (
        <OverlayPanel title="Remove this pay-back?" maxWidth={440} onClose={() => setRemovingPayBack(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setRemovingPayBack(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === removingPayBack.id} onClick={() => void confirmRemovePayBack()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === removingPayBack.id ? 0.5 : 1 }}>
                {busyId === removingPayBack.id ? "Removing…" : "Remove"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{formatMoney(removingPayBack.amount)}</strong> from {removingPayBack.fromName} · {removingPayBack.dayKey}
          </p>
          <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
            The money goes back into {removingPayBack.fromName} and comes out of {pot.name} again, and the spending owes it again.
            A copy of both rows is kept under Removed, with who removed them and when.
          </p>
        </OverlayPanel>
      )}

      {markingLoan && (
        <LoanForm
          target={markingLoan}
          potName={pot.name}
          getIdToken={getIdToken}
          onClose={() => setMarkingLoan(null)}
          onSaved={(text) => { setBanner({ ok: true, text }); setMarkingLoan(null); }}
        />
      )}

      {returningLoan && (
        <LoanReturnForm
          target={returningLoan}
          pot={pot}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          onClose={() => setReturningLoan(null)}
          onSaved={(text) => { setBanner({ ok: true, text }); setReturningLoan(null); }}
        />
      )}

      {removingLoanReturn && (
        <OverlayPanel title="Remove this return?" maxWidth={440} onClose={() => setRemovingLoanReturn(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setRemovingLoanReturn(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === removingLoanReturn.id} onClick={() => void confirmRemoveLoanReturn()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === removingLoanReturn.id ? 0.5 : 1 }}>
                {busyId === removingLoanReturn.id ? "Removing…" : "Remove"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{formatMoney(removingLoanReturn.amount)}</strong> into {removingLoanReturn.intoName} · {removingLoanReturn.dayKey}
          </p>
          <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
            The money comes out of {removingLoanReturn.intoName} again and the loan owes it again.
            A copy is kept under Removed, with who removed it and when.
          </p>
        </OverlayPanel>
      )}

      {/*
        **Pay back** uses the same "where is the money coming from?" control as
        paying an expense — one line per account, the same checks — with the
        pay-back's own action behind it. The account the spending came out of
        is not offered: it cannot pay itself back. Income accounts are listed
        first, since a profit is what the owner pays back from.
      */}
      {payingBack && (() => {
        const back = readPaidBack(payingBack);
        const label = payingBack.sourceLabel ?? "Spending";
        const sources = ledger.accounts
          .filter((account) => account.id !== pot.id)
          .slice()
          .sort((a, b) => Number(b.kind === "INCOME") - Number(a.kind === "INCOME"));
        return (
          <PayFromAccounts
            open
            onClose={() => setPayingBack(null)}
            onPaid={(text) => setBanner({ ok: true, text })}
            accounts={sources}
            balances={ledger.balances}
            getIdToken={getIdToken}
            source={{
              module: "PAY_BACK",
              collection: "transactions",
              id: payingBack.id,
              label,
              amount: payingBack.amount,
              alreadyPaid: back.paidBack,
              direction: "OUT",
              type: "TRANSFER",
            }}
            copy={{
              title: `Pay back into ${pot.name}`,
              full: "Pay back in full",
              part: "Record part pay-back",
              linesTitle: "Paying back from",
              done: "paid back",
              noun: "spending",
              settledWord: "paid back",
            }}
            submit={async ({ allocations, dayKey, note }) => {
              const result = await payBackSpending(await getIdToken(), {
                transactionId: payingBack.id,
                allocations,
                dayKey,
                note,
              });
              return result.ok
                ? { ok: true, fullyPaid: result.data.fullyPaid, posted: result.data.posted }
                : { ok: false, error: result.error };
            }}
            extra={
              <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
                The money leaves the account above and goes back into <strong style={{ color: X.muted }}>{pot.name}</strong>.
                It is not counted as income or as spending: the {formatMoney(payingBack.amount)} was counted once, when it was spent.
              </p>
            }
          />
        );
      })()}

      {removingContribution && (
        <OverlayPanel title="Remove this money in?" maxWidth={420} onClose={() => setRemovingContribution(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setRemovingContribution(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === removingContribution.id} onClick={() => void removeContribution()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === removingContribution.id ? 0.5 : 1 }}>
                {busyId === removingContribution.id ? "Removing…" : "Remove"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{removingContribution.label}</strong> · {formatMoney(removingContribution.amount)}
          </p>
          <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
            {pot.name} goes down by {formatMoney(removingContribution.amount)}. A copy is kept under Removed, with who removed it and when.
          </p>
        </OverlayPanel>
      )}

      {/*
        **The line the owner asked for.** Choosing which accounts fund a
        spending posts one transaction per account — so a spending on this
        venture can come out of the Committee, out of StateLife commission, or
        out of the venture's own pot, and each of those statements shows its
        share named for this spending.
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
            module: "CAPITAL_INVESTMENT",
            collection: "capitalSpendings",
            id: paying.id,
            label: `${pot.name} — ${paying.title}`,
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

/* -------------------------------------------------------------------------- */
/* What has been paid back                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every pay-back against one spending: how much, from which account, when —
 * with Remove on each, so a pay-back recorded by mistake is taken off in the
 * place it was made rather than by hunting for two rows on two statements.
 */
function PayBackList({ potName, lines, busyId, onRemove }: {
  potName: string;
  lines: PayBackLine[];
  busyId: string | null;
  onRemove: (line: PayBackLine) => void;
}) {
  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
          Paid back into {potName}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: X.faint, whiteSpace: "nowrap" }}>
          {lines.length} payment{lines.length === 1 ? "" : "s"}
        </span>
      </div>
      {lines.map((line) => (
        <div key={line.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: `1px solid ${X.rowLine}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              From {line.fromName}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>
              {line.dayKey}{line.by ? ` · ${line.by}` : ""}{line.note ? ` · ${line.note}` : ""}
            </div>
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: X.deep, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            +{formatMoney(line.amount)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(line)}
            disabled={busyId === line.id}
            aria-label={`Remove the ${formatMoney(line.amount)} pay-back from ${line.fromName}`}
            className="acc-press"
            style={{
              flexShrink: 0, borderRadius: 999, border: "1px solid #f0dcd8", background: "#fff", color: "#a8483c",
              padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busyId === line.id ? "wait" : "pointer",
              fontFamily: "inherit", opacity: busyId === line.id ? 0.55 : 1,
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Loans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A loan's figures and every repayment, with Remove on each — in the loan's
 * own panel, so a return recorded by mistake is taken off where it was made.
 */
function LoanPanel({ loan, lines, busyId, onRemove }: {
  loan: LoanReading;
  lines: LoanReturnLine[];
  busyId: string | null;
  onRemove: (line: LoanReturnLine) => void;
}) {
  const figure = (label: string, value: number, color: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.1px", textTransform: "uppercase", color: X.faint }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", marginTop: 3 }}>{formatMoney(value)}</div>
    </div>
  );
  return (
    <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
          Lent to {loan.to}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: loan.settled ? X.deep : "#a5762a", whiteSpace: "nowrap" }}>
          {loan.lent <= 0 ? "Not paid out yet" : loan.settled ? "All back" : `${formatMoney(loan.owed)} owed`}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, padding: "12px 16px" }}>
        {figure("Lent", loan.lent, X.ink)}
        {figure("Returned", loan.returned, X.deep)}
        {figure("Still owed", loan.owed, loan.owed > 0 ? "#a5762a" : X.deep)}
      </div>
      <p style={{ padding: "0 16px 12px", fontSize: 11.5, color: X.faint, lineHeight: 1.55 }}>
        A loan is not counted as spending on Group Income or Group Expense, and what comes back is not counted as income.
      </p>
      {lines.map((line) => (
        <div key={line.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: `1px solid ${X.rowLine}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: X.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Back into {line.intoName}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>
              {line.dayKey}{line.by ? ` · ${line.by}` : ""}{line.note ? ` · ${line.note}` : ""}
            </div>
          </div>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: X.deep, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            +{formatMoney(line.amount)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(line)}
            disabled={busyId === line.id}
            aria-label={`Remove the ${formatMoney(line.amount)} return into ${line.intoName}`}
            className="acc-press"
            style={{
              flexShrink: 0, borderRadius: 999, border: "1px solid #f0dcd8", background: "#fff", color: "#a8483c",
              padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busyId === line.id ? "wait" : "pointer",
              fontFamily: "inherit", opacity: busyId === line.id ? 0.55 : 1,
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Marks a spending as a loan to somebody, changes who, or takes the mark off.
 */
function LoanForm({ target, potName, getIdToken, onClose, onSaved }: {
  target: LoanTarget;
  potName: string;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [borrower, setBorrower] = useState(target.loan.to);
  const [busy, setBusy] = useState<"save" | "unmark" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };
  const name = normalizeBorrower(borrower);
  const wasLoan = target.loan.isLoan;

  const submit = async (unmark: boolean) => {
    setBusy(unmark ? "unmark" : "save");
    setError(null);
    const result = await setSpendingLoan(await getIdToken(), { kind: target.kind, id: target.id, borrower: unmark ? null : name });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    onSaved(unmark
      ? `"${target.label}" is a plain spending again and counts as spent.`
      : wasLoan
        ? `"${target.label}" is now lent to ${name}.`
        : `"${target.label}" marked as a loan to ${name}. It no longer counts as spending.`);
  };

  return (
    <OverlayPanel title={wasLoan ? "Loan" : "Mark as loan"} subtitle={target.label} icon={<Wallet2 size={18} />} maxWidth={480} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%", flexWrap: "wrap" }}>
          {wasLoan && target.loan.returned <= 0 && (
            <button type="button" disabled={busy !== null} onClick={() => void submit(true)}
              style={{ marginRight: "auto", borderRadius: 10, border: "1px solid #f0dcd8", background: "#fff", color: "#a8483c", padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
              {busy === "unmark" ? "Saving…" : "Not a loan"}
            </button>
          )}
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy !== null || !name || name === target.loan.to} onClick={() => void submit(false)}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy !== null || !name || name === target.loan.to ? 0.5 : 1 }}>
            {busy === "save" ? "Saving…" : wasLoan ? "Save" : "Mark as loan"}
          </button>
        </div>
      }>
      <OverlayCard title="Who has the money">
        <div style={{ display: "grid", gap: 11, padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Lent to</span>
            <input value={borrower} onChange={(event) => setBorrower(event.target.value)} placeholder="Muhammad Hussain" autoFocus style={field} />
          </label>
        </div>
      </OverlayCard>
      <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
        The money stays out of {potName}, but as a loan: it is not counted as spending on Group Income or Group Expense,
        and when it comes back you record it with <strong style={{ color: X.muted }}>Loan returned</strong>.
      </p>
      {wasLoan && target.loan.returned > 0 && (
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
          {formatMoney(target.loan.returned)} has already come back, so this cannot be turned back into a plain spending until those returns are removed.
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

/**
 * Records money a borrower gave back. It goes into the account the loan came
 * out of unless another is chosen.
 */
function LoanReturnForm({ target, pot, accounts, balances, getIdToken, onClose, onSaved }: {
  target: LoanTarget;
  pot: Ledger["accounts"][number];
  accounts: Ledger["accounts"];
  balances: Ledger["balances"];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const open = accounts.filter((account) => account.status !== "ARCHIVED" || account.id === pot.id);
  const [accountId, setAccountId] = useState(pot.id);
  const [amount, setAmount] = useState(String(target.loan.owed));
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };
  const value = Number(amount) || 0;
  const tooMuch = value > target.loan.owed;
  const intoName = open.find((account) => account.id === accountId)?.name ?? pot.name;

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await recordLoanReturn(await getIdToken(), {
      kind: target.kind, id: target.id, accountId, amount: value, dayKey, note: note.trim() || null,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onSaved(result.data.settled
      ? `${formatMoney(value)} back from ${target.loan.to} into ${intoName}. The loan is fully returned.`
      : `${formatMoney(value)} back from ${target.loan.to} into ${intoName}. ${formatMoney(result.data.owed)} is still owed.`);
  };

  return (
    <OverlayPanel title="Loan returned" subtitle={`${target.loan.to} · ${target.label}`} icon={<Wallet2 size={18} />} maxWidth={500} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !(value > 0) || tooMuch} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !(value > 0) || tooMuch ? 0.5 : 1 }}>
            {busy ? "Saving…" : value >= target.loan.owed ? "Record full return" : "Record part return"}
          </button>
        </div>
      }>
      <p style={{ fontSize: 13, color: X.body, lineHeight: 1.6 }}>
        Lent {formatMoney(target.loan.lent)}
        {target.loan.returned > 0 ? `, ${formatMoney(target.loan.returned)} back so far` : ""} —{" "}
        <strong style={{ color: "#a5762a" }}>{formatMoney(target.loan.owed)} still owed</strong>.
      </p>
      <OverlayCard title="What came back">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Into account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={field}>
              {open.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.id === pot.id ? " (where it was lent from)" : ""} · {formatMoney(balances.get(account.id)?.balance ?? 0)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Amount</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Date</span>
            <input type="date" value={dayKey} max={karachiDayKey()} onChange={(event) => setDayKey(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Cash, bank transfer…" style={field} />
          </label>
        </div>
      </OverlayCard>
      {tooMuch && (
        <p role="alert" style={{ fontSize: 12.5, fontWeight: 600, color: "#a33a29" }}>
          Only {formatMoney(target.loan.owed)} is still owed.
        </p>
      )}
      <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
        The money goes into {intoName}. It is not counted as income or as new money put in — it is the loan coming home.
      </p>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

function PotForm({ pot, getIdToken, onClose, onSaved }: {
  pot?: Ledger["accounts"][number];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [name, setName] = useState(pot?.name ?? "");
  const [note, setNote] = useState(pot?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const token = await getIdToken();
    const result = pot
      ? await updateAccount(token, pot.id, { name, note: note || null })
      /*
        **A new pot opens at zero, always.** The sheet's first row is a
        contribution like any other ("STATE LIFE LOAN 1,192,500"), and putting
        it in as an opening balance would hide it from the Money in list and
        leave the count one short of what somebody can see.
      */
      : await createAccount(token, { name, kind: "INVESTMENT", openingBalance: 0, note: note || null });
    setBusy(false);
    if (result.ok) onSaved(pot ? `Renamed to "${name.trim()}".` : `"${name.trim()}" created. Add what goes into it next.`);
    else setError(result.error);
  };

  return (
    <OverlayPanel title={pot ? "Rename investment" : "New investment"} icon={<Wallet2 size={18} />} maxWidth={480} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !name.trim() ? 0.5 : 1 }}>
            {busy ? "Saving…" : pot ? "Save" : "Create"}
          </button>
        </div>
      }>
      <OverlayCard title="The investment">
        <div style={{ display: "grid", gap: 11, padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Car investment, State Life loan…" style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything worth remembering" style={field} />
          </label>
        </div>
      </OverlayCard>
      {!pot && (
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
          It starts empty. Add money in as often as you like — the sheet has three rows on one investment and room for more.
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function ContributionForm({ existing, inHand = 0, pot, getIdToken, onClose, onSaved }: {
  /** Present: edits this row in place (`updateTransaction`, previous values kept). */
  existing?: TransactionDoc;
  /** What the pot holds now, so an edit can say what it will hold after. */
  inHand?: number;
  pot: Ledger["accounts"][number];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [label, setLabel] = useState(existing?.sourceLabel ?? "");
  const [dayKey, setDayKey] = useState(existing?.dayKey ?? karachiDayKey());
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const token = await getIdToken();
    const result = existing
      ? await updateTransaction(token, existing.id, {
          amount: Number(amount) || 0, label: label.trim(), dayKey, note: note.trim() || null,
        })
      : await addManualTransaction(token, {
          accountId: pot.id, direction: "IN", amount: Number(amount) || 0,
          type: "INVESTMENT", dayKey, label, note: note.trim() || null,
        });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (!existing) { onSaved(`${formatMoney(Number(amount) || 0)} added to ${pot.name}.`); return; }
    const diff = (Number(amount) || 0) - existing.amount;
    onSaved(diff === 0
      ? `"${label.trim()}" updated. The previous values are kept in its history.`
      : `"${label.trim()}" updated — ${pot.name} ${diff > 0 ? "up" : "down"} by ${formatMoney(Math.abs(diff))}. The previous values are kept in its history.`);
  };

  return (
    <OverlayPanel title={existing ? "Edit money in" : "Add money in"} subtitle={pot.name} icon={<Wallet2 size={18} />} maxWidth={480} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !label.trim() || !(Number(amount) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? (existing ? "Saving…" : "Adding…") : existing ? "Save changes" : "Add"}
          </button>
        </div>
      }>
      <OverlayCard title="What went in">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Description</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="State Life loan, Daddy 8 March, April committee 270…" style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Amount</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Date</span>
            <input type="date" value={dayKey} max={karachiDayKey()} onChange={(event) => setDayKey(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Details or notes…" style={field} />
          </label>
        </div>
      </OverlayCard>
      {existing && (() => {
        const after = Math.round((inHand + (Number(amount) || 0) - existing.amount) * 100) / 100;
        if ((Number(amount) || 0) === existing.amount) return null;
        return (
          <p style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.6, borderRadius: 10, padding: "9px 12px",
            background: after < 0 ? "#fdf4e6" : "#e8f5f3", color: after < 0 ? "#8a6321" : X.deep }}>
            Still in hand after this: {formatMoney(after)}
            {after < 0 && ` — more has already been spent from ${pot.name} than this would leave put in. It will show as overdrawn.`}
          </p>
        );
      })()}
      {existing && (
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
          {pot.name} moves by the difference. The old amount, description, date and note are kept in this entry&apos;s history.
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function SpendingForm({ spending, pot, getIdToken, onClose, onSaved }: {
  spending: Spending | null;
  pot: Ledger["accounts"][number];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({
    title: spending?.title ?? "",
    amount: spending ? String(spending.amount) : "",
    dayKey: spending?.dayKey ?? karachiDayKey(),
    description: spending?.description ?? "",
  });
  const [payDirectly, setPayDirectly] = useState(!spending);
  const [isLoan, setIsLoan] = useState(false);
  const [borrower, setBorrower] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const token = await getIdToken();
    if (!spending && payDirectly) {
      const result = await addManualTransaction(token, {
        accountId: pot.id,
        direction: "OUT",
        amount: Number(form.amount) || 0,
        type: "EXPENSE",
        dayKey: form.dayKey,
        label: form.title.trim(),
        note: form.description.trim() || null,
        ...(isLoan ? { loanTo: normalizeBorrower(borrower) } : {}),
      });
      setBusy(false);
      if (result.ok) {
        onSaved(isLoan
          ? `${formatMoney(Number(form.amount) || 0)} lent to ${normalizeBorrower(borrower)} from ${pot.name}. It is not counted as spending.`
          : `${formatMoney(Number(form.amount) || 0)} spending recorded and debited from ${pot.name}.`);
      } else {
        setError(result.error);
      }
    } else {
      const result = await saveCapitalSpending(
        token,
        {
          investmentId: pot.id,
          title: form.title.trim(),
          amount: Number(form.amount) || 0,
          dayKey: form.dayKey,
          description: form.description.trim() || "",
          ...(!spending && isLoan ? { loanTo: normalizeBorrower(borrower) } : {}),
        },
        spending?.id
      );
      setBusy(false);
      if (result.ok) {
        onSaved(spending ? "Spending updated." : "Spending added. Choose which account pays it.");
      } else {
        setError(result.error);
      }
    }
  };

  return (
    <OverlayPanel title={spending ? "Edit spending" : "Add spending"} subtitle={pot.name} icon={<Wallet2 size={18} />} maxWidth={520} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !form.title.trim() || !(Number(form.amount) > 0) || (isLoan && !normalizeBorrower(borrower))} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : spending ? "Save changes" : isLoan ? "Add loan" : "Add spending"}
          </button>
        </div>
      }>
      <OverlayCard title="What the money went on">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>What was it</span>
            <input value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Cultus, cheque payment, Feb committee…" style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Amount</span>
            <input type="number" inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Date</span>
            <input type="date" value={form.dayKey} max={karachiDayKey()} onChange={(event) => set("dayKey", event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Note</span>
            <input value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="47K tyre + 5.5 oil + 83.7 engine + 51 décor…" style={field} />
          </label>
        </div>
      </OverlayCard>

      {!spending && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginTop: 4, padding: "0 4px" }}>
          <input
            type="checkbox"
            checked={payDirectly}
            onChange={(e) => setPayDirectly(e.target.checked)}
            style={{ marginTop: 2, accentColor: X.teal, width: 16, height: 16, cursor: "pointer" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: X.ink }}>
              Pay directly from {pot.name}
            </span>
            <span style={{ fontSize: 11.5, color: X.faint }}>
              Debits {pot.name} directly and syncs with Central Ledger and Group Income sheet.
            </span>
          </div>
        </label>
      )}

      {!spending && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "0 4px" }}>
          <input
            type="checkbox"
            checked={isLoan}
            onChange={(e) => setIsLoan(e.target.checked)}
            style={{ marginTop: 2, accentColor: X.teal, width: 16, height: 16, cursor: "pointer" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: X.ink }}>This is a loan</span>
            <span style={{ fontSize: 11.5, color: X.faint }}>
              The money is lent to somebody and will come back. Not counted as spending.
            </span>
          </div>
        </label>
      )}
      {!spending && isLoan && (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 4px", ...designLabel }}>
          <span>Lent to</span>
          <input value={borrower} onChange={(event) => setBorrower(event.target.value)} placeholder="Muhammad Hussain" style={{ ...designField, fontSize: isMobile ? 16 : 13.5 }} />
        </label>
      )}

      {!spending && !payDirectly && (
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
          Recording as an unfunded spending ticket does not move money yet. Once added, you can choose which account(s) fund it.
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function DirectSpendingForm({
  existing,
  pot,
  getIdToken,
  onClose,
  onSaved,
}: {
  existing: TransactionDoc;
  pot: Ledger["accounts"][number];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [label, setLabel] = useState(existing.sourceLabel ?? "");
  const [amount, setAmount] = useState(String(existing.amount));
  const [dayKey, setDayKey] = useState(existing.dayKey);
  const [note, setNote] = useState(existing.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const token = await getIdToken();
    const result = await updateTransaction(token, existing.id, {
      amount: Number(amount) || 0,
      label: label.trim(),
      dayKey,
      note: note.trim() || null,
    });
    setBusy(false);
    if (result.ok) onSaved("Spending updated.");
    else setError(result.error);
  };

  return (
    <OverlayPanel
      title="Edit spending"
      subtitle={pot.name}
      icon={<Wallet2 size={18} />}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !label.trim() || !(Number(amount) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !label.trim() || !(Number(amount) > 0) ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      }
    >
      <OverlayCard title="What the money went on">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Description</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Feburary 2026 Khasara, tyre, repair…" style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Amount</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Date</span>
            <input type="date" value={dayKey} max={karachiDayKey()} onChange={(event) => setDayKey(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Details or notes…" style={field} />
          </label>
        </div>
      </OverlayCard>
      <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
        This spending was paid directly out of {pot.name}. Editing updates the amount in the ledger and investment spendings.
      </p>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}
