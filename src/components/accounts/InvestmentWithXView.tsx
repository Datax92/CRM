"use client";

/**
 * Investment with X — the owner's sheet, one book per partner.
 *
 * The desktop is the sheet itself: `AMOUNT | DATE | RETURN DATE | PROFIT |
 * GROSS PROFIT | AARYJ | INVESTOR | CC | ALI | MISC | NET PROFIT |
 * DESCRIPTION`, a row per round and a TOTAL row, in `SheetTable`. The phone is
 * the Accounts card list with the same figures in a `FigureStrip`, so no figure
 * the sheet has is missing on either surface.
 *
 * **Everything is editable**: every round, the book's name and partner, the
 * share columns (rename, add, remove) and whether net profit is taken from
 * Profit or Gross Profit. The arithmetic is `lib/investmentWithX`; each round's
 * net profit is banked into the book's own income account, from which expenses
 * can be paid like any other account.
 *
 * **A round's amount is taken from an account** — any account in Accounts, the
 * Capital Investment ones first — and goes back into it when the round is
 * **received**. Until somebody presses Received the return date is only an
 * expectation: the net is not income and the amount is still with the partner.
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLedger, type AccountDoc } from "@/hooks/useLedger";
import { usePagination } from "@/hooks/usePagination";
import { useInvestmentBooks, useInvestmentRounds, type InvestmentBook } from "@/hooks/useAccountSheets";
import { Pager } from "@/components/employees/DossierControls";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  NET_BASIS_LABELS,
  bookTotals,
  calculateRound,
  checkRoundFunding,
  isRoundOverdue,
  isRoundReceived,
  parseAmount,
  readFunding,
  receivedDayFor,
  type FundingLine,
  type NetBasis,
  type RoundFigures,
} from "@/lib/investmentWithX";
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@/lib/ledger";
import {
  saveInvestmentBook,
  deleteInvestmentBook,
  saveInvestmentRound,
  deleteInvestmentRound,
  setInvestmentRoundReceived,
} from "@/lib/clientActions";
import {
  ChipRow,
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
  type ExpenseRowModel,
  type Figure,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { SheetTable, SheetAction, Amount, type SheetColumn } from "./SheetTable";
import { ConfirmPanel, Field, FooterButtons, FormError, FormGrid, Glyph, Notice, fieldStyle } from "./sheetForms";

const INVEST_ICON = "M3 17l6-6 4 4 8-8M15 7h6v6";
const REINVEST_ICON = "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5";

interface Round extends RoundFigures {
  id: string;
  bookId: string;
  dayKey: string;
  returnDayKey: string | null;
  description: string | null;
  /** Where the amount was taken from. Empty on rounds saved before it was asked. */
  funding: Array<FundingLine & { accountName: string | null }>;
  /** The partner has paid it back: the net is banked and the amount is home. */
  received: boolean;
  receivedDayKey: string | null;
  /** Rounds that put this one's money back to work, once it came home. */
  reinvestedInto: string[];
  /** The received round this one's money came from, if it is a reinvestment. */
  reinvestedFrom: string | null;
}

/** What a reinvestment starts the round form with. */
interface RoundPrefill {
  amount: number;
  funding: Array<{ accountId: string; amount: string }>;
  description: string;
  reinvestedFrom: string;
}

const money = (n: number) => formatMoney(n);

/** Stored funding plus the name frozen beside each line when it was saved. */
function readRoundFunding(raw: unknown): Round["funding"] {
  const names = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const line of raw) {
      const entry = (line ?? {}) as { accountId?: unknown; accountName?: unknown };
      if (typeof entry.accountId === "string" && typeof entry.accountName === "string") {
        names.set(entry.accountId, entry.accountName);
      }
    }
  }
  return readFunding(raw).map((line) => ({ ...line, accountName: names.get(line.accountId) ?? null }));
}

/** The live name when the account still exists, else the one frozen on the round. */
function fundingNames(round: Pick<Round, "funding">, accounts: readonly AccountDoc[]): string {
  return round.funding
    .map((line) => accounts.find((account) => account.id === line.accountId)?.name ?? line.accountName ?? "A deleted account")
    .join(", ");
}

/** Capital Investment accounts first — that is where a round's money usually comes from. */
const KIND_ORDER: AccountKind[] = ["INVESTMENT", "BANK", "CASH", "WALLET", "COMMITTEE", "INCOME", "OTHER"];

export function InvestmentWithXView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const isMobile = useIsMobile();
  const { books, loading: booksLoading, error } = useInvestmentBooks(ready);
  const { rounds: rawRounds, loading: roundsLoading } = useInvestmentRounds(ready);
  const ledger = useLedger(ready);

  const [pickedBook, setPickedBook] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [showPeriod, setShowPeriod] = useState(false);
  const [bookForm, setBookForm] = useState<{ book: InvestmentBook | null } | null>(null);
  const [roundForm, setRoundForm] = useState<{ round: Round | null; bookId?: string; prefill?: RoundPrefill } | null>(null);
  /** A received round whose money is about to go back to work. */
  const [reinvesting, setReinvesting] = useState<Round | null>(null);
  const [deleting, setDeleting] = useState<Round | null>(null);
  /** The round being marked received (or, to undo a mistake, not received). */
  const [receiving, setReceiving] = useState<Round | null>(null);
  const [receivedOn, setReceivedOn] = useState(karachiDayKey());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const book = books.find((entry) => entry.id === pickedBook) ?? books[0] ?? null;

  /** Recomputed on read from the book's current columns and basis. */
  const rounds = useMemo<Round[]>(() => {
    if (!book) return [];
    return rawRounds
      .filter((raw) => raw.bookId === book.id)
      .map((raw) => ({
        ...calculateRound(
          {
            amount: raw.amount as number,
            profit: raw.profit as number,
            grossProfit: raw.grossProfit as number,
            shares: (raw.shares as Record<string, number>) ?? {},
          },
          book.columns,
          book.netBasis
        ),
        id: raw.id as string,
        bookId: book.id,
        dayKey: typeof raw.dayKey === "string" ? raw.dayKey : "",
        returnDayKey: typeof raw.returnDayKey === "string" && raw.returnDayKey ? raw.returnDayKey : null,
        description: typeof raw.description === "string" && raw.description ? raw.description : null,
        funding: readRoundFunding(raw.funding),
        received: isRoundReceived({ received: raw.received }),
        receivedDayKey: isRoundReceived({ received: raw.received }) ? receivedDayFor({ receivedDayKey: raw.receivedDayKey, returnDayKey: raw.returnDayKey, dayKey: raw.dayKey }) : null,
        // Only rounds that still exist — a deleted reinvestment is no longer where the money went.
        reinvestedInto: Array.isArray(raw.reinvestedInto)
          ? (raw.reinvestedInto as unknown[]).filter((id): id is string => typeof id === "string" && rawRounds.some((other) => other.id === id))
          : [],
        reinvestedFrom: typeof raw.reinvestedFrom === "string" ? raw.reinvestedFrom : null,
      }))
      // The sheet reads oldest first, top to bottom.
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.id.localeCompare(b.id));
  }, [rawRounds, book]);

  const inRange = useMemo(
    () => rounds.filter((round) => (!from || round.dayKey >= from) && (!to || round.dayKey <= to)),
    [rounds, from, to]
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return inRange;
    return inRange.filter(
      (round) =>
        (round.description ?? "").toLowerCase().includes(needle) ||
        String(round.amount).includes(needle) ||
        round.dayKey.includes(needle)
    );
  }, [inRange, search]);

  const totals = useMemo(() => bookTotals(inRange, book?.columns ?? []), [inRange, book]);
  const listedTotals = useMemo(() => bookTotals(filtered, book?.columns ?? []), [filtered, book]);

  const account = book ? ledger.accounts.find((entry) => entry.id === book.accountId) ?? null : null;
  const balance = account ? ledger.balances.get(account.id)?.balance ?? 0 : 0;
  const spent = account ? ledger.balances.get(account.id)?.outflow ?? 0 : 0;

  const page = usePagination(filtered, 12);

  const periodLabel = !from && !to ? "All rounds" : !from ? `Up to ${to}` : !to ? `From ${from}` : `${from} → ${to}`;

  /** Not received yet — money currently with the partner, and profit not yet income. */
  const pending = useMemo(() => {
    const open = inRange.filter((round) => !round.received);
    return {
      rounds: open.length,
      amount: open.reduce((sum, round) => sum + round.amount, 0),
      net: open.reduce((sum, round) => sum + round.netProfit, 0),
      overdue: open.filter((round) => isRoundOverdue(round, karachiDayKey())).length,
    };
  }, [inRange]);
  const stillOut = pending.amount;
  const receivedNet = totals.netProfit - pending.net;

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number, of: number) => (of ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
    return [
      {
        // What is with the partner right now. A received round's money is home,
        // so it is not "invested" any more — it was 2,802,000 here with 612,000
        // of it already back (owner, 2026-09-26). The lifetime figure is the note.
        label: "Invested Now", value: money(stillOut),
        note: `${pending.rounds} of ${totals.rounds} round${totals.rounds === 1 ? "" : "s"} out · ${money(totals.amount)} put in, ${money(totals.amount - stillOut)} back`,
        pill: `${pending.rounds} out`, pct: pct(stillOut, totals.amount), color: "#141f1e", accent: "#3f8f8a", icon: ICON.wallet,
      },
      {
        label: "Net Received", value: money(receivedNet),
        note: pending.rounds > 0
          ? `${money(pending.net)} still to come from ${pending.rounds} round${pending.rounds === 1 ? "" : "s"}${pending.overdue ? ` · ${pending.overdue} overdue` : ""}`
          : "every round received",
        pill: `${pct(receivedNet, totals.netProfit)}%`, tone: pending.overdue ? "warn" : "good", pct: pct(receivedNet, totals.netProfit),
        color: "#2f7d78", accent: "#4fa39c", icon: ICON.bars,
      },
      {
        label: "Shares Paid", value: money(totals.totalShares),
        note: (book?.columns ?? []).filter((c) => totals.shares[c.key]).map((c) => c.label).join(", ") || "none yet",
        pill: `${pct(totals.totalShares, totals.profit)}%`, tone: "warn", pct: pct(totals.totalShares, totals.profit),
        color: "#a5762a", accent: "#c99a2e", icon: ICON.user,
      },
      {
        label: "Left To Spend", value: money(balance),
        note: spent > 0 ? `${money(spent)} already paid out` : "nothing paid out of it yet",
        pill: "In hand", tone: balance > 0 ? "good" : "warn", pct: pct(balance, totals.netProfit),
        color: balance < 0 ? "#a8483c" : "#2f7d78", accent: "#4fa39c", icon: ICON.wallet,
      },
    ];
  }, [totals, balance, spent, book, stillOut, pending, receivedNet]);

  const figuresFor = (round: Round): Figure[] => [
    { label: "Amount", value: money(round.amount), strong: true, hint: round.dayKey },
    { label: "From", value: round.funding.length ? fundingNames(round, ledger.accounts) : "—", tone: "muted" },
    { label: "Return", value: round.returnDayKey ?? "—", tone: "muted" },
    { label: "Received", value: round.received ? round.receivedDayKey ?? "Yes" : "Not yet", tone: round.received ? "good" : "warn" },
    { label: "Profit", value: money(round.profit), tone: "ink" },
    { label: "Gross", value: money(round.grossProfit), tone: "muted" },
    ...(book?.columns ?? [])
      .filter((column) => round.shares[column.key])
      .map((column) => ({ label: column.label, value: money(round.shares[column.key]), tone: "warn" as const })),
    { label: "Net profit", value: money(round.netProfit), tone: round.netProfit < 0 ? "bad" : "good", strong: true },
  ];

  const askReceive = (round: Round) => {
    setReceivedOn(karachiDayKey());
    setReceiving(round);
  };
  const confirmReceive = async () => {
    if (!receiving) return;
    const marking = !receiving.received;
    setBusy(true);
    const result = await setInvestmentRoundReceived(await getIdToken(), receiving.id, marking, marking ? receivedOn : null);
    setBusy(false);
    setReceiving(null);
    if (!result.ok) {
      setBanner({ ok: false, text: result.error });
      return;
    }
    const back = receiving.funding.length ? ` ${money(receiving.amount)} back into ${fundingNames(receiving, ledger.accounts)}.` : "";
    setBanner({
      ok: true,
      text: marking
        ? `Received on ${result.data.receivedDayKey} — ${money(result.data.netProfit)} net banked into ${book?.name}.${back}`
        : `Moved back to awaiting — ${money(result.data.netProfit)} taken back out of ${book?.name}.${
            receiving.funding.length ? ` ${money(receiving.amount)} is out with the partner again.` : ""
          }`,
    });
  };

  const askDelete = (round: Round) => setDeleting(round);
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteInvestmentRound(await getIdToken(), deleting.id);
    setBusy(false);
    setDeleting(null);
    setBanner(
      result.ok
        ? {
            ok: true,
            text: `Round deleted, and ${money(result.data.reversed)} taken back out of ${book?.name}.${
              result.data.restored > 0 ? ` ${money(result.data.restored)} put back into the account it came from.` : ""
            }`,
          }
        : { ok: false, text: result.error }
    );
  };

  if (!ready) {
    return <Notice ok={false}>Investment with X is for administrators and HR.</Notice>;
  }

  const shareColumns: SheetColumn<Round>[] = (book?.columns ?? []).map((column) => ({
    key: `share_${column.key}`,
    header: column.label,
    align: "right",
    tone: "expense",
    render: (round) => <Amount value={round.shares[column.key] ?? 0} format={money} />,
    total: <Amount value={listedTotals.shares[column.key] ?? 0} format={money} />,
  }));

  const columns: SheetColumn<Round>[] = [
    { key: "amount", header: "Amount", align: "right", render: (r) => money(r.amount), total: money(listedTotals.amount) },
    {
      key: "from", header: "From",
      render: (r) => r.funding.length
        ? <span style={{ fontWeight: 600, color: X.body }}>{fundingNames(r, ledger.accounts)}</span>
        : <span style={{ color: "#c3d5d3" }}>–</span>,
    },
    { key: "date", header: "Date", render: (r) => r.dayKey },
    { key: "return", header: "Return date", render: (r) => r.returnDayKey ?? <span style={{ color: "#c3d5d3" }}>–</span> },
    {
      key: "received", header: "Received",
      render: (r) => (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
          <ReceivedCell round={r} onToggle={() => askReceive(r)} />
          {r.reinvestedInto.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: X.deep }}>↻ Reinvested</span>}
          {r.reinvestedFrom && <span style={{ fontSize: 11, fontWeight: 600, color: X.faint }}>↻ from a received round</span>}
        </span>
      ),
    },
    { key: "profit", header: "Profit", align: "right", tone: book?.netBasis === "PROFIT" ? "income" : undefined, render: (r) => money(r.profit), total: money(listedTotals.profit) },
    { key: "gross", header: "Gross profit", align: "right", tone: book?.netBasis === "GROSS" ? "income" : undefined, render: (r) => money(r.grossProfit), total: money(listedTotals.grossProfit) },
    ...shareColumns,
    { key: "net", header: "Net profit", align: "right", tone: "net", render: (r) => <Amount value={r.netProfit} dashZero={false} format={money} />, total: money(listedTotals.netProfit) },
    {
      key: "description", header: "Description",
      render: (r) => (
        <span title={r.description ?? ""} style={{ display: "inline-block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom", fontWeight: 500, color: X.body }}>
          {r.description ?? "—"}
        </span>
      ),
    },
    {
      key: "actions", header: "", align: "right",
      render: (r) => (
        <>
          {r.received && <SheetAction label="Reinvest this money" d={REINVEST_ICON} tone="good" onClick={() => setReinvesting(r)} />}
          <SheetAction label="Edit round" d={ICON.edit} onClick={() => setRoundForm({ round: r })} />
          <SheetAction label="Delete round" d={ICON.trash} tone="bad" onClick={() => askDelete(r)} />
        </>
      ),
    },
  ];

  const rowModels: ExpenseRowModel[] = page.items.map((round) => ({
    id: round.id,
    title: `${money(round.amount)} round`,
    meta: [round.dayKey, round.returnDayKey ? `returns ${round.returnDayKey}` : null].filter(Boolean).join(" · "),
    amount: round.amount,
    category: book?.name ?? "Investment",
    status: { label: `${money(round.netProfit)} net`, tone: round.netProfit < 0 ? TONE.bad : TONE.good },
    payment: receivedPill(round),
    notes: round.description ? (
      <div style={{ marginTop: 6, fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{round.description}</div>
    ) : null,
    detail: <FigureStrip figures={figuresFor(round)} isMobile={isMobile} />,
    actions: [
      round.received
        ? { key: "unreceive", label: "Move back to awaiting", shortLabel: "Awaiting", d: ICON.clock, tone: "quiet", onClick: () => askReceive(round) }
        : { key: "receive", label: "Received", d: ICON.check, tone: "good", onClick: () => askReceive(round) },
      ...(round.received ? [{ key: "reinvest", label: "Reinvest", d: REINVEST_ICON, tone: "good" as const, onClick: () => setReinvesting(round) }] : []),
      { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setRoundForm({ round }) },
      { key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => askDelete(round) },
    ],
    onOpen: () => setRoundForm({ round }),
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow={book ? book.name : "Investment with X"}
        figure={money(totals.netProfit)}
        caption={
          book
            ? `net profit · ${money(totals.amount)} put in over ${totals.rounds} round${totals.rounds === 1 ? "" : "s"}${book.partner ? ` · with ${book.partner}` : ""}`
            : "Create a book to start recording rounds"
        }
        isMobile={isMobile}
        tileIcon={INVEST_ICON}
        stats={[
          { label: "OUT NOW", value: stillOut },
          { label: "PROFIT", value: totals.profit },
          { label: "NET", value: totals.netProfit },
        ]}
        mobileAction={
          book
            ? <HeroTile onClick={() => setBookForm({ book })} label="Edit book and columns" d={ICON.tags} />
            : <HeroTile onClick={() => setBookForm({ book: null })} label="New book" d="M12 5v14M5 12h14" />
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <HeroButton onClick={() => setBookForm({ book: null })} icon={<Glyph d="M12 5v14M5 12h14" width={2.4} />}>New book</HeroButton>
            {book && <HeroButton onClick={() => setBookForm({ book })} icon={<Glyph d={ICON.tags} />}>Book &amp; columns</HeroButton>}
            {book && <HeroButton onClick={() => setRoundForm({ round: null })} solid icon={<Glyph d="M12 5v14M5 12h14" width={2.4} />}>Add round</HeroButton>}
          </div>
        }
      >
        {isMobile && book && (
          <PeriodPill from={from} to={to} maxTo={karachiDayKey()} open={showPeriod} label={periodLabel}
            onToggle={() => setShowPeriod((open) => !open)} onFrom={setFrom} onTo={setTo} />
        )}
      </ExpenseHero>

      {books.length > 1 && (
        <ChipRow
          chips={books.map((entry) => ({
            label: entry.name,
            active: entry.id === book?.id,
            pick: () => setPickedBook(entry.id),
          }))}
        />
      )}

      {banner && <Notice ok={banner.ok}>{banner.text}</Notice>}
      {error && <Notice ok={false}>{error}</Notice>}

      {!booksLoading && !book ? (
        <section style={{ background: "#fff", border: `1px dashed ${X.track}`, borderRadius: 18, padding: "36px 22px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: X.ink }}>No investment books yet</div>
          <p style={{ fontSize: 13, color: X.muted, marginTop: 6, maxWidth: 460, marginInline: "auto", lineHeight: 1.6 }}>
            A book is one partner you put money to work with — “Investment with X”. Each round records the amount,
            the return date, the profit and everyone&rsquo;s share; the net profit is banked into the book&rsquo;s own account.
          </p>
          <button type="button" onClick={() => setBookForm({ book: null })} className="acc-press"
            style={{ marginTop: 16, borderRadius: 999, border: "none", background: X.deep, color: "#fff", padding: "11px 22px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Create “Investment with X”
          </button>
        </section>
      ) : book ? (
        <>
          <StatCards isMobile={isMobile} cards={statCards} />

          {isMobile ? (
            <MobileSearch value={search} onChange={setSearch} placeholder="Description, amount or date" />
          ) : (
            <FilterPanel
              from={from} to={to} maxTo={karachiDayKey()} onFrom={setFrom} onTo={setTo}
              periodLabel={periodLabel}
              search={search} onSearch={setSearch}
              onDownload={() => downloadSheet(book, filtered, ledger.accounts)} canDownload={filtered.length > 0}
              selects={[]}
            />
          )}

          {isMobile ? (
            <ExpenseList
              heading="Rounds"
              count={`${filtered.length} of ${inRange.length}`}
              total={listedTotals.netProfit}
              rows={rowModels}
              isMobile
              loading={roundsLoading}
              empty={inRange.length === 0 ? "No rounds yet. Add the first with its amount, dates and profit." : "Nothing matches that search."}
              formatMoney={money}
              pager={<Pager pagination={page} variant="mobile" noun="rounds" />}
            />
          ) : (
            <SheetTable
              title={`${book.name.toUpperCase()}${book.partner ? ` · ${book.partner}` : ""}`}
              aside={
                <span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint }}>
                  Net profit = {NET_BASIS_LABELS[book.netBasis]} − {book.columns.map((c) => c.label).join(" − ") || "nothing"} · click a row to edit
                </span>
              }
              columns={columns}
              rows={filtered}
              rowKey={(round) => round.id}
              onRowClick={(round) => setRoundForm({ round })}
              empty={roundsLoading ? "Loading…" : inRange.length === 0 ? "No rounds yet. Add the first with its amount, dates and profit." : "Nothing matches that search."}
            />
          )}

          {isMobile && <FloatingAdd onClick={() => setRoundForm({ round: null })} label="Add round" />}
        </>
      ) : null}

      {bookForm && (
        <BookForm
          book={bookForm.book}
          hasRounds={bookForm.book ? rawRounds.some((raw) => raw.bookId === bookForm.book!.id) : false}
          getIdToken={getIdToken}
          onClose={() => setBookForm(null)}
          onSaved={(text, id) => {
            setBookForm(null);
            if (id) setPickedBook(id);
            setBanner({ ok: true, text });
          }}
          onDeleted={(text) => {
            setBookForm(null);
            setPickedBook(null);
            setBanner({ ok: true, text });
          }}
        />
      )}

      {reinvesting && book && (
        <ReinvestChooser
          round={reinvesting}
          fromBook={book}
          books={books}
          onClose={() => setReinvesting(null)}
          onContinue={(targetId, withProfit) => {
            const source = reinvesting;
            setReinvesting(null);
            const amount = source.amount + (withProfit ? Math.max(0, source.netProfit) : 0);
            // The capital went back into the account(s) it came from; the net
            // was banked into this book's own account. Reinvesting takes it out
            // of the same places. Unfunded capital leaves the choice to the form.
            const capital = source.funding.map((line) => ({ accountId: line.accountId, amount: String(line.amount) }));
            const funding = withProfit && source.netProfit > 0
              ? capital.length ? [...capital, { accountId: book.accountId, amount: String(source.netProfit) }] : []
              : capital.length === 1 ? [{ accountId: capital[0].accountId, amount: "" }] : capital;
            setRoundForm({
              round: null,
              bookId: targetId,
              prefill: {
                amount,
                funding,
                description: `Reinvested — the ${money(source.amount)} round of ${source.dayKey}${withProfit ? ` plus its ${money(source.netProfit)} net` : ""}`,
                reinvestedFrom: source.id,
              },
            });
          }}
        />
      )}

      {roundForm && book && (
        <RoundForm
          book={books.find((entry) => entry.id === roundForm.bookId) ?? book}
          prefill={roundForm.prefill}
          round={roundForm.round}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          onClose={() => setRoundForm(null)}
          onSaved={(text) => {
            const target = roundForm.bookId;
            setRoundForm(null);
            // A reinvestment into another book: show that book, where it went.
            if (target && target !== book.id) setPickedBook(target);
            setBanner({ ok: true, text });
          }}
          onDelete={roundForm.round ? () => { const r = roundForm.round!; setRoundForm(null); askDelete(r); } : undefined}
        />
      )}

      {deleting && (
        <ConfirmPanel
          title="Delete this round?"
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <strong style={{ color: X.ink }}>{money(deleting.amount)}</strong> put in on {deleting.dayKey}, net profit{" "}
          <strong style={{ color: X.ink }}>{money(deleting.netProfit)}</strong>.
          {deleting.netProfit !== 0 && (
            <> That {deleting.netProfit > 0 ? "profit comes back out of" : "loss is put back into"} {book?.name}&rsquo;s account.</>
          )}
          {deleting.funding.length > 0 && !deleting.received && (
            <> The {money(deleting.amount)} goes back into {fundingNames(deleting, ledger.accounts)}.</>
          )}{" "}
          This cannot be undone.
        </ConfirmPanel>
      )}

      {receiving && (
        <ConfirmPanel
          title={receiving.received ? "Move back to awaiting?" : "Mark this round received?"}
          confirmLabel={receiving.received ? "Move to awaiting" : "Mark received"}
          danger={false}
          busy={busy}
          onCancel={() => setReceiving(null)}
          onConfirm={() => void confirmReceive()}
        >
          {receiving.received ? (
            <>
              The <strong style={{ color: X.ink }}>{money(receiving.netProfit)}</strong> net comes back out of {book?.name}&rsquo;s account
              {receiving.funding.length > 0 && (
                <> and the <strong style={{ color: X.ink }}>{money(receiving.amount)}</strong> is taken back out of {fundingNames(receiving, ledger.accounts)}, as money still with the partner</>
              )}
              . You can mark it received again at any time.
            </>
          ) : (
            <>
              <strong style={{ color: X.ink }}>{money(receiving.netProfit)}</strong> net{" "}
              {receiving.netProfit < 0 ? "comes out of" : "is banked into"} {book?.name} as income
              {receiving.funding.length > 0 ? (
                <>, and the <strong style={{ color: X.ink }}>{money(receiving.amount)}</strong> goes back into {fundingNames(receiving, ledger.accounts)}, ready to use again.</>
              ) : (
                <>.</>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14, fontSize: 12, fontWeight: 700, color: X.muted }}>
                Received on
                <input
                  type="date"
                  value={receivedOn}
                  min={receiving.dayKey}
                  max={karachiDayKey()}
                  onChange={(e) => { const v = e.target.value; setReceivedOn(v); }}
                  style={fieldStyle(isMobile)}
                />
              </label>
            </>
          )}
        </ConfirmPanel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** The received state as a pill: received, awaited, or past its return date. */
function receivedPill(round: Round): { label: string; tone: (typeof TONE)[keyof typeof TONE] } {
  if (round.received) return { label: `Received${round.receivedDayKey ? ` ${round.receivedDayKey}` : ""}`, tone: TONE.good };
  if (isRoundOverdue(round, karachiDayKey())) return { label: "Overdue", tone: TONE.bad };
  return { label: "Awaiting", tone: TONE.warn };
}

/**
 * The sheet's Received cell: the date it came back, or the button that says it
 * has. A button rather than a pill because pressing it is what banks the money.
 */
function ReceivedCell({ round, onToggle }: { round: Round; onToggle: () => void }) {
  const pill = receivedPill(round);
  // A two-way switch, so moving a round back is as plain as moving it forward.
  // The side already lit does nothing; the other side asks to confirm.
  const sides = [
    { on: !round.received, label: round.received ? "Awaiting" : pill.label, d: ICON.clock, tone: round.received ? TONE.warn : pill.tone },
    { on: round.received, label: round.received ? pill.label : "Received", d: ICON.check, tone: TONE.good },
  ];
  return (
    <div
      role="group"
      aria-label="Received"
      onClick={(event) => event.stopPropagation()}
      style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 999, background: "#eef4f3", whiteSpace: "nowrap" }}
    >
      {sides.map((side) => (
        <button
          key={side.d}
          type="button"
          aria-pressed={side.on}
          disabled={side.on}
          onClick={onToggle}
          title={side.on ? undefined : side.d === ICON.check ? "Mark this round received" : "Move this round back to awaiting"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit",
            border: "none", cursor: side.on ? "default" : "pointer",
            background: side.on ? side.tone.tint : "transparent",
            color: side.on ? side.tone.color : "#8a9a98",
            boxShadow: side.on ? "0 1px 2px rgba(20,31,30,0.08)" : "none",
          }}
        >
          <Glyph d={side.d} size={12} width={2.4} />
          {side.label}
        </button>
      ))}
    </div>
  );
}

function downloadSheet(book: InvestmentBook, rounds: Round[], accounts: readonly AccountDoc[]) {
  const header = ["AMOUNT", "FROM", "DATE", "RETURN DATE", "RECEIVED", "PROFIT", "GROSS PROFIT", ...book.columns.map((c) => c.label), "NET PROFIT", "DESCRIPTION"];
  const rows = rounds.map((round) => [
    round.amount, fundingNames(round, accounts), round.dayKey, round.returnDayKey ?? "",
    round.received ? round.receivedDayKey ?? "YES" : "NO", round.profit, round.grossProfit,
    ...book.columns.map((c) => round.shares[c.key] ?? 0), round.netProfit, round.description ?? "",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${book.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Reinvesting                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A received round's money, put back to work (owner, 2026-09-26): into the
 * same book or another, the capital alone or with its net profit. Continuing
 * opens the ordinary round form, filled in — so dates, return date and profit
 * are set and checked exactly as for any round, and nothing moves until it is
 * saved.
 */
function ReinvestChooser({ round, fromBook, books, onClose, onContinue }: {
  round: Round;
  fromBook: InvestmentBook;
  books: InvestmentBook[];
  onClose: () => void;
  onContinue: (bookId: string, withProfit: boolean) => void;
}) {
  const [target, setTarget] = useState(fromBook.id);
  const [withProfit, setWithProfit] = useState(false);
  const total = round.amount + (withProfit ? Math.max(0, round.netProfit) : 0);
  const chip = (active: boolean): React.CSSProperties => ({
    borderRadius: 12, border: `1px solid ${active ? X.deep : X.line}`, background: active ? "#e3f1ef" : "#fff",
    color: active ? X.deep : X.body, padding: "10px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
  });

  return (
    <OverlayPanel
      title="Reinvest this money"
      subtitle={`The ${money(round.amount)} round of ${round.dayKey} · received ${round.receivedDayKey ?? ""}`}
      icon={<Glyph d={REINVEST_ICON} size={18} />}
      maxWidth={520}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => onContinue(target, withProfit)} busy={false} submitLabel={`Continue with ${money(total)}`} />}
    >
      <OverlayCard title="Into which book?">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {books.map((entry) => (
            <button key={entry.id} type="button" aria-pressed={target === entry.id} onClick={() => setTarget(entry.id)} style={chip(target === entry.id)}>
              {entry.name}
              {entry.partner && <span style={{ fontWeight: 500, color: X.faint }}> · {entry.partner}</span>}
              {entry.id === fromBook.id && <span style={{ fontWeight: 500, color: X.faint }}> · same book</span>}
            </button>
          ))}
        </div>
      </OverlayCard>

      <OverlayCard title="How much?">
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, fontWeight: 600, color: X.ink, cursor: "pointer" }}>
          <input type="checkbox" checked={withProfit} disabled={round.netProfit <= 0}
            onChange={(e) => setWithProfit(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, accentColor: X.deep }} />
          <span>
            Add the net profit too ({money(round.netProfit)})
            <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: X.faint, marginTop: 3 }}>
              {money(round.amount)} capital{withProfit ? ` + ${money(round.netProfit)} net = ${money(total)}` : " only"}. You can change the amount on the next screen.
            </span>
          </span>
        </label>
        <p style={{ fontSize: 12, color: X.faint, lineHeight: 1.55, marginTop: 10 }}>
          {round.funding.length
            ? `It is taken from ${round.funding.map((line) => line.accountName ?? "its account").join(", ")}${withProfit ? ` and ${fromBook.name}'s account` : ""} — where the money came back to.`
            : "This round was not taken from an account, so choose where the money comes from on the next screen."}
        </p>
      </OverlayCard>
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* A round                                                                     */
/* -------------------------------------------------------------------------- */

function RoundForm({ book, round, prefill, accounts, balances, getIdToken, onClose, onSaved, onDelete }: {
  book: InvestmentBook;
  round: Round | null;
  /** A reinvestment: the new round starts with the money it comes from. */
  prefill?: RoundPrefill;
  accounts: AccountDoc[];
  balances: Map<string, { balance: number }>;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [form, setForm] = useState({
    amount: round ? String(round.amount) : prefill ? String(prefill.amount) : "",
    dayKey: round?.dayKey ?? karachiDayKey(),
    returnDayKey: round?.returnDayKey ?? "",
    profit: round ? String(round.profit) : "",
    grossProfit: round ? String(round.grossProfit) : "",
    description: round?.description ?? prefill?.description ?? "",
    received: round?.received ?? false,
    receivedDayKey: round?.receivedDayKey ?? karachiDayKey(),
  });
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(book.columns.map((c) => [c.key, round && round.shares[c.key] ? String(round.shares[c.key]) : ""]))
  );
  // Gross follows profit until somebody types a different gross.
  const [grossTouched, setGrossTouched] = useState(Boolean(round && round.grossProfit !== round.profit));
  // Amounts are only typed once the money is split; one account takes it all.
  const [lines, setLines] = useState<Array<{ accountId: string; amount: string }>>(
    round && round.funding.length
      ? round.funding.map((line) => ({ accountId: line.accountId, amount: round.funding.length > 1 ? String(line.amount) : "" }))
      : prefill && prefill.funding.length
        ? prefill.funding
        : [{ accountId: "", amount: "" }]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const funding = checkRoundFunding(parseAmount(form.amount), lines);
  const fundingError = parseAmount(form.amount) > 0 ? funding.errors[0] ?? null : null;
  const split = lines.length > 1;

  /** Open accounts, plus any already on this round, grouped by kind. */
  const groups = useMemo(() => {
    const onRound = new Set(round?.funding.map((line) => line.accountId) ?? []);
    const usable = accounts.filter((account) => account.status !== "ARCHIVED" || onRound.has(account.id));
    return KIND_ORDER.map((kind) => ({
      kind,
      // A kind this list does not know is shown under Other rather than dropped.
      accounts: usable.filter((account) => (KIND_ORDER.includes(account.kind) ? account.kind : "OTHER") === kind),
    })).filter((group) => group.accounts.length > 0);
  }, [accounts, round]);
  const missing = (round?.funding ?? []).filter((line) => !accounts.some((account) => account.id === line.accountId));

  const nameOf = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.name
    ?? round?.funding.find((line) => line.accountId === accountId)?.accountName
    ?? "A deleted account";

  const setLine = (index: number, patch: Partial<{ accountId: string; amount: string }>) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const gross = grossTouched ? form.grossProfit : form.profit;
  const preview = calculateRound(
    { amount: parseAmount(form.amount), profit: parseAmount(form.profit), grossProfit: parseAmount(gross), shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, parseAmount(v)])) },
    book.columns,
    book.netBasis
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveInvestmentRound(
        await getIdToken(),
        {
          bookId: book.id,
          amount: parseAmount(form.amount),
          dayKey: form.dayKey,
          returnDayKey: form.returnDayKey || null,
          profit: parseAmount(form.profit),
          grossProfit: parseAmount(gross),
          shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, parseAmount(v)])),
          description: form.description,
          funding: lines,
          received: form.received,
          receivedDayKey: form.received ? form.receivedDayKey : null,
          reinvestedFrom: round ? null : prefill?.reinvestedFrom ?? null,
        },
        round?.id
      );
      if (result.ok) {
        const from = funding.lines.map((line) => nameOf(line.accountId)).join(", ");
        const net = formatMoney(result.data.netProfit);
        onSaved(
          result.data.received
            ? `${round ? "Round updated" : "Round added"} — received, ${net} net ${result.data.netProfit < 0 ? "taken out of" : "banked into"} ${book.name}.${
                from ? ` ${formatMoney(parseAmount(form.amount))} taken from and back into ${from}.` : ""
              }`
            : `${round ? "Round updated" : "Round added"} — ${net} net expected, banked once you mark it received.${
                from ? ` ${formatMoney(parseAmount(form.amount))} taken from ${from} until then.` : ""
              }`
        );
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel
      title={round ? "Edit round" : prefill ? "Reinvest" : "Add round"}
      subtitle={prefill ? `A new round in ${book.name}` : book.name}
      icon={<Glyph d={INVEST_ICON} size={18} />}
      maxWidth={640}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={Boolean(fundingError)}
          submitLabel={round ? "Save round" : prefill ? "Reinvest" : "Add round"}
          left={
            <span style={{ fontSize: 12.5, fontWeight: 700, color: preview.netProfit < 0 ? "#a8483c" : X.deep }}>
              Net {formatMoney(preview.netProfit)}
            </span>
          }
        />
      }
    >
      <OverlayCard title="The round">
        <FormGrid isMobile={isMobile}>
          <Field label="Amount">
            <input inputMode="decimal" value={form.amount} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, amount: v })); }} placeholder="350,000" style={field} />
          </Field>
          <Field label="Date">
            <input type="date" value={form.dayKey} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, dayKey: v })); }} style={field} />
          </Field>
          <Field label="Return date" hint="When the money and profit are expected back. Nothing moves until the round is marked received.">
            <input type="date" value={form.returnDayKey} min={form.dayKey} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, returnDayKey: v })); }} style={field} />
          </Field>
          <Field label="Received" hint={form.received ? "The net is banked and the amount goes back into its account on this date." : "Tick once the partner has actually paid back."}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: X.ink, cursor: "pointer", flexShrink: 0 }}>
                <input type="checkbox" checked={form.received}
                  onChange={(e) => { const v = e.target.checked; setForm((f) => ({ ...f, received: v })); }}
                  style={{ width: 18, height: 18, accentColor: X.deep }} />
                Received
              </label>
              {form.received && (
                <input type="date" aria-label="Received on" value={form.receivedDayKey} min={form.dayKey} max={karachiDayKey()}
                  onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, receivedDayKey: v })); }} style={{ ...field, flex: 1, minWidth: 0 }} />
              )}
            </div>
          </Field>
          <Field label="Profit">
            <input inputMode="decimal" value={form.profit} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, profit: v })); }} placeholder="82,000" style={field} />
          </Field>
          <Field label="Gross profit" hint={grossTouched ? undefined : "Same as profit until you type a different figure."}>
            <input inputMode="decimal" value={gross} onChange={(e) => { const v = e.target.value; setGrossTouched(true); setForm((f) => ({ ...f, grossProfit: v })); }} style={field} />
          </Field>
        </FormGrid>
      </OverlayCard>

      <OverlayCard title="Taken from" hint="Leaves the account on the date, goes back in when the round is received">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((line, index) => (
            <div key={index} style={{ display: "grid", gap: 8, alignItems: "center", gridTemplateColumns: split ? `minmax(0, 1fr) ${isMobile ? 112 : 140}px 38px` : "minmax(0, 1fr)" }}>
              <select
                aria-label={split ? `Account ${index + 1}` : "Account"}
                value={line.accountId}
                onChange={(e) => { const v = e.target.value; setLine(index, { accountId: v }); }}
                style={{ ...field, cursor: "pointer" }}
              >
                <option value="">{split ? "Choose an account…" : "Not taken from an account"}</option>
                {groups.map((group) => (
                  <optgroup key={group.kind} label={group.kind === "INVESTMENT" ? "Capital Investment" : ACCOUNT_KIND_LABELS[group.kind]}>
                    {group.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {formatMoney(balances.get(account.id)?.balance ?? 0)}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {missing.map((line) => (
                  <option key={line.accountId} value={line.accountId}>{line.accountName ?? "A deleted account"} (deleted)</option>
                ))}
              </select>
              {split && (
                <>
                  <input inputMode="decimal" aria-label={`Amount from account ${index + 1}`} value={line.amount} placeholder="Amount"
                    onChange={(e) => { const v = e.target.value; setLine(index, { amount: v }); }} style={field} />
                  <button type="button" aria-label="Remove this account"
                    onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                    style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Glyph d={ICON.cross} size={14} />
                  </button>
                </>
              )}
            </div>
          ))}

          {lines[0]?.accountId && (
            <button type="button"
              onClick={() => setLines((rows) => [
                // Splitting starts the first line at the whole amount, so only the
                // second figure has to be taken off it.
                ...rows.map((row, i) => (i === 0 && rows.length === 1 && !row.amount ? { ...row, amount: form.amount } : row)),
                { accountId: "", amount: "" },
              ])}
              style={{ alignSelf: isMobile ? "stretch" : "flex-start", borderRadius: 11, border: `1px dashed ${X.track}`, background: "transparent", padding: "9px 14px", fontSize: 12.5, fontWeight: 700, color: X.deep, cursor: "pointer", fontFamily: "inherit" }}>
              + Split across another account
            </button>
          )}
        </div>

        <div style={{ marginTop: 12, padding: "11px 13px", borderRadius: 12, fontSize: 12.5, fontWeight: 600, lineHeight: 1.5,
          background: fundingError ? "#fdeeec" : funding.lines.length ? "#eef7f5" : "#f4f7f7",
          color: fundingError ? "#a8483c" : funding.lines.length ? X.darkest : X.muted }}>
          {fundingError
            ? fundingError
            : funding.lines.length === 0
              ? "Not taken from any account — the amount is a figure on the sheet only."
              : <>
                  {formatMoney(parseAmount(form.amount))} leaves {funding.lines.map((l) => nameOf(l.accountId)).join(" and ")} on {form.dayKey || "the date"}
                  {form.received
                    ? ` and goes back in on ${form.receivedDayKey || "the received date"}.`
                    : " and stays out until the round is marked received."}
                </>}
        </div>
      </OverlayCard>

      <OverlayCard title="Shares" hint={`Each comes off ${NET_BASIS_LABELS[book.netBasis].toLowerCase()} before the net`}>
        {book.columns.length === 0 ? (
          <p style={{ fontSize: 12.5, color: X.faint }}>This book has no share columns. Add them under Book &amp; columns.</p>
        ) : (
          <FormGrid isMobile={isMobile}>
            {book.columns.map((column) => (
              <Field key={column.key} label={column.label}>
                <input inputMode="decimal" value={shares[column.key] ?? ""} placeholder="–"
                  onChange={(e) => { const v = e.target.value; setShares((s) => ({ ...s, [column.key]: v })); }} style={field} />
              </Field>
            ))}
          </FormGrid>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12, padding: "11px 13px", borderRadius: 12, background: preview.netProfit < 0 ? "#fdeeec" : "#eef7f5", fontSize: 13, fontWeight: 700 }}>
          <span style={{ color: X.muted }}>
            {formatMoney(preview.base)} − {formatMoney(preview.totalShares)} shares
          </span>
          <span style={{ color: preview.netProfit < 0 ? "#a8483c" : X.darkest, fontVariantNumeric: "tabular-nums" }}>
            = {formatMoney(preview.netProfit)} net
          </span>
        </div>
      </OverlayCard>

      <OverlayCard title="Description">
        <textarea rows={3} value={form.description} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, description: v })); }}
          placeholder="Where the net went — “18.5 investor + 5k added to income khata”" style={{ ...field, resize: "vertical" }} />
      </OverlayCard>

      <FormError text={error} />
      {onDelete && (
        <button type="button" onClick={onDelete}
          style={{ alignSelf: "flex-start", borderRadius: 10, border: "1px solid #f0dcd8", background: "#fff", color: "#a8483c", padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          Delete this round
        </button>
      )}
    </OverlayPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* A book and its columns                                                      */
/* -------------------------------------------------------------------------- */

function BookForm({ book, hasRounds, getIdToken, onClose, onSaved, onDeleted }: {
  book: InvestmentBook | null;
  hasRounds: boolean;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string, bookId?: string) => void;
  onDeleted: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [name, setName] = useState(book?.name ?? "Investment with X");
  const [partner, setPartner] = useState(book?.partner ?? "");
  const [netBasis, setNetBasis] = useState<NetBasis>(book?.netBasis ?? "PROFIT");
  const [description, setDescription] = useState(book?.description ?? "");
  const [columns, setColumns] = useState<Array<{ key?: string; label: string }>>(
    book ? book.columns.map((c) => ({ ...c })) : [
      { label: "AARYJ" }, { label: "INVESTOR" }, { label: "CC" }, { label: "ALI" }, { label: "MISC" },
    ]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveInvestmentBook(await getIdToken(), { name, partner, netBasis, description, columns }, book?.id);
      if (result.ok) {
        onSaved(
          book
            ? `${name} saved.${result.data.reposted ? ` ${result.data.reposted} round${result.data.reposted === 1 ? "" : "s"} re-banked with the new net profit.` : ""}`
            : `${name} created. Add its first round.`,
          result.data.bookId
        );
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!book) return;
    setBusy(true);
    const result = await deleteInvestmentBook(await getIdToken(), book.id);
    setBusy(false);
    if (result.ok) onDeleted(`${book.name} deleted.`);
    else setError(result.error);
  };

  return (
    <OverlayPanel
      title={book ? "Book & columns" : "New investment book"}
      subtitle="Everything here can be changed later"
      icon={<Glyph d={ICON.tags} size={18} />}
      maxWidth={600}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={book ? "Save" : "Create book"}
          left={
            book && !hasRounds ? (
              <button type="button" onClick={() => void remove()} disabled={busy}
                style={{ borderRadius: 10, border: "1px solid #f0dcd8", background: "#fff", color: "#a8483c", padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Delete book
              </button>
            ) : null
          }
        />
      }
    >
      <OverlayCard title="Book">
        <FormGrid isMobile={isMobile}>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} style={field} /></Field>
          <Field label="Partner" hint="Who the money is with."><input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="X" style={field} /></Field>
          <Field label="Net profit is taken from" wide hint={book && hasRounds ? "Changing this re-banks every round in the book." : undefined}>
            <select value={netBasis} onChange={(e) => setNetBasis(e.target.value as NetBasis)} style={{ ...field, cursor: "pointer" }}>
              <option value="PROFIT">Profit − shares (as the sheet does)</option>
              <option value="GROSS">Gross profit − shares</option>
            </select>
          </Field>
          <Field label="Description" wide>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" style={field} />
          </Field>
        </FormGrid>
      </OverlayCard>

      <OverlayCard title="Share columns" hint="Who takes a cut before the net — rename, add or remove">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {columns.map((column, index) => (
            <div key={column.key ?? `new-${index}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={column.label} aria-label={`Column ${index + 1}`}
                onChange={(e) => { const v = e.target.value; setColumns((rows) => rows.map((r, i) => (i === index ? { ...r, label: v } : r))); }}
                style={{ ...field, flex: 1 }} />
              <button type="button" aria-label={`Remove ${column.label || "column"}`}
                onClick={() => setColumns((rows) => rows.filter((_, i) => i !== index))}
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Glyph d={ICON.cross} size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setColumns((rows) => [...rows, { label: "" }])}
            style={{ alignSelf: isMobile ? "stretch" : "flex-start", borderRadius: 11, border: `1px dashed ${X.track}`, background: "transparent", padding: "10px 14px", fontSize: 13, fontWeight: 700, color: X.deep, cursor: "pointer", fontFamily: "inherit" }}>
            + Add column
          </button>
        </div>
      </OverlayCard>

      <FormError text={error} />
    </OverlayPanel>
  );
}
