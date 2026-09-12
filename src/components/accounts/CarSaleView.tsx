"use client";

/**
 * Car Sale — cars bought with partners, sold on, and what each one earned.
 *
 * **Transcribed from the owner's `car sale.xlsx`**, whose fourteen columns are
 * the specification; `lib/carSale` holds the arithmetic and is unit-tested
 * against every row of that book, including its totals line.
 *
 * It is built on `components/finance/expensesChrome` — the same hero, stat
 * cards, filter panel, rows, detail panel and floating Add that Office
 * Expenses, Personal Expenses, StateLife and Marketing Income use — so the
 * screen matches the rest of Accounts on the desktop *and* gets the phone
 * layout for free rather than as a second implementation that could drift.
 *
 * **The row is the unusual part, as it is on Marketing Income.** A car has nine
 * facts worth seeing at a glance — bought for, sold for, the whole profit, each
 * partner's share, the three deductions and what is left — so the row carries a
 * labelled `FigureStrip` under it rather than trying to be a title and one
 * amount.
 *
 * **There is no Receive button.** A car's net profit is banked into the **Car
 * Sale** account the moment the car is recorded, so from that instant an office
 * expense, a personal expense, a committee bill or a capital spending can be
 * paid straight *from Car Sale* through the same split control every module
 * already uses — which is the whole of being interlinked with the other
 * accounts.
 */

import { useCallback, useMemo, useState } from "react";
import { Car } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinanceCollection, useLedger } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePagination } from "@/hooks/usePagination";
import { Pager } from "@/components/employees/DossierControls";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { saveCarSale, deleteCarSale, countCarSaleProfit } from "@/lib/clientActions";
import {
  calculateCarSale,
  parseAmount,
  partnershipLabel,
  readDeductions,
  readPartners,
  type CarPartner,
  type CarPartnerLine,
  type CarShareBasis,
} from "@/lib/carSale";
import { parsePercent } from "@/lib/marketingIncome";
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
 * The account every car's net profit lands in.
 *
 * Fixed rather than searched for by name — renaming it on screen must not make
 * the next car create a second one beside it. `actions/carSale` writes the
 * matching id.
 */
const CAR_SALE_ACCOUNT_ID = "car_sale";

interface CarSale {
  id: string;
  /** The selling date — when the money actually arrived. */
  dayKey: string;
  carName: string;
  purchaseDayKey: string | null;
  purchaseCost: number;
  /** Recorded, never moved — the owner's own instruction. */
  myPayment: number;
  salePrice: number;
  saleNote: string | null;
  partners: CarPartnerLine[];
  partnership: string;
  totalProfit: number;
  grossProfit: number;
  deductions: { investor: number; ccCharges: number; misc: number };
  totalDeductions: number;
  netProfit: number;
  description: string | null;
  history: Array<{ at: string; action: string; byName: string | null; detail: string | null; amount: number | null }>;
}

function readCarSale(raw: Record<string, unknown>): CarSale {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);

  /*
    **Recomputed on read, from the column that was typed.** The rupees and the
    percentages are both stored, for exports; but a record written before a rule
    changed — or edited by hand — must never show a net profit that does not
    follow from its own partners and deductions.
  */
  const partners = readPartners(raw.partners);
  const split = calculateCarSale({
    purchaseCost: parseAmount(raw.purchaseCost),
    salePrice: parseAmount(raw.salePrice),
    partners,
    deductions: readDeductions(raw.deductions as Record<string, unknown> | undefined),
  });

  return {
    id: String(raw.id ?? ""),
    dayKey: typeof raw.dayKey === "string" && raw.dayKey.length === 10 ? raw.dayKey : karachiDayKey(),
    carName: text(raw.carName) ?? "Unnamed car",
    purchaseDayKey: text(raw.purchaseDayKey),
    purchaseCost: split.purchaseCost,
    myPayment: parseAmount(raw.myPayment),
    salePrice: split.salePrice,
    saleNote: text(raw.saleNote),
    partners: split.lines,
    partnership: text(raw.partnership) ?? partnershipLabel(partners),
    totalProfit: split.totalProfit,
    grossProfit: split.grossProfit,
    deductions: split.deductions,
    totalDeductions: split.totalDeductions,
    netProfit: split.netProfit,
    description: text(raw.description),
    history: Array.isArray(raw.history)
      ? raw.history.map(readHistoryEntry).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
  };
}

export function CarSaleView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { records, loading } = useFinanceCollection("carSales", ready);
  const ledger = useLedger(ready);
  const isMobile = useIsMobile();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("ALL");
  const [showPeriod, setShowPeriod] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CarSale | null>(null);
  const [deleting, setDeleting] = useState<{ car: CarSale; balance: number; shortBy: number } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cars = useMemo(() => (records as Record<string, unknown>[]).map(readCarSale), [records]);

  /*
    **Opens on the whole book**, like StateLife and Marketing Income and unlike
    the expense screens. A car sold in August is still money the business
    banked; defaulting to this month would hide most of the record and
    understate every total on it.
  */
  const inRange = useMemo(
    () => cars.filter((car) => (!from || car.dayKey >= from) && (!to || car.dayKey <= to)),
    [cars, from, to]
  );

  /** Everybody who has ever been in on a car — the partner filter. */
  const people = useMemo(
    () => [...new Set(inRange.flatMap((car) => car.partners.map((partner) => partner.name)).filter((name): name is string => Boolean(name)))].sort(),
    [inRange]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return inRange.filter((car) => {
      if (partnerFilter !== "ALL" && !car.partners.some((partner) => partner.name === partnerFilter)) return false;
      if (!needle) return true;
      return (
        car.carName.toLowerCase().includes(needle) ||
        car.partnership.toLowerCase().includes(needle) ||
        (car.description ?? "").toLowerCase().includes(needle) ||
        (car.saleNote ?? "").toLowerCase().includes(needle)
      );
    });
  }, [inRange, search, partnerFilter]);

  const summary = useMemo(() => {
    const sum = { sold: 0, bought: 0, profit: 0, gross: 0, deductions: 0, net: 0, count: 0 };
    for (const car of inRange) {
      sum.sold += car.salePrice;
      sum.bought += car.purchaseCost;
      sum.profit += car.totalProfit;
      sum.gross += car.grossProfit;
      sum.deductions += car.totalDeductions;
      sum.net += car.netProfit;
      sum.count += 1;
    }
    return sum;
  }, [inRange]);

  /*
    **The account, not a total.** Every car's profit is banked the moment it is
    recorded, and anything paid from Car Sale comes straight back out — so what
    is left to spend is the account's balance, which no sum over this screen's
    records could tell you.
  */
  const account = ledger.accounts.find((entry) => entry.id === CAR_SALE_ACCOUNT_ID) ?? null;
  const accountBalance = account ? ledger.balances.get(account.id)?.balance ?? 0 : 0;
  const spentFromAccount = account ? ledger.balances.get(account.id)?.outflow ?? 0 : 0;

  const listedTotal = useMemo(
    () => filtered.reduce((total, car) => total + car.salePrice, 0),
    [filtered]
  );

  const page = usePagination(filtered, 12);

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number, of: number) => (of ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
    return [
      {
        label: "Sold For", value: formatMoney(summary.sold),
        note: `${summary.count} car${summary.count === 1 ? "" : "s"} · ${formatMoney(summary.bought)} to buy`,
        pill: `${summary.count}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.car,
      },
      {
        label: "My Gross Profit", value: formatMoney(summary.gross),
        note: `my share of ${formatMoney(summary.profit)} total profit`,
        pill: `${pct(summary.gross, summary.profit)}%`, tone: summary.gross < 0 ? "bad" : "good",
        pct: pct(summary.gross, summary.profit),
        color: summary.gross < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.bars,
      },
      {
        label: "Investor, CC & Misc", value: formatMoney(summary.deductions),
        note: "taken off before net",
        pill: `${pct(summary.deductions, summary.gross)}%`, tone: "warn",
        pct: pct(summary.deductions, summary.gross),
        color: "#a5762a", accent: "#c99a2e", icon: ICON.user,
      },
      // **The figure that decides whether the money can be spent.** The net
      // profit ever earned and what is left in the account are different
      // numbers the moment anything is paid out of it.
      {
        label: "Left To Spend", value: formatMoney(accountBalance),
        note: spentFromAccount > 0 ? `${formatMoney(spentFromAccount)} already paid out` : "nothing paid out of it yet",
        pill: "In hand", tone: accountBalance > 0 ? "good" : "warn",
        pct: summary.net ? pct(accountBalance, summary.net) : 0,
        color: accountBalance < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet,
      },
    ];
  }, [summary, accountBalance, spentFromAccount]);

  /** Where each car's profit landed. */
  const legsByCar = useMemo(() => {
    const map = new Map<string, FundingLeg[]>();
    const names = new Map(ledger.accounts.map((entry) => [entry.id, entry.name]));
    for (const txn of ledger.transactions) {
      if (txn.sourceModule !== "CAR_SALE" || !txn.sourceId) continue;
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

  const askDelete = useCallback(async (car: CarSale) => {
    setBusyId(car.id);
    const result = await countCarSaleProfit(await getIdToken(), car.id);
    setBusyId(null);
    setDeleting({
      car,
      balance: result.ok ? result.data.balance : 0,
      shortBy: result.ok ? result.data.shortBy : 0,
    });
  }, [getIdToken]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.car.id);
    const result = await deleteCarSale(await getIdToken(), deleting.car.id);
    setBusyId(null);
    setDeleting(null);
    setOpened(null);
    setBanner(result.ok
      ? { ok: true, text: `"${deleting.car.carName}" deleted, and ${formatMoney(result.data.reversed)} taken back out of Car Sale.` }
      : { ok: false, text: result.error });
  };

  const buildActions = useCallback((car: CarSale): RowAction[] => [
    { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setEditing(car) },
    { key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => void askDelete(car), disabled: busyId === car.id },
  ], [busyId, askDelete]);

  /**
   * Every figure a car carries, in the order the sheet reads them.
   *
   * Each partner is named under their own amount, because "Rs 25,000 partner"
   * and "Rs 25,000 to QALBE" are different facts and only the second can be
   * checked against anything.
   */
  const figuresFor = useCallback((car: CarSale): Figure[] => {
    const figures: Figure[] = [
      { label: "Bought for", value: formatMoney(car.purchaseCost), tone: "muted", hint: car.purchaseDayKey },
      { label: "Sold for", value: formatMoney(car.salePrice), strong: true, hint: car.dayKey },
      { label: "Total profit", value: formatMoney(car.totalProfit), tone: car.totalProfit < 0 ? "bad" : "ink", hint: "before the split" },
      ...car.partners.map((partner) => ({
        label: partner.name ?? "Unnamed",
        value: formatMoney(partner.amount),
        tone: (partner.mine ? "good" : "muted") as Figure["tone"],
        hint: `${partner.percent}%${partner.mine ? " · me" : ""}`,
      })),
    ];
    if (car.totalDeductions !== 0) {
      figures.push({ label: "Investor, CC & misc", value: formatMoney(car.totalDeductions), tone: "warn", hint: "off my share" });
    }
    figures.push({
      label: "Net profit",
      value: formatMoney(car.netProfit),
      tone: car.netProfit < 0 ? "bad" : "good",
      strong: true,
      hint: car.netProfit < 0 ? "came out of Car Sale" : "banked to Car Sale",
    });
    return figures;
  }, []);

  const rowModels = useMemo<ExpenseRowModel[]>(
    () =>
      page.items.map((car) => ({
        id: car.id,
        title: car.carName,
        meta: [car.dayKey, car.partnership]
          .concat(car.purchaseDayKey ? [`bought ${car.purchaseDayKey}`] : [])
          .join(" · "),
        amount: car.salePrice,
        category: "Car Sale",
        // The profit is banked the moment the car exists, so the state worth a
        // pill is what it actually earned — and a loss must not read as a gain.
        status: {
          label: `${formatMoney(car.netProfit)} net`,
          tone: car.netProfit < 0 ? TONE.bad : TONE.good,
        },
        payment: null,
        notes: car.saleNote || car.description
          ? <div style={{ marginTop: 6 }}><span style={{ fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{[car.saleNote, car.description].filter(Boolean).join(" · ")}</span></div>
          : null,
        detail: <FigureStrip figures={figuresFor(car)} isMobile={isMobile} />,
        actions: buildActions(car),
        onOpen: () => setOpened(car.id),
      })),
    [page.items, buildActions, isMobile, figuresFor]
  );

  const openedCar = useMemo(
    () => (opened ? cars.find((car) => car.id === opened) ?? null : null),
    [opened, cars]
  );

  const periodLabel = !from && !to ? "All cars" : !from ? `Up to ${to}` : !to ? `From ${from}` : `${from} → ${to}`;

  const download = () => {
    /*
      One column per partner is impossible — a car can have any number — so they
      are one column, written the way somebody reads them aloud:
      "ME 33.33% = 25,000; QALBE 33.33% = 25,000".
    */
    const header = ["Selling date", "Car", "Partnership", "Purchase date", "Purchase rate + cost",
      "My payment", "Sale price", "Sale note", "Total profit", "Partner shares",
      "Gross profit", "Investor", "CC charges", "Misc", "Net profit", "Description"];
    const rows = filtered.map((car) => [
      car.dayKey, car.carName, car.partnership, car.purchaseDayKey ?? "",
      String(car.purchaseCost), String(car.myPayment), String(car.salePrice), car.saleNote ?? "",
      String(car.totalProfit),
      car.partners.map((partner) => `${partner.name ?? "Unnamed"} ${partner.percent}% = ${partner.amount}`).join("; "),
      String(car.grossProfit), String(car.deductions.investor), String(car.deductions.ccCharges),
      String(car.deductions.misc), String(car.netProfit), car.description ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = !from && !to ? "car-sale-all.csv" : `car-sale-${from || "start"}-to-${to || "today"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!ready) {
    return (
      <p style={{ borderRadius: 14, border: `1px solid ${X.line}`, background: "#fff", padding: "22px 20px", fontSize: 13.5, color: X.faint }}>
        Car Sale is for administrators and HR.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Car Sale"
        figure={formatMoney(summary.net)}
        caption={`net profit · ${formatMoney(summary.sold)} sold, ${formatMoney(summary.gross)} my gross share`}
        isMobile={isMobile}
        tileIcon={ICON.car}
        stats={[
          { label: "SOLD", value: summary.sold },
          { label: "GROSS", value: summary.gross },
          { label: "NET", value: summary.net },
        ]}
        mobileAction={<HeroTile onClick={() => setAdding(true)} label="Add car" d="M12 5v14M5 12h14" />}
        actions={
          <HeroButton onClick={() => setAdding(true)} solid
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>}>
            Add car
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
          <MobileSearch value={search} onChange={setSearch} placeholder="Car, partner or note" />
          <ChipRow
            chips={[
              { label: "All", active: partnerFilter === "ALL", pick: () => setPartnerFilter("ALL") },
              ...people.map((value) => ({
                label: value,
                active: partnerFilter === value,
                pick: () => setPartnerFilter(value),
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
              label: "In on the car", width: "200px", value: partnerFilter, onChange: setPartnerFilter,
              options: [{ value: "ALL", label: "Anyone" }, ...people.map((v) => ({ value: v, label: v }))],
            },
          ]}
        />
      )}

      <ExpenseList
        heading="Cars"
        count={`${filtered.length} of ${inRange.length}`}
        total={listedTotal}
        rows={rowModels}
        isMobile={isMobile}
        loading={loading}
        empty={inRange.length === 0
          ? "No cars recorded yet. Add one with what it cost, what it sold for and who was in on it."
          : "Nothing matches these filters."}
        formatMoney={formatMoney}
        pager={<Pager pagination={page} variant={isMobile ? "mobile" : "web"} noun="cars" />}
      />

      {isMobile && <FloatingAdd onClick={() => setAdding(true)} label="Add car" />}

      {openedCar && (
        <OverlayPanel
          title={openedCar.carName}
          subtitle={`${openedCar.dayKey} · ${formatMoney(openedCar.netProfit)} net`}
          maxWidth={640}
          onClose={() => setOpened(null)}
        >
          <ExpenseDetail
            title={openedCar.carName}
            amountLabel={formatMoney(openedCar.salePrice)}
            formatMoney={formatMoney}
            status={{
              label: `${formatMoney(openedCar.netProfit)} net`,
              tone: openedCar.netProfit < 0 ? TONE.bad : TONE.good,
            }}
            payment={null}
            legsHeading={openedCar.netProfit < 0 ? "What the loss came out of" : "Where the profit landed"}
            legsIn={openedCar.netProfit >= 0}
            legs={legsByCar.get(openedCar.id) ?? []}
            notFunded="This car's profit has not been posted. Edit and save it to bank it."
            extra={
              <>
                {/* The same strip the row carries, so the two cannot disagree. */}
                <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>
                    The car, and what it made
                  </div>
                  <FigureStrip figures={figuresFor(openedCar)} isMobile={isMobile} />
                </section>

                {/*
                  The partnership spelled out line by line — the share, the
                  rupees and which line is the owner's — then the three
                  deductions and the net, in the order the sheet takes them.
                */}
                <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${X.panelLine}`, background: X.tint }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>The partnership</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: X.faint }}>{formatMoney(openedCar.totalProfit)} to share</span>
                  </div>

                  {openedCar.partners.length === 0 ? (
                    <div style={{ padding: "13px 16px", fontSize: 12.5, fontWeight: 500, color: X.faint }}>
                      No partners — the whole profit is yours.
                    </div>
                  ) : (
                    openedCar.partners.map((partner, index) => (
                      <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: index === 0 ? undefined : `1px solid ${X.rowLine}`, background: partner.mine ? "#f6faf9" : undefined }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: partner.mine ? 800 : 700, color: partner.mine ? X.deep : X.ink }}>
                            {partner.name ?? "Unnamed"}{partner.mine ? " · me" : ""}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
                            {partner.percent}% of {formatMoney(openedCar.totalProfit)}
                            {partner.basis === "AMOUNT" ? " · typed in rupees" : ""}
                          </div>
                        </div>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: partner.amount < 0 ? "#a8483c" : X.ink, fontVariantNumeric: "tabular-nums" }}>
                          {formatMoney(partner.amount)}
                        </span>
                      </div>
                    ))
                  )}

                  {([
                    ["Investor", openedCar.deductions.investor],
                    ["CC charges", openedCar.deductions.ccCharges],
                    ["Misc", openedCar.deductions.misc],
                  ] as const)
                    .filter(([, amount]) => amount !== 0)
                    .map(([label, amount]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: `1px solid ${X.rowLine}` }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#a5762a" }}>{label}</div>
                        <span style={{ fontSize: 13.5, fontWeight: 800, color: "#a5762a", fontVariantNumeric: "tabular-nums" }}>
                          − {formatMoney(amount)}
                        </span>
                      </div>
                    ))}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: "#f6faf9" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: X.deep }}>Net profit</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
                        my {formatMoney(openedCar.grossProfit)} share
                        {openedCar.totalDeductions !== 0 ? `, less ${formatMoney(openedCar.totalDeductions)}` : ""}
                        {" — "}
                        {openedCar.netProfit < 0 ? "taken out of Car Sale" : "banked into Car Sale"}
                      </div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 800, color: openedCar.netProfit < 0 ? "#a8483c" : X.deep, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(openedCar.netProfit)}
                    </span>
                  </div>
                </section>
              </>
            }
            fields={[
              { label: "Car", value: openedCar.carName },
              { label: "Partnership", value: openedCar.partnership },
              { label: "Purchase date", value: openedCar.purchaseDayKey ?? "—" },
              { label: "Purchase rate + cost", value: formatMoney(openedCar.purchaseCost) },
              // Recorded, never moved — so the panel says so rather than
              // leaving somebody to wonder which account it came out of.
              { label: "My payment", value: `${formatMoney(openedCar.myPayment)} — recorded only, no account touched` },
              { label: "Selling date", value: openedCar.dayKey },
              { label: "Sale price", value: formatMoney(openedCar.salePrice) },
              { label: "Note on the sale", value: openedCar.saleNote ?? "—", wide: true },
              { label: "Description", value: openedCar.description ?? "—", wide: true },
            ]}
            history={openedCar.history.map((entry) => ({
              at: stamp(entry.at),
              action: HISTORY_LABELS[entry.action] ?? entry.action,
              by: entry.byName,
              detail: entry.detail,
              amount: entry.amount,
            }))}
            actions={buildActions(openedCar).map((action) => (
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
        <OverlayPanel title="Delete this car?" maxWidth={440} onClose={() => setDeleting(null)}
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
              <button type="button" onClick={() => setDeleting(null)}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Keep it</button>
              <button type="button" disabled={busyId === deleting.car.id || deleting.shortBy > 0} onClick={() => void confirmDelete()}
                style={{ borderRadius: 10, border: "none", background: "#a8483c", color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busyId === deleting.car.id || deleting.shortBy > 0 ? 0.5 : 1 }}>
                {busyId === deleting.car.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          }>
          <p style={{ fontSize: 13.5, color: X.body, lineHeight: 1.6 }}>
            <strong style={{ color: X.ink }}>{deleting.car.carName}</strong> · sold {formatMoney(deleting.car.salePrice)} · {deleting.car.dayKey}
          </p>
          {deleting.shortBy > 0 ? (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdeeec", border: "1px solid #f0c4bd", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#a33a29", lineHeight: 1.6 }}>
              This cannot be deleted. It put {formatMoney(deleting.car.netProfit)} into Car Sale and the account now holds{" "}
              {formatMoney(deleting.balance)} — {formatMoney(deleting.shortBy)} of it has been spent on something else.
              Remove those payments first, or edit the car rather than deleting it.
            </p>
          ) : (
            <p style={{ marginTop: 10, borderRadius: 10, background: "#fdf5e6", border: "1px solid #ecdcae", padding: "11px 13px", fontSize: 12.5, fontWeight: 600, color: "#8a6321", lineHeight: 1.6 }}>
              {formatMoney(deleting.car.netProfit)} comes back out of Car Sale, leaving{" "}
              {formatMoney(deleting.balance - deleting.car.netProfit)}. This cannot be undone.
            </p>
          )}
        </OverlayPanel>
      )}

      {(adding || editing) && (
        <CarForm
          car={editing}
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

/** What a partner row holds while it is being typed. */
interface PartnerRow {
  name: string;
  percent: string;
  amount: string;
  basis: CarShareBasis;
  mine: boolean;
}

/** New and Edit as one component, so the two cannot ask for different fields. */
function CarForm({ car, getIdToken, onClose, onSaved }: {
  car: CarSale | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();

  const [form, setForm] = useState({
    carName: car?.carName ?? "",
    purchaseDayKey: car?.purchaseDayKey ?? "",
    purchaseCost: car ? String(car.purchaseCost) : "",
    myPayment: car ? String(car.myPayment) : "",
    dayKey: car?.dayKey ?? karachiDayKey(),
    salePrice: car ? String(car.salePrice) : "",
    saleNote: car?.saleNote ?? "",
    description: car?.description ?? "",
    investor: car && car.deductions.investor ? String(car.deductions.investor) : "",
    ccCharges: car && car.deductions.ccCharges ? String(car.deductions.ccCharges) : "",
    misc: car && car.deductions.misc ? String(car.deductions.misc) : "",
  });

  /*
    **Figures are held as typed text, not as numbers.** A controlled numeric
    input that reformats what somebody typed fights them mid-entry — "2." would
    become "2" and they could never reach 2.5. Everything is parsed on read.
  */
  const [partners, setPartners] = useState<PartnerRow[]>(
    car && car.partners.length > 0
      ? car.partners.map((partner) => ({
          name: partner.name ?? "",
          percent: String(partner.percent),
          amount: String(partner.amount),
          basis: partner.basis,
          mine: partner.mine,
        }))
      : [{ name: "", percent: "", amount: "", basis: "PERCENT", mine: true }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const modelPartners: CarPartner[] = partners.map((row) => ({
    name: row.name.trim() || null,
    percent: parsePercent(row.percent),
    amount: parseAmount(row.amount),
    basis: row.basis,
    mine: row.mine,
  }));

  // Recomputed every keystroke — a handful of multiplications, so no memo and
  // no chance of a rupee figure lagging the percentage that produced it.
  const split = calculateCarSale({
    purchaseCost: parseAmount(form.purchaseCost),
    salePrice: parseAmount(form.salePrice),
    partners: modelPartners,
    deductions: {
      investor: parseAmount(form.investor),
      ccCharges: parseAmount(form.ccCharges),
      misc: parseAmount(form.misc),
    },
  });

  const patch = (index: number, next: Partial<PartnerRow>) =>
    setPartners((rows) => rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  /**
   * **The two columns fill each other in.**
   *
   * Typing a percentage writes the rupees beside it and marks the row
   * `PERCENT`; typing rupees writes the percentage and marks it `AMOUNT`. The
   * basis is what survives a later change to the sale price — a percentage
   * means "this share of whatever it made", a rupee figure means "this much".
   * Both readings are legitimate, which is why the app has to remember which
   * one the person chose rather than guessing on their behalf.
   */
  const typePercent = (index: number, text: string) =>
    patch(index, {
      percent: text,
      basis: "PERCENT",
      amount: String(Math.round(((split.totalProfit * parsePercent(text)) / 100) * 100) / 100),
    });

  const typeAmount = (index: number, text: string) =>
    patch(index, {
      amount: text,
      basis: "AMOUNT",
      percent: split.totalProfit
        ? String(Math.round((parseAmount(text) / split.totalProfit) * 10000) / 100)
        : "0",
    });

  /** Exactly one line can be the owner's — picking one clears the others. */
  const pickMine = (index: number) =>
    setPartners((rows) => rows.map((row, i) => ({ ...row, mine: i === index })));

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveCarSale(
      await getIdToken(),
      {
        carName: form.carName,
        purchaseDayKey: form.purchaseDayKey || null,
        purchaseCost: parseAmount(form.purchaseCost),
        myPayment: parseAmount(form.myPayment),
        dayKey: form.dayKey,
        salePrice: parseAmount(form.salePrice),
        saleNote: form.saleNote,
        partners: modelPartners,
        deductions: {
          investor: parseAmount(form.investor),
          ccCharges: parseAmount(form.ccCharges),
          misc: parseAmount(form.misc),
        },
        description: form.description,
      },
      car?.id
    );
    setBusy(false);
    if (result.ok) {
      const net = result.data.netProfit;
      onSaved(
        car
          ? `"${form.carName.trim()}" updated — Car Sale now holds this car's ${formatMoney(net)}.`
          : net < 0
            ? `"${form.carName.trim()}" recorded. It lost ${formatMoney(Math.abs(net))}, taken out of Car Sale.`
            : `"${form.carName.trim()}" recorded. ${formatMoney(net)} banked into Car Sale.`
      );
    } else setError(result.error);
  };

  const canSave = Boolean(form.carName.trim()) && split.valid;

  return (
    <OverlayPanel
      title={car ? "Edit car" : "Add a car"}
      icon={<Car size={18} />}
      maxWidth={680}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          <button type="button" onClick={onClose}
            style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.muted, padding: "10px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button type="button" disabled={busy || !canSave} onClick={() => void save()}
            style={{ borderRadius: 10, border: "none", background: X.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: busy || !canSave ? 0.5 : 1 }}>
            {busy ? "Saving…" : car ? "Save changes" : "Add car"}
          </button>
        </div>
      }
    >
      <OverlayCard title="The car">
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", padding: "14px 16px" }}>
          <L label="Car name" wide>
            <input value={form.carName} onChange={(e) => set("carName", e.target.value)} placeholder="e.g. HONDA CITY 2022" style={field} />
          </L>
          <L label="Purchasing date">
            <input type="date" value={form.purchaseDayKey} max={karachiDayKey()} onChange={(e) => set("purchaseDayKey", e.target.value)} style={field} />
          </L>
          <L label="Purchasing rate + cost">
            <input type="number" inputMode="decimal" value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} style={field} />
          </L>
          <L label="Selling date">
            <input type="date" value={form.dayKey} max={karachiDayKey()} onChange={(e) => set("dayKey", e.target.value)} style={field} />
          </L>
          <L label="Sale price">
            <input type="number" inputMode="decimal" value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} style={field} />
          </L>
          {/* Recorded, never moved — the caption says so, because every other
              money box on this screen does move something. */}
          <L label="My payment" wide>
            <input type="number" inputMode="decimal" value={form.myPayment} onChange={(e) => set("myPayment", e.target.value)} style={field} />
            <span style={{ fontSize: 11, fontWeight: 500, color: X.faint }}>
              What you put in yourself. Recorded here only — it does not come out of any account.
            </span>
          </L>
          <L label="Description if any" wide>
            <input value={form.saleNote} onChange={(e) => set("saleNote", e.target.value)} placeholder="Anything about the sale worth remembering" style={field} />
          </L>
        </div>

        {/* The profit, before anybody's share — the number every row below is
            a slice of, so it sits above them rather than under. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: X.tint }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: split.totalProfit < 0 ? "#a8483c" : X.deep }}>
              {split.totalProfit < 0 ? "Total loss on the car" : "Total profit on the car"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
              {formatMoney(split.salePrice)} sold − {formatMoney(split.purchaseCost)} cost
            </div>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: split.totalProfit < 0 ? "#a8483c" : X.deep, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(split.totalProfit)}
          </span>
        </div>
      </OverlayCard>

      {/*
        **Two columns, either one driving the other**, at the owner's
        instruction — his book splits a 75,000 profit into three round 25,000s
        where a third would be 24,999.99, and it also carries plain percentages.
        Whichever box is typed fills in the other.
      */}
      <OverlayCard title="The partnership" hint={`${formatMoney(split.allocated)} of ${formatMoney(split.totalProfit)} shared out`}>
        <p style={{ margin: "0 16px", marginTop: 14, borderRadius: 10, background: X.tint, border: `1px solid ${X.line}`, padding: "10px 12px", fontSize: 12, fontWeight: 600, color: X.body, lineHeight: 1.6 }}>
          Add each partner and their share — type a percentage <em>or</em> the rupees and the other fills itself in.
          Mark the line that is <strong>you</strong>: that share is what the car earns you. A car with no partners is
          entirely yours.
        </p>

        <div style={{ display: "grid", gap: 9, padding: "14px 16px" }}>
          {partners.map((row, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "minmax(0,1fr) 92px 128px 74px 36px", gap: 9, alignItems: "end" }}>
              <L label="Partner">
                <input value={row.name} onChange={(e) => patch(index, { name: e.target.value })} placeholder="QALBE" style={field} />
              </L>
              <L label="Share %">
                <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input type="number" inputMode="decimal" step="0.01" min="0" max="100"
                    value={row.percent} onChange={(e) => typePercent(index, e.target.value)}
                    style={{ ...field, paddingRight: 26, background: row.basis === "PERCENT" ? "#fff" : X.tint }} />
                  <span aria-hidden style={{ position: "absolute", right: 10, fontSize: 13, fontWeight: 700, color: X.faint }}>%</span>
                </span>
              </L>
              <L label="Share in rupees">
                <input type="number" inputMode="decimal"
                  value={row.amount} onChange={(e) => typeAmount(index, e.target.value)}
                  style={{ ...field, background: row.basis === "AMOUNT" ? "#fff" : X.tint }} />
              </L>
              {/* A radio, not a tick: exactly one line can be the owner's, and
                  a radio group says that without needing a rule to enforce it. */}
              <L label="This is me">
                <button type="button" onClick={() => pickMine(index)}
                  aria-pressed={row.mine}
                  style={{ ...field, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, justifyContent: "center", background: row.mine ? "#e8f5f3" : "#fff", color: row.mine ? X.deep : X.faint, fontWeight: 700, borderColor: row.mine ? "#bfe0dc" : undefined }}>
                  <span aria-hidden style={{ width: 13, height: 13, borderRadius: "50%", border: `2px solid ${row.mine ? X.deep : X.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    {row.mine && <span style={{ width: 5, height: 5, borderRadius: "50%", background: X.deep }} />}
                  </span>
                  {row.mine ? "Me" : "Pick"}
                </button>
              </L>
              <button type="button" aria-label="Remove this partner"
                onClick={() => setPartners((rows) => (rows.length === 1
                  ? [{ name: "", percent: "", amount: "", basis: "PERCENT", mine: true }]
                  : rows.filter((_, i) => i !== index).map((r, i, list) => (list.some((x) => x.mine) ? r : { ...r, mine: i === 0 }))))}
                style={{ height: 40, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gridColumn: isMobile ? "1 / -1" : undefined }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON.trash} /></svg>
              </button>
            </div>
          ))}

          <button type="button" onClick={() => setPartners((rows) => [...rows, { name: "", percent: "", amount: "", basis: "PERCENT", mine: rows.length === 0 }])}
            style={{ justifySelf: "start", display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 999, border: `1px dashed ${X.line}`, background: "#fff", color: X.deep, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            Add another partner
          </button>
        </div>

        {/* What nobody has been given yet. Shown rather than enforced — a car
            can legitimately be part-shared — but never hidden. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: "#f6faf9" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: X.deep }}>My gross profit</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
              {split.myPercent}% of {formatMoney(split.totalProfit)}
              {split.unallocated !== 0 ? ` · ${formatMoney(split.unallocated)} not shared out` : ""}
            </div>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: split.grossProfit < 0 ? "#a8483c" : X.deep, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(split.grossProfit)}
          </span>
        </div>
      </OverlayCard>

      {/* The sheet's last three cost columns, taken off the owner's share. */}
      <OverlayCard title="Taken off my share" hint={formatMoney(split.totalDeductions)}>
        <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", padding: "14px 16px" }}>
          <L label="Investor">
            <input type="number" inputMode="decimal" value={form.investor} onChange={(e) => set("investor", e.target.value)} style={field} />
          </L>
          <L label="CC charges">
            <input type="number" inputMode="decimal" value={form.ccCharges} onChange={(e) => set("ccCharges", e.target.value)} style={field} />
          </L>
          <L label="Misc">
            <input type="number" inputMode="decimal" value={form.misc} onChange={(e) => set("misc", e.target.value)} style={field} />
          </L>
          <L label="Description" wide>
            <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Where this money went — “65,500 used in committee Sep”" style={field} />
          </L>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${X.rowLine}`, background: "#f6faf9" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: X.deep }}>Net profit</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: X.faint, marginTop: 2 }}>
              {split.netProfit < 0 ? "comes out of" : "goes into"} the Car Sale account, ready to spend from
            </div>
          </div>
          <span style={{ fontSize: 17, fontWeight: 800, color: split.netProfit < 0 ? "#a8483c" : X.deep, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(split.netProfit)}
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
            { label: "Bought for", value: formatMoney(split.purchaseCost), tone: "muted" },
            { label: "Sold for", value: formatMoney(split.salePrice), strong: true },
            { label: "Total profit", value: formatMoney(split.totalProfit), tone: split.totalProfit < 0 ? "bad" : "ink" },
            ...split.lines.map((line) => ({
              label: line.name ?? "Unnamed",
              value: formatMoney(line.amount),
              tone: (line.mine ? "good" : "muted") as Figure["tone"],
              hint: `${line.percent}%${line.mine ? " · me" : ""}`,
            })),
            { label: "Net profit", value: formatMoney(split.netProfit), tone: split.netProfit < 0 ? "bad" : "good", strong: true },
          ]}
        />
      </div>

      {split.errors.length > 0 && (
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
