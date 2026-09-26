"use client";

/**
 * Receivables and Payables — the owner's two sheets.
 *
 * **Receivables**: who owes the business. `DATE | PENDING AMOUNT | CUSTOMER
 * NAME | AMOUNT RECEIVED | AMOUNT PENDING`, in the owner's groups ("Official /
 * Unofficial", "Official / Regular").
 *
 * **Payables**: whom the business owes. `DATE | NAME | PENDING AMOUNT | RETURN
 * DATE | BORROW PURPOSE | AMOUNT GIVEN | AMOUNT PENDING`.
 *
 * On the desktop each group is its own sheet block with a TOTAL row, as the
 * workbook lays them out; on the phone every entry is a card carrying every
 * figure. `AMOUNT PENDING` is derived, never typed.
 *
 * **"Received" / "Pay back" moves money through the accounts** (owner,
 * 2026-09-26), with the same split control Office Expenses pays with
 * (`PayFromAccounts`): a receivable's money lands in the account(s) chosen, a
 * payable's leaves them, and both show on those accounts' statements. Money
 * that never touched a company account can still be recorded on the sheet
 * only, from the same panel.
 *
 * Everything is editable: every entry, what has been settled, and the group
 * names.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSheetEntries, useSheetGroups } from "@/hooks/useAccountSheets";
import { useLedger } from "@/hooks/useLedger";
import { PayFromAccounts } from "./PayFromAccounts";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import {
  ENTRY_STATE_LABELS,
  entryState,
  pendingOf,
  sheetTotals,
  type EntryState,
  type LedgerSide,
  type SheetEntry,
} from "@/lib/receivableSheet";
import {
  saveSheetEntry,
  settleSheetEntry,
  settleSheetEntryThroughAccounts,
  deleteSheetEntry,
  saveSheetGroups,
  importLegacyReceivables,
  countLegacyReceivables,
} from "@/lib/clientActions";
import {
  ChipRow,
  ExpenseHero,
  ExpenseList,
  FigureStrip,
  FloatingAdd,
  HeroButton,
  HeroTile,
  ICON,
  MobileSearch,
  Segmented,
  StatCards,
  TONE,
  X,
  type ExpenseRowModel,
  type StatCard,
} from "@/components/finance/expensesChrome";
import { SheetTable, SheetAction, Amount, type SheetColumn } from "./SheetTable";
import { ConfirmPanel, Field, FooterButtons, FormError, FormGrid, Glyph, Notice, fieldStyle } from "./sheetForms";

type Entry = SheetEntry & { history: Array<Record<string, unknown>> };

const money = (n: number) => formatMoney(n);
const IN_ICON = "M12 3v14M6 11l6 6 6-6M4 21h16";
const OUT_ICON = "M12 21V7M6 13l6-6 6 6M4 3h16";

const STATE_TONE: Record<EntryState, (typeof TONE)[keyof typeof TONE]> = {
  OPEN: TONE.warn,
  PART: TONE.quiet,
  SETTLED: TONE.good,
  OVERDUE: TONE.bad,
};

export function ReceivablesSheetView() {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const isAdmin = role === "admin";
  const isMobile = useIsMobile();
  const { entries, loading, error } = useSheetEntries(ready);
  const groups = useSheetGroups(ready);
  const ledger = useLedger(ready);

  const [side, setSide] = useState<LedgerSide>("RECEIVABLE");
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [stateFilter, setStateFilter] = useState<"ALL" | "PENDING" | "SETTLED">("PENDING");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ entry: Entry | null } | null>(null);
  const [settling, setSettling] = useState<{ entry: Entry; sheetOnly: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [editingGroups, setEditingGroups] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [legacyWaiting, setLegacyWaiting] = useState(0);

  const today = karachiDayKey();
  const payable = side === "PAYABLE";
  const sideGroups = payable ? groups.payableGroups : groups.receivableGroups;

  const refreshLegacy = useCallback(async () => {
    const result = await countLegacyReceivables(await getIdToken());
    if (result.ok) setLegacyWaiting(result.data.waiting);
  }, [getIdToken]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void (async () => {
      const result = await countLegacyReceivables(await getIdToken());
      if (live && result.ok) setLegacyWaiting(result.data.waiting);
    })();
    return () => {
      live = false;
    };
  }, [ready, getIdToken]);

  const ofSide = useMemo(() => entries.filter((entry) => entry.side === side), [entries, side]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return ofSide
      .filter((entry) => groupFilter === "ALL" || entry.group === groupFilter)
      .filter((entry) => {
        const state = entryState(entry, today);
        if (stateFilter === "PENDING") return state !== "SETTLED";
        if (stateFilter === "SETTLED") return state === "SETTLED";
        return true;
      })
      .filter(
        (entry) =>
          !needle ||
          entry.name.toLowerCase().includes(needle) ||
          (entry.purpose ?? "").toLowerCase().includes(needle) ||
          (entry.description ?? "").toLowerCase().includes(needle)
      )
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.name.localeCompare(b.name));
  }, [ofSide, groupFilter, stateFilter, search, today]);

  const totals = useMemo(() => sheetTotals(ofSide), [ofSide]);
  const overdue = ofSide.filter((entry) => entryState(entry, today) === "OVERDUE");

  /** Every group with something in it, in the saved order, then any stray names. */
  const blocks = useMemo(() => {
    const names = [...sideGroups];
    for (const entry of filtered) if (!names.includes(entry.group)) names.push(entry.group);
    return names
      .filter((name) => groupFilter === "ALL" || name === groupFilter)
      .map((name) => ({ name, rows: filtered.filter((entry) => entry.group === name) }))
      .filter((block) => block.rows.length > 0 || (groupFilter !== "ALL" && block.name === groupFilter));
  }, [sideGroups, filtered, groupFilter]);

  if (!ready) return <Notice ok={false}>Receivables and Payables are for administrators and HR.</Notice>;

  const settledWord = payable ? "Given back" : "Received";
  const statCards: StatCard[] = [
    {
      label: payable ? "Owed By Us" : "Owed To Us", value: money(totals.amount),
      note: `${totals.count} entr${totals.count === 1 ? "y" : "ies"}`, pill: `${totals.count}`,
      pct: 100, color: "#141f1e", accent: "#3f8f8a", icon: payable ? OUT_ICON : IN_ICON,
    },
    {
      label: settledWord, value: money(totals.settled), note: payable ? "paid back so far" : "come back so far",
      pill: totals.amount ? `${Math.round((totals.settled / totals.amount) * 100)}%` : null, tone: "good",
      pct: totals.amount ? Math.round((totals.settled / totals.amount) * 100) : 0,
      color: "#2f7d78", accent: "#4fa39c", icon: ICON.check,
    },
    {
      label: "Still Pending", value: money(totals.pending),
      note: overdue.length ? `${overdue.length} past the return date` : "amount pending",
      pill: overdue.length ? "Overdue" : "Pending", tone: overdue.length ? "bad" : "warn",
      pct: totals.amount ? Math.round((totals.pending / totals.amount) * 100) : 0,
      color: overdue.length ? "#a8483c" : "#a5762a", accent: "#c99a2e", icon: ICON.clock,
    },
  ];

  const columnsFor = (rows: Entry[]): SheetColumn<Entry>[] => {
    const blockTotals = sheetTotals(rows);
    const statePill = (entry: Entry) => {
      const state = entryState(entry, today);
      const tone = STATE_TONE[state];
      return <span style={{ borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, color: tone.color, background: tone.tint }}>{ENTRY_STATE_LABELS[state]}</span>;
    };
    const actions: SheetColumn<Entry> = {
      key: "actions", header: "", align: "right",
      render: (entry) => (
        <>
          {pendingOf(entry) > 0 && <SheetAction label={payable ? "Record money given back" : "Record money received"} d={ICON.check} tone="good" onClick={() => setSettling({ entry, sheetOnly: false })} />}
          <SheetAction label="Edit" d={ICON.edit} onClick={() => setForm({ entry })} />
          {isAdmin && <SheetAction label="Delete" d={ICON.trash} tone="bad" onClick={() => setDeleting(entry)} />}
        </>
      ),
    };
    return payable
      ? [
          { key: "date", header: "Date", render: (e) => e.dayKey },
          { key: "name", header: "Name", render: (e) => <span style={{ fontWeight: 700 }}>{e.name}</span> },
          { key: "amount", header: "Pending amount", align: "right", render: (e) => money(e.amount), total: money(blockTotals.amount) },
          { key: "return", header: "Return date", render: (e) => e.returnDayKey ? <span style={{ color: entryState(e, today) === "OVERDUE" ? "#a8483c" : undefined }}>{e.returnDayKey}</span> : <span style={{ color: "#c3d5d3" }}>–</span> },
          { key: "purpose", header: "Borrow purpose", render: (e) => <span style={{ fontWeight: 500, color: X.body }}>{e.purpose ?? "—"}</span> },
          { key: "settled", header: "Amount given", align: "right", tone: "income", render: (e) => <Amount value={e.settled} format={money} />, total: money(blockTotals.settled) },
          { key: "pending", header: "Amount pending", align: "right", tone: "net", render: (e) => <Amount value={pendingOf(e)} format={money} />, total: money(blockTotals.pending) },
          { key: "state", header: "", render: statePill },
          actions,
        ]
      : [
          { key: "date", header: "Date", render: (e) => e.dayKey },
          { key: "amount", header: "Pending amount", align: "right", render: (e) => money(e.amount), total: money(blockTotals.amount) },
          { key: "name", header: "Customer name", render: (e) => <span style={{ fontWeight: 700 }}>{e.name}</span> },
          { key: "settled", header: "Amount received", align: "right", tone: "income", render: (e) => <Amount value={e.settled} format={money} />, total: money(blockTotals.settled) },
          { key: "pending", header: "Amount pending", align: "right", tone: "net", render: (e) => <Amount value={pendingOf(e)} format={money} />, total: money(blockTotals.pending) },
          { key: "note", header: "Note", render: (e) => <span style={{ fontWeight: 500, color: X.body, maxWidth: 240, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{e.purpose ?? e.description ?? "—"}</span> },
          { key: "state", header: "", render: statePill },
          actions,
        ];
  };

  const cards: ExpenseRowModel[] = filtered.map((entry) => {
    const state = entryState(entry, today);
    return {
      id: entry.id,
      title: entry.name,
      meta: [entry.dayKey, entry.group, entry.purpose].filter(Boolean).join(" · "),
      amount: pendingOf(entry),
      category: entry.group,
      status: { label: ENTRY_STATE_LABELS[state], tone: STATE_TONE[state] },
      payment: null,
      detail: (
        <FigureStrip
          isMobile
          figures={[
            { label: "Pending amount", value: money(entry.amount), tone: "ink" },
            { label: payable ? "Given" : "Received", value: money(entry.settled), tone: "good" },
            { label: "Still pending", value: money(pendingOf(entry)), tone: pendingOf(entry) > 0 ? "warn" : "good", strong: true },
            ...(payable ? [{ label: "Return date", value: entry.returnDayKey ?? "—", tone: (state === "OVERDUE" ? "bad" : "muted") as "bad" | "muted" }] : []),
          ]}
        />
      ),
      actions: [
        ...(pendingOf(entry) > 0 ? [{ key: "settle", label: payable ? "Paid back" : "Received", d: ICON.check, tone: "good" as const, onClick: () => setSettling({ entry, sheetOnly: false }) }] : []),
        { key: "edit", label: "Edit", d: ICON.edit, tone: "quiet" as const, onClick: () => setForm({ entry }) },
        ...(isAdmin ? [{ key: "delete", label: "Delete", d: ICON.trash, tone: "bad" as const, onClick: () => setDeleting(entry) }] : []),
      ],
      onOpen: () => setForm({ entry }),
    };
  });

  const importNow = async () => {
    setBusy(true);
    const result = await importLegacyReceivables(await getIdToken());
    setBusy(false);
    setBanner(result.ok ? { ok: true, text: `${result.data.imported} receivable${result.data.imported === 1 ? "" : "s"} brought in from the old screen.` } : { ok: false, text: result.error });
    void refreshLegacy();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const result = await deleteSheetEntry(await getIdToken(), deleting.id);
    setBusy(false);
    setDeleting(null);
    setBanner(result.ok ? { ok: true, text: `${deleting.name} deleted.` } : { ok: false, text: result.error });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <ExpenseHero
        eyebrow={payable ? "Payables · we owe" : "Receivables · owed to us"}
        figure={money(totals.pending)}
        caption={`still pending · ${money(totals.amount)} in total, ${money(totals.settled)} ${payable ? "given back" : "received"}`}
        isMobile={isMobile}
        tileIcon={payable ? OUT_ICON : IN_ICON}
        stats={[
          { label: "TOTAL", value: totals.amount },
          { label: payable ? "GIVEN" : "RECEIVED", value: totals.settled },
          { label: "PENDING", value: totals.pending },
        ]}
        mobileAction={<HeroTile onClick={() => setEditingGroups(true)} label="Groups" d={ICON.tags} />}
        actions={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <HeroButton onClick={() => setEditingGroups(true)} icon={<Glyph d={ICON.tags} />}>Groups</HeroButton>
            <HeroButton onClick={() => setForm({ entry: null })} solid icon={<Glyph d="M12 5v14M5 12h14" width={2.4} />}>
              {payable ? "Add payable" : "Add receivable"}
            </HeroButton>
          </div>
        }
      />

      <Segmented
        isMobile={isMobile}
        value={side}
        onChange={(next) => { setSide(next); setGroupFilter("ALL"); }}
        tabs={[
          { key: "RECEIVABLE", label: "Receivables", d: IN_ICON },
          { key: "PAYABLE", label: "Payables", d: OUT_ICON },
        ] as const}
      />

      {banner && <Notice ok={banner.ok}>{banner.text}</Notice>}
      {error && <Notice ok={false}>{error}</Notice>}

      {legacyWaiting > 0 && side === "RECEIVABLE" && (
        <section style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", gap: 10, background: "#fdf5e6", border: "1px solid #ecdcae", borderRadius: 14, padding: "12px 16px" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#8a6321", lineHeight: 1.5 }}>
            {legacyWaiting} receivable{legacyWaiting === 1 ? " was" : "s were"} recorded on the old Receivable screen. Bring them into this sheet as pending — the originals are kept.
          </span>
          <button type="button" onClick={() => void importNow()} disabled={busy}
            style={{ borderRadius: 999, border: "none", background: "#a5762a", color: "#fff", padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            {busy ? "Bringing in…" : `Bring in ${legacyWaiting}`}
          </button>
        </section>
      )}

      <StatCards isMobile={isMobile} cards={statCards} />

      {isMobile && <MobileSearch value={search} onChange={setSearch} placeholder={payable ? "Name or purpose" : "Customer name"} />}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 8 : 12, alignItems: isMobile ? "stretch" : "center" }}>
        <ChipRow
          chips={[
            { label: "Pending", active: stateFilter === "PENDING", pick: () => setStateFilter("PENDING") },
            { label: "Settled", active: stateFilter === "SETTLED", pick: () => setStateFilter("SETTLED") },
            { label: "All", active: stateFilter === "ALL", pick: () => setStateFilter("ALL") },
          ]}
        />
        <ChipRow
          chips={[
            { label: "Every group", active: groupFilter === "ALL", pick: () => setGroupFilter("ALL") },
            ...sideGroups.map((name) => ({ label: name, active: groupFilter === name, pick: () => setGroupFilter(name) })),
          ]}
        />
        {!isMobile && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={payable ? "Search name or purpose" : "Search customer"}
            style={{ ...fieldStyle(false), marginLeft: "auto", width: 240, background: "#fff" }} />
        )}
      </div>

      {isMobile ? (
        <ExpenseList
          heading={payable ? "Payables" : "Receivables"}
          count={`${filtered.length} of ${ofSide.length}`}
          total={filtered.reduce((sum, entry) => sum + pendingOf(entry), 0)}
          rows={cards}
          isMobile
          loading={loading}
          empty={ofSide.length === 0 ? (payable ? "Nothing owed by the business yet." : "Nobody owes the business anything yet.") : "Nothing matches these filters."}
          formatMoney={money}
        />
      ) : blocks.length === 0 ? (
        <SheetTable columns={columnsFor([])} rows={[]} rowKey={(entry) => entry.id} empty={loading ? "Loading…" : ofSide.length === 0 ? (payable ? "Nothing owed by the business yet." : "Nobody owes the business anything yet.") : "Nothing matches these filters."} />
      ) : (
        blocks.map((block) => (
          <SheetTable
            key={block.name}
            title={`Mahziyar ${block.name} ${payable ? "payables" : "receivables"}`}
            aside={<span style={{ fontSize: 11.5, fontWeight: 600, color: X.faint }}>{block.rows.length} entr{block.rows.length === 1 ? "y" : "ies"} · click a row to edit</span>}
            columns={columnsFor(block.rows)}
            rows={block.rows}
            rowKey={(entry) => entry.id}
            onRowClick={(entry) => setForm({ entry })}
            rowStyle={(entry) => (entryState(entry, today) === "SETTLED" ? { background: "#f7fbfa", opacity: 0.75 } : undefined)}
            empty="Nothing in this group."
          />
        ))
      )}

      {isMobile && <FloatingAdd onClick={() => setForm({ entry: null })} label={payable ? "Add payable" : "Add receivable"} />}

      {form && (
        <EntryForm
          side={side}
          entry={form.entry}
          groups={sideGroups}
          defaultGroup={groupFilter !== "ALL" ? groupFilter : sideGroups[0]}
          getIdToken={getIdToken}
          onClose={() => setForm(null)}
          onSaved={(text) => { setForm(null); setBanner({ ok: true, text }); }}
        />
      )}

      {settling && !settling.sheetOnly && (
        <PayFromAccounts
          open
          onClose={() => setSettling(null)}
          onPaid={(text) => setBanner({ ok: true, text })}
          accounts={ledger.accounts}
          balances={ledger.balances}
          getIdToken={getIdToken}
          copy={
            settling.entry.side === "PAYABLE"
              ? { title: `Paying back ${settling.entry.name} — from which account?`, full: "Pay back in full", part: "Pay back part", linesTitle: "Paid from", done: "paid back", noun: "payable", settledWord: "given back" }
              : { title: `Money from ${settling.entry.name} — into which account?`, full: "Received in full", part: "Record part received", linesTitle: "Received into", done: "received", noun: "receivable", settledWord: "received" }
          }
          source={{
            module: "RECEIVABLE",
            collection: "receivableEntries",
            id: settling.entry.id,
            label: settling.entry.name,
            amount: settling.entry.amount,
            alreadyPaid: settling.entry.settled,
            direction: settling.entry.side === "PAYABLE" ? "OUT" : "IN",
            type: "LOAN",
          }}
          submit={async ({ allocations, dayKey, note }) => {
            const result = await settleSheetEntryThroughAccounts(await getIdToken(), settling.entry.id, { allocations, dayKey, note });
            return result.ok ? { ok: true, fullyPaid: result.data.fullyPaid, posted: result.data.posted } : { ok: false, error: result.error };
          }}
          extra={
            <button type="button" onClick={() => setSettling({ entry: settling.entry, sheetOnly: true })}
              style={{ alignSelf: "flex-start", border: "none", background: "transparent", padding: 0, fontSize: 12.5, fontWeight: 700, color: X.deep, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              Settled outside the company accounts? Record it on the sheet only →
            </button>
          }
        />
      )}

      {settling && settling.sheetOnly && (
        <SettleForm
          entry={settling.entry}
          getIdToken={getIdToken}
          onBack={() => setSettling({ entry: settling.entry, sheetOnly: false })}
          onClose={() => setSettling(null)}
          onSaved={(text) => { setSettling(null); setBanner({ ok: true, text }); }}
        />
      )}

      {editingGroups && (
        <GroupsForm
          side={side}
          groups={sideGroups}
          getIdToken={getIdToken}
          onClose={() => setEditingGroups(false)}
          onSaved={(text) => { setEditingGroups(false); setBanner({ ok: true, text }); }}
        />
      )}

      {deleting && (
        <ConfirmPanel title={`Delete ${deleting.name}?`} confirmLabel="Delete" busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()}>
          {money(deleting.amount)} · {deleting.dayKey} · {money(pendingOf(deleting))} still pending. This cannot be undone.
          {deleting.accountSettled > 0 && ` The ${money(deleting.accountSettled)} that moved through accounts stays on those accounts — delete it there if it should not have happened.`}
        </ConfirmPanel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EntryForm({ side, entry, groups, defaultGroup, getIdToken, onClose, onSaved }: {
  side: LedgerSide;
  entry: Entry | null;
  groups: string[];
  defaultGroup: string;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const payable = side === "PAYABLE";
  const [values, setValues] = useState({
    group: entry?.group ?? defaultGroup,
    dayKey: entry?.dayKey ?? karachiDayKey(),
    name: entry?.name ?? "",
    amount: entry ? String(entry.amount) : "",
    settled: entry ? String(entry.settled || "") : "",
    returnDayKey: entry?.returnDayKey ?? "",
    purpose: entry?.purpose ?? "",
    description: entry?.description ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const num = (text: string) => Number(String(text).replace(/[,\s]/g, "")) || 0;
  const pending = Math.max(0, num(values.amount) - num(values.settled));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveSheetEntry(
        await getIdToken(),
        {
          side,
          group: values.group,
          dayKey: values.dayKey,
          name: values.name,
          amount: num(values.amount),
          settled: num(values.settled),
          returnDayKey: values.returnDayKey || null,
          purpose: values.purpose,
          description: values.description,
        },
        entry?.id
      );
      if (result.ok) onSaved(`${values.name.trim()} ${entry ? "updated" : "added"}.`);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const history = (entry?.history ?? []).slice(-6).reverse();

  return (
    <OverlayPanel
      title={entry ? `Edit ${entry.name}` : payable ? "Add payable" : "Add receivable"}
      subtitle={payable ? "Money the business owes" : "Money owed to the business"}
      icon={<Glyph d={payable ? OUT_ICON : IN_ICON} size={18} />}
      maxWidth={600}
      onClose={onClose}
      footer={
        <FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel={entry ? "Save" : "Add"}
          left={<span style={{ fontSize: 12.5, fontWeight: 700, color: pending > 0 ? "#a5762a" : X.deep }}>Pending {formatMoney(pending)}</span>} />
      }
    >
      <OverlayCard title={payable ? "Payable" : "Receivable"}>
        <FormGrid isMobile={isMobile}>
          <Field label={payable ? "Name" : "Customer name"}>
            <input value={values.name} onChange={(e) => set("name", e.target.value)} style={field} />
          </Field>
          <Field label="Group">
            <select value={values.group} onChange={(e) => set("group", e.target.value)} style={{ ...field, cursor: "pointer" }}>
              {[...new Set([...groups, values.group])].map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={values.dayKey} onChange={(e) => set("dayKey", e.target.value)} style={field} />
          </Field>
          <Field label="Pending amount" hint="What was owed at the start.">
            <input inputMode="decimal" value={values.amount} onChange={(e) => set("amount", e.target.value)} placeholder="8,500" style={field} />
          </Field>
          <Field label={payable ? "Amount given" : "Amount received"} hint={entry?.accountSettled ? `${formatMoney(entry.accountSettled)} of it went through accounts — that part cannot be typed away here.` : "Settled so far outside the accounts. Use Received / Pay back to move money."}>
            <input inputMode="decimal" value={values.settled} onChange={(e) => set("settled", e.target.value)} placeholder="0" style={field} />
          </Field>
          {payable ? (
            <Field label="Return date">
              <input type="date" value={values.returnDayKey} onChange={(e) => set("returnDayKey", e.target.value)} style={field} />
            </Field>
          ) : <div />}
          <Field label={payable ? "Borrow purpose" : "What it is for"} wide>
            <input value={values.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder={payable ? "Office renovation" : "Advance, balance on a deal…"} style={field} />
          </Field>
          <Field label="Description" wide>
            <input value={values.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" style={field} />
          </Field>
        </FormGrid>
      </OverlayCard>

      {history.length > 0 && (
        <OverlayCard title="History">
          {history.map((row, index) => (
            <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderTop: index ? `1px solid ${X.rowLine}` : undefined, fontSize: 12.5 }}>
              <span style={{ color: X.body, fontWeight: 600 }}>
                {String(row.action ?? "").replace(/_/g, " ").toLowerCase()}{row.detail ? ` · ${row.detail}` : ""}
                <span style={{ color: X.faint, fontWeight: 500 }}> · {String(row.byName ?? "")} · {String(row.at ?? "").slice(0, 10)}</span>
              </span>
              {typeof row.amount === "number" && <span style={{ fontWeight: 800, color: X.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(row.amount)}</span>}
            </div>
          ))}
        </OverlayCard>
      )}
      <FormError text={error} />
    </OverlayPanel>
  );
}

function SettleForm({ entry, getIdToken, onBack, onClose, onSaved }: {
  entry: Entry;
  getIdToken: () => Promise<string>;
  onBack: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const payable = entry.side === "PAYABLE";
  const pending = pendingOf(entry);
  const [amount, setAmount] = useState(String(pending));
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await settleSheetEntry(await getIdToken(), entry.id, { amount: Number(String(amount).replace(/[,\s]/g, "")) || 0, dayKey, note });
      if (result.ok) {
        onSaved(result.data.pending > 0
          ? `${formatMoney(Number(amount.replace(/[,\s]/g, "")))} recorded — ${formatMoney(result.data.pending)} still pending on ${entry.name}.`
          : `${entry.name} is settled.`);
      } else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel
      title={payable ? `Given back to ${entry.name} — sheet only` : `Received from ${entry.name} — sheet only`}
      subtitle={`${formatMoney(pending)} pending`}
      icon={<Glyph d={ICON.check} size={18} />}
      maxWidth={480}
      onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel="Record" />}
    >
      <FormGrid isMobile={isMobile}>
        <Field label="Amount"><input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={field} /></Field>
        <Field label="Date"><input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} style={field} /></Field>
        <Field label="Note" wide><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={field} /></Field>
      </FormGrid>
      <p style={{ fontSize: 11.5, color: X.faint, lineHeight: 1.5 }}>
        For money that never touched a company account. No account balance changes.{" "}
        <button type="button" onClick={onBack} style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontWeight: 700, color: X.deep, cursor: "pointer" }}>
          Move it through an account instead
        </button>
      </p>
      <FormError text={error} />
    </OverlayPanel>
  );
}

function GroupsForm({ side, groups, getIdToken, onClose, onSaved }: {
  side: LedgerSide;
  groups: string[];
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isMobile = useIsMobile();
  const field = fieldStyle(isMobile);
  const [rows, setRows] = useState(groups.map((name) => ({ original: name, name })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const renames = rows.filter((row) => row.original && row.name.trim() && row.original !== row.name.trim()).map((row) => ({ from: row.original, to: row.name.trim() }));
      const result = await saveSheetGroups(await getIdToken(), side, rows.map((row) => row.name), renames);
      if (result.ok) onSaved(`Groups saved${result.data.moved ? ` — ${result.data.moved} entr${result.data.moved === 1 ? "y" : "ies"} moved with a renamed group` : ""}.`);
      else setError(result.error);
    } catch {
      setError("Could not reach the server. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPanel title={side === "PAYABLE" ? "Payable groups" : "Receivable groups"} subtitle="Renaming a group moves its entries with it" icon={<Glyph d={ICON.tags} size={18} />} maxWidth={500} onClose={onClose}
      footer={<FooterButtons onCancel={onClose} onSubmit={() => void submit()} busy={busy} submitLabel="Save groups" />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row, index) => (
          <div key={index} style={{ display: "flex", gap: 8 }}>
            <input value={row.name} aria-label={`Group ${index + 1}`} onChange={(e) => { const v = e.target.value; setRows((list) => list.map((r, i) => (i === index ? { ...r, name: v } : r))); }} style={{ ...field, flex: 1 }} />
            {rows.length > 1 && (
              <button type="button" aria-label="Remove group" onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: `1px solid ${X.line}`, background: "#fff", color: "#a8483c", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Glyph d={ICON.cross} size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setRows((list) => [...list, { original: "", name: "" }])}
          style={{ alignSelf: isMobile ? "stretch" : "flex-start", borderRadius: 11, border: `1px dashed ${X.track}`, background: "transparent", padding: "10px 14px", fontSize: 13, fontWeight: 700, color: X.deep, cursor: "pointer", fontFamily: "inherit" }}>
          + Add group
        </button>
        <p style={{ fontSize: 11.5, color: X.faint, lineHeight: 1.5 }}>Removing a group from this list keeps its entries; they still show under their old group name.</p>
      </div>
      <FormError text={error} />
    </OverlayPanel>
  );
}
