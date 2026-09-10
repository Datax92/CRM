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
import { Wallet2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLedger, useFinanceCollection } from "@/hooks/useLedger";
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
  deleteTransaction,
  saveCapitalSpending,
  deleteCapitalSpending,
  countCapitalSpendingPayments,
} from "@/lib/clientActions";
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

interface Spending {
  id: string;
  investmentId: string;
  title: string;
  amount: number;
  dayKey: string;
  description: string | null;
  paidAmount: number;
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
    const map = new Map<string, { received: number; paidFromPot: number; cost: number; funded: number; count: number }>();
    for (const pot of pots) {
      map.set(pot.id, { received: pot.openingBalance ?? 0, paidFromPot: 0, cost: 0, funded: 0, count: 0 });
    }
    for (const txn of ledger.transactions) {
      const entry = map.get(txn.accountId);
      if (!entry) continue;
      if (txn.direction === "IN") entry.received += txn.amount;
      else entry.paidFromPot += txn.amount;
    }
    for (const spending of spendings) {
      const entry = map.get(spending.investmentId);
      if (!entry) continue;
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

function VentureView({ pot, ledger, spendings, loading, getIdToken, isMobile, onBack }: {
  pot: Ledger["accounts"][number];
  ledger: Ledger;
  spendings: Spending[];
  loading: boolean;
  getIdToken: () => Promise<string>;
  isMobile: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"SPENDINGS" | "RECEIVED">("SPENDINGS");
  const [addingSpending, setAddingSpending] = useState(false);
  const [editingSpending, setEditingSpending] = useState<Spending | null>(null);
  const [addingContribution, setAddingContribution] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [paying, setPaying] = useState<Spending | null>(null);
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
  const contributions = useMemo(
    () => movements.filter((txn) => txn.direction === "IN"),
    [movements]
  );

  const figures = useMemo(() => {
    const received = (pot.openingBalance ?? 0) + contributions.reduce((sum, txn) => sum + txn.amount, 0);
    const paidFromPot = movements.filter((txn) => txn.direction === "OUT").reduce((sum, txn) => sum + txn.amount, 0);
    const cost = spendings.reduce((sum, spending) => sum + spending.amount, 0);
    const funded = spendings.reduce((sum, spending) => sum + readPaid(spending).paid, 0);
    return { received, paidFromPot, inHand: received - paidFromPot, cost, funded, unfunded: Math.max(0, cost - funded) };
  }, [pot.openingBalance, contributions, movements, spendings]);

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
    setBanner(result.ok
      ? { ok: true, text: result.data.removedPayments > 0
          ? `"${deleting.spending.title}" deleted, and ${formatMoney(result.data.restored)} put back into ${result.data.removedPayments} account${result.data.removedPayments === 1 ? "" : "s"}.`
          : `"${deleting.spending.title}" deleted.` }
      : { ok: false, text: result.error });
  };

  const removeContribution = async () => {
    if (!removingContribution) return;
    setBusyId(removingContribution.id);
    const result = await deleteTransaction(await getIdToken(), removingContribution.id);
    setBusyId(null);
    setRemovingContribution(null);
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
    actions.push({ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditingSpending(spending) });
    actions.push({ key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void askDelete(spending), disabled: busyId === spending.id });
    return actions;
  }, [busyId, askDelete]);

  const spendingRows: ExpenseRowModel[] = spendings
    .slice()
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
    .map((spending) => {
      const { paid, outstanding, settled } = readPaid(spending);
      const legs = legsBySpending.get(spending.id) ?? [];
      return {
        id: spending.id,
        title: spending.title,
        meta: [spending.dayKey]
          .concat(legs.length ? [`from ${legs.map((leg) => leg.accountName).join(", ")}`] : ["not paid from anywhere yet"])
          .join(" · "),
        amount: spending.amount,
        category: "Utilities",
        status: {
          label: settled ? "Paid" : paid > 0 ? `${formatMoney(outstanding)} left` : "Unpaid",
          tone: settled ? TONE.good : paid > 0 ? TONE.warn : TONE.quiet,
        },
        payment: null,
        notes: spending.description
          ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{spending.description}</span></div>
          : null,
        actions: buildActions(spending, isMobile),
        onOpen: () => setOpened(spending.id),
      };
    });

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
      /*
        **Only a manual contribution may be removed here.** A money-in row that
        came from another module — a StateLife slab received into this pot —
        belongs to that module's record, and deleting it from this side would
        leave the policy insisting it had been paid.
      */
      actions: txn.sourceModule === "MANUAL"
        ? [{ key: "remove", label: "Remove", d: ICON.trash, tone: "bad" as const, onClick: () => setRemovingContribution({ id: txn.id, label: txn.sourceLabel ?? "Money in", amount: txn.amount }), disabled: busyId === txn.id }]
        : [],
      onOpen: () => { /* A contribution is one line; there is nothing more to open. */ },
    }));

  const openedSpending = opened ? spendings.find((spending) => spending.id === opened) ?? null : null;
  const rows = tab === "SPENDINGS" ? spendingRows : contributionRows;
  const page = usePagination(rows, 12);

  const statCards: StatCard[] = [
    { label: "Put In", value: formatMoney(figures.received), note: `${contributions.length} contribution${contributions.length === 1 ? "" : "s"}`, pill: `${contributions.length}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
    { label: "Still In Hand", value: formatMoney(figures.inHand), note: "in this pot, not yet spent", pill: null, pct: figures.received ? Math.max(0, Math.round((figures.inHand / figures.received) * 100)) : 0, color: figures.inHand < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet },
    { label: "Spent On It", value: formatMoney(figures.cost), note: `${spendings.length} spending${spendings.length === 1 ? "" : "s"}, whoever paid`, pill: null, pct: figures.received ? Math.min(100, Math.round((figures.cost / figures.received) * 100)) : 0, color: "#141f1e", accent: "#c99a2e", icon: ICON.bars },
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
          { label: `Spendings (${spendings.length})`, active: tab === "SPENDINGS", pick: () => setTab("SPENDINGS") },
          { label: `Money in (${contributions.length})`, active: tab === "RECEIVED", pick: () => setTab("RECEIVED") },
        ]}
      />

      <ExpenseList
        heading={tab === "SPENDINGS" ? "Spendings" : "Money in"}
        count={`${rows.length}`}
        total={tab === "SPENDINGS" ? figures.cost : figures.received}
        rows={page.items}
        isMobile={isMobile}
        loading={loading || ledger.loading}
        empty={tab === "SPENDINGS"
          ? "Nothing spent on this yet. Add a spending, then choose which account pays it."
          : "Nothing put in yet. Add money in to start the pot."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun={tab === "SPENDINGS" ? "spendings" : "entries"} />}
      />

      {isMobile && (
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
                    if (action.key === "pay" || action.key === "edit") setOpened(null);
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
          investmentId={pot.id}
          investmentName={pot.name}
          getIdToken={getIdToken}
          onClose={() => { setAddingSpending(false); setEditingSpending(null); }}
          onSaved={(text) => { setBanner({ ok: true, text }); setAddingSpending(false); setEditingSpending(null); }}
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
            {pot.name} goes down by {formatMoney(removingContribution.amount)}. This cannot be undone.
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

function ContributionForm({ pot, getIdToken, onClose, onSaved }: {
  pot: Ledger["accounts"][number];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await addManualTransaction(await getIdToken(), {
      accountId: pot.id, direction: "IN", amount: Number(amount) || 0,
      type: "INVESTMENT", dayKey, label,
    });
    setBusy(false);
    if (result.ok) onSaved(`${formatMoney(Number(amount) || 0)} added to ${pot.name}.`);
    else setError(result.error);
  };

  return (
    <OverlayPanel title="Add money in" subtitle={pot.name} icon={<Wallet2 size={18} />} maxWidth={480} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !label.trim() || !(Number(amount) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Adding…" : "Add"}
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
        </div>
      </OverlayCard>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function SpendingForm({ spending, investmentId, investmentName, getIdToken, onClose, onSaved }: {
  spending: Spending | null;
  investmentId: string;
  investmentName: string;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveCapitalSpending(
      await getIdToken(),
      { investmentId, title: form.title, amount: Number(form.amount) || 0, dayKey: form.dayKey, description: form.description },
      spending?.id
    );
    setBusy(false);
    if (result.ok) onSaved(spending ? "Spending updated." : "Spending added. Choose which account pays it.");
    else setError(result.error);
  };

  return (
    <OverlayPanel title={spending ? "Edit spending" : "Add spending"} subtitle={investmentName} icon={<Wallet2 size={18} />} maxWidth={520} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !form.title.trim() || !(Number(form.amount) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : spending ? "Save changes" : "Add spending"}
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
      <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
        Recording it does not move any money. Once it is here, <strong style={{ color: X.body }}>Pay from…</strong> chooses which
        account funds it — the committee, a StateLife commission, this investment&rsquo;s own pot, or several at once.
      </p>
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}
