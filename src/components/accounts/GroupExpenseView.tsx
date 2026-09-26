"use client";

/**
 * Mahziyar Group Expense — one month, and its closing.
 *
 * The owner's instruction, in order:
 *
 * 1. **one combined sheet** of office and personal expenses, month by month —
 *    every office expense (approved) and every personal expense dated in the
 *    month, in one list, sorted by date;
 * 2. **"option to add more"** — lines typed straight into the month against a
 *    field (Committee / Kist, Investor, Daddy Media, Misc, or any field added);
 * 3. **closing at the end of the month** — "this much was made, this much was
 *    spent, this much is remaining" — frozen on the month and locked;
 * 4. **"option to see all the incomes, and they should be editable"** — the
 *    Income tab lists every income line the accounts produced that month, and
 *    each can be corrected (or set to 0) without touching the sale behind it.
 *
 * The figures come from `useGroupFigures`, the same computation the yearly
 * performance sheet (Group Income) reads, so the two screens always agree.
 * Office and personal expenses are edited on their own screens; a closed month
 * refuses those edits too (`lib/groupMonthGuard`).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGroupFigures } from "@/hooks/useGroupFigures";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { karachiDayKey, karachiMonthKey } from "@/lib/dates";
import {
  INCOME_SOURCE_LABELS,
  isMonthKey,
  monthLabel,
  shiftMonth,
  type GroupEntry,
  type GroupField,
  type IncomeLine,
} from "@/lib/groupFinance";
import {
  saveGroupEntry,
  deleteGroupEntry,
  setGroupIncomeEdit,
  closeGroupMonth,
  reopenGroupMonth,
} from "@/lib/clientActions";
import {
  ExpenseHero,
  ExpenseList,
  FigureStrip,
  FloatingAdd,
  HeroButton,
  HeroTile,
  ICON,
  Segmented,
  StatCards,
  TONE,
  X,
  catMeta,
  type ExpenseRowModel,
  type Figure,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { SheetTable, SheetAction, Amount, type SheetColumn } from "./SheetTable";
import { GroupFieldsEditor } from "./GroupFieldsEditor";
import { ConfirmPanel, Field, FooterButtons, FormError, FormGrid, Glyph, Notice, fieldStyle } from "./sheetForms";

const money = (n: number) => formatMoney(n);
const LOCK = "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z";
const GROUP_ICON = "M3 21h18M5 21V7l7-4 7 4v14M9 11h2M13 11h2M9 15h2M13 15h2";

/** One row of the combined spending sheet. */
interface SpendRow {
  id: string;
  kind: "OFFICE" | "PERSONAL" | "ACCOUNT" | "LINE";
  dayKey: string;
  title: string;
  category: string;
  amount: number;
  entry?: GroupEntry;
}

export function GroupExpenseView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin";
  const isMobile = useIsMobile();
  const router = useRouter();
  const params = useSearchParams();

  const asked = params.get("month");
  const monthKey = isMonthKey(asked) ? asked : karachiMonthKey();
  const year = Number(monthKey.slice(0, 4));
  const setMonth = (next: string) => router.replace(`/admin/accounts/group-expense?month=${next}`, { scroll: false });

  const group = useGroupFigures(year, ready);
  const view = group.months.find((month) => month.monthKey === monthKey)!;
  const closed = view?.doc?.status === "CLOSED";

  const [tab, setTab] = useState<"SPENDING" | "INCOME">("SPENDING");
  const [lineForm, setLineForm] = useState<{ entry: GroupEntry | null; type: "INCOME" | "EXPENSE" } | null>(null);
  const [incomeEdit, setIncomeEdit] = useState<IncomeLine | null>(null);
  const [deletingLine, setDeletingLine] = useState<GroupEntry | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [editingFields, setEditingFields] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const fieldsByKey = useMemo(() => new Map(group.fields.map((field) => [field.key, field])), [group.fields]);

  /**
   * The spending sheet, read from the month's own lines (`figures.lines`) — the
   * records Group Income opens onto — so the two screens list the same
   * spending, corrections included. Spending straight out of an account is on
   * it now: it was on no screen before.
   */
  const spendRows = useMemo<SpendRow[]>(() => {
    if (!view) return [];
    const entriesById = new Map((view.doc?.entries ?? []).map((entry) => [entry.id, entry]));
    const expenseKeys = new Set(view.figures.columns.filter((column) => column.type === "EXPENSE").map((column) => column.key));
    const columnLabel = new Map(view.figures.columns.map((column) => [column.key, column.label]));
    return view.figures.lines
      .filter((line) => expenseKeys.has(line.columnKey) && (line.kind === "OFFICE" || line.kind === "PERSONAL" || line.kind === "ACCOUNT" || line.kind === "ADDED"))
      .map<SpendRow>((line) => ({
        id: line.id,
        kind: line.kind === "ADDED" ? "LINE" : line.kind === "ACCOUNT" ? "ACCOUNT" : line.kind === "OFFICE" ? "OFFICE" : "PERSONAL",
        dayKey: line.dayKey,
        title: line.label,
        category:
          line.kind === "ACCOUNT"
            ? `${line.sub ?? "Account"} → ${columnLabel.get(line.columnKey) ?? ""}`
            : line.kind === "ADDED"
              ? (columnLabel.get(line.columnKey) ?? "")
              : (line.sub ?? "Other"),
        amount: line.amount,
        entry: line.kind === "ADDED" ? entriesById.get(line.id) : undefined,
      }));
  }, [view]);

  const incomeEntries = useMemo(
    () => (view?.doc?.entries ?? []).filter((entry) => fieldsByKey.get(entry.fieldKey)?.type === "INCOME"),
    [view, fieldsByKey]
  );

  if (!ready) return <Notice ok={false}>Mahziyar Group Expense is for the administrator.</Notice>;
  if (!view) return null;

  const { figures, shown } = view;
  const expenseColumns = figures.columns.filter((column) => column.type === "EXPENSE");
  const incomeColumns = figures.columns.filter((column) => column.type === "INCOME");
  const monthIsOver = monthKey < karachiMonthKey();

  const statCards: StatCard[] = [
    {
      label: "Made", value: money(shown.income),
      note: `${figures.incomeLines.length} income line${figures.incomeLines.length === 1 ? "" : "s"}${incomeEntries.length ? ` + ${incomeEntries.length} added` : ""}`,
      pill: closed ? "Frozen" : "Live", tone: "good", pct: 100, color: "#2f7d78", accent: "#4fa39c", icon: ICON.bars,
    },
    {
      label: "Spent", value: money(shown.spent),
      note: `office ${money(shown.column("office"))} · personal ${money(shown.column("personal"))}`,
      pill: shown.income ? `${Math.round((shown.spent / shown.income) * 100)}%` : null, tone: "warn",
      pct: shown.income ? Math.min(100, Math.round((shown.spent / shown.income) * 100)) : 0,
      color: "#a5762a", accent: "#c99a2e", icon: ICON.receipt,
    },
    {
      label: "Remaining", value: money(shown.remaining),
      note: shown.remaining < 0 ? "spent more than was made" : "made minus spent",
      pill: closed ? "Closed" : "Open", tone: shown.remaining < 0 ? "bad" : "good",
      pct: shown.income ? Math.max(0, Math.min(100, Math.round((shown.remaining / shown.income) * 100))) : 0,
      color: shown.remaining < 0 ? "#a8483c" : "#1f5c58", accent: "#2f7d78", icon: ICON.wallet,
    },
  ];

  const spendFigures: Figure[] = expenseColumns.map((column) => ({
    label: column.label,
    value: money(shown.column(column.key)),
    tone: "warn",
    hint: column.overridden ? `edited · auto ${money(column.auto)}` : column.key === "office" ? `${figures.officeCount} expenses` : column.key === "personal" ? `${figures.personalCount} expenses` : null,
  }));

  const kindLabel = (row: SpendRow) => (row.kind === "OFFICE" ? "Office" : row.kind === "PERSONAL" ? "Personal" : row.kind === "ACCOUNT" ? "Account" : "Added");
  const recordHref = (row: SpendRow) =>
    row.kind === "OFFICE" ? "/admin/accounts/office-expenses" : row.kind === "PERSONAL" ? "/admin/accounts/personal-expense" : "/admin/accounts";

  const spendColumns: SheetColumn<SpendRow>[] = [
    { key: "date", header: "Date", render: (row) => row.dayKey },
    { key: "what", header: "What", render: (row) => <span style={{ fontWeight: 600 }}>{row.title}</span> },
    {
      key: "type", header: "Sheet",
      render: (row) => {
        const tone = row.kind === "OFFICE" ? TONE.warn : row.kind === "PERSONAL" ? TONE.bad : row.kind === "ACCOUNT" ? TONE.quiet : TONE.good;
        return <span style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, color: tone.color, background: tone.tint }}>{kindLabel(row)}</span>;
      },
    },
    { key: "category", header: "Category", render: (row) => row.category },
    { key: "amount", header: "Amount", align: "right", tone: "expense", render: (row) => money(row.amount), total: money(spendRows.reduce((s, r) => s + r.amount, 0)) },
    {
      key: "actions", header: "", align: "right",
      render: (row) =>
        row.kind === "LINE" ? (
          <>
            <SheetAction label="Edit line" d={ICON.edit} disabled={closed} onClick={() => setLineForm({ entry: row.entry!, type: "EXPENSE" })} />
            <SheetAction label="Delete line" d={ICON.trash} tone="bad" disabled={closed} onClick={() => setDeletingLine(row.entry!)} />
          </>
        ) : (
          <Link href={recordHref(row)}
            onClick={(event) => event.stopPropagation()}
            style={{ fontSize: 12, fontWeight: 700, color: X.deep }}>
            Open ›
          </Link>
        ),
    },
  ];

  const incomeColumnsSheet: SheetColumn<IncomeLine>[] = [
    { key: "date", header: "Date", render: (line) => line.dayKey },
    { key: "what", header: "Income", render: (line) => <span style={{ fontWeight: 600 }}>{line.label}</span> },
    { key: "source", header: "From", render: (line) => INCOME_SOURCE_LABELS[line.sourceModule] ?? line.sourceModule },
    { key: "account", header: "Account", render: (line) => line.accountName },
    { key: "auto", header: "Posted", align: "right", render: (line) => <Amount value={line.auto} dashZero={false} format={money} /> },
    {
      key: "counts", header: "Counts as", align: "right", tone: "income",
      render: (line) => (
        <span>
          {line.edited && <span title={`Edited — posted ${money(line.auto)}`} style={{ marginRight: 6, fontSize: 10.5, fontWeight: 800, color: "#a5762a" }}>EDITED</span>}
          <Amount value={line.amount} dashZero={false} format={money} />
        </span>
      ),
      total: money(figures.incomeLines.reduce((s, l) => s + l.amount, 0)),
    },
    {
      key: "actions", header: "", align: "right",
      render: (line) => <SheetAction label="Edit what this counts as" d={ICON.edit} disabled={closed} onClick={() => setIncomeEdit(line)} />,
    },
  ];

  const spendCards: ExpenseRowModel[] = spendRows.map((row) => ({
    id: row.id,
    title: row.title,
    meta: [row.dayKey, row.category].join(" · "),
    amount: row.amount,
    category: row.kind === "OFFICE" ? "Office" : row.kind === "PERSONAL" ? "Personal" : row.category,
    status: { label: kindLabel(row), tone: row.kind === "OFFICE" ? TONE.warn : row.kind === "PERSONAL" ? TONE.bad : row.kind === "ACCOUNT" ? TONE.quiet : TONE.good },
    payment: null,
    actions:
      row.kind === "LINE" && !closed
        ? [
            { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet", onClick: () => setLineForm({ entry: row.entry!, type: "EXPENSE" }) },
            { key: "delete", label: "Delete", d: ICON.trash, tone: "bad", onClick: () => setDeletingLine(row.entry!) },
          ]
        : [],
    onOpen: () => {
      if (row.kind === "LINE") {
        if (!closed) setLineForm({ entry: row.entry!, type: "EXPENSE" });
      } else {
        router.push(recordHref(row));
      }
    },
  }));

  const incomeCards: ExpenseRowModel[] = [
    ...figures.incomeLines.map((line) => ({
      id: line.id,
      title: line.label,
      meta: [line.dayKey, line.accountName].join(" · "),
      amount: line.amount,
      category: INCOME_SOURCE_LABELS[line.sourceModule] ?? "Income",
      status: line.edited ? { label: `edited · posted ${money(line.auto)}`, tone: TONE.warn } : { label: "Automatic", tone: TONE.good },
      payment: null,
      actions: closed ? [] : [{ key: "edit", label: "Edit", d: ICON.edit, tone: "quiet" as const, onClick: () => setIncomeEdit(line) }],
      onOpen: () => { if (!closed) setIncomeEdit(line); },
    })),
    ...incomeEntries.map((entry) => ({
      id: `l_${entry.id}`,
      title: entry.note || fieldsByKey.get(entry.fieldKey)?.label || "Income",
      meta: [entry.dayKey, fieldsByKey.get(entry.fieldKey)?.label].filter(Boolean).join(" · "),
      amount: entry.amount,
      category: fieldsByKey.get(entry.fieldKey)?.label ?? "Income",
      status: { label: "Added", tone: TONE.good },
      payment: null,
      actions: closed
        ? []
        : [
            { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet" as const, onClick: () => setLineForm({ entry, type: "INCOME" }) },
            { key: "delete", label: "Delete", d: ICON.trash, tone: "bad" as const, onClick: () => setDeletingLine(entry) },
          ],
      onOpen: () => { if (!closed) setLineForm({ entry, type: "INCOME" }); },
    })),
  ];

  const doClose = async () => {
    setBusy(true);
    const result = await closeGroupMonth(await getIdToken(), monthKey);
    setBusy(false);
    setClosing(false);
    setBanner(
      result.ok
        ? { ok: true, text: `${monthLabel(monthKey)} closed — made ${money(result.data.income)}, spent ${money(result.data.spent)}, remaining ${money(result.data.remaining)}.` }
        : { ok: false, text: result.error }
    );
  };
  const doReopen = async () => {
    setBusy(true);
    const result = await reopenGroupMonth(await getIdToken(), monthKey);
    setBusy(false);
    setReopening(false);
    setBanner(result.ok ? { ok: true, text: `${monthLabel(monthKey)} reopened.` } : { ok: false, text: result.error });
  };
  const doDeleteLine = async () => {
    if (!deletingLine) return;
    setBusy(true);
    const result = await deleteGroupEntry(await getIdToken(), monthKey, deletingLine.id);
    setBusy(false);
    setDeletingLine(null);
    setBanner(result.ok ? { ok: true, text: "Line removed." } : { ok: false, text: result.error });
  };

  const monthBar = (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, marginTop: isMobile ? 14 : 16, flexWrap: "wrap" }}>
      <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(monthKey, -1))} style={glassButton}>‹</button>
      <label style={{ ...glassButton, width: "auto", padding: "0 14px", position: "relative", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>{monthLabel(monthKey)}</span>
        <input type="month" value={monthKey} aria-label="Choose a month"
          onChange={(e) => { const v = e.target.value; if (isMonthKey(v)) setMonth(v); }}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
      </label>
      <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(monthKey, 1))} style={glassButton}>›</button>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 800, background: closed ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.18)", color: closed ? X.darkest : "#fff" }}>
        {closed && <Glyph d={LOCK} size={13} />}
        {closed ? "Closed" : "Open"}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow="Mahziyar Group Expense"
        figure={money(shown.remaining)}
        caption={`remaining · made ${money(shown.income)}, spent ${money(shown.spent)}`}
        isMobile={isMobile}
        tileIcon={GROUP_ICON}
        stats={[
          { label: "MADE", value: shown.income },
          { label: "SPENT", value: shown.spent },
          { label: "LEFT", value: shown.remaining },
        ]}
        mobileAction={<HeroTile onClick={() => setEditingFields(true)} label="Sheet columns" d={ICON.tags} />}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <HeroButton onClick={() => setEditingFields(true)} icon={<Glyph d={ICON.tags} />}>Columns</HeroButton>
            {closed ? (
              <HeroButton onClick={() => setReopening(true)} icon={<Glyph d={LOCK} />}>Reopen month</HeroButton>
            ) : (
              <>
                <HeroButton onClick={() => setLineForm({ entry: null, type: tab === "INCOME" ? "INCOME" : "EXPENSE" })} icon={<Glyph d="M12 5v14M5 12h14" width={2.4} />}>Add line</HeroButton>
                <HeroButton onClick={() => setClosing(true)} solid icon={<Glyph d={LOCK} />}>Close month</HeroButton>
              </>
            )}
          </div>
        }
      >
        {monthBar}
      </ExpenseHero>

      {banner && <Notice ok={banner.ok}>{banner.text}</Notice>}
      {group.error && <Notice ok={false}>{group.error}</Notice>}

      {closed && view.doc?.closing && (
        <Notice ok>
          <strong>Closed</strong>{view.doc.closing.closedByName ? ` by ${view.doc.closing.closedByName}` : ""}
          {view.doc.closing.closedAt ? ` on ${view.doc.closing.closedAt.slice(0, 10)}` : ""} — these figures are frozen.
          {shown.drifted && (
            <> Records dated in this month have changed since: live figures are made {money(figures.income)}, spent{" "}
              {money(figures.spent)}. Reopen and close again to take them in.</>
          )}
        </Notice>
      )}

      {isMobile && (
        <div style={{ display: "flex", gap: 8 }}>
          {closed ? (
            <button type="button" onClick={() => setReopening(true)} className="acc-press" style={{ ...stripButton, background: "#fff", color: X.deep, border: `1px solid ${X.line}` }}>
              <Glyph d={LOCK} size={15} /> Reopen month
            </button>
          ) : (
            <button type="button" onClick={() => setClosing(true)} className="acc-press" style={stripButton}>
              <Glyph d={LOCK} size={15} /> Close {monthLabel(monthKey).split(" ")[0]}
            </button>
          )}
        </div>
      )}

      <StatCards isMobile={isMobile} cards={statCards} />

      <Segmented
        isMobile={isMobile}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "SPENDING", label: `Spending · ${money(shown.spent)}`, d: ICON.receipt },
          { key: "INCOME", label: `Income · ${money(shown.income)}`, d: ICON.bars },
        ] as const}
      />

      {tab === "SPENDING" ? (
        <>
          <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>Where it went</div>
            <FigureStrip figures={spendFigures} isMobile={isMobile} />
          </section>

          {isMobile ? (
            <ExpenseList
              heading="Office + personal + added"
              count={`${spendRows.length} lines`}
              total={spendRows.reduce((sum, row) => sum + row.amount, 0)}
              rows={spendCards}
              isMobile
              loading={group.loading}
              empty="Nothing spent in this month yet."
              formatMoney={money}
            />
          ) : (
            <SheetTable
              title={`${monthLabel(monthKey)} · office, personal, accounts and added`}
              aside={<span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint }}>Office expenses count once approved · amounts are what each counts as on the sheet</span>}
              columns={spendColumns}
              rows={spendRows}
              rowKey={(row) => row.id}
              onRowClick={(row) => {
                if (row.kind === "LINE" && !closed) setLineForm({ entry: row.entry!, type: "EXPENSE" });
              }}
              empty={group.loading ? "Loading…" : "Nothing spent in this month yet."}
            />
          )}
        </>
      ) : (
        <>
          {incomeColumns.length > 1 && (
            <section style={{ background: "#fff", border: `1px solid ${X.line}`, borderRadius: 16, padding: "13px 15px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: X.faint }}>Income by column</div>
              <FigureStrip
                isMobile={isMobile}
                figures={incomeColumns.map((column) => ({ label: column.label, value: money(shown.column(column.key)), tone: "good" as const, hint: column.overridden ? `edited · auto ${money(column.auto)}` : null }))}
              />
            </section>
          )}

          {isMobile ? (
            <ExpenseList
              heading="Income this month"
              count={`${incomeCards.length} lines`}
              total={shown.income}
              rows={incomeCards}
              isMobile
              loading={group.loading}
              empty="No income landed in any account this month."
              formatMoney={money}
            />
          ) : (
            <>
              <SheetTable
                title={`${monthLabel(monthKey)} · income from the accounts`}
                aside={<span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint }}>Editing a line changes this sheet only — the sale and the account are untouched</span>}
                columns={incomeColumnsSheet}
                rows={figures.incomeLines}
                rowKey={(line) => line.id}
                onRowClick={(line) => { if (!closed) setIncomeEdit(line); }}
                empty={group.loading ? "Loading…" : "No income landed in any account this month."}
              />
              {(incomeEntries.length > 0 || group.fields.some((f) => f.type === "INCOME" && !f.archived)) && (
                <SheetTable
                  title="Income added by hand"
                  columns={[
                    { key: "date", header: "Date", render: (entry: GroupEntry) => entry.dayKey },
                    { key: "field", header: "Field", render: (entry: GroupEntry) => fieldsByKey.get(entry.fieldKey)?.label ?? entry.fieldKey },
                    { key: "note", header: "Note", render: (entry: GroupEntry) => entry.note ?? "—" },
                    { key: "amount", header: "Amount", align: "right", tone: "income", render: (entry: GroupEntry) => money(entry.amount), total: money(incomeEntries.reduce((s, e) => s + e.amount, 0)) },
                    {
                      key: "actions", header: "", align: "right",
                      render: (entry: GroupEntry) => (
                        <>
                          <SheetAction label="Edit line" d={ICON.edit} disabled={closed} onClick={() => setLineForm({ entry, type: "INCOME" })} />
                          <SheetAction label="Delete line" d={ICON.trash} tone="bad" disabled={closed} onClick={() => setDeletingLine(entry)} />
                        </>
                      ),
                    },
                  ]}
                  rows={incomeEntries}
                  rowKey={(entry) => entry.id}
                  empty="No income added by hand."
                />
              )}
            </>
          )}
        </>
      )}

      {isMobile && !closed && (
        <FloatingAdd onClick={() => setLineForm({ entry: null, type: tab === "INCOME" ? "INCOME" : "EXPENSE" })} label="Add line" />
      )}

      {lineForm && (
        <LineForm
          monthKey={monthKey}
          entry={lineForm.entry}
          type={lineForm.type}
          fields={group.fields}
          getIdToken={getIdToken}
          onClose={() => setLineForm(null)}
          onManageFields={() => { setLineForm(null); setEditingFields(true); }}
          onSaved={(text) => { setLineForm(null); setBanner({ ok: true, text }); }}
        />
      )}

      {incomeEdit && (
        <IncomeEditForm
          monthKey={monthKey}
          line={incomeEdit}
          getIdToken={getIdToken}
          onClose={() => setIncomeEdit(null)}
          onSaved={(text) => { setIncomeEdit(null); setBanner({ ok: true, text }); }}
        />
      )}

      {editingFields && (
        <GroupFieldsEditor
          fields={group.fields}
          labels={group.labels}
          accounts={group.accounts.map((account) => ({ id: account.id, name: account.name, kind: String(account.kind ?? "") }))}
          getIdToken={getIdToken}
          onClose={() => setEditingFields(false)}
          onSaved={(text) => { setEditingFields(false); setBanner({ ok: true, text }); }}
        />
      )}

      {deletingLine && (
        <ConfirmPanel title="Remove this line?" confirmLabel="Remove" busy={busy} onCancel={() => setDeletingLine(null)} onConfirm={() => void doDeleteLine()}>
          <strong style={{ color: X.ink }}>{fieldsByKey.get(deletingLine.fieldKey)?.label ?? "Line"}</strong> ·{" "}
          {money(deletingLine.amount)} · {deletingLine.dayKey}
          {deletingLine.note ? ` · ${deletingLine.note}` : ""}
        </ConfirmPanel>
      )}

      {closing && (
        <ConfirmPanel title={`Close ${monthLabel(monthKey)}?`} confirmLabel="Close month" danger={false} busy={busy} onCancel={() => setClosing(false)} onConfirm={() => void doClose()}>
          <div style={{ display: "grid", gap: 6, padding: "12px 14px", borderRadius: 12, background: X.tint, marginBottom: 10 }}>
            <Row label="Made" value={money(figures.income)} />
            <Row label="Spent" value={money(figures.spent)} />
            <Row label="Remaining" value={money(figures.remaining)} strong />
          </div>
          These figures are frozen on the month, and its lines, income edits, office expenses and personal expenses are
          locked until the month is reopened. Paying an expense from an account is still allowed.
          {!monthIsOver && (
            <p style={{ marginTop: 10, fontWeight: 700, color: "#8a6321" }}>
              {monthLabel(monthKey)} has not ended yet — anything recorded later this month will not be in the closing.
            </p>
          )}
        </ConfirmPanel>
      )}

      {reopening && (
        <ConfirmPanel title={`Reopen ${monthLabel(monthKey)}?`} confirmLabel="Reopen" danger={false} busy={busy} onCancel={() => setReopening(false)} onConfirm={() => void doReopen()}>
          The month goes back to live figures and can be edited again. The closing it had is kept in its history.
        </ConfirmPanel>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: strong ? 14 : 13, fontWeight: strong ? 800 : 700 }}>
      <span style={{ color: X.muted }}>{label}</span>
      <span style={{ color: X.ink, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

const glassButton: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)",
  background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 18, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
};

const stripButton: React.CSSProperties = {
  flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  borderRadius: 999, border: "none", background: X.deep, color: "#fff",
  padding: "12px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};

/* -------------------------------------------------------------------------- */

function LineForm({ monthKey, entry, type, fields, getIdToken, onClose, onSaved, onManageFields }: {
  monthKey: string;
  entry: GroupEntry | null;
  type: "INCOME" | "EXPENSE";
  fields: GroupField[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
  onManageFields: () => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const live = fields.filter((f) => !f.archived);
  const [fieldKey, setFieldKey] = useState(entry?.fieldKey ?? live.find((f) => f.type === type)?.key ?? live[0]?.key ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const today = karachiDayKey();
  const [dayKey, setDayKey] = useState(entry?.dayKey ?? (today.startsWith(monthKey) ? today : `${monthKey}-01`));
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveGroupEntry(
        await getIdToken(),
        monthKey,
        { fieldKey, amount: Number(String(amount).replace(/[,\s]/g, "")) || 0, dayKey, note },
        entry?.id
      );
      if (result.ok) onSaved(entry ? "Line updated." : "Line added.");
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const chosen = live.find((f) => f.key === fieldKey);
  const meta = catMeta(chosen?.label ?? "");

  return (
    <OverlayPanel
      title={entry ? "Edit line" : "Add a line"}
      subtitle={monthLabel(monthKey)}
      icon={<Glyph d={meta.d} size={18} />}
      maxWidth={520}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel={entry ? "Save line" : "Add line"} disabled={!fieldKey} />}
    >
      <OverlayCard title="Line">
        <FormGrid isMobile={isMobile}>
          <Field label="Field" wide hint={chosen ? (chosen.type === "INCOME" ? "Counts as income" : "Counts as spending") : undefined}>
            <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} style={{ ...field, cursor: "pointer" }}>
              {live.length === 0 && <option value="">No fields — add one first</option>}
              {(["EXPENSE", "INCOME"] as const).map((group) => {
                const options = live.filter((f) => f.type === group);
                return options.length === 0 ? null : (
                  <optgroup key={group} label={group === "INCOME" ? "Income" : "Spending"}>
                    {options.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </Field>
          <Field label="Amount">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50,000" style={field} />
          </Field>
          <Field label="Date">
            <input type="date" value={dayKey} min={`${monthKey}-01`} max={`${monthKey}-31`} onChange={(e) => setDayKey(e.target.value)} style={field} />
          </Field>
          <Field label="Note" wide>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Committee kist, tour to Murree…" style={field} />
          </Field>
        </FormGrid>
        <button type="button" onClick={onManageFields}
          style={{ marginTop: 10, border: "none", background: "transparent", color: X.deep, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
          + Add or rename a field
        </button>
      </OverlayCard>
      <FormError text={error} />
    </OverlayPanel>
  );
}

function IncomeEditForm({ monthKey, line, getIdToken, onClose, onSaved }: {
  monthKey: string;
  line: IncomeLine;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [amount, setAmount] = useState(String(line.amount));
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setGroupIncomeEdit(await getIdToken(), monthKey, line.id, value, note);
      if (result.ok) onSaved(value === null ? `${line.label} is back to what was posted.` : `${line.label} now counts as ${formatMoney(value)}.`);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const typed = Number(String(amount).replace(/[,\s]/g, ""));

  return (
    <OverlayPanel
      title="Edit this income"
      subtitle={`${line.label} · ${line.dayKey}`}
      icon={<Glyph d={ICON.bars} size={18} />}
      maxWidth={500}
      onClose={onClose}
      footer={
        <FooterButtons
          onCancel={onClose}
          onSubmit={() => void save(Number.isFinite(typed) ? typed : 0)}
          busy={busy}
          submitLabel="Save"
          disabled={!Number.isFinite(typed)}
          left={
            line.edited ? (
              <button type="button" onClick={() => void save(null)} disabled={busy}
                style={{ borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: X.deep, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Use {formatMoney(line.auto)} again
              </button>
            ) : null
          }
        />
      }
    >
      <OverlayCard title="What it counts as">
        <p style={{ fontSize: 12.5, color: X.muted, lineHeight: 1.55, marginBottom: 12 }}>
          {formatMoney(line.auto)} was posted to <strong>{line.accountName}</strong>. Change what this line counts as on the
          Mahziyar sheet — enter 0 to leave it out. The sale and the account&rsquo;s balance are not changed.
        </p>
        <FormGrid isMobile={isMobile}>
          <Field label="Counts as">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={field} />
          </Field>
          <Field label="Why">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={field} />
          </Field>
        </FormGrid>
      </OverlayCard>
      <FormError text={error} />
    </OverlayPanel>
  );
}
