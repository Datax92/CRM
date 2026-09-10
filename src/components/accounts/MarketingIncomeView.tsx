"use client";

/**
 * Mahziyar Marketing — income, and the three cuts that come out of it.
 *
 * **Deliberately not routed through the deal profit split.**
 * `lib/profitDistribution` splits a closed CRM deal, where the admin finalises
 * percentages against a cut base; this is a marketing receipt with three
 * amounts typed straight in. Putting one through the other would give
 * `dealPayouts` a second meaning and make every commission report ambiguous
 * about which kind of earning it was counting.
 *
 * **The cuts are percentages, as many as the sale needs**, and the rupees are
 * computed from them — the same shape a deal's profit distribution has. **The
 * company is not a recipient**: it keeps `received − Σ cuts`, because a typed
 * company percentage could disagree with the arithmetic and this figure always
 * adds up.
 *
 * **There is no "receive" step, and that is the point.** Recording a sale banks
 * its profit immediately, in an account called **Mahziyar Marketing**, labelled
 * with the customer — so the statement reads *"Imran Khan — sold lead"*. From
 * that moment an office expense, a personal expense or a capital spending can
 * be paid straight **from Mahziyar Marketing** through the same split control
 * every module already uses, and the balance goes down as it is spent. Two
 * steps for one fact was one step too many.
 *
 * **The row is the unusual part of this screen.** Every other module has a
 * title, a date and one amount; a marketing receipt has ten facts that each
 * have to be findable without reading the row twice. So the row carries a
 * labelled `FigureStrip` under it — Received · Staff · Team · Company · Cost ·
 * Kept — with the person each cut belongs to named beneath the figure.
 */

import { useCallback, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinanceCollection, useLedger } from "@/hooks/useLedger";
import { useEmployees, useSubAdmins } from "@/hooks/useEmployees";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  saveMarketingIncome,
  deleteMarketingIncome,
  countMarketingIncomeReceipts,
} from "@/lib/clientActions";
import {
  calculateMarketingSplit,
  parsePercent,
  readCuts,
  CUT_ROLE_LABELS,
  type CutRole,
  type MarketingCut,
  type MarketingCutLine,
} from "@/lib/marketingIncome";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { readHistoryEntry, HISTORY_LABELS } from "@/lib/officeExpenses";
import {
  ChipRow,
  DetailAction,
  ExpenseDetail,
  ExpenseHero,
  ExpenseList,
  FigureStrip,
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
  type Figure,
  type FundingLeg,
  type RowAction,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { stamp } from "@/components/finance/OfficeExpensesView";

/**
 * The account every sale's profit lands in.
 *
 * Fixed rather than searched for by name — renaming it on screen must not make
 * the next sale create a second one beside it. `accountModules` writes the
 * matching id.
 */
const MARKETING_ACCOUNT_ID = "mahziyar_marketing";

/**
 * **Who sold it — and a sale is not always an employee's.**
 *
 * A manager closes their own, and so does the owner. Which one it was decides
 * what the cut can look like, so it is a stored fact rather than something
 * inferred from the uid: an employee promoted to manager next year must not
 * retrospectively turn last year's sale into a manager's.
 */
const SELLER_ROLES = ["EMPLOYEE", "MANAGER", "ADMIN"] as const;
type SellerRole = (typeof SELLER_ROLES)[number];

function readSellerRole(raw: unknown): SellerRole | null {
  return (SELLER_ROLES as readonly string[]).includes(raw as string) ? (raw as SellerRole) : null;
}

/**
 * What the cut is expected to look like for each kind of seller.
 *
 * **Nothing is ever mandatory** — a sale with no cuts at all is valid and the
 * company simply keeps all of it. What changes is what the form *suggests* and
 * what it says, so nobody is left hunting for an employee cut on a sale no
 * employee touched.
 */
const SELLER_GUIDANCE: Record<SellerRole, { seeds: "STAFF" | "MANAGER" | null; hint: string }> = {
  EMPLOYEE: {
    seeds: "STAFF",
    hint: "Sold by an employee — their cut is filled in, and a manager's can be added. The company keeps the rest.",
  },
  MANAGER: {
    seeds: "MANAGER",
    hint: "Sold by a manager — no employee cut is needed. Their own cut is filled in, and the company keeps the rest.",
  },
  ADMIN: {
    seeds: null,
    hint: "You sold this one — no employee cut, and no manager cut is needed. Add one if somebody helped; otherwise the whole sale is the company's.",
  },
};

interface Income {
  id: string;
  dayKey: string;
  customerName: string;
  soldByUid: string | null;
  soldByName: string | null;
  soldByRole: SellerRole | null;
  description: string | null;
  amountReceived: number;
  /** One row per recipient, as a percentage — with its rupees derived. */
  cuts: MarketingCutLine[];
  totalCost: number;
  totalPercent: number;
  netIncome: number;
  history: Array<{ at: string; action: string; byName: string | null; detail: string | null; amount: number | null }>;
}

function readIncome(raw: Record<string, unknown>): Income {
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const amountReceived = num(raw.amountReceived);

  /*
    **The split is recomputed on read, from the percentages.** The rupees are
    stored too, for exports, but a record written before a rule changed — or one
    edited by hand — must never show a cost that does not add up to its own
    cuts. `readCuts` also converts the module's old three-typed-figures shape
    into percentages, so an existing record keeps its numbers with no migration.
  */
  const cuts = readCuts(raw);
  const split = calculateMarketingSplit(amountReceived, cuts);

  return {
    id: String(raw.id ?? ""),
    dayKey: typeof raw.dayKey === "string" && raw.dayKey.length === 10 ? raw.dayKey : karachiDayKey(),
    customerName: text(raw.customerName) ?? "Unnamed customer",
    soldByUid: text(raw.soldByUid),
    soldByName: text(raw.soldByName),
    soldByRole: readSellerRole(raw.soldByRole),
    description: text(raw.description),
    amountReceived,
    cuts: split.lines,
    totalCost: split.totalCost,
    totalPercent: split.totalPercent,
    netIncome: split.companyKeeps,
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}


export function MarketingIncomeView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { records, loading } = useFinanceCollection("marketingIncome", ready);
  const ledger = useLedger(ready);
  const isMobile = useIsMobile();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [showPeriod, setShowPeriod] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [deleting, setDeleting] = useState<{ income: Income; balance: number; shortBy: number } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const incomes = useMemo(
    () => (records as Record<string, unknown>[]).map(readIncome),
    [records]
  );

  /*
    **Opens on the whole book, like StateLife and unlike the expense screens.**
    A receipt earned in January is still money the company banked; defaulting to
    this month would hide most of the record and understate every total on it.
    An empty bound means no bound on that side.
  */
  const inRange = useMemo(
    () => incomes.filter((income) => (!from || income.dayKey >= from) && (!to || income.dayKey <= to)),
    [incomes, from, to]
  );

  /** Everybody who has ever taken a cut — the "paid to" filter. */
  const people = useMemo(
    () => [...new Set(incomes.flatMap((income) => income.cuts.map((cut) => cut.name)).filter((name): name is string => Boolean(name)))].sort(),
    [incomes]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((income) => {
      if (teamFilter !== "ALL" && !income.cuts.some((cut) => cut.name === teamFilter)) return false;
      if (!needle) return true;
      return (
        income.customerName.toLowerCase().includes(needle) ||
        (income.soldByName ?? "").toLowerCase().includes(needle) ||
        income.cuts.some((cut) => (cut.name ?? "").toLowerCase().includes(needle)) ||
        (income.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, teamFilter]);

  const summary = useMemo(() => {
    const sum = { received: 0, cost: 0, net: 0, count: 0 };
    for (const income of inRange) {
      sum.received += income.amountReceived;
      sum.cost += income.totalCost;
      sum.net += income.netIncome;
      sum.count += 1;
    }
    return sum;
  }, [inRange]);

  /*
    **The account, not a total.** Every sale's profit is banked the moment it is
    recorded, and expenses paid from Mahziyar Marketing come straight back out
    of it — so what is left to spend is the account's balance, which no sum over
    this screen's records could tell you.
  */
  const account = ledger.accounts.find((entry) => entry.id === MARKETING_ACCOUNT_ID) ?? null;
  const accountBalance = account ? ledger.balances.get(account.id)?.balance ?? 0 : 0;
  const spentFromAccount = account ? ledger.balances.get(account.id)?.outflow ?? 0 : 0;

  const listedTotal = useMemo(
    () => filtered.reduce((total, income) => total + income.amountReceived, 0),
    [filtered]
  );

  const page = usePagination(filtered, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number) => (summary.received ? Math.round((n / summary.received) * 100) : 0);
    return [
      { label: "Received", value: formatMoney(summary.received), note: `${summary.count} sale${summary.count === 1 ? "" : "s"}`, pill: `${summary.count}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.receipt },
      { label: "Commission Cost", value: formatMoney(summary.cost), note: "staff, team and company cuts", pill: `${pct(summary.cost)}%`, tone: "warn", pct: pct(summary.cost), color: "#a5762a", accent: "#c99a2e", icon: ICON.user },
      { label: "Company Keeps", value: formatMoney(summary.net), note: "what is left after the cuts", pill: `${pct(summary.net)}%`, tone: "good", pct: pct(summary.net), color: "#2f7d78", accent: "#2f7d78", icon: ICON.check },
      // **The figure that decides whether the money can be spent.** Income not
      // yet received into an account is not in any balance, so nothing can be
      // paid from it.
      { label: "Left To Spend", value: formatMoney(accountBalance), note: spentFromAccount > 0 ? `${formatMoney(spentFromAccount)} already paid out` : "nothing paid out of it yet", pill: "In hand", tone: accountBalance > 0 ? "good" : "warn", pct: summary.net ? Math.max(0, Math.round((accountBalance / summary.net) * 100)) : 0, color: accountBalance < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet },
    ];
  }, [summary, accountBalance, spentFromAccount]);

  /** Where each receipt's money landed. */
  const legsByIncome = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "MARKETING_INCOME" || !txn.sourceId) continue;
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

  const askDelete = useCallback(async (income: Income) => {
    setBusyId(income.id);
    const result = await countMarketingIncomeReceipts(await getIdToken(), income.id);
    setBusyId(null);
    setDeleting({
      income,
      balance: result.ok ? result.data.balance : 0,
      shortBy: result.ok ? result.data.shortBy : 0,
    });
  }, [getIdToken]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.income.id);
    const result = await deleteMarketingIncome(await getIdToken(), deleting.income.id);
    setBusyId(null);
    setDeleting(null);
    setOpened(null);
    setBanner(result.ok
      ? { ok: true, text: `"${deleting.income.customerName}" deleted, and ${formatMoney(result.data.reversed)} taken back out of Mahziyar Marketing.` }
      : { ok: false, text: result.error });
  };

  /*
    **No Receive button.** The profit is banked when the sale is recorded, so
    there is nothing to receive; what is left is editing the sale and deleting
    it. Spending the money happens on the expense screens, by choosing Mahziyar
    Marketing as the account that pays.
  */
  const buildActions = useCallback((income: Income): RowAction[] => [
    { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditing(income) },
    { key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void askDelete(income), disabled: busyId === income.id },
  ], [busyId, askDelete]);

  /**
   * The six figures every row carries.
   *
   * The three cuts name **who** they belong to under the amount, because
   * "Rs 10,000 team" and "Rs 10,000 to Tayyab" are different facts and only the
   * second can be checked against anything.
   */
  const figuresFor = useCallback((income: Income): Figure[] => [
    { label: "Received", value: formatMoney(income.amountReceived), strong: true, hint: income.dayKey },
    // One cell per recipient, captioned with the person and their percentage,
    // so a sale split three ways reads as three named figures rather than one
    // lump somebody has to open the record to understand.
    ...income.cuts.map((cut) => ({
      label: `${cut.name ?? "Unassigned"}`,
      value: formatMoney(cut.amount),
      tone: "muted" as const,
      hint: `${cut.percent}% · ${CUT_ROLE_LABELS[cut.role]}`,
    })),
    { label: "Total cost", value: formatMoney(income.totalCost), tone: "warn", hint: `${income.totalPercent}% in cuts` },
    { label: "Company keeps", value: formatMoney(income.netIncome), tone: "good", strong: true, hint: "banked as profit" },
  ], []);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((income) => {
        return {
          id: income.id,
          title: income.customerName,
          meta: [income.dayKey]
            .concat(income.soldByName
              ? [`sold by ${income.soldByName}${income.soldByRole === "MANAGER" ? " (manager)" : ""}`]
              : [])
            .concat(income.cuts.length ? [`${income.cuts.length} cut${income.cuts.length === 1 ? "" : "s"}`] : ["no cuts"])
            .join(" · "),
          amount: income.amountReceived,
          category: "Marketing",
          // The profit is banked the moment the sale exists, so the only state
          // worth a pill is what the company kept out of it.
          status: { label: `${formatMoney(income.netIncome)} profit`, tone: TONE.good },
          payment: null,
          notes: income.description
            ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{income.description}</span></div>
            : null,
          detail: <FigureStrip figures={figuresFor(income)} isMobile={isMobile} />,
          actions: buildActions(income),
          onOpen: () => setOpened(income.id),
        };
      }),
    [page.items, buildActions, isMobile, figuresFor]
  );

  const openedIncome = useMemo(
    () => (opened ? incomes.find((income) => income.id === opened) ?? null : null),
    [opened, incomes]
  );

  const periodLabel = !from && !to ? "All income" : !from ? `Up to ${to}` : !to ? `From ${from}` : `${from} → ${to}`;

  const download = () => {
    /*
      **One column per cut is impossible** — a sale can have any number of them —
      so the recipients are one column, written the way somebody reads them
      aloud: "Hussain 8% = 20,000; Tayyab 4% = 10,000".
    */
    const header = ["Date", "Customer", "Sold by", "Description", "Amount received",
      "Cuts", "Total cost", "Cut %", "Company keeps"];
    const rows = filtered.map((income) => [
      income.dayKey, income.customerName, income.soldByName ?? "", income.description ?? "",
      String(income.amountReceived),
      income.cuts.map((cut) => `${cut.name ?? "Unassigned"} ${cut.percent}% = ${cut.amount}`).join("; "),
      String(income.totalCost), `${income.totalPercent}%`, String(income.netIncome),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = !from && !to ? "marketing-income-all.csv" : `marketing-income-${from || "start"}-to-${to || "today"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) {
    return (
      <p style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: "#fff", padding: "22px 20px", fontSize: 13.5, color: X.faint }}>
        Marketing income is for administrators and HR.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Mahziyar Marketing"
        figure={formatMoney(summary.net)}
        caption={`the company's share · ${formatMoney(summary.received)} received, ${formatMoney(summary.cost)} in commission`}
        isMobile={isMobile}
        tileIcon={ICON.bars}
        stats={[
          { label: "RECEIVED", value: summary.received },
          { label: "COMMISSION", value: summary.cost },
          { label: "KEPT", value: summary.net },
        ]}
        mobileAction={<HeroTile onClick={() => setAdding(true)} label="Add income" d="M12 5v14M5 12h14" />}
        actions={
          <HeroButton onClick={() => setAdding(true)} solid
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
            Add income
          </HeroButton>
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
          <MobileSearch value={search} onChange={setSearch} placeholder="Customer, seller or whoever took a cut" />
          <ChipRow
            chips={[
              { label: "All", active: teamFilter === "ALL", pick: () => setTeamFilter("ALL") },
              ...people.map((value) => ({
                label: value,
                active: teamFilter === value,
                pick: () => setTeamFilter(value),
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
              label: "Paid a cut to", width: "200px", value: teamFilter, onChange: setTeamFilter,
              options: [{ value: "ALL", label: "Everyone" }, ...people.map((v) => ({ value: v, label: v }))],
            },
          ]}
        />
      )}

      <ExpenseList
        heading="Marketing Income"
        count={`${filtered.length} of ${inRange.length}`}
        total={listedTotal}
        rows={rowModels}
        isMobile={isMobile}
        loading={loading}
        empty={inRange.length === 0
          ? "No income recorded yet. Add a sale and its three commission cuts."
          : "Nothing matches these filters."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="records" />}
      />

      {isMobile && <FloatingAdd onClick={() => setAdding(true)} label="Add income" />}

      {openedIncome && (
        <OverlayPanel
          title={openedIncome.customerName}
          subtitle={`${openedIncome.dayKey} · ${formatMoney(openedIncome.netIncome)} profit`}
          maxWidth={640}
          onClose={() => setOpened(null)}
        >
          <ExpenseDetail
            title={openedIncome.customerName}
            amountLabel={formatMoney(openedIncome.amountReceived)}
            formatMoney={formatMoney}
            status={{ label: `${formatMoney(openedIncome.netIncome)} kept`, tone: TONE.good }}
            payment={null}
            legsHeading="Where the profit landed"
            legsIn
            legs={legsByIncome.get(openedIncome.id) ?? []}
            notFunded="This sale's profit has not been posted. Edit and save it to bank it."
            extra={
              <>
                {/* The same strip the row carries, so the two cannot disagree. */}
                <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
                    The sale, and what it cost
                  </div>
                  <FigureStrip figures={figuresFor(openedIncome)} isMobile={isMobile} />
                </section>

                {/*
                  The split, spelled out line by line — a percentage, who it goes
                  to, and the rupees it comes to — with the company's share as
                  the last line, marked as the remainder rather than as a cut.
                */}
                <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>The split</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: X.faint }}>{openedIncome.totalPercent}% in cuts</span>
                  </div>
                  {openedIncome.cuts.map((cut, index) => (
                    <div key={`${cut.uid ?? "x"}-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: index === 0 ? undefined : `1px solid ${X.rowLine}` }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: X.ink }}>{cut.name ?? "Unassigned"}</div>
                        <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
                          {CUT_ROLE_LABELS[cut.role]} · {cut.percent}% of {formatMoney(openedIncome.amountReceived)}
                        </div>
                      </div>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: X.ink, fontVariantNumeric: "tabular-nums" }}>
                        {formatMoney(cut.amount)}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: "#f6faf9" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: X.deep }}>The company</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
                        everything left — {openedIncome.totalPercent >= 100 ? "nothing" : `${100 - openedIncome.totalPercent}%`}, not a cut
                      </div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 800, color: X.deep, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(openedIncome.netIncome)}
                    </span>
                  </div>
                </section>
              </>
            }
            fields={[
              { label: "Date", value: openedIncome.dayKey },
              { label: "Customer", value: openedIncome.customerName },
              {
                label: "Sold by",
                value: openedIncome.soldByName
                  ? `${openedIncome.soldByName}${openedIncome.soldByRole ? ` · ${openedIncome.soldByRole === "ADMIN" ? "Owner" : openedIncome.soldByRole === "MANAGER" ? "Manager" : "Employee"}` : ""}`
                  : "—",
              },
              { label: "Amount received", value: formatMoney(openedIncome.amountReceived) },
              { label: "Description", value: openedIncome.description ?? "—", wide: true },
            ]}
            history={openedIncome.history.map((entry) => ({
              at: stamp(entry.at),
              action: HISTORY_LABELS[entry.action] ?? entry.action,
              by: entry.byName,
              detail: entry.detail,
              amount: entry.amount,
            }))}
            actions={buildActions(openedIncome).map((action) => (
              <DetailAction key={action.key} label={action.label} d={action.d} tone={action.tone}
                disabled={action.disabled}
                onClick={() => {
                  if (action.key === "edit") setOpened(null);
                  action.onClick();
                }} />
            ))}
          />
        </OverlayPanel>
      )}

      {deleting && (
        <OverlayPanel title="Delete this income?" maxWidth={440} onClose={() => setDeleting(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeleting(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === deleting.income.id || deleting.shortBy > 0} onClick={() => void confirmDelete()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deleting.income.id || deleting.shortBy > 0 ? 0.5 : 1 }}>
                {busyId === deleting.income.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deleting.income.customerName}</strong> · {formatMoney(deleting.income.amountReceived)} · {deleting.income.dayKey}
          </p>
          {deleting.shortBy > 0 ? (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdeeec", border: "1px solid #f0c4bd", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#a33a29", lineHeight: 1.6 }}>
              This cannot be deleted. It put {formatMoney(deleting.income.netIncome)} into Mahziyar Marketing and the account
              now holds {formatMoney(deleting.balance)} — {formatMoney(deleting.shortBy)} of it has been spent on something
              else. Remove those payments first, or edit the sale rather than deleting it.
            </p>
          ) : (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
              {formatMoney(deleting.income.netIncome)} comes back out of Mahziyar Marketing, leaving{" "}
              {formatMoney(deleting.balance - deleting.income.netIncome)}. This cannot be undone.
            </p>
          )}
        </OverlayPanel>
      )}

      {(adding || editing) && (
        <IncomeForm
          income={editing}
          getIdToken={getIdToken}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(text) => { setBanner({ ok: true, text }); setAdding(false); setEditing(null); }}
        />
      )}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

/** New and Edit as one component, so the two cannot ask for different fields. */
function IncomeForm({ income, getIdToken, onClose, onSaved }: {
  income: Income | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const { employees } = useEmployees(true);
  const { subAdmins } = useSubAdmins(true);
  const isMobile = useIsMobile();

  const [form, setForm] = useState({
    dayKey: income?.dayKey ?? karachiDayKey(),
    customerName: income?.customerName ?? "",
    soldByUid: income?.soldByUid ?? "",
    description: income?.description ?? "",
    amountReceived: income ? String(income.amountReceived) : "",
  });
  const [sellerRole, setSellerRole] = useState<SellerRole | null>(income?.soldByRole ?? null);
  /*
    **Percentages are held as typed text, not as numbers.** A controlled numeric
    input that reformats what somebody typed fights them mid-entry — "2." would
    become "2" and they could never reach 2.5. The number is parsed on read.
  */
  const [cuts, setCuts] = useState<Array<{ uid: string; role: CutRole; percent: string }>>(
    income && income.cuts.length > 0
      ? income.cuts.map((cut) => ({ uid: cut.uid ?? "", role: cut.role, percent: String(cut.percent) }))
      : [{ uid: "", role: "STAFF", percent: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };
  const received = Number(form.amountReceived) || 0;

  /*
    **Everybody who can sell**, in one grouped list: the owner, the managers,
    then the employees. It used to offer employees only, which is why a sale the
    owner or a manager closed had nobody to file it under.
  */
  const sellers: Array<{ uid: string; name: string; role: SellerRole }> = [
    ...(user?.uid ? [{ uid: user.uid, name: "Myself", role: "ADMIN" as const }] : []),
    ...subAdmins.map((manager) => ({ uid: manager.uid, name: manager.name, role: "MANAGER" as const })),
    ...employees.map((employee) => ({ uid: employee.uid, name: employee.name, role: "EMPLOYEE" as const })),
  ];

  /**
   * Choosing a seller **seeds the cut that sale would normally carry** and
   * clears the one it would not.
   *
   * Only when the rows are still untouched: somebody who has already typed a
   * split and then corrects the seller must not lose it. Read from the browser
   * event, never after an await — a controlled select re-renders back to its
   * prop the moment the handler yields.
   */
  const pickSeller = (uid: string) => {
    const seller = sellers.find((entry) => entry.uid === uid) ?? null;
    setForm((f) => ({ ...f, soldByUid: uid }));
    setSellerRole(seller?.role ?? null);

    const untouched = cuts.every((cut) => !cut.uid && !cut.percent.trim());
    if (!untouched || !seller) return;

    const seeds = SELLER_GUIDANCE[seller.role].seeds;
    setCuts(
      seeds === "STAFF"
        ? [{ uid: seller.uid, role: "STAFF", percent: "" }]
        : seeds === "MANAGER"
          ? [{ uid: seller.uid, role: "MANAGER", percent: "" }]
          : [{ uid: "", role: "MANAGER", percent: "" }]
    );
  };

  /** Whoever a row's role points at — staff pick from employees, managers from managers. */
  const peopleFor = (role: CutRole) =>
    role === "MANAGER"
      ? subAdmins.map((manager) => ({ uid: manager.uid, name: manager.name }))
      : employees.map((employee) => ({ uid: employee.uid, name: employee.name }));

  const nameOf = (uid: string) =>
    employees.find((e) => e.uid === uid)?.name
    ?? subAdmins.find((m) => m.uid === uid)?.name
    ?? (uid && uid === user?.uid ? "Myself" : null);

  const modelCuts: MarketingCut[] = cuts.map((cut) => ({
    uid: cut.uid || null,
    name: cut.uid ? nameOf(cut.uid) : null,
    role: cut.role,
    percent: parsePercent(cut.percent),
  }));

  // Recomputed every keystroke — a handful of multiplications, so no memo and
  // no chance of a rupee figure lagging the percentage that produced it.
  const split = calculateMarketingSplit(received, modelCuts);

  const patch = (index: number, next: Partial<{ uid: string; role: CutRole; percent: string }>) =>
    setCuts((rows) => rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveMarketingIncome(
      await getIdToken(),
      {
        dayKey: form.dayKey,
        customerName: form.customerName,
        soldByUid: form.soldByUid || null,
        soldByName: form.soldByUid ? nameOf(form.soldByUid) : null,
        soldByRole: sellerRole,
        description: form.description,
        amountReceived: received,
        cuts: modelCuts,
      },
      income?.id
    );
    setBusy(false);
    if (result.ok) {
      onSaved(
        income
          ? `"${form.customerName.trim()}" updated — Mahziyar Marketing now holds this sale's ${formatMoney(result.data.profit)} profit.`
          : `"${form.customerName.trim()}" recorded. ${formatMoney(result.data.profit)} profit banked into Mahziyar Marketing.`
      );
    } else setError(result.error);
  };

  const canSave = Boolean(form.customerName.trim()) && received > 0 && split.valid;

  return (
    <OverlayPanel
      title={income ? "Edit income" : "Add marketing income"}
      icon={<TrendingUp size={18} />}
      maxWidth={640}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !canSave} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !canSave ? 0.5 : 1 }}>
            {busy ? "Saving…" : income ? "Save changes" : "Add income"}
          </button>
        </div>
      }
    >
      <OverlayCard title="The sale">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <L label="Customer name" wide>
            <input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} style={field} />
          </L>
          <L label="Date">
            <input type="date" value={form.dayKey} max={karachiDayKey()} onChange={(e) => set("dayKey", e.target.value)} style={field} />
          </L>
          <L label="Amount received">
            <input type="number" inputMode="decimal" value={form.amountReceived} onChange={(e) => set("amountReceived", e.target.value)} style={field} />
          </L>
          <L label="Sold by" wide>
            <select value={form.soldByUid} onChange={(e) => pickSeller(e.target.value)} style={{ ...field, cursor: "pointer" }}>
              <option value="">—</option>
              {user?.uid && (
                <optgroup label="Me">
                  <option value={user.uid}>Myself</option>
                </optgroup>
              )}
              {subAdmins.length > 0 && (
                <optgroup label="Managers">
                  {subAdmins.map((manager) => <option key={manager.uid} value={manager.uid}>{manager.name}</option>)}
                </optgroup>
              )}
              {employees.length > 0 && (
                <optgroup label="Employees">
                  {employees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name}</option>)}
                </optgroup>
              )}
            </select>
          </L>
          <L label="Description" wide>
            <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What was sold, and anything worth remembering" style={field} />
          </L>
        </div>
      </OverlayCard>

      {/*
        **The cut, as Profit Distribution does it.** A percentage per person, as
        many rows as the sale needs, the rupees computed beside each one — and
        no company row, because the company is not a recipient. It keeps
        whatever the percentages leave.
      */}
      <OverlayCard title="The cut" hint={`${split.totalPercent}% allocated · company keeps ${split.companyPercent}%`}>
        {/*
          **Guidance, not a rule.** Nothing here is ever mandatory — a sale with
          no cuts at all is valid and the company keeps every rupee of it. What
          this line does is stop somebody hunting for an employee cut on a sale
          no employee touched.
        */}
        {sellerRole && (
          <p style={{ margin: "0 16px", marginTop: 14, borderRadius: 10, background: X.tint, border: `1px solid ${X.line}`, padding: "10px 12px", fontSize: 12, fontWeight: 600, color: X.body, lineHeight: 1.6 }}>
            {SELLER_GUIDANCE[sellerRole].hint}
          </p>
        )}
        <div style={{ display: "grid", gap: 9, padding: "14px 16px" }}>
          {cuts.map((cut, index) => {
            const line = split.lines[index];
            return (
              <div key={index} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "120px minmax(0,1fr) 94px 108px 36px", gap: 9, alignItems: "end" }}>
                <L label="Role">
                  <select value={cut.role}
                    onChange={(e) => patch(index, { role: e.target.value as CutRole, uid: "" })}
                    style={{ ...field, cursor: "pointer" }}>
                    <option value="STAFF">Staff</option>
                    <option value="MANAGER">Manager</option>
                  </select>
                </L>
                <L label="Who">
                  <select value={cut.uid} onChange={(e) => patch(index, { uid: e.target.value })} style={{ ...field, cursor: "pointer" }}>
                    <option value="">Choose…</option>
                    {peopleFor(cut.role).map((person) => (
                      <option key={person.uid} value={person.uid}>{person.name}</option>
                    ))}
                  </select>
                </L>
                <L label="Percent">
                  <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input type="number" inputMode="decimal" step="0.5" min="0" max="100"
                      value={cut.percent} onChange={(e) => patch(index, { percent: e.target.value })}
                      style={{ ...field, paddingRight: 28 }} />
                    <span aria-hidden style={{ position: "absolute", right: 11, fontSize: 13, fontWeight: 700, color: X.faint }}>%</span>
                  </span>
                </L>
                {/* Computed, never typed — the answer, not a second question. */}
                <L label="Comes to">
                  <div style={{ ...field, background: X.tint, fontWeight: 800, color: X.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatMoney(line?.amount ?? 0)}
                  </div>
                </L>
                <button type="button" aria-label="Remove this cut"
                  onClick={() => setCuts((rows) => (rows.length === 1 ? [{ uid: "", role: "STAFF", percent: "" }] : rows.filter((_, i) => i !== index)))}
                  style={{ height: 40, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gridColumn: isMobile ? "1 / -1" : undefined }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.trash} /></svg>
                </button>
              </div>
            );
          })}

          <button type="button" onClick={() => setCuts((rows) => [...rows, { uid: "", role: rows.length === 0 ? "STAFF" : "MANAGER", percent: "" }])}
            style={{ justifySelf: "start", display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 999, border: `1px dashed ${X.line}`, background: "#fff", color: X.deep, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            Add another cut
          </button>
        </div>

        {/* The company's line, marked as the remainder rather than as a cut. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: "#f6faf9" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: X.deep }}>The company keeps the rest</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
              {split.companyPercent}% of {formatMoney(received)} — banked into Mahziyar Marketing
            </div>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: split.companyKeeps < 0 ? "#a8483c" : X.deep, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(split.companyKeeps)}
          </span>
        </div>
      </OverlayCard>

      {/* The same strip the row will show, live, from the same numbers. */}
      <div style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: X.tint, padding: "13px 15px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
          How this row will read
        </div>
        <FigureStrip
          isMobile={isMobile}
          figures={[
            { label: "Received", value: formatMoney(received), strong: true },
            ...split.lines.map((line) => ({
              label: line.name ?? "Unassigned",
              value: formatMoney(line.amount),
              tone: "muted" as const,
              hint: `${line.percent}% · ${CUT_ROLE_LABELS[line.role]}`,
            })),
            { label: "Total cost", value: formatMoney(split.totalCost), tone: "warn" as const, hint: `${split.totalPercent}% in cuts` },
            { label: "Company keeps", value: formatMoney(split.companyKeeps), tone: "good" as const, strong: true },
          ]}
        />
      </div>

      {received > 0 && split.errors.length > 0 && (
        <p role="alert" style={{ borderRadius: 10, border: "1px solid #f0c4bd", background: "#fdeeec", padding: "10px 12px", fontSize: 12.5, fontWeight: 600, color: "#a33a29" }}>
          {split.errors[0]}
        </p>
      )}
      {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
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
