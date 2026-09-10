"use client";

/**
 * StateLife — the commission record, and the money it brings in.
 *
 * The columns are the workbook's columns and the commissions are
 * `lib/stateLife`'s, transcribed from its formulas: every rate is a percentage
 * of **PASS** with 8% tax folded in.
 *
 * **The commission arrives in three slabs, months apart** — 40% (the remaining
 * commission, after the discount is given back), 2.5% quarterly, 7.5% in
 * December. The workbook says so itself in column T: *"40% FEB + 2.5% JAN
 * INCOM"*. So this screen is not a table of what is owed, it is a record of
 * what has come in and what is still to come.
 *
 * **Receiving a slab puts the money into an account**, which is the whole point
 * of the rebuild. StateLife is an *income* account: the slab lands as an
 * ordinary `IN` transaction, and from that moment an office expense, a personal
 * expense or a committee bill can be funded out of it through the same split
 * control every module already uses — with no StateLife-specific code in any of
 * them. The same trick Committee plays.
 *
 * **This is the Office Expenses screen**, from `components/finance/
 * expensesChrome` — one hero, one set of stat cards, one filter grid, one row,
 * one detail panel across every money screen, because four copies drift.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReceiptText } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinanceCollection, useLedger } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  saveStateLifePolicy,
  deleteStateLifePolicy,
  receiveStateLifeSlab,
  unreceiveStateLifeSlab,
  getStateLifeRates,
  setStateLifeRates,
} from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { readHistoryEntry, HISTORY_LABELS } from "@/lib/officeExpenses";
import {
  slabPosition,
  slabNote,
  slabMeta,
  stateLifeCommission,
  normalizeRates,
  fromPercent,
  toPercent,
  RATE_LABELS,
  DEFAULT_STATELIFE_RATES,
  type SlabReceipts,
  type StateLifeRates,
  type StateLifeSlab,
} from "@/lib/stateLife";
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
  Tag,
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

/**
 * **StateLife opens on the whole book, not on this month.**
 *
 * Every other money screen here defaults to the current month, and that is
 * right for them: an office expense or a personal one *is* a this-month
 * question. A policy book is not. A policy written in January still earns its
 * 2.5% in April and its 7.5% in December, so a month-long default hides most of
 * the book — and worse, makes "Still To Come" wrong, because that total counts
 * only the policies in range. This screen shipped with the month default copied
 * across and the first thing it did was hide a January policy.
 *
 * An empty bound means **no bound on that side**, so the period control still
 * works exactly as it does elsewhere the moment somebody narrows it.
 */
const ALL_TIME = "";

/** Where a policy stands overall, in three words rather than a number. */
const RECEIPT_STATES = ["NONE", "PART", "ALL"] as const;
type ReceiptState = (typeof RECEIPT_STATES)[number];

const RECEIPT_LABELS: Record<ReceiptState, string> = {
  NONE: "Nothing in yet",
  PART: "Part received",
  ALL: "All received",
};

function receiptTone(state: ReceiptState): Tone {
  return state === "ALL" ? TONE.good : state === "PART" ? TONE.warn : TONE.quiet;
}

interface Policy {
  id: string;
  proposalNo: string | null;
  name: string;
  fyp: number;
  pass: number;
  discount: number;
  srCode: string | null;
  srName: string | null;
  dayKey: string;
  policyNumber: string | null;
  description: string | null;
  slabReceipts: SlabReceipts;
  /** The rates this policy was written under. Absent reads as the workbook's. */
  rates: Partial<StateLifeRates> | null;
  history: Array<{ at: string; action: string; byName: string | null; detail: string | null; amount: number | null }>;
}

function readPolicy(raw: Record<string, unknown>): Policy {
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    id: String(raw.id ?? ""),
    proposalNo: text(raw.proposalNo),
    name: text(raw.name) ?? "Unnamed policy",
    fyp: num(raw.fyp),
    pass: num(raw.pass),
    discount: num(raw.discount),
    srCode: text(raw.srCode),
    srName: text(raw.srName),
    dayKey: typeof raw.dayKey === "string" && raw.dayKey.length === 10 ? raw.dayKey : karachiDayKey(),
    policyNumber: text(raw.policyNumber),
    description: text(raw.description),
    // **The field this whole feature turns on**, and the one this project has
    // shipped six bugs by forgetting to read. Absent means no slab has come in.
    slabReceipts: (raw.slabReceipts ?? {}) as SlabReceipts,
    rates: (raw.rates ?? null) as Partial<StateLifeRates> | null,
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

export function StateLifeView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { records, loading } = useFinanceCollection("stateLifePolicies", ready);
  const ledger = useLedger(ready);
  const isMobile = useIsMobile();

  const [from, setFrom] = useState(ALL_TIME);
  const [to, setTo] = useState(ALL_TIME);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ReceiptState | "ALL_STATES">("ALL_STATES");
  const [seller, setSeller] = useState("ALL");
  const [showPeriod, setShowPeriod] = useState(false);
  /*
    The business default, loaded once. Every policy carries its own rates, so
    this is only what a **new** one starts at — and what the Rates dialog edits.
  */
  const [rates, setRates] = useState<StateLifeRates>(DEFAULT_STATELIFE_RATES);
  const [editingRates, setEditingRates] = useState(false);
  const [ratesNonce, setRatesNonce] = useState(0);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<{ policy: Policy; slab: StateLifeSlab; due: number } | null>(null);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const policies = useMemo(
    () => (records as Record<string, unknown>[]).map(readPolicy),
    [records]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getIdToken().catch(() => "");
      if (cancelled || !token) return;
      const result = await getStateLifeRates(token);
      if (!cancelled && result.ok) setRates(result.data.rates);
    })();
    return () => { cancelled = true; };
  }, [getIdToken, ratesNonce]);

  /**
   * The range first — every figure on the screen belongs to the same period.
   *
   * An empty bound is not a comparison: `"2026-01-31" >= ""` is true for every
   * key, which happens to work on the lower side and would be a trap on the
   * upper one, so both are tested explicitly rather than relied on.
   */
  const inRange = useMemo(
    () => policies.filter((policy) =>
      (!from || policy.dayKey >= from) && (!to || policy.dayKey <= to)
    ),
    [policies, from, to]
  );

  /** What the period control says when one or both ends are open. */
  const periodLabel = !from && !to
    ? "All policies"
    : !from
      ? `Up to ${to}`
      : !to
        ? `From ${from}`
        : `${from} → ${to}`;

  const sellers = useMemo(
    () => [...new Set(policies.map((policy) => policy.srName).filter((name): name is string => Boolean(name)))].sort(),
    [policies]
  );

  const stateOf = useCallback((policy: Policy): ReceiptState => {
    const position = slabPosition(policy, policy.slabReceipts, policy.rates);
    if (position.received <= 0) return "NONE";
    return position.outstanding <= 0 ? "ALL" : "PART";
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((policy) => {
      if (state !== "ALL_STATES" && stateOf(policy) !== state) return false;
      if (seller !== "ALL" && policy.srName !== seller) return false;
      if (!needle) return true;
      return (
        policy.name.toLowerCase().includes(needle) ||
        (policy.proposalNo ?? "").toLowerCase().includes(needle) ||
        (policy.policyNumber ?? "").toLowerCase().includes(needle) ||
        (policy.srName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, state, seller, stateOf]);

  /*
    The headline figures describe the **range**, not the filter — a total that
    fell when somebody clicked "Nothing in yet" would read as the book having
    shrunk, which is the opposite of what happened.
  */
  const summary = useMemo(() => {
    const sum = { pass: 0, net: 0, received: 0, outstanding: 0, count: 0, waiting: 0 };
    for (const policy of inRange) {
      const position = slabPosition(policy, policy.slabReceipts, policy.rates);
      sum.pass += policy.pass;
      sum.net += position.net;
      sum.received += position.received;
      sum.outstanding += position.outstanding;
      sum.count += 1;
      if (position.outstanding > 0) sum.waiting += 1;
    }
    return sum;
  }, [inRange]);

  const listedTotal = useMemo(
    () => filtered.reduce((total, policy) => total + slabPosition(policy, policy.slabReceipts, policy.rates).net, 0),
    [filtered]
  );

  const page = usePagination(filtered, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number) => (summary.net ? Math.round((n / summary.net) * 100) : 0);
    return [
      { label: "Passed", value: formatMoney(summary.pass), note: `${summary.count} polic${summary.count === 1 ? "y" : "ies"} in range`, pill: `${summary.count}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
      { label: "Net Commission", value: formatMoney(summary.net), note: "everything these policies will pay", pill: null, pct: 100, color: "#141f1e", accent: "#4fa39c", icon: ICON.bars },
      { label: "Received", value: formatMoney(summary.received), note: `${pct(summary.received)}% of the commission`, pill: `${pct(summary.received)}%`, tone: "good", pct: pct(summary.received), color: "#2f7d78", accent: "#2f7d78", icon: ICON.check },
      // **The figure the screen exists for**: commission earned and not yet in
      // an account, so not yet money anything can be paid from.
      { label: "Still To Come", value: formatMoney(summary.outstanding), note: summary.outstanding > 0 ? `${summary.waiting} polic${summary.waiting === 1 ? "y" : "ies"} waiting` : "every slab is in", pill: summary.outstanding > 0 ? "Waiting" : "Clear", tone: summary.outstanding > 0 ? "warn" : "good", pct: pct(summary.outstanding), color: summary.outstanding > 0 ? "#a5762a" : "#2f7d78", accent: "#c99a2e", icon: ICON.clock },
    ];
  }, [summary]);

  /** The slab receipts, by the policy that earned them. */
  const legsByPolicy = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "STATELIFE" || !txn.sourceId) continue;
      const list = map.get(txn.sourceId) ?? [];
      list.push({
        id: txn.id,
        accountName: names.get(txn.accountId) ?? "A deleted account",
        amount: txn.amount,
        dayKey: txn.dayKey,
        note: txn.sourceLabel ?? null,
        by: txn.createdByName ?? null,
      });
      map.set(txn.sourceId, list);
    }
    return map;
  }, [ledger.transactions, ledger.accounts]);

  const undoSlab = useCallback(async (policy: Policy, slab: StateLifeSlab) => {
    setBusyId(policy.id);
    const result = await unreceiveStateLifeSlab(await getIdToken(), policy.id, slab);
    setBusyId(null);
    setBanner(
      result.ok
        ? { ok: true, text: `${slabMeta(policy.rates)[slab].short} on "${policy.name}" is no longer marked received — ${formatMoney(result.data.removed)} taken back out of the account.` }
        : { ok: false, text: result.error }
    );
  }, [getIdToken]);

  const removePolicy = async (policy: Policy) => {
    setBusyId(policy.id);
    const result = await deleteStateLifePolicy(await getIdToken(), policy.id);
    setBusyId(null);
    setDeleting(null);
    setOpened(null);
    setBanner(
      result.ok
        ? { ok: true, text: `"${policy.name}" deleted, and anything received against it taken back out of its account.` }
        : { ok: false, text: result.error }
    );
  };

  /**
   * A policy's actions.
   *
   * **Receive is offered on the next slab that is actually due**, not as a menu
   * of three: a slab worth nothing (the discount swallowed it) cannot be
   * received and the server refuses it, so offering the button would be
   * offering a choice that can only fail. The detail panel has the full slab
   * table for anything out of order.
   */
  const buildActions = useCallback((policy: Policy, compact: boolean): RowAction[] => {
    const actions: RowAction[] = [];
    const next = slabPosition(policy, policy.slabReceipts, policy.rates).slabs.find(
      (entry) => !entry.received && entry.amount > 0
    );

    if (next) {
      actions.push({
        key: "receive",
        label: compact ? `Get ${next.short}` : `Receive ${next.short}`,
        shortLabel: next.short,
        d: ICON.wallet, tone: "good",
        onClick: () => setReceiving({ policy, slab: next.slab, due: next.amount }),
      });
    }
    actions.push({ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditing(policy) });
    actions.push({ key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => setDeleting(policy), disabled: busyId === policy.id });
    return actions;
  }, [busyId]);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((policy) => {
        const position = slabPosition(policy, policy.slabReceipts, policy.rates);
        const state_ = stateOf(policy);
        return {
          id: policy.id,
          title: policy.name,
          meta: [policy.dayKey, policy.proposalNo ? `#${policy.proposalNo}` : null, policy.srName]
            .filter(Boolean)
            .concat(`Pass ${formatMoney(policy.pass)}`)
            .join(" · "),
          amount: position.net,
          // The icon tile reads as a person, since a policy is a policyholder.
          category: "Salaries",
          status: { label: RECEIPT_LABELS[state_], tone: receiptTone(state_) },
          payment: position.outstanding > 0
            ? { label: `${formatMoney(position.outstanding)} to come`, tone: TONE.warn }
            : null,
          notes: (
            /* The slab strip: three chips saying what has landed and what has
               not, which is the question this screen is opened for. */
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
              {position.slabs.map((entry) => (
                <span key={entry.slab}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700,
                    background: entry.received ? "#e8f5f3" : entry.amount > 0 ? "#f2f7f6" : "#fdeeec",
                    color: entry.received ? "#2f7d78" : entry.amount > 0 ? "#6c7d7b" : "#a8483c",
                  }}>
                  <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                  {entry.short} {entry.amount <= 0 ? "nil" : formatMoney(entry.amount)}
                </span>
              ))}
            </div>
          ),
          actions: buildActions(policy, isMobile),
          onOpen: () => setOpened(policy.id),
        };
      }),
    [page.items, buildActions, isMobile, stateOf]
  );

  const openedPolicy = useMemo(
    () => (opened ? policies.find((policy) => policy.id === opened) ?? null : null),
    [opened, policies]
  );

  const download = () => {
    const header = [
      "Date", "Proposal No", "Name", "FYP", "PASS", "SR Code", "Policy Number", "Description",
      "Sr Name", "30% - Tax 8%", "10% - Tax 8%", "Discount", "Remaining Commission",
      "Quarter 2.5%", "Dec 7.5%", "Net Commission", "Received", "Still To Come", "Income Note",
    ];
    const rows = filtered.map((policy) => {
      const c = stateLifeCommission(policy, policy.rates);
      const position = slabPosition(policy, policy.slabReceipts, policy.rates);
      return [
        policy.dayKey, policy.proposalNo ?? "", policy.name, String(policy.fyp), String(policy.pass),
        policy.srCode ?? "", policy.policyNumber ?? "", policy.description ?? "", policy.srName ?? "",
        String(c.firstCommission), String(c.secondCommission), String(c.discount),
        String(c.remainingCommission), String(c.quarterCommission), String(c.decemberCommission),
        String(c.netCommission), String(position.received), String(position.outstanding),
        // Column T, generated — so the export still says what the owner's own
        // sheet said by hand.
        slabNote(policy.slabReceipts) ?? "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = !from && !to ? "statelife-all.csv" : `statelife-${from || "start"}-to-${to || "today"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) {
    return (
      <p style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: "#fff", padding: "22px 20px", fontSize: 13.5, color: X.faint }}>
        StateLife is for administrators and HR.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="StateLife"
        figure={formatMoney(summary.outstanding)}
        caption={`still to come · ${formatMoney(summary.received)} already received`}
        isMobile={isMobile}
        tileIcon={ICON.receipt}
        stats={[
          { label: "NET", value: summary.net },
          { label: "IN", value: summary.received },
          { label: "TO COME", value: summary.outstanding },
        ]}
        mobileAction={<HeroTile onClick={() => setEditingRates(true)} label="Commission rates" d={ICON.tags} />}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HeroButton onClick={() => setEditingRates(true)}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.tags} /></svg>}>
              Rates
            </HeroButton>
            <HeroButton onClick={() => setAdding(true)} solid
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
              Add policy
            </HeroButton>
          </div>
        }
      >
        {isMobile && (
          <PeriodPill from={from} to={to} maxTo={karachiDayKey()} open={showPeriod} label={periodLabel}
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
          <MobileSearch value={search} onChange={setSearch} placeholder="Name, proposal or policy number" />
          <ChipRow
            chips={[
              { label: "All", active: state === "ALL_STATES" && seller === "ALL", pick: () => { setState("ALL_STATES"); setSeller("ALL"); } },
              ...RECEIPT_STATES.map((value) => ({
                label: RECEIPT_LABELS[value],
                active: state === value,
                pick: () => { setState(value); setSeller("ALL"); },
              })),
              ...sellers.map((value) => ({
                label: value,
                active: seller === value,
                pick: () => { setSeller(value); setState("ALL_STATES"); },
              })),
            ]}
          />
        </>
      ) : (
        <FilterPanel
          from={from} to={to} maxTo={karachiDayKey()} onFrom={setFrom} onTo={setTo}
          periodLabel={periodLabel}
          search={search} onSearch={setSearch}
          onDownload={download} canDownload={filtered.length > 0}
          selects={[
            {
              label: "Commission", width: "148px", value: state,
              onChange: (next) => setState(next as ReceiptState | "ALL_STATES"),
              options: [{ value: "ALL_STATES", label: "All" }, ...RECEIPT_STATES.map((v) => ({ value: v, label: RECEIPT_LABELS[v] }))],
            },
            {
              label: "Sold by", width: "168px", value: seller, onChange: setSeller,
              options: [{ value: "ALL", label: "Everyone" }, ...sellers.map((v) => ({ value: v, label: v }))],
            },
          ]}
        />
      )}

      <ExpenseList
        heading="Policies"
        count={`${filtered.length} of ${inRange.length}${isMobile || (!from && !to) ? "" : " in this period"}`}
        total={listedTotal}
        rows={rowModels}
        isMobile={isMobile}
        loading={loading}
        empty={inRange.length === 0
          ? (from || to)
            ? "No policies in this period. Widen the dates, or add one."
            : "No policies yet. Add one and its commission fills in from the passed amount."
          : "No policies match these filters."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="policies" />}
      />

      {isMobile && <FloatingAdd onClick={() => setAdding(true)} label="Add policy" />}

      {openedPolicy && (() => {
        const position = slabPosition(openedPolicy, openedPolicy.slabReceipts, openedPolicy.rates);
        const c = stateLifeCommission(openedPolicy, openedPolicy.rates);
        const state_ = stateOf(openedPolicy);
        return (
          <OverlayPanel
            title={openedPolicy.name}
            subtitle={`${openedPolicy.proposalNo ? `#${openedPolicy.proposalNo} · ` : ""}${openedPolicy.dayKey}`}
            maxWidth={640}
            onClose={() => setOpened(null)}
          >
            <ExpenseDetail
              title={openedPolicy.name}
              amountLabel={formatMoney(position.net)}
              formatMoney={formatMoney}
              status={{ label: RECEIPT_LABELS[state_], tone: receiptTone(state_) }}
              payment={position.received > 0
                ? { paid: position.received, outstanding: position.outstanding, label: position.outstanding > 0 ? `${formatMoney(position.outstanding)} to come` : "All in", tone: position.outstanding > 0 ? TONE.warn : TONE.good }
                : null}
              legsHeading="Where the money landed"
              legsIn
              legs={legsByPolicy.get(openedPolicy.id) ?? []}
              notFunded="No slab has been received yet. Mark one received and choose the account it landed in."
              extra={
                /*
                  **The slab table is the point of this panel.** Three rows, each
                  saying what it is worth, whether it has come in, into which
                  account and on what day — and carrying the control that banks
                  it. Everything else here is the workbook's arithmetic, which
                  is already correct and was never the thing anybody had to look
                  up.
                */
                <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>Commission slabs</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: X.faint }}>{formatMoney(position.received)} of {formatMoney(position.net)} in</span>
                  </div>
                  {position.slabs.map((entry) => (
                    <div key={entry.slab} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}` }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: X.ink }}>{entry.label}</span>
                          {entry.received
                            ? <Tag label="Received" tone={TONE.good} />
                            : entry.amount > 0
                              ? <Tag label="To come" tone={TONE.quiet} />
                              /* Row 15 of the workbook is −2,592: the discount
                                 exceeded the commission, so nothing is owed. */
                              : <Tag label="Nothing owed" tone={TONE.bad} />}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 3 }}>
                          {entry.received
                            ? `${entry.received.dayKey} · into ${entry.received.accountName ?? "an account"}`
                            : entry.hint}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: entry.amount < 0 ? "#a8483c" : X.ink, fontVariantNumeric: "tabular-nums" }}>
                          {formatMoney(entry.received ? entry.received.amount : entry.amount)}
                        </span>
                        {entry.received ? (
                          <DetailAction label="Undo" d={ICON.cross} tone="bad"
                            disabled={busyId === openedPolicy.id}
                            onClick={() => void undoSlab(openedPolicy, entry.slab)} />
                        ) : entry.amount > 0 ? (
                          <DetailAction label="Receive" d={ICON.wallet} tone="good"
                            onClick={() => { setOpened(null); setReceiving({ policy: openedPolicy, slab: entry.slab, due: entry.amount }); }} />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </section>
              }
              fields={[
                { label: "Date", value: openedPolicy.dayKey },
                { label: "Proposal No", value: openedPolicy.proposalNo ?? "—" },
                { label: "Policy number", value: openedPolicy.policyNumber ?? "—" },
                { label: "Sold by", value: openedPolicy.srName ?? "—" },
                { label: "SR code", value: openedPolicy.srCode ?? "—" },
                { label: "FYP", value: formatMoney(openedPolicy.fyp) },
                { label: "PASS — the commission base", value: formatMoney(openedPolicy.pass) },
                { label: "30% less 8% tax", value: formatMoney(c.firstCommission) },
                { label: "10% less 8% tax", value: formatMoney(c.secondCommission) },
                { label: "Discount given back", value: formatMoney(c.discount) },
                { label: "Status", value: openedPolicy.description ?? "—", wide: true },
              ]}
              history={openedPolicy.history.map((entry) => ({
                at: stamp(entry.at),
                action: HISTORY_LABELS[entry.action] ?? SLAB_LABELS[entry.action] ?? entry.action,
                by: entry.byName,
                detail: entry.detail,
                amount: entry.amount,
              }))}
              actions={
                <>
                  <DetailAction label="Edit" d={ICON.edit} tone="quiet" onClick={() => { setOpened(null); setEditing(openedPolicy); }} />
                  <DetailAction label="Delete" d={ICON.trash} tone="bad" disabled={busyId === openedPolicy.id}
                    onClick={() => setDeleting(openedPolicy)} />
                </>
              }
            />
          </OverlayPanel>
        );
      })()}

      {receiving && (
        <ReceiveSlab
          policy={receiving.policy}
          slab={receiving.slab}
          due={receiving.due}
          accounts={ledger.accounts}
          getIdToken={getIdToken}
          onClose={() => setReceiving(null)}
          onDone={(text) => { setBanner({ ok: true, text }); setReceiving(null); }}
        />
      )}

      {deleting && (
        <OverlayPanel title="Delete this policy?" maxWidth={440} onClose={() => setDeleting(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeleting(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Keep it
              </button>
              <button type="button" disabled={busyId === deleting.id} onClick={() => void removePolicy(deleting)}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deleting.id ? 0.5 : 1 }}>
                {busyId === deleting.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deleting.name}</strong> · Pass {formatMoney(deleting.pass)} · {deleting.dayKey}
          </p>
          {(() => {
            const position = slabPosition(deleting, deleting.slabReceipts, deleting.rates);
            return position.received > 0 ? (
              <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
                {formatMoney(position.received)} has already been received against this policy. Deleting it takes that money
                back out of the account it landed in — otherwise the account would show income arriving for a record that no
                longer exists.
              </p>
            ) : (
              <p style={{ marginTop: 10, fontSize: 12.5, color: X.faint, lineHeight: 1.6 }}>
                Nothing has been received against this policy, so no account changes. This cannot be undone.
              </p>
            );
          })()}
        </OverlayPanel>
      )}

      {editingRates && (
        <RatesForm
          rates={rates}
          getIdToken={getIdToken}
          onClose={() => setEditingRates(false)}
          onSaved={(text) => { setBanner({ ok: true, text }); setEditingRates(false); setRatesNonce((v) => v + 1); }}
        />
      )}

      {(adding || editing) && (
        <PolicyForm
          policy={editing}
          defaults={rates}
          onClose={() => { setAdding(false); setEditing(null); }}
          getIdToken={getIdToken}
          onSaved={(text) => { setBanner({ ok: true, text }); setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/** The history actions this module writes, in words. */
const SLAB_LABELS: Record<string, string> = {
  SLAB_RECEIVED: "Slab received",
  SLAB_UNRECEIVED: "Slab receipt removed",
};

/* -------------------------------------------------------------------------- */
/* Receiving a slab                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Marking a slab received, and saying where the money went.
 *
 * The account is the required part: a slab received into nowhere is a number
 * changing on a screen, and the whole reason for this control is that the money
 * has to land somewhere it can then be **spent from**.
 */
function ReceiveSlab({ policy, slab, due, accounts, getIdToken, onClose, onDone }: {
  policy: Policy;
  slab: StateLifeSlab;
  due: number;
  accounts: Array<{ id: string; name: string; kind: string; status: string }>;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const open = accounts.filter((account) => account.status !== "ARCHIVED");
  // An income account first when there is one, since that is what this money is.
  const preferred = open.find((account) => account.kind === "INCOME") ?? open[0];

  const [accountId, setAccountId] = useState(preferred?.id ?? "");
  const [amount, setAmount] = useState(String(due));
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };
  const typed = Number(amount) || 0;
  const over = typed > due;
  // The slab's name at **this policy's** rates — "40%" on a book written at
  // 30 + 10, "35%" on one written at 25 + 10.
  const meta = slabMeta(policy.rates)[slab];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await receiveStateLifeSlab(await getIdToken(), policy.id, slab, accountId, {
      amount: typed, dayKey, note: note.trim() || null,
    });
    setBusy(false);
    if (result.ok) {
      const into = open.find((account) => account.id === accountId)?.name ?? "the account";
      onDone(`${formatMoney(result.data.amount)} received into ${into}. It can now be spent from there.`);
    } else {
      setError(result.error);
    }
  };

  return (
    <OverlayPanel
      title={`Receive the ${meta.short} slab`}
      subtitle={policy.name}
      icon={<ReceiptText size={18} />}
      maxWidth={520}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="button" disabled={busy || !accountId || typed <= 0 || over} onClick={() => void submit()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !accountId || typed <= 0 || over ? 0.5 : 1 }}>
            {busy ? "Recording…" : "Mark received"}
          </button>
        </div>
      }
    >
      <div style={{ borderRadius: 14, background: X.gradient, color: "#fff", padding: "16px 18px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "1.4px", textTransform: "uppercase", opacity: 0.76 }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: "-1px", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(due)}
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.84, marginTop: 3 }}>{meta.hint}</div>
      </div>

      <OverlayCard title="Where did it land?">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={{ ...field, cursor: "pointer" }}>
              {open.length === 0 && <option value="">No accounts yet — create one first</option>}
              {open.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Amount</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
            <span>Day it landed</span>
            <input type="date" value={dayKey} max={karachiDayKey()} onChange={(event) => setDayKey(event.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1", ...designLabel }}>
            <span>Note</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Anything worth remembering" style={field} />
          </label>
        </div>
      </OverlayCard>

      {/* Part payments are real — the sheet's own descriptions say "5K PENDING",
          "22K PENDING" — so a smaller figure is allowed and a larger one is not. */}
      {over && (
        <p role="alert" style={{ borderRadius: 10, border: "1px solid #f0c4bd", background: "#fdeeec", padding: "10px 12px", fontSize: 12.5, fontWeight: 600, color: "#a33a29" }}>
          The slab is {formatMoney(due)}. You cannot receive more than that.
        </p>
      )}
      {!over && typed > 0 && typed < due && (
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.6 }}>
          {formatMoney(due - typed)} of this slab stays outstanding.
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

/** New and Edit as one component, so the two cannot ask for different fields. */
function PolicyForm({ policy, defaults, onClose, getIdToken, onSaved }: {
  policy: Policy | null;
  /** What a new policy starts at. An existing one keeps its own. */
  defaults: StateLifeRates;
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({
    proposalNo: policy?.proposalNo ?? "",
    name: policy?.name ?? "",
    fyp: policy ? String(policy.fyp) : "",
    pass: policy ? String(policy.pass) : "",
    srCode: policy?.srCode ?? "",
    dayKey: policy?.dayKey ?? karachiDayKey(),
    policyNumber: policy?.policyNumber ?? "",
    description: policy?.description ?? "",
    srName: policy?.srName ?? "",
    discount: policy ? String(policy.discount) : "",
  });
  const [ratePercents, setRatePercents] = useState<Record<keyof StateLifeRates, string>>(() => {
    const start = normalizeRates(policy?.rates ?? defaults);
    return {
      first: String(toPercent(start.first)),
      second: String(toPercent(start.second)),
      quarter: String(toPercent(start.quarter)),
      december: String(toPercent(start.december)),
      tax: String(toPercent(start.tax)),
    };
  });

  /** Fractions, from what was typed — the shape the arithmetic takes. */
  const policyRates = normalizeRates({
    first: fromPercent(Number(ratePercents.first)),
    second: fromPercent(Number(ratePercents.second)),
    quarter: fromPercent(Number(ratePercents.quarter)),
    december: fromPercent(Number(ratePercents.december)),
    tax: fromPercent(Number(ratePercents.tax)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  // The live preview, from the same function the server will run — so the
  // figures on the form and the figures that get stored cannot differ.
  const preview = slabPosition(
    { fyp: Number(form.fyp), pass: Number(form.pass), discount: Number(form.discount) },
    policy?.slabReceipts,
    policyRates
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveStateLifePolicy(
      await getIdToken(),
      {
        proposalNo: form.proposalNo, name: form.name, fyp: Number(form.fyp) || 0,
        pass: Number(form.pass) || 0, srCode: form.srCode, dayKey: form.dayKey,
        policyNumber: form.policyNumber, description: form.description,
        srName: form.srName, discount: Number(form.discount) || 0,
        rates: policyRates,
      },
      policy?.id
    );
    setBusy(false);
    if (result.ok) onSaved(policy ? `"${form.name.trim()}" updated.` : `"${form.name.trim()}" added.`);
    else setError(result.error);
  };

  return (
    <OverlayPanel title={policy ? "Edit policy" : "Add policy"} icon={<ReceiptText size={18} />} maxWidth={620} onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="button" disabled={busy || !form.name.trim() || !(Number(form.pass) > 0)} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : policy ? "Save changes" : "Add policy"}
          </button>
        </div>
      }>
      <OverlayCard title="Policy">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <F label="Policyholder" wide><input value={form.name} onChange={(e) => set("name", e.target.value)} style={field} /></F>
          <F label="Proposal No"><input value={form.proposalNo} onChange={(e) => set("proposalNo", e.target.value)} style={field} /></F>
          <F label="Date"><input type="date" value={form.dayKey} onChange={(e) => set("dayKey", e.target.value)} style={field} /></F>
          <F label="FYP"><input type="number" inputMode="decimal" value={form.fyp} onChange={(e) => set("fyp", e.target.value)} style={field} /></F>
          <F label="PASS — the commission base"><input type="number" inputMode="decimal" value={form.pass} onChange={(e) => set("pass", e.target.value)} style={field} /></F>
          <F label="Discount given back"><input type="number" inputMode="decimal" value={form.discount} onChange={(e) => set("discount", e.target.value)} style={field} /></F>
          <F label="Policy number"><input value={form.policyNumber} onChange={(e) => set("policyNumber", e.target.value)} style={field} /></F>
          <F label="Sold by"><input value={form.srName} onChange={(e) => set("srName", e.target.value)} style={field} /></F>
          <F label="SR code"><input value={form.srCode} onChange={(e) => set("srCode", e.target.value)} style={field} /></F>
          <F label="Status" wide><input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Payment cleared, 5K pending…" style={field} /></F>
        </div>
      </OverlayCard>

      {/*
        **This policy's own rates.** Pre-filled from the business default for a
        new one and from the policy itself for an existing one, so opening an
        old row never quietly re-rates it. Editing them here changes this policy
        and nothing else.
      */}
      <OverlayCard title="Commission rates for this policy" hint={policy ? "As written" : "From the business default"}>
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", padding: "14px 16px" }}>
          {(Object.keys(RATE_LABELS) as Array<keyof StateLifeRates>).map((key) => (
            <label key={key} style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
              <span>{RATE_LABELS[key]}</span>
              <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" inputMode="decimal" step="0.5" value={ratePercents[key]}
                  onChange={(event) => setRatePercents((r) => ({ ...r, [key]: event.target.value }))}
                  style={{ ...field, paddingRight: 30 }} />
                <span aria-hidden style={{ position: "absolute", right: 12, fontSize: 13, fontWeight: 700, color: X.faint }}>%</span>
              </span>
            </label>
          ))}
        </div>
      </OverlayCard>

      {/*
        The slabs, live, from the same function the server runs. It is the only
        way to see that a discount has swallowed the 40% before saving the row.
      */}
      <div style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: X.tint, padding: "13px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>Commission slabs, from PASS</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: X.deep, fontVariantNumeric: "tabular-nums" }}>{formatMoney(preview.net)}</span>
        </div>
        <div style={{ display: "grid", gap: 7, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginTop: 10 }}>
          {preview.slabs.map((entry) => (
            <div key={entry.slab} style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: X.faint }}>{entry.short}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: entry.amount < 0 ? "#a8483c" : X.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(entry.amount)}
              </div>
            </div>
          ))}
        </div>
        {preview.slabs[0].amount < 0 && (
          <p style={{ marginTop: 9, fontSize: 11.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
            The discount is more than the 30% and 10% together, so this policy earns nothing on that slab. The sheet has
            rows like this — it is recorded as it is, not rounded up to zero.
          </p>
        )}
      </div>

      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: wide ? "1 / -1" : undefined, ...designLabel }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* The rates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Editing the commission structure.
 *
 * **What this changes is what the next policy starts at.** Every policy stores
 * the rates it was written under, so nothing already recorded moves — which is
 * the only reason these can be edited at all. Correcting a rate in September
 * must not restate a January commission that has already been banked, and the
 * panel says so rather than leaving somebody to find out.
 *
 * Typed as percentages because that is how the business talks about them
 * ("thirty percent, less eight for tax"); stored as fractions, because that is
 * what the arithmetic multiplies by.
 */
function RatesForm({ rates, getIdToken, onClose, onSaved }: {
  rates: StateLifeRates;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState<Record<keyof StateLifeRates, string>>({
    first: String(toPercent(rates.first)),
    second: String(toPercent(rates.second)),
    quarter: String(toPercent(rates.quarter)),
    december: String(toPercent(rates.december)),
    tax: String(toPercent(rates.tax)),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };
  const next = normalizeRates({
    first: fromPercent(Number(draft.first)),
    second: fromPercent(Number(draft.second)),
    quarter: fromPercent(Number(draft.quarter)),
    december: fromPercent(Number(draft.december)),
    tax: fromPercent(Number(draft.tax)),
  });

  // A worked example, so the multipliers are visible rather than implied.
  const example = stateLifeCommission({ pass: 100_000, discount: 0 }, next);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await setStateLifeRates(await getIdToken(), next);
    setBusy(false);
    if (result.ok) onSaved("Commission rates saved. Policies already recorded keep the rates they were written at.");
    else setError(result.error);
  };

  return (
    <OverlayPanel
      title="Commission rates"
      subtitle="What a new policy starts at"
      icon={<ReceiptText size={18} />}
      maxWidth={540}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={() => setDraft({
            first: String(toPercent(DEFAULT_STATELIFE_RATES.first)),
            second: String(toPercent(DEFAULT_STATELIFE_RATES.second)),
            quarter: String(toPercent(DEFAULT_STATELIFE_RATES.quarter)),
            december: String(toPercent(DEFAULT_STATELIFE_RATES.december)),
            tax: String(toPercent(DEFAULT_STATELIFE_RATES.tax)),
          })}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Reset to the sheet
          </button>
          <button type="button" disabled={busy} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save rates"}
          </button>
        </div>
      }
    >
      <OverlayCard title="Rates">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", padding: "14px 16px" }}>
          {(Object.keys(RATE_LABELS) as Array<keyof StateLifeRates>).map((key) => (
            <label key={key} style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
              <span>{RATE_LABELS[key]}</span>
              <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input type="number" inputMode="decimal" step="0.5" value={draft[key]}
                  onChange={(event) => setDraft((d) => ({ ...d, [key]: event.target.value }))}
                  style={{ ...field, paddingRight: 30 }} />
                <span aria-hidden style={{ position: "absolute", right: 12, fontSize: 13, fontWeight: 700, color: X.faint }}>%</span>
              </span>
            </label>
          ))}
        </div>
      </OverlayCard>

      <div style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: X.tint, padding: "13px 15px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
          On a policy that passes for Rs 100,000
        </div>
        <div style={{ display: "grid", gap: 7, gridTemplateColumns: "repeat(auto-fit,minmax(112px,1fr))", marginTop: 10 }}>
          {[
            ["First", example.firstCommission],
            ["Second", example.secondCommission],
            ["Quarter", example.quarterCommission],
            ["December", example.decemberCommission],
            ["Net", example.netCommission],
          ].map(([label, value]) => (
            <div key={label as string} style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: X.faint }}>{label}</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: X.ink, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(value as number)}
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 10, fontSize: 11.5, color: X.faint, lineHeight: 1.6 }}>
          The tax comes off every slab, so {toPercent(next.first)}% less {toPercent(next.tax)}% is a multiplier of{" "}
          <strong style={{ color: X.body }}>{(next.first * (1 - next.tax)).toFixed(4)}</strong>. The sheet&rsquo;s own figures
          are 30 / 10 / 2.5 / 7.5 with 8% tax.
        </p>
      </div>

      <p style={{ borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
        Policies already recorded keep the rates they were written at — nothing here restates a commission that has
        already been earned or banked. To change one policy, open it and edit its own rates.
      </p>

      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
    </OverlayPanel>
  );
}
