"use client";

/**
 * Mahziyar Group Income — the year, month by month.
 *
 * The owner's `MAHZIYAR 2026 PERFORMANCE` sheet: `MONTH | TOTAL INCOME |
 * PERSONAL EXPENCE | OFFICE EXPENCE | COMMITTEE / KIST | INVESTOR | DADDY MEDIA
 * | MISC / PLOT / TOUR | TOTAL EXPENCE | REMAINING | DESCRIPTION`, with a TOTAL
 * row. The difference is that **it fills itself**: Total Income is every income
 * account's money for the month, Personal and Office come from their modules,
 * and the rest are the lines added to each month in Group Expense.
 *
 * **Every cell is editable.** Clicking one shows what the records say and lets a
 * different figure be typed over it; the cell then carries a mark, and a reset
 * gives the automatic value back. The description is typed straight in.
 * **Fields can be added** — any number of income or spending columns — under
 * Columns. A closed month shows its frozen figures and a lock.
 *
 * Same computation as Group Expense (`useGroupFigures`), so a month reads the
 * same on both screens.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGroupFigures, type GroupMonthView } from "@/hooks/useGroupFigures";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { karachiMonthKey } from "@/lib/dates";
import { monthLabel, monthName, type ColumnValue } from "@/lib/groupFinance";
import { setGroupCell, setGroupDescription } from "@/lib/clientActions";
import {
  ExpenseHero,
  ExpenseList,
  FigureStrip,
  HeroButton,
  HeroTile,
  ICON,
  StatCards,
  TONE,
  X,
  type ExpenseRowModel,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { SheetTable, type SheetColumn } from "./SheetTable";
import { GroupFieldsEditor } from "./GroupFieldsEditor";
import { Field, FooterButtons, FormError, Glyph, Notice, fieldStyle } from "./sheetForms";

const money = (n: number) => formatMoney(n);
const LOCK = "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z";
const PERF_ICON = "M4 16l5-5 4 3 7-8M15 6h6v6";

export function GroupIncomeView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin";
  const isMobile = useIsMobile();
  const router = useRouter();

  const [year, setYear] = useState(Number(karachiMonthKey().slice(0, 4)));
  const group = useGroupFigures(year, ready);
  const [cell, setCell] = useState<{ month: GroupMonthView; column: ColumnValue } | null>(null);
  const [describing, setDescribing] = useState<GroupMonthView | null>(null);
  const [openedMonth, setOpenedMonth] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const columnDefs = group.months[0]?.figures.columns ?? [];
  const currentMonth = karachiMonthKey();

  const yearTotals = useMemo(() => {
    const byColumn: Record<string, number> = {};
    let income = 0;
    let spent = 0;
    for (const month of group.months) {
      income += month.shown.income;
      spent += month.shown.spent;
      for (const column of month.figures.columns) {
        byColumn[column.key] = (byColumn[column.key] ?? 0) + month.shown.column(column.key);
      }
    }
    return { income, spent, remaining: income - spent, byColumn };
  }, [group.months]);

  if (!ready) return <Notice ok={false}>Mahziyar Group Income is for the administrator.</Notice>;

  const closedCount = group.months.filter((month) => month.doc?.status === "CLOSED").length;
  const best = [...group.months].sort((a, b) => b.shown.remaining - a.shown.remaining)[0];

  const statCards: StatCard[] = [
    { label: "Made", value: money(yearTotals.income), note: `${year}, every income account`, pill: `${year}`, tone: "good", pct: 100, color: "#2f7d78", accent: "#4fa39c", icon: ICON.bars },
    {
      label: "Spent", value: money(yearTotals.spent), note: "office, personal and every field",
      pill: yearTotals.income ? `${Math.round((yearTotals.spent / yearTotals.income) * 100)}%` : null, tone: "warn",
      pct: yearTotals.income ? Math.min(100, Math.round((yearTotals.spent / yearTotals.income) * 100)) : 0,
      color: "#a5762a", accent: "#c99a2e", icon: ICON.receipt,
    },
    {
      label: "Remaining", value: money(yearTotals.remaining),
      note: best && best.shown.remaining > 0 ? `best month ${monthName(best.monthKey)}` : "made minus spent",
      pill: `${closedCount}/12 closed`, tone: yearTotals.remaining < 0 ? "bad" : "good",
      pct: Math.round((closedCount / 12) * 100),
      color: yearTotals.remaining < 0 ? "#a8483c" : "#1f5c58", accent: "#2f7d78", icon: ICON.wallet,
    },
  ];

  const editableCell = (month: GroupMonthView, column: ColumnValue) => {
    const closed = month.doc?.status === "CLOSED";
    const value = month.shown.column(column.key);
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (closed) setBanner({ ok: false, text: `${monthLabel(month.monthKey)} is closed. Reopen it in Group Expense to change its figures.` });
          else setCell({ month, column });
        }}
        title={column.overridden ? `Edited — the records say ${money(column.auto)}` : "Click to edit"}
        style={{
          border: "none", background: "transparent", padding: 0, font: "inherit", color: "inherit",
          cursor: closed ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        {column.overridden && !closed && <span style={{ fontSize: 9, fontWeight: 900, color: "#a5762a" }}>✎</span>}
        {value ? money(value) : <span style={{ color: "#c3d5d3" }}>–</span>}
      </button>
    );
  };

  const sheetColumns: SheetColumn<GroupMonthView>[] = [
    {
      key: "month", header: "Month",
      render: (month) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {month.doc?.status === "CLOSED" && <span style={{ color: X.deep }} title="Closed"><Glyph d={LOCK} size={12} /></span>}
          <span style={{ fontWeight: month.monthKey === currentMonth ? 900 : 700 }}>{monthName(month.monthKey).toUpperCase()}</span>
        </span>
      ),
    },
    ...columnDefs.map<SheetColumn<GroupMonthView>>((definition) => ({
      key: definition.key,
      header: definition.label,
      align: "right",
      tone: definition.type === "INCOME" ? "income" : "expense",
      render: (month) => editableCell(month, month.figures.columns.find((c) => c.key === definition.key)!),
      total: money(yearTotals.byColumn[definition.key] ?? 0),
    })),
    {
      key: "totalExpense", header: "Total expense", align: "right", tone: "expense",
      render: (month) => (month.shown.spent ? money(month.shown.spent) : <span style={{ color: "#c3d5d3" }}>–</span>),
      total: money(yearTotals.spent),
    },
    {
      key: "remaining", header: "Remaining", align: "right", tone: "net",
      render: (month) => (month.shown.income || month.shown.spent ? <span style={{ color: month.shown.remaining < 0 ? "#a8483c" : undefined }}>{money(month.shown.remaining)}</span> : <span style={{ color: "#c3d5d3" }}>–</span>),
      total: money(yearTotals.remaining),
    },
    {
      key: "description", header: "Description",
      render: (month) => (
        <button type="button"
          onClick={(event) => { event.stopPropagation(); if (month.doc?.status !== "CLOSED") setDescribing(month); }}
          style={{ border: "none", background: "transparent", padding: 0, font: "inherit", textAlign: "left", cursor: month.doc?.status === "CLOSED" ? "default" : "pointer", color: month.doc?.description ? X.body : "#c3d5d3", fontWeight: 500, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {month.doc?.description ?? "Add a note"}
        </button>
      ),
    },
  ];

  const cards: ExpenseRowModel[] = group.months.map((month) => {
    const closed = month.doc?.status === "CLOSED";
    return {
      id: month.monthKey,
      title: monthLabel(month.monthKey),
      meta: [closed ? "Closed" : month.monthKey === currentMonth ? "This month" : month.monthKey < currentMonth ? "Open" : "Upcoming", month.doc?.description].filter(Boolean).join(" · "),
      amount: month.shown.remaining,
      category: "Remaining",
      status: closed ? { label: "Closed", tone: TONE.good } : { label: `${money(month.shown.income)} made`, tone: TONE.quiet },
      payment: null,
      detail: (
        <FigureStrip
          isMobile
          figures={[
            ...month.figures.columns
              .filter((column) => month.shown.column(column.key) !== 0)
              .map((column) => ({ label: column.label, value: money(month.shown.column(column.key)), tone: (column.type === "INCOME" ? "good" : "warn") as "good" | "warn", hint: column.overridden ? "edited" : null })),
            { label: "Total expense", value: money(month.shown.spent), tone: "warn" as const },
            { label: "Remaining", value: money(month.shown.remaining), tone: (month.shown.remaining < 0 ? "bad" : "good") as "bad" | "good", strong: true },
          ]}
        />
      ),
      actions: [],
      onOpen: () => setOpenedMonth(month.monthKey),
    };
  });

  const opened = openedMonth ? group.months.find((month) => month.monthKey === openedMonth) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow={`Mahziyar ${year} Performance`}
        figure={money(yearTotals.remaining)}
        caption={`remaining · made ${money(yearTotals.income)}, spent ${money(yearTotals.spent)}`}
        isMobile={isMobile}
        tileIcon={PERF_ICON}
        stats={[
          { label: "MADE", value: yearTotals.income },
          { label: "SPENT", value: yearTotals.spent },
          { label: "LEFT", value: yearTotals.remaining },
        ]}
        mobileAction={<HeroTile onClick={() => setEditingFields(true)} label="Sheet columns" d={ICON.tags} />}
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <HeroButton onClick={() => setEditingFields(true)} icon={<Glyph d={ICON.tags} />}>Columns &amp; fields</HeroButton>
            <HeroButton onClick={() => router.push(`/admin/accounts/group-expense?month=${currentMonth}`)} solid icon={<Glyph d={ICON.receipt} />}>This month&rsquo;s expense sheet</HeroButton>
          </div>
        }
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} style={glass}>‹</button>
          <span style={{ ...glass, width: "auto", padding: "0 16px", fontSize: 14 }}>{year}</span>
          <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)} style={glass}>›</button>
        </div>
      </ExpenseHero>

      {banner && <Notice ok={banner.ok}>{banner.text}</Notice>}
      {group.error && <Notice ok={false}>{group.error}</Notice>}

      <StatCards isMobile={isMobile} cards={statCards} />

      {isMobile ? (
        <ExpenseList
          heading={`${year} by month`}
          count="12 months"
          total={yearTotals.remaining}
          rows={cards}
          isMobile
          loading={group.loading}
          empty="Nothing recorded this year."
          formatMoney={money}
        />
      ) : (
        <SheetTable
          title={`Mahziyar ${year} performance`}
          aside={<span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint }}>Filled from the accounts · click any figure to edit it · click a month to open its sheet</span>}
          columns={sheetColumns}
          rows={group.months}
          rowKey={(month) => month.monthKey}
          onRowClick={(month) => router.push(`/admin/accounts/group-expense?month=${month.monthKey}`)}
          rowStyle={(month) => (month.monthKey > currentMonth && !month.shown.income && !month.shown.spent ? { opacity: 0.6 } : undefined)}
          empty="Loading…"
        />
      )}

      {cell && (
        <CellEditor
          month={cell.month}
          column={cell.column}
          getIdToken={getIdToken}
          onClose={() => setCell(null)}
          onSaved={(text) => { setCell(null); setBanner({ ok: true, text }); }}
        />
      )}

      {describing && (
        <DescriptionEditor
          month={describing}
          getIdToken={getIdToken}
          onClose={() => setDescribing(null)}
          onSaved={(text) => { setDescribing(null); setBanner({ ok: true, text }); }}
        />
      )}

      {opened && (
        <OverlayPanel title={monthLabel(opened.monthKey)} subtitle={opened.doc?.status === "CLOSED" ? "Closed — figures frozen" : "Tap a figure to edit it"} maxWidth={520} onClose={() => setOpenedMonth(null)}
          footer={
            <button type="button" onClick={() => router.push(`/admin/accounts/group-expense?month=${opened.monthKey}`)}
              style={{ width: "100%", borderRadius: 999, border: "none", background: X.deep, color: "#fff", padding: "12px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Open the month&rsquo;s expense sheet
            </button>
          }>
          <OverlayCard title="Columns">
            {opened.figures.columns.map((column) => (
              <button key={column.key} type="button"
                onClick={() => {
                  if (opened.doc?.status === "CLOSED") return;
                  setOpenedMonth(null);
                  setCell({ month: opened, column });
                }}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 2px", border: "none", borderBottom: `1px solid ${X.rowLine}`, background: "transparent", fontFamily: "inherit", cursor: opened.doc?.status === "CLOSED" ? "default" : "pointer" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: X.ink, textAlign: "left" }}>
                  {column.label}
                  {column.overridden && <span style={{ marginLeft: 6, fontSize: 11, color: "#a5762a" }}>edited</span>}
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: column.type === "INCOME" ? X.deep : "#8a6321", fontVariantNumeric: "tabular-nums" }}>
                  {money(opened.shown.column(column.key))}
                </span>
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 2px 2px", fontSize: 15, fontWeight: 800 }}>
              <span style={{ color: X.ink }}>Remaining</span>
              <span style={{ color: opened.shown.remaining < 0 ? "#a8483c" : X.darkest, fontVariantNumeric: "tabular-nums" }}>{money(opened.shown.remaining)}</span>
            </div>
          </OverlayCard>
          {opened.doc?.status !== "CLOSED" && (
            <button type="button" onClick={() => { setOpenedMonth(null); setDescribing(opened); }}
              style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: X.deep, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
              {opened.doc?.description ? `Note: ${opened.doc.description}` : "+ Add a note to this month"}
            </button>
          )}
        </OverlayPanel>
      )}

      {editingFields && (
        <GroupFieldsEditor
          fields={group.fields}
          labels={group.labels}
          getIdToken={getIdToken}
          onClose={() => setEditingFields(false)}
          onSaved={(text) => { setEditingFields(false); setBanner({ ok: true, text }); }}
        />
      )}
    </div>
  );
}

const glass: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)",
  background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 18, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
};

function CellEditor({ month, column, getIdToken, onClose, onSaved }: {
  month: GroupMonthView;
  column: ColumnValue;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [value, setValue] = useState(String(column.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = Number(String(value).replace(/[,\s]/g, ""));

  const save = async (next: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setGroupCell(await getIdToken(), month.monthKey, column.key, next);
      if (result.ok) {
        onSaved(next === null ? `${column.label} for ${monthLabel(month.monthKey)} is automatic again.` : `${column.label} for ${monthLabel(month.monthKey)} set to ${formatMoney(next)}.`);
      } else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const source =
    column.key === "income"
      ? "every income account's money this month"
      : column.key === "office"
        ? "approved office expenses this month"
        : column.key === "personal"
          ? "personal expenses this month"
          : "the lines added to this field in Group Expense";

  return (
    <OverlayPanel
      title={column.label}
      subtitle={monthLabel(month.monthKey)}
      maxWidth={440}
      onClose={onClose}
      footer={
        <FooterButtons onCancel={onClose} onSubmit={() => void save(typed)} busy={busy} submitLabel="Save" disabled={!Number.isFinite(typed)}
          left={column.overridden ? (
            <button type="button" onClick={() => void save(null)} disabled={busy}
              style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.deep, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Use {formatMoney(column.auto)}
            </button>
          ) : null} />
      }
    >
      <p style={{ fontSize: 13, color: X.muted, lineHeight: 1.55 }}>
        The records say <strong style={{ color: X.ink }}>{formatMoney(column.auto)}</strong> — {source}. Type a different figure to use
        on the sheet instead; the records themselves are not changed.
      </p>
      <Field label="Figure on the sheet">
        <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={fieldStyle(isMobile)} />
      </Field>
      <FormError text={error} />
    </OverlayPanel>
  );
}

function DescriptionEditor({ month, getIdToken, onClose, onSaved }: {
  month: GroupMonthView;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const [text, setText] = useState(month.doc?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setGroupDescription(await getIdToken(), month.monthKey, text);
      if (result.ok) onSaved(`Note saved for ${monthLabel(month.monthKey)}.`);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel title="Description" subtitle={monthLabel(month.monthKey)} maxWidth={480} onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void save()} busy={busy} submitLabel="Save note" />}>
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tour to Murree, plot instalment…"
        style={{ ...fieldStyle(isMobile), resize: "vertical" }} />
      <FormError text={error} />
    </OverlayPanel>
  );
}
