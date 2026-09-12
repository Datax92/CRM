"use client";

/**
 * The Accounts dashboard, and one account's statement.
 *
 * Two layouts, chosen by `useIsMobile` — a measured width, not a media query,
 * per the CRM's rule. The phone is not the desktop shrunk: the balance leads,
 * the summary cards scroll horizontally by the thumb, account cards stack full
 * width, and every transaction is a card rather than a row in a table nobody
 * can read at 390px.
 *
 * The statement is laid out the way the owner's workbook lays it out —
 * **Amount Received** one side, **Spendings** the other, each totalled. That is
 * how `COMMITTE 2025` and `CAPITAL INVESTMENT` are drawn by hand, so those
 * accounts open looking like the sheet they replace.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wallet, Plus, ArrowRightLeft, ArrowDownLeft, ArrowUpRight,
  ExternalLink, Landmark, TrendingUp, TrendingDown, Receipt, PiggyBank,
  Clock, Search, Pencil, Trash2, MoreHorizontal, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLedger, type AccountDoc, type TransactionDoc } from "@/hooks/useLedger";
import { formatMoney } from "@/lib/money";
import { karachiDayKey, karachiMonthKey, formatBusinessDate } from "@/lib/dates";
import {
  ACCOUNT_KIND_LABELS, TRANSACTION_TYPE_LABELS, ACCOUNT_KINDS,
  accountMovement, summarizeMonth, compareToPrevious,
  type LedgerTransaction, type TransactionType,
} from "@/lib/ledger";
import {
  addManualTransaction, countAccountContents, createAccount, createTransfer,
  deleteAccount, deleteTransaction, updateAccount, updateTransaction,
} from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import {
  A, CARD, ACCOUNT_ICONS, Trend, StatusPill, SummaryCard, Skeleton,
  EmptyState, Button, Chip, SectionTitle,
} from "./accountsChrome";
import { CommitteeStatement } from "./CommitteeStatement";

const iconButton: React.CSSProperties = {
  border: "none", background: "transparent", color: A.hair,
  cursor: "pointer", padding: 3, display: "inline-flex", alignItems: "center",
};

const FIELD: React.CSSProperties = {
  width: "100%", borderRadius: 10, border: `1px solid ${A.border}`, background: A.surface,
  padding: "10px 12px", fontSize: 14, color: A.ink, outline: "none", fontFamily: "inherit",
};

/** Where a transaction came from, so a row opens the record that caused it. */
const SOURCE_ROUTES: Record<string, string> = {
  OFFICE_EXPENSE: "/admin/accounts/office-expenses",
  PERSONAL_EXPENSE: "/admin/accounts/personal-expense",
  MARKETING_INCOME: "/admin/accounts/marketing-income",
  CAR_SALE: "/admin/accounts/car-sale",
  STATELIFE: "/admin/accounts/statelife",
  RECEIVABLE: "/admin/accounts/receivable",
};

const SOURCE_LABELS: Record<string, string> = {
  OFFICE_EXPENSE: "Office Expense",
  PERSONAL_EXPENSE: "Personal Expense",
  MARKETING_INCOME: "Marketing Income",
  CAR_SALE: "Car Sale",
  STATELIFE: "StateLife",
  CAPITAL_INVESTMENT: "Capital Investment",
  RECEIVABLE: "Receivable",
  DEAL_PAYOUT: "Deal Payout",
  PAYROLL: "Payroll",
  TRANSFER: "Transfer",
  MANUAL: "Manual entry",
};

/* -------------------------------------------------------------------------- */

export function AccountsView({ accountId }: { accountId?: string }) {
  const { role, getIdToken } = useAuth();
  const isMobile = useIsMobile();
  const ready = role === "admin" || role === "subadmin";
  const { accounts, transactions, balances, totalBalance, loading, error } = useLedger(ready);

  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [managingAccount, setManagingAccount] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  /** The committee screen owns its own Add / Edit, so they live up here. */
  const [enteringOn, setEnteringOn] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<TransactionDoc | null>(null);

  // One instant for the whole screen, so no two cards straddle midnight.
  const now = useMemo(() => {
    const todayKey = karachiDayKey();
    const monthKey = karachiMonthKey();
    const [y, m] = monthKey.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return { todayKey, monthKey, previousMonthKey: prev };
  }, []);

  const account = accountId ? accounts.find((a) => a.id === accountId) ?? null : null;

  if (!ready) {
    return (
      <EmptyState
        icon={<Wallet size={22} />}
        title="Accounts is for administrators and HR"
        body="Your role does not include the company's financial records."
        mobile={isMobile}
      />
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <header style={{ display: account?.kind === "COMMITTEE" ? "none" : "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          {account && (
            <Link href="/admin/accounts" style={{ fontSize: 12, fontWeight: 700, color: A.tealInk, textDecoration: "none" }}>
              ← All accounts
            </Link>
          )}
          <h1 style={{ fontFamily: "inherit", fontSize: isMobile ? 21 : 25, fontWeight: 700, color: A.ink, letterSpacing: -0.4, marginTop: account ? 4 : 0 }}>
            {account ? account.name : "Accounts"}
          </h1>
          <p style={{ fontSize: 12.5, color: A.faint, marginTop: 2 }}>
            {account
              ? `${ACCOUNT_KIND_LABELS[account.kind]} · every movement, and what caused it`
              : "Every rupee the business holds, and everywhere it moved"}
          </p>
        </div>
        {!account ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: isMobile ? "100%" : undefined }}>
            <Button onClick={() => setTransferring(true)} icon={<ArrowRightLeft size={14} />} full={isMobile}>Transfer</Button>
            <Button onClick={() => setCreating(true)} icon={<Plus size={14} />} primary full={isMobile}>New account</Button>
          </div>
        ) : (
          <Button onClick={() => setManagingAccount(true)} icon={<MoreHorizontal size={14} />} full={isMobile}>
            Rename or delete
          </Button>
        )}
      </header>

      {banner && (
        <p role="status" className="acc-in" style={{ marginBottom: 12, borderRadius: 12, border: `1px solid ${A.positiveBg}`, background: A.positiveBg, padding: "11px 14px", fontSize: 12.5, fontWeight: 700, color: A.positive }}>
          {banner}
        </p>
      )}
      {error && (
        <p role="alert" style={{ marginBottom: 12, borderRadius: 12, border: `1px solid ${A.negativeBg}`, background: A.negativeBg, padding: "11px 14px", fontSize: 12.5, fontWeight: 700, color: A.negative }}>
          {error}
        </p>
      )}

      {account && account.kind === "COMMITTEE" ? (
        /*
          A committee has its own screen, transcribed from
          `Committee Account.dc.html` and its mobile twin. Every other kind of
          account keeps the generic in/out statement below — the design covers
          committees, and inventing the rest from it would be guessing.
        */
        <CommitteeStatement
          account={account}
          transactions={transactions}
          isMobile={isMobile}
          onAdd={() => setEnteringOn(account.id)}
          onEdit={setEditingRow}
          onDelete={async (row) => {
            const extra = row.sourceModule === "MANUAL" ? "" : "\n\nThis was funding another record, which will go back to unpaid.";
            if (!window.confirm(`Delete "${row.sourceLabel ?? "this row"}"?${extra}`)) return;
            const res = await deleteTransaction(await getIdToken(), row.id);
            setBanner(res.ok ? "Deleted." : res.error);
          }}
          onManage={() => setManagingAccount(true)}
        />
      ) : account ? (
        <AccountStatement
          account={account}
          transactions={transactions}
          now={now}
          isMobile={isMobile}
          getIdToken={getIdToken}
          onDone={setBanner}
        />
      ) : (
        <Dashboard
          accounts={accounts}
          transactions={transactions}
          totalBalance={totalBalance}
          now={now}
          loading={loading}
          isMobile={isMobile}
          onCreate={() => setCreating(true)}
        />
      )}

      {managingAccount && account && (
        <ManageAccount
          account={account}
          onClose={() => setManagingAccount(false)}
          getIdToken={getIdToken}
          onSaved={setBanner}
        />
      )}

      {enteringOn && account && (
        <ManualEntry
          account={account}
          direction="OUT"
          onClose={() => setEnteringOn(null)}
          getIdToken={getIdToken}
          onSaved={(m) => { setBanner(m); setEnteringOn(null); }}
        />
      )}

      {editingRow && account && (
        <ManualEntry
          account={account}
          direction={editingRow.direction}
          existing={editingRow}
          onClose={() => setEditingRow(null)}
          getIdToken={getIdToken}
          onSaved={(m) => { setBanner(m); setEditingRow(null); }}
        />
      )}

      {creating && <NewAccount onClose={() => setCreating(false)} getIdToken={getIdToken} onSaved={(m) => { setBanner(m); setCreating(false); }} />}
      {transferring && (
        <TransferPanel accounts={accounts} balances={balances} onClose={() => setTransferring(false)} getIdToken={getIdToken} onSaved={(m) => { setBanner(m); setTransferring(false); }} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Dashboard({
  accounts, transactions, totalBalance, now, loading, isMobile, onCreate,
}: {
  accounts: AccountDoc[];
  transactions: TransactionDoc[];
  totalBalance: number;
  now: { todayKey: string; monthKey: string; previousMonthKey: string };
  loading: boolean;
  isMobile: boolean;
  onCreate: () => void;
}) {
  const rows = transactions as unknown as LedgerTransaction[];
  const thisMonth = useMemo(() => summarizeMonth(rows, now.monthKey), [rows, now.monthKey]);
  const lastMonth = useMemo(() => summarizeMonth(rows, now.previousMonthKey), [rows, now.previousMonthKey]);
  // Only compare when the previous month actually holds something — otherwise
  // the card shows the figure and no trend.
  const hadLast = useMemo(
    () => rows.some((t) => t.dayKey.slice(0, 7) === now.previousMonthKey),
    [rows, now.previousMonthKey]
  );
  const cmp = (current: number, previous: number) =>
    compareToPrevious(current, hadLast ? previous : null);

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Skeleton height={isMobile ? 116 : 132} />
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 170}px, 1fr))` }}>
          <Skeleton height={104} count={6} />
        </div>
        <Skeleton height={92} count={3} />
      </div>
    );
  }

  return (
    <>
      {/* The one figure somebody opens this page for. */}
      <div
        className="acc-in"
        style={{
          borderRadius: 18,
          background: `linear-gradient(135deg, ${A.deep} 0%, ${A.tealInk} 55%, #35706b 100%)`,
          color: "#fff",
          padding: isMobile ? "20px 20px" : "24px 26px",
          marginBottom: 12,
          boxShadow: "0 10px 30px rgba(31,92,88,0.18)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", opacity: 0.82 }}>
          Total balance
        </span>
        <div style={{ fontSize: isMobile ? 30 : 38, fontWeight: 800, marginTop: 3, letterSpacing: -1, fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(totalBalance)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap", fontSize: 12, opacity: 0.9 }}>
          <span>{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
          <span aria-hidden>·</span>
          <span>
            {thisMonth.netMovement >= 0 ? "up" : "down"} {formatMoney(Math.abs(thisMonth.netMovement))} this month
          </span>
        </div>
      </div>

      {/* Summary. Scrolls by thumb on a phone rather than shrinking to fit. */}
      <div
        style={
          isMobile
            ? { display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, margin: "0 -4px", padding: "0 4px 4px", scrollSnapType: "x mandatory" }
            : { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(178px, 1fr))" }
        }
      >
        {([
          ["Income", thisMonth.income, <ArrowDownLeft key="i" size={14} />, A.positive, cmp(thisMonth.income, lastMonth.income)],
          ["Expenses", thisMonth.expenses, <ArrowUpRight key="e" size={14} />, A.negative, cmp(thisMonth.expenses, lastMonth.expenses)],
          ["Investments", thisMonth.investments, <PiggyBank key="v" size={14} />, undefined, cmp(thisMonth.investments, lastMonth.investments)],
          ["Reimbursements", thisMonth.reimbursements, <Receipt key="r" size={14} />, undefined, cmp(thisMonth.reimbursements, lastMonth.reimbursements)],
          ["Transfers", thisMonth.transfersOut, <ArrowRightLeft key="t" size={14} />, A.neutral, undefined],
          ["Net movement", thisMonth.netMovement, <TrendingUp key="n" size={14} />, thisMonth.netMovement < 0 ? A.negative : A.positive, cmp(thisMonth.netMovement, lastMonth.netMovement)],
        ] as const).map(([label, value, icon, tone, trend]) => (
          <div key={label} style={isMobile ? { minWidth: 168, scrollSnapAlign: "start", flexShrink: 0 } : undefined}>
            <SummaryCard
              label={label}
              value={value}
              icon={icon}
              tone={tone}
              direction={trend?.direction}
              changePct={trend?.changePct}
              comparison="vs last month"
              mobile={isMobile}
            />
          </div>
        ))}
      </div>

      <SectionTitle action={<Button onClick={onCreate} icon={<Plus size={13} />}>Add</Button>}>Accounts</SectionTitle>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark size={22} />}
          title="No accounts yet"
          body="Create a bank, the cash box, a committee or an investment. Once one exists, every expense and every receipt in the CRM can be paid from it — and each movement records itself here."
          action={<Button onClick={onCreate} primary icon={<Plus size={14} />}>Create your first account</Button>}
          mobile={isMobile}
        />
      ) : (
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(268px, 1fr))" }}>
          {accounts.map((account, index) => (
            <AccountCard
              key={account.id}
              account={account}
              movement={accountMovement(account, rows, now)}
              count={rows.filter((t) => t.accountId === account.id && t.status === "POSTED").length}
              index={index}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}

      <SectionTitle
        action={
          <Link href="/admin/accounts/transactions" style={{ fontSize: 12, fontWeight: 700, color: A.tealInk, textDecoration: "none" }}>
            View all →
          </Link>
        }
      >
        Recent activity
      </SectionTitle>

      {transactions.length === 0 ? (
        <EmptyState
          icon={<Clock size={22} />}
          title="No transactions yet"
          body="Transactions from expenses, income and transfers appear here automatically — you never enter them twice."
          mobile={isMobile}
        />
      ) : (
        <TransactionList rows={transactions.slice(0, 12)} accounts={accounts} isMobile={isMobile} />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function AccountCard({
  account, movement, count, index, isMobile,
}: {
  account: AccountDoc;
  movement: ReturnType<typeof accountMovement>;
  count: number;
  index: number;
  isMobile: boolean;
}) {
  const Icon = ACCOUNT_ICONS[account.kind];
  /** Committees and investments hold a pot; banks hold a running balance. */
  const isVault = account.kind === "COMMITTEE" || account.kind === "INVESTMENT";
  return (
    <Link
      href={`/admin/accounts/ledger/${account.id}`}
      className="acc-in acc-lift"
      style={{
        ...CARD,
        display: "block", padding: "15px 17px", textDecoration: "none",
        animationDelay: `${Math.min(index, 7) * 35}ms`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", background: A.tealTint, color: A.tealInk, flexShrink: 0 }}>
            <Icon size={15} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account.name}
            </span>
            <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: A.faint }}>
              {ACCOUNT_KIND_LABELS[account.kind]}
            </span>
          </span>
        </span>
        {account.status === "ARCHIVED" && <StatusPill status="ARCHIVED" small />}
      </div>

      {/* The headline says what it is. On a vault it is what is *left*, which
          is a different claim from a bank account's balance. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
        {isVault && <span style={{ fontSize: 11.5, fontWeight: 600, color: A.faint }}>Remaining</span>}
        <span style={{ fontSize: isMobile ? 24 : 26, fontWeight: 800, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums", color: movement.balance < 0 ? A.negative : A.ink }}>
          {formatMoney(movement.balance)}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
        <Trend direction={movement.direction} changePct={movement.changePct} />
        <span style={{ fontSize: 11, color: A.faint, fontWeight: 600 }}>
          {movement.month === 0 ? "no movement this month" : `${formatMoney(Math.abs(movement.month))} this month`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 11, paddingTop: 10, borderTop: `1px solid ${A.rowBorder}`, fontSize: 11, color: A.faint, flexWrap: "wrap" }}>
        <span>Today <strong style={{ color: movement.today === 0 ? A.faint : movement.today > 0 ? A.positive : A.negative, fontVariantNumeric: "tabular-nums" }}>
          {movement.today === 0 ? "—" : formatMoney(Math.abs(movement.today))}
        </strong></span>
        {/*
          **A vault's "in" is its pot, not its inflow.** A committee's amount
          lives on the account and is deliberately not a transaction, so
          `movement.inflow` is 0 — the card used to read "In Rs 0" beside a real
          spend. A bank account genuinely does take money in repeatedly, and
          keeps the inflow figure.
        */}
        <span>
          {isVault ? "Received" : "In"}{" "}
          <strong style={{ color: A.positive, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(isVault ? movement.openingBalance : movement.inflow)}
          </strong>
        </span>
        <span>
          {isVault ? "Spent" : "Out"}{" "}
          <strong style={{ color: A.negative, fontVariantNumeric: "tabular-nums" }}>{formatMoney(movement.outflow)}</strong>
        </span>
        <span>{count} txn{count === 1 ? "" : "s"}</span>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Transactions as cards, on both surfaces.
 *
 * Deliberately not a table: the important facts — what it was, which account,
 * which module, the amount — group better than they column, and the same
 * component then works at 390px without a horizontal scrollbar.
 */
export function TransactionList({
  rows, accounts, isMobile,
}: {
  rows: TransactionDoc[];
  accounts: AccountDoc[];
  isMobile: boolean;
}) {
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown account";

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row, index) => {
        const isTransfer = row.type === "TRANSFER";
        const tone = isTransfer ? A.neutral : row.direction === "IN" ? A.positive : A.negative;
        const bg = isTransfer ? A.neutralBg : row.direction === "IN" ? A.positiveBg : A.negativeBg;
        const Icon = isTransfer ? ArrowRightLeft : row.direction === "IN" ? ArrowDownLeft : ArrowUpRight;
        const href = row.sourceId ? SOURCE_ROUTES[row.sourceModule] : undefined;
        const voided = row.status === "VOIDED";

        const body = (
          <div
            className="acc-in"
            style={{
              ...CARD,
              display: "flex", alignItems: "center", gap: 12,
              padding: isMobile ? "12px 13px" : "13px 16px",
              opacity: voided ? 0.5 : 1,
              animationDelay: `${Math.min(index, 7) * 28}ms`,
            }}
          >
            <span style={{ display: "inline-flex", width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", background: bg, color: tone, flexShrink: 0 }}>
              <Icon size={16} />
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13.5, fontWeight: 700, color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: voided ? "line-through" : "none" }}>
                {row.sourceLabel ?? TRANSACTION_TYPE_LABELS[row.type]}
              </p>
              <p style={{ fontSize: 11.5, color: A.faint, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {SOURCE_LABELS[row.sourceModule] ?? row.sourceModule} · {nameOf(row.accountId)}
                {!isMobile && ` · ${formatBusinessDate(new Date(`${row.dayKey}T12:00:00+05:00`))}`}
              </p>
              {isMobile && (
                <p style={{ fontSize: 11, color: A.hair, marginTop: 1 }}>
                  {formatBusinessDate(new Date(`${row.dayKey}T12:00:00+05:00`))}
                </p>
              )}
            </div>

            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <p style={{ fontSize: isMobile ? 14 : 15, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {/* The sign, not only the colour — meaning must survive a
                    monochrome screen. */}
                {row.direction === "IN" ? "+" : "−"} {formatMoney(row.amount)}
              </p>
              <div style={{ marginTop: 3 }}>
                <StatusPill status={voided ? "VOIDED" : isTransfer ? "TRANSFER" : "POSTED"} small />
              </div>
            </div>

            {href && !isMobile && <ExternalLink size={13} style={{ color: A.hair, flexShrink: 0 }} />}
          </div>
        );

        return href ? (
          <Link key={row.id} href={href} style={{ textDecoration: "none" }}>{body}</Link>
        ) : (
          <div key={row.id}>{body}</div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AccountStatement({
  account, transactions, now, isMobile, getIdToken, onDone,
}: {
  account: AccountDoc;
  transactions: TransactionDoc[];
  now: { todayKey: string; monthKey: string; previousMonthKey: string };
  isMobile: boolean;
  getIdToken: () => Promise<string>;
  onDone: (message: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TransactionType | "ALL">("ALL");
  const [flow, setFlow] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [search, setSearch] = useState("");
  /**
   * Entering a receipt or a spending **on the account itself**.
   *
   * Most rows arrive on their own — pay an office expense from the Committee
   * and its outflow posts itself. But the owner's sheet also has spendings that
   * belong to no other module: "USED IN IRAN TOUR", "DECEMBER COMMITTEE KAT
   * GAYI". Those are real movements with nothing else to hang off, so the
   * statement has to be able to take them directly.
   */
  const [entering, setEntering] = useState<"IN" | "OUT" | null>(null);
  const [editingRow, setEditingRow] = useState<TransactionDoc | null>(null);
  /** Committees and investments are vaults: one amount in, then spendings. */
  const isVault = account.kind === "COMMITTEE" || account.kind === "INVESTMENT";

  const mine = useMemo(
    () => transactions.filter((t) => t.accountId === account.id),
    [transactions, account.id]
  );
  const movement = useMemo(
    () => accountMovement(account, mine as unknown as LedgerTransaction[], now),
    [account, mine, now]
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return mine.filter((t) => {
      if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
      if (flow !== "ALL" && t.direction !== flow) return false;
      if (needle && !`${t.sourceLabel ?? ""} ${t.note ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [mine, typeFilter, flow, search]);

  const received = shown.filter((t) => t.direction === "IN");
  const spent = shown.filter((t) => t.direction === "OUT");

  return (
    <>
      {/*
        **A committee is a vault**: an amount comes in once, and everything
        after it is a spending. Three figures answer everything — what came in,
        what has gone, what is left — so the in/out/this-month cards a bank
        account wants are not shown for one.
      */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : `repeat(${isVault ? 3 : 5}, minmax(0, 1fr))`, marginBottom: 14 }}>
        {isVault ? (
          <>
            <SummaryCard label={`${ACCOUNT_KIND_LABELS[account.kind]} amount`} value={movement.openingBalance} icon={<Landmark size={14} />} mobile={isMobile} />
            <SummaryCard label="Spent" value={movement.outflow} icon={<ArrowUpRight size={14} />} tone={A.negative} mobile={isMobile} />
            <SummaryCard label="Remaining" value={movement.balance} icon={<Wallet size={14} />} tone={movement.balance < 0 ? A.negative : A.positive} mobile={isMobile} />
          </>
        ) : (
          <>
            <SummaryCard label="Opening balance" value={movement.openingBalance} icon={<Landmark size={14} />} mobile={isMobile} />
            <SummaryCard label="Total in" value={movement.inflow} icon={<ArrowDownLeft size={14} />} tone={A.positive} mobile={isMobile} />
            <SummaryCard label="Total out" value={movement.outflow} icon={<ArrowUpRight size={14} />} tone={A.negative} mobile={isMobile} />
            <SummaryCard
              label="This month"
              value={movement.month}
              icon={movement.direction === "down" ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
              direction={movement.direction}
              changePct={movement.changePct}
              comparison="vs last month"
              mobile={isMobile}
            />
            <SummaryCard label="Current balance" value={movement.balance} icon={<Wallet size={14} />} tone={movement.balance < 0 ? A.negative : A.tealInk} mobile={isMobile} />
          </>
        )}
      </div>

      {/* Filters. Chips on both surfaces — a select would hide the state. */}
      <div style={{ ...CARD, padding: isMobile ? "11px 12px" : "12px 14px", marginBottom: 12, display: "grid", gap: 9 }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: A.hair }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this statement…"
            style={{ ...FIELD, paddingLeft: 32, fontSize: isMobile ? 16 : 13.5 }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", overflowX: isMobile ? "auto" : undefined }}>
          <Chip label="All" active={flow === "ALL" && typeFilter === "ALL"} onClick={() => { setFlow("ALL"); setTypeFilter("ALL"); }} />
          <Chip label="Money in" active={flow === "IN"} onClick={() => setFlow(flow === "IN" ? "ALL" : "IN")} />
          <Chip label="Money out" active={flow === "OUT"} onClick={() => setFlow(flow === "OUT" ? "ALL" : "OUT")} />
          {(["EXPENSE", "INCOME", "TRANSFER", "REIMBURSEMENT"] as const).map((t) => (
            <Chip key={t} label={TRANSACTION_TYPE_LABELS[t]} active={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? "ALL" : t)} />
          ))}
        </div>
      </div>

      {mine.length === 0 ? (
        <EmptyState
          icon={<Clock size={22} />}
          title="Nothing has moved through this account yet"
          body={
            account.kind === "COMMITTEE"
              ? "Record what this committee is being spent on. Anything you pay from it elsewhere in the CRM — an office expense, a reimbursement — lands here by itself, so only add the spendings that belong to no other module."
              : "Two ways things land here. Pay an expense from this account anywhere in the CRM and the movement records itself, linked to what caused it — or add a receipt or a spending directly, for money that belongs to no other module."
          }
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {account.kind !== "COMMITTEE" && (
                <Button icon={<ArrowDownLeft size={14} />} onClick={() => setEntering("IN")}>Add received</Button>
              )}
              <Button primary icon={<ArrowUpRight size={14} />} onClick={() => setEntering("OUT")}>Add spending</Button>
            </div>
          }
          mobile={isMobile}
        />
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile || isVault ? "1fr" : "repeat(auto-fit, minmax(330px, 1fr))" }}>
          {/*
            **A vault has one list.** The sheet's Spendings table is the whole
            page: an Amount Received column with a single row in it was a second
            thing to manage for no gain, so the pot lives in the card above and
            this is only what has gone out.
          */}
          {!isVault && (
            <StatementColumn
              title="Amount Received"
              rows={received}
              tone={A.positive}
              isMobile={isMobile}
              getIdToken={getIdToken}
              onDone={onDone}
              onAdd={() => setEntering("IN")}
              addLabel="Add received"
              onEdit={setEditingRow}
            />
          )}
          <StatementColumn
            title="Spendings"
            rows={isVault ? shown : spent}
            tone={A.negative}
            isMobile={isMobile}
            getIdToken={getIdToken}
            onDone={onDone}
            onAdd={() => setEntering("OUT")}
            addLabel="Add spending"
            onEdit={setEditingRow}
          />
        </div>
      )}

      {entering && (
        <ManualEntry
          account={account}
          direction={entering}
          onClose={() => setEntering(null)}
          getIdToken={getIdToken}
          onSaved={(m) => { onDone(m); setEntering(null); }}
        />
      )}

      {editingRow && (
        <ManualEntry
          account={account}
          direction={editingRow.direction}
          existing={editingRow}
          onClose={() => setEditingRow(null)}
          getIdToken={getIdToken}
          onSaved={(m) => { onDone(m); setEditingRow(null); }}
        />
      )}

    </>
  );
}

/**
 * Renaming an account, or deleting it.
 *
 * Delete counts what it is about to destroy **before** offering the button, and
 * refuses outright when any of those rows came from an expense or a receipt
 * elsewhere — that record would be left insisting it was funded from an account
 * that no longer exists. Archiving is offered beside it as the safe version:
 * the history stays, and nothing can be paid from it again.
 */
function ManageAccount({
  account, onClose, getIdToken, onSaved,
}: {
  account: AccountDoc;
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [counts, setCounts] = useState<{ total: number; linked: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await countAccountContents(await getIdToken(), account.id);
      if (!cancelled && res.ok) setCounts(res.data);
    })();
    return () => { cancelled = true; };
  }, [account.id, getIdToken]);

  return (
    <OverlayPanel
      title="Account settings"
      subtitle={account.name}
      icon={<MoreHorizontal size={18} />}
      maxWidth={480}
      onClose={onClose}
      footer={
        <Button
          primary
          full={isMobile}
          disabled={busy || !name.trim() || name.trim() === account.name}
          onClick={async () => {
            setBusy(true);
            const res = await updateAccount(await getIdToken(), account.id, { name: name.trim() });
            setBusy(false);
            if (res.ok) { onSaved("Renamed."); onClose(); } else setError(res.error);
          }}
        >
          Save name
        </Button>
      }
    >
      <OverlayCard title="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }} />
      </OverlayCard>

      <OverlayCard title="Remove this account">
        <p style={{ fontSize: 12.5, color: A.muted, lineHeight: 1.55 }}>
          {counts === null
            ? "Counting what is in it…"
            : counts.linked > 0
              ? `This account holds ${counts.linked} movement${counts.linked === 1 ? "" : "s"} that came from expenses or income elsewhere in the CRM. Deleting it would leave those records funded from an account that no longer exists, so delete is not offered — archive it instead.`
              : counts.total === 0
                ? "Nothing has moved through it, so deleting removes only the account."
                : `Deleting removes the account and all ${counts.total} row${counts.total === 1 ? "" : "s"} on its statement. This cannot be undone.`}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await updateAccount(await getIdToken(), account.id, {
                status: account.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
              });
              setBusy(false);
              if (res.ok) {
                onSaved(account.status === "ARCHIVED" ? "Reopened." : "Archived — its history stays, and nothing can be paid from it.");
                onClose();
              } else setError(res.error);
            }}
          >
            {account.status === "ARCHIVED" ? "Reopen account" : "Archive instead"}
          </Button>

          {counts !== null && counts.linked === 0 && (
            <button
              type="button"
              className="acc-press"
              disabled={busy}
              onClick={async () => {
                const what = counts.total === 0 ? "this account" : `this account and its ${counts.total} rows`;
                if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
                setBusy(true);
                const res = await deleteAccount(await getIdToken(), account.id);
                setBusy(false);
                if (res.ok) {
                  onClose();
                  router.push("/admin/accounts");
                } else setError(res.error);
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 11,
                border: `1px solid #f0c4bd`, background: A.negativeBg, color: A.negative,
                padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Trash2 size={14} /> Delete account
            </button>
          )}
        </div>

        {counts !== null && counts.linked > 0 && (
          <p style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 10, fontSize: 11.5, color: A.pending, fontWeight: 600 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            Reverse those movements first if you really need this account gone.
          </p>
        )}
      </OverlayCard>

      {error && <p role="alert" style={{ color: A.negative, fontSize: 12.5, fontWeight: 700 }}>{error}</p>}
    </OverlayPanel>
  );
}

/**
 * A receipt or a spending typed straight onto an account.
 *
 * It posts through `addManualTransaction`, which is the same ledger write
 * everything else uses — so the row lands in the statement, the balance moves,
 * and it is reversible like any other. Its source reads **Manual entry**, which
 * is the honest answer: nothing else in the CRM caused it.
 *
 * The empty state on an account with nothing in it now points here, because
 * "wait for another module to pay from this" was not a usable instruction for
 * a committee somebody spends out of directly.
 */
function ManualEntry({
  account, direction, existing, onClose, getIdToken, onSaved,
}: {
  account: AccountDoc;
  direction: "IN" | "OUT";
  /** Present when editing a row rather than adding one. */
  existing?: TransactionDoc | null;
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const editing = Boolean(existing);
  const [label, setLabel] = useState(existing?.sourceLabel ?? "");
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [dayKey, setDayKey] = useState(existing?.dayKey ?? karachiDayKey());
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incoming = direction === "IN";
  const ok = label.trim().length > 0 && Number(amount) > 0;

  return (
    <OverlayPanel
      title={editing ? (incoming ? "Edit received" : "Edit spending") : incoming ? "Add amount received" : "Add spending"}
      subtitle={account.name}
      icon={incoming ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
      maxWidth={460}
      onClose={onClose}
      footer={
        <Button
          primary
          full={isMobile}
          disabled={busy || !ok}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const token = await getIdToken();
            // Editing moves the balance by the *difference*; adding moves it by
            // the whole amount. Neither re-reads the statement.
            const res = existing
              ? await updateTransaction(token, existing.id, {
                  amount: Number(amount),
                  label: label.trim(),
                  dayKey,
                  note: note.trim() || null,
                })
              : await addManualTransaction(token, {
                  accountId: account.id,
                  direction,
                  amount: Number(amount),
                  // A committee's own spending is an expense of the business,
                  // and a receipt into it is income — so the dashboard's totals
                  // pick them up rather than filing them under "adjustment".
                  type: incoming ? "INCOME" : "EXPENSE",
                  dayKey,
                  label: label.trim(),
                  note: note.trim() || null,
                });
            setBusy(false);
            if (res.ok) {
              onSaved(
                existing
                  ? "Updated."
                  : `${incoming ? "Received" : "Spending"} recorded on ${account.name}.`
              );
            } else {
              setError(res.error);
            }
          }}
        >
          {busy ? "Saving…" : editing ? "Save changes" : incoming ? "Add received" : "Add spending"}
        </Button>
      }
    >
      <OverlayCard title="Details">
        <div style={{ display: "grid", gap: 11 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
            Description
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={incoming ? "December committee received" : "Used in Iran tour"}
              style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }}
            />
            <span style={{ fontSize: 11, color: A.faint, fontWeight: 500 }}>
              What the statement will say — the same column the sheet calls Description.
            </span>
          </label>

          <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
              Amount
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                style={{ ...FIELD, fontSize: isMobile ? 16 : 14, fontVariantNumeric: "tabular-nums" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
              Date
              <input
                type="date"
                value={dayKey}
                max={karachiDayKey()}
                onChange={(e) => setDayKey(e.target.value)}
                style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }}
              />
            </label>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }} />
          </label>

          <p
            style={{
              fontSize: 11.5, color: A.faint, lineHeight: 1.55,
              borderRadius: 10, background: A.tint, padding: "10px 12px",
            }}
          >
            {editing
              ? "The change is kept on the row's own history — what it said before, who changed it and when."
              : <>
                  This is for money that belongs to no other module. Anything paid from{" "}
                  <strong style={{ color: A.muted }}>{account.name}</strong> elsewhere in the CRM — an
                  office expense, a reimbursement — already records itself here, and should not be
                  entered twice.
                </>}
          </p>
        </div>
      </OverlayCard>

      {error && (
        <p role="alert" style={{ color: A.negative, fontSize: 12.5, fontWeight: 700 }}>{error}</p>
      )}
    </OverlayPanel>
  );
}

function StatementColumn({
  title, rows, tone, isMobile, getIdToken, onDone, onAdd, addLabel, onEdit,
}: {
  title: string;
  rows: TransactionDoc[];
  tone: string;
  isMobile: boolean;
  getIdToken: () => Promise<string>;
  onDone: (message: string) => void;
  /** Opens the entry panel for this side of the statement. */
  onAdd?: () => void;
  addLabel?: string;
  onEdit?: (row: TransactionDoc) => void;
}) {
  const total = rows.filter((r) => r.status === "POSTED").reduce((sum, r) => sum + r.amount, 0);

  return (
    <div style={{ ...CARD, overflow: "hidden" }}>
      <div style={{ padding: "12px 15px", borderBottom: `1px solid ${A.rowBorder}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: tone }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums" }}>{formatMoney(total)}</span>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              aria-label={addLabel}
              title={addLabel}
              className="acc-press"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                borderRadius: 8, border: `1px solid ${A.border}`, background: A.surface,
                color: tone, padding: "5px 9px", fontSize: 11.5, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              <Plus size={12} /> Add
            </button>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "22px 15px", textAlign: "center" }}>
          <p style={{ fontSize: 12.5, color: A.faint }}>Nothing here yet.</p>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="acc-press"
              style={{
                marginTop: 9, borderRadius: 10, border: `1px dashed ${A.hair}`, background: "transparent",
                color: A.tealInk, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              + {addLabel}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid" }}>
          {rows.map((row) => {
            const href = row.sourceId ? SOURCE_ROUTES[row.sourceModule] : undefined;
            const voided = row.status === "VOIDED";
            return (
              <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "11px 13px" : "11px 15px", borderTop: `1px solid ${A.rowBorder}`, opacity: voided ? 0.5 : 1 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: A.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: voided ? "line-through" : "none" }}>
                    {row.sourceLabel ?? TRANSACTION_TYPE_LABELS[row.type]}
                  </p>
                  <p style={{ fontSize: 11, color: A.faint, marginTop: 1 }}>
                    {row.dayKey} · {SOURCE_LABELS[row.sourceModule] ?? row.sourceModule}
                    {href && (
                      <>
                        {" · "}
                        <Link href={href} style={{ color: A.tealInk, textDecoration: "none", fontWeight: 700 }}>open</Link>
                      </>
                    )}
                  </p>
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: tone, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {formatMoney(row.amount)}
                </span>
                {!voided && (
                  <span style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}>
                    {/*
                      **Delete on every row; edit only on the ones typed here.**
                      An amount that arrived from an expense belongs to that
                      expense — editing it here would leave the two disagreeing.
                      Deleting is different: it takes the money back off the
                      expense too, so the two stay in step and the expense
                      becomes payable again from somewhere else.
                    */}
                    {row.sourceModule === "MANUAL" && (
                      <button
                        type="button"
                        title="Edit"
                        aria-label={`Edit ${row.sourceLabel ?? "row"}`}
                        className="acc-press"
                        onClick={() => onEdit?.(row)}
                        style={iconButton}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete"
                      aria-label={`Delete ${row.sourceLabel ?? "row"}`}
                      className="acc-press"
                      onClick={async () => {
                        const extra =
                          row.sourceModule === "MANUAL"
                            ? ""
                            : "\n\nThis was funding another record, which will go back to unpaid.";
                        if (!window.confirm(`Delete "${row.sourceLabel ?? "this row"}" (${formatMoney(row.amount)})?${extra}`)) return;
                        const res = await deleteTransaction(await getIdToken(), row.id);
                        onDone(res.ok ? "Deleted." : res.error);
                      }}
                      style={{ ...iconButton, color: A.negative }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NewAccount({ onClose, getIdToken, onSaved }: { onClose: () => void; getIdToken: () => Promise<string>; onSaved: (m: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("BANK");
  const [openingBalance, setOpeningBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();

  return (
    <OverlayPanel
      title="New account"
      icon={<Wallet size={18} />}
      maxWidth={480}
      onClose={onClose}
      footer={
        <Button
          primary
          full={isMobile}
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const res = await createAccount(await getIdToken(), { name, kind, openingBalance: Number(openingBalance) || 0 });
            setBusy(false);
            if (res.ok) onSaved(`${name.trim()} created.`); else setError(res.error);
          }}
        >
          {busy ? "Creating…" : "Create account"}
        </Button>
      }
    >
      <OverlayCard title="Account details">
        <div style={{ display: "grid", gap: 11 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meezan Bank · Cash in hand · December Committee" style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }} />
          </label>
          <div>
            <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: A.muted, marginBottom: 6 }}>Type</span>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {ACCOUNT_KINDS.map((k) => {
                const Icon = ACCOUNT_ICONS[k];
                const on = kind === k;
                return (
                  <button key={k} type="button" onClick={() => setKind(k)} className="acc-press"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10,
                      border: `1px solid ${on ? A.teal : A.border}`, background: on ? A.tealTint : A.surface,
                      color: on ? A.deep : A.muted, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    }}>
                    <Icon size={13} /> {ACCOUNT_KIND_LABELS[k]}
                  </button>
                );
              })}
            </div>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
            Opening balance
            <input type="number" inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0" style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }} />
            <span style={{ fontSize: 11, color: A.faint, fontWeight: 500 }}>
              What it held before the ledger started. Part of the balance, and deliberately not a transaction.
            </span>
          </label>
        </div>
      </OverlayCard>
      {error && <p role="alert" style={{ color: A.negative, fontSize: 12.5, fontWeight: 700 }}>{error}</p>}
    </OverlayPanel>
  );
}

function TransferPanel({ accounts, balances, onClose, getIdToken, onSaved }: {
  accounts: AccountDoc[];
  balances: Map<string, { balance: number }>;
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onSaved: (m: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const ok = from && to && from !== to && Number(amount) > 0;

  return (
    <OverlayPanel
      title="Transfer between accounts"
      icon={<ArrowRightLeft size={18} />}
      maxWidth={480}
      onClose={onClose}
      footer={
        <Button
          primary
          full={isMobile}
          disabled={busy || !ok}
          onClick={async () => {
            setBusy(true);
            const res = await createTransfer(await getIdToken(), { fromAccountId: from, toAccountId: to, amount: Number(amount) });
            setBusy(false);
            if (res.ok) onSaved("Transferred — counted as neither income nor expense."); else setError(res.error);
          }}
        >
          {busy ? "Transferring…" : "Transfer"}
        </Button>
      }
    >
      <OverlayCard title="From, to, how much">
        <div style={{ display: "grid", gap: 11 }}>
          {([["From", from, setFrom], ["To", to, setTo]] as const).map(([label, value, set]) => (
            <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
              {label}
              <select value={value} onChange={(e) => set(e.target.value)} style={{ ...FIELD, cursor: "pointer", fontSize: isMobile ? 16 : 14 }}>
                <option value="">Choose an account…</option>
                {accounts.filter((a) => a.status !== "ARCHIVED").map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — {formatMoney(balances.get(a.id)?.balance ?? 0)}</option>
                ))}
              </select>
            </label>
          ))}
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 700, color: A.muted }}>
            Amount
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ ...FIELD, fontSize: isMobile ? 16 : 14 }} />
          </label>
          <p style={{ fontSize: 11.5, color: A.faint, lineHeight: 1.5 }}>
            A transfer reduces one account and increases the other. It is neither income nor expense —
            counting it as either would inflate both sides of every report by the same amount.
          </p>
        </div>
      </OverlayCard>
      {error && <p role="alert" style={{ color: A.negative, fontSize: 12.5, fontWeight: 700 }}>{error}</p>}
    </OverlayPanel>
  );
}

export { EmptyState };
