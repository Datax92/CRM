"use client";

/**
 * **"Where are we paying this from?"**
 *
 * The control the whole rebuild was asked for: a 50,000 expense funded 30,000
 * from one account, 10,000 from another and 10,000 from a third. Three lines,
 * one obligation, and the expense stays 50,000 — the lines only explain the
 * funding.
 *
 * Everything it refuses, it refuses *before* the button is live, and for the
 * same reasons the server refuses it a second time in `payFromAccounts`:
 *
 * - over-allocation is shown as an error, never silently trimmed;
 * - the same account twice is refused, because that is the shape a duplicate
 *   payment arrives in;
 * - "Pay" only says *Pay* when the lines close the balance exactly; short of
 *   that it says how much is still unfunded and records a part payment.
 *
 * The validation is `lib/ledger.checkAllocations` — the same function the
 * Server Action runs — so a payment this screen accepts is never refused by
 * the server, and one it refuses could not have been posted anyway.
 */

import { useMemo, useState } from "react";
import { Wallet, Plus, X, AlertTriangle } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { checkAllocations, ACCOUNT_KIND_LABELS, type SourceModule, type TransactionType } from "@/lib/ledger";
import { payFromAccounts } from "@/lib/clientActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { AccountDoc } from "@/hooks/useLedger";
import { A, Button } from "./accountsChrome";

/** `E` was the old alias; the section's tokens now live in `accountsChrome`. */
const E = A;

const FIELD: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: `1px solid ${E.border}`,
  background: E.surface,
  padding: "9px 11px",
  fontSize: 13.5,
  color: E.ink,
  outline: "none",
  fontFamily: "inherit",
};

export function PayFromAccounts({
  open,
  onClose,
  onPaid,
  accounts,
  balances,
  getIdToken,
  submit: submitOverride,
  source,
  copy,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  onPaid: (message: string) => void;
  accounts: AccountDoc[];
  balances: Map<string, { balance: number }>;
  getIdToken: () => Promise<string>;
  /**
   * Posts the payment, when the generic ledger call is not the right one.
   *
   * Payroll is the case: a month may only be paid once it is approved, only by
   * the admin, and paying the last rupee marks it paid and writes the payslips.
   * Those are payroll's rules, not the ledger's, so that module wraps
   * `payFromAccounts` and hands the wrapper in here — rather than this panel
   * growing a branch per module, or payroll growing a second split control that
   * could validate differently from this one.
   */
  submit?: (input: {
    allocations: Array<{ accountId: string; amount: number }>;
    dayKey: string;
    note: string | null;
  }) => Promise<{ ok: true; fullyPaid: boolean; posted: number } | { ok: false; error: string }>;
  /**
   * The words, when the money is not a payment: a receivable coming back is
   * *received into* an account, not *paid from* one. Same control, same checks.
   */
  copy?: { title: string; full: string; part: string; linesTitle?: string; done: string; noun?: string; settledWord?: string };
  /** Anything the calling module needs under the meter — another way to record it, say. */
  extra?: React.ReactNode;
  source: {
    module: SourceModule;
    collection: string;
    id: string;
    label: string;
    /** The obligation. Never changed by paying it. */
    amount: number;
    alreadyPaid: number;
    /** `IN` for money arriving (marketing income), `OUT` for a payment. */
    direction?: "IN" | "OUT";
    type?: TransactionType;
  };
}) {
  const open_ = accounts.filter((a) => a.status !== "ARCHIVED");
  const [lines, setLines] = useState<Array<{ accountId: string; amount: string }>>([
    { accountId: open_[0]?.id ?? "", amount: "" },
  ]);
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstanding = Math.round((source.amount - source.alreadyPaid) * 100) / 100;

  const allocations = useMemo(
    () => lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, amount: Number(l.amount) || 0 })),
    [lines]
  );
  // The same check the server runs, so the two can never disagree.
  const check = useMemo(
    () => checkAllocations(source.amount, allocations, source.alreadyPaid),
    [source.amount, source.alreadyPaid, allocations]
  );
  const started = lines.some((l) => l.amount !== "");
  const over = check.allocated > outstanding;
  const pct = outstanding > 0 ? (check.allocated / outstanding) * 100 : 0;
  const isMobile = useIsMobile();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = submitOverride
        ? await submitOverride({ allocations, dayKey, note: note.trim() || null })
        : await payFromAccounts(await getIdToken(), {
            sourceModule: source.module,
            sourceId: source.id,
            sourceCollection: source.collection,
            sourceLabel: source.label,
            allocations,
            direction: source.direction ?? "OUT",
            type: source.type ?? (source.direction === "IN" ? "INCOME" : "EXPENSE"),
            dayKey,
            note: note.trim() || null,
          });
      if (result.ok) {
        const done = "data" in result ? result.data : result;
        onPaid(
          done.fullyPaid
            ? `${source.label} ${copy?.done ?? "paid"} in full — ${done.posted} account${done.posted === 1 ? "" : "s"}.`
            : `${formatMoney(check.allocated)} ${copy?.done ?? "paid"} — ${formatMoney(check.unallocated)} still outstanding.`
        );
        onClose();
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach the server. Nothing was paid.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <OverlayPanel
      title={copy?.title ?? "Where are we paying this from?"}
      subtitle={`${source.label} · ${formatMoney(source.amount)}`}
      icon={<Wallet size={19} />}
      maxWidth={620}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%" }}>
          <span style={{ fontSize: 12.5, color: check.valid ? E.muted : E.red, fontWeight: 600 }}>
            {check.allocated > 0
              ? `${formatMoney(check.allocated)} of ${formatMoney(outstanding)} allocated`
              : `${formatMoney(outstanding)} to allocate`}
          </span>
          <Button
            primary
            full={isMobile}
            disabled={busy || !check.valid || check.allocated <= 0}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : check.fullyFunded ? (copy?.full ?? "Pay in full") : (copy?.part ?? "Record part payment")}
          </Button>
        </div>
      }
    >
      <OverlayCard title={copy?.linesTitle ?? "Payment lines"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {lines.map((line, index) => {
            const balance = balances.get(line.accountId)?.balance ?? 0;
            return (
              <div
                key={index}
                style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  // Stacks on a phone: a select and a number field side by side
                  // at 390px leaves neither readable.
                  flexDirection: isMobile ? "column" : "row",
                }}
              >
                <label style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <select
                    value={line.accountId}
                    onChange={(e) => {
                      // Read synchronously — see the phone Pipeline Status note
                      // in CLAUDE.md.
                      const accountId = e.target.value;
                      setLines((rows) => rows.map((r, i) => (i === index ? { ...r, accountId } : r)));
                    }}
                    style={{ ...FIELD, cursor: "pointer", fontSize: isMobile ? 16 : 13.5 }}
                  >
                    <option value="">Choose an account…</option>
                    {open_.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} — {ACCOUNT_KIND_LABELS[account.kind]} · {formatMoney(balances.get(account.id)?.balance ?? 0)}
                      </option>
                    ))}
                  </select>
                  {line.accountId && (
                    /* The balance is shown, never enforced: an account may
                       legitimately go negative — a committee that has paid out
                       more than it has taken in is exactly the case the owner's
                       own sheet shows. Refusing it would be this screen
                       inventing a rule about the business's cash. */
                    <span style={{ fontSize: 11, color: balance < 0 ? E.red : E.faint, fontWeight: 600 }}>
                      Balance {formatMoney(balance)}
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) => {
                    const amount = e.target.value;
                    setLines((rows) => rows.map((r, i) => (i === index ? { ...r, amount } : r)));
                  }}
                  placeholder="0"
                  style={{
                    ...FIELD,
                    width: isMobile ? "100%" : 140,
                    flexShrink: 0,
                    fontVariantNumeric: "tabular-nums",
                    // 16px or iOS Safari zooms the page on focus.
                    fontSize: isMobile ? 16 : 13.5,
                  }}
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove this line"
                    onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                    style={{
                      width: 36, height: 36, flexShrink: 0, borderRadius: 9,
                      border: `1px solid ${E.border}`, background: E.surface,
                      color: E.faint, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="acc-press"
            onClick={() => setLines((rows) => [...rows, { accountId: "", amount: "" }])}
            style={{
              alignSelf: isMobile ? "stretch" : "flex-start",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              borderRadius: 11, border: `1px dashed ${A.hair}`, background: "transparent",
              padding: "10px 14px", fontSize: 13, fontWeight: 700, color: A.tealInk, cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add another account
          </button>
        </div>
      </OverlayCard>

      <OverlayCard title="When">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "160px 1fr" }}>
          <input type="date" value={dayKey} max={karachiDayKey()} onChange={(e) => setDayKey(e.target.value)} style={FIELD} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={FIELD} />
        </div>
      </OverlayCard>

      {/*
        **The allocation meter.** Total, allocated, remaining — and a bar, so
        whether the payment is fully funded is answerable at a glance rather
        than by reading three numbers and subtracting. It turns red the moment
        the lines exceed what is owed, which is the one state that must be
        impossible to miss.
      */}
      <div
        style={{
          padding: "13px 15px", borderRadius: 14,
          border: `1px solid ${over ? "#f0c4bd" : check.fullyFunded ? "#bfe0dc" : A.border}`,
          background: over ? A.negativeBg : check.fullyFunded ? A.tealTint : A.tint,
        }}
        aria-live="polite"
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12.5, fontWeight: 700 }}>
          <span style={{ color: A.muted }}>Total</span>
          <span style={{ color: A.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(outstanding)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>
          <span style={{ color: A.muted }}>Allocated</span>
          <span style={{ color: over ? A.negative : A.ink, fontVariantNumeric: "tabular-nums" }}>{formatMoney(check.allocated)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12.5, fontWeight: 800, marginTop: 4 }}>
          <span style={{ color: A.muted }}>Remaining</span>
          <span style={{ color: check.unallocated === 0 ? A.positive : over ? A.negative : A.pending, fontVariantNumeric: "tabular-nums" }}>
            {formatMoney(Math.abs(check.unallocated))}{over ? " over" : ""}
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round(pct))}
          aria-label="Amount allocated"
          style={{ height: 8, borderRadius: 999, background: "#fff", overflow: "hidden", marginTop: 10, border: `1px solid ${A.softBorder}` }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, pct)}%`,
              background: over ? A.negative : check.fullyFunded ? A.positive : A.teal,
              transition: "width 160ms ease",
            }}
          />
        </div>

        <p style={{ fontSize: 11, color: A.faint, marginTop: 8, lineHeight: 1.5 }}>
          This {copy?.noun ?? (source.direction === "IN" ? "receipt" : "expense")} stays <strong style={{ color: A.muted }}>{formatMoney(source.amount)}</strong>
          {source.alreadyPaid > 0 && <> · {formatMoney(source.alreadyPaid)} already {copy?.settledWord ?? "paid"}</>}
          . The lines above only record where the money comes from.
        </p>
      </div>

      {(error || (started && check.errors.length > 0)) && (
        <p
          role="alert"
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            borderRadius: 10, border: "1px solid #f0c4bd", background: E.redBg,
            padding: "10px 12px", fontSize: 12.5, fontWeight: 600, color: "#a33a29",
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {error ?? check.errors[0]}
        </p>
      )}
      {extra}
    </OverlayPanel>
  );
}
