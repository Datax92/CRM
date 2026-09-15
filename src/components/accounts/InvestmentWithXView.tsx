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
 */

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLedger } from "@/hooks/useLedger";
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
  parseAmount,
  type NetBasis,
  type RoundFigures,
} from "@/lib/investmentWithX";
import {
  saveInvestmentBook,
  deleteInvestmentBook,
  saveInvestmentRound,
  deleteInvestmentRound,
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

interface Round extends RoundFigures {
  id: string;
  bookId: string;
  dayKey: string;
  returnDayKey: string | null;
  description: string | null;
}

const money = (n: number) => formatMoney(n);

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
  const [roundForm, setRoundForm] = useState<{ round: Round | null } | null>(null);
  const [deleting, setDeleting] = useState<Round | null>(null);
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

  const statCards = useMemo<StatCard[]>(() => {
    const pct = (n: number, of: number) => (of ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
    return [
      {
        label: "Invested", value: money(totals.amount),
        note: `${totals.rounds} round${totals.rounds === 1 ? "" : "s"}`,
        pill: `${totals.rounds}`, pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: ICON.wallet,
      },
      {
        label: "Profit", value: money(totals.profit),
        note: `${money(totals.grossProfit)} gross`,
        pill: `${pct(totals.profit, totals.amount)}%`, tone: "good", pct: pct(totals.profit, totals.amount),
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
  }, [totals, balance, spent, book]);

  const figuresFor = (round: Round): Figure[] => [
    { label: "Amount", value: money(round.amount), strong: true, hint: round.dayKey },
    { label: "Return", value: round.returnDayKey ?? "—", tone: "muted" },
    { label: "Profit", value: money(round.profit), tone: "ink" },
    { label: "Gross", value: money(round.grossProfit), tone: "muted" },
    ...(book?.columns ?? [])
      .filter((column) => round.shares[column.key])
      .map((column) => ({ label: column.label, value: money(round.shares[column.key]), tone: "warn" as const })),
    { label: "Net profit", value: money(round.netProfit), tone: round.netProfit < 0 ? "bad" : "good", strong: true },
  ];

  const askDelete = (round: Round) => setDeleting(round);
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteInvestmentRound(await getIdToken(), deleting.id);
    setBusy(false);
    setDeleting(null);
    setBanner(
      result.ok
        ? { ok: true, text: `Round deleted, and ${money(result.data.reversed)} taken back out of ${book?.name}.` }
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
    { key: "date", header: "Date", render: (r) => r.dayKey },
    { key: "return", header: "Return date", render: (r) => r.returnDayKey ?? <span style={{ color: "#c3d5d3" }}>–</span> },
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
    payment: null,
    notes: round.description ? (
      <div style={{ marginTop: 6, fontSize: 11.5, color: X.faint, fontWeight: 500 }}>{round.description}</div>
    ) : null,
    detail: <FigureStrip figures={figuresFor(round)} isMobile={isMobile} />,
    actions: [
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
          { label: "INVESTED", value: totals.amount },
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
              onDownload={() => downloadSheet(book, filtered)} canDownload={filtered.length > 0}
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

      {roundForm && book && (
        <RoundForm
          book={book}
          round={roundForm.round}
          getIdToken={getIdToken}
          onClose={() => setRoundForm(null)}
          onSaved={(text) => {
            setRoundForm(null);
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
          )}{" "}
          This cannot be undone.
        </ConfirmPanel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function downloadSheet(book: InvestmentBook, rounds: Round[]) {
  const header = ["AMOUNT", "DATE", "RETURN DATE", "PROFIT", "GROSS PROFIT", ...book.columns.map((c) => c.label), "NET PROFIT", "DESCRIPTION"];
  const rows = rounds.map((round) => [
    round.amount, round.dayKey, round.returnDayKey ?? "", round.profit, round.grossProfit,
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
/* A round                                                                     */
/* -------------------------------------------------------------------------- */

function RoundForm({ book, round, getIdToken, onClose, onSaved, onDelete }: {
  book: InvestmentBook;
  round: Round | null;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [form, setForm] = useState({
    amount: round ? String(round.amount) : "",
    dayKey: round?.dayKey ?? karachiDayKey(),
    returnDayKey: round?.returnDayKey ?? "",
    profit: round ? String(round.profit) : "",
    grossProfit: round ? String(round.grossProfit) : "",
    description: round?.description ?? "",
  });
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(book.columns.map((c) => [c.key, round && round.shares[c.key] ? String(round.shares[c.key]) : ""]))
  );
  // Gross follows profit until somebody types a different gross.
  const [grossTouched, setGrossTouched] = useState(Boolean(round && round.grossProfit !== round.profit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        },
        round?.id
      );
      if (result.ok) {
        onSaved(
          `${round ? "Round updated" : "Round added"} — ${formatMoney(result.data.netProfit)} net ${result.data.netProfit < 0 ? "taken out of" : "banked into"} ${book.name}.`
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
      title={round ? "Edit round" : "Add round"}
      subtitle={book.name}
      icon={<Glyph d={INVEST_ICON} size={18} />}
      maxWidth={640}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel={round ? "Save round" : "Add round"}
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
          <Field label="Return date" hint="When the profit comes back. The net is banked on this date.">
            <input type="date" value={form.returnDayKey} min={form.dayKey} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, returnDayKey: v })); }} style={field} />
          </Field>
          <div />
          <Field label="Profit">
            <input inputMode="decimal" value={form.profit} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, profit: v })); }} placeholder="82,000" style={field} />
          </Field>
          <Field label="Gross profit" hint={grossTouched ? undefined : "Same as profit until you type a different figure."}>
            <input inputMode="decimal" value={gross} onChange={(e) => { const v = e.target.value; setGrossTouched(true); setForm((f) => ({ ...f, grossProfit: v })); }} style={field} />
          </Field>
        </FormGrid>
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
