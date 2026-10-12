"use client";

/**
 * **Every payment made against a book of expenses, by the account it came out
 * of — and the way to take one back.**
 *
 * Opened from the *Paid Back* card. The owner's case: expenses were paid from a
 * temporary account, the income has now arrived, and they want those payments
 * undone so the expenses can be paid again from the income.
 *
 * Reversing never deletes (`reversePayments`): the payment stays on the
 * account's statement marked reversed, an equal leg puts the money back into
 * that account, and the expense becomes payable again. Reversed payments stay
 * listed here under *Reversed*, so the trail is never lost.
 */

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";
import { formatMoney } from "@/lib/money";
import { reversePayments } from "@/lib/clientActions";
import { TONE, X, designField, designLabel } from "@/components/finance/expensesChrome";

export interface PaymentLine {
  id: string;
  accountId: string;
  accountName: string;
  amount: number;
  dayKey: string;
  expenseTitle: string;
  expenseDayKey: string | null;
  note: string | null;
  by: string | null;
  reversed: boolean;
  reversedByName: string | null;
}

type Show = "ACTIVE" | "REVERSED" | "ALL";

export function PaymentsPanel({ title, subtitle, payments, isMobile, getIdToken, onClose, onDone }: {
  title: string;
  subtitle: string;
  payments: PaymentLine[];
  isMobile: boolean;
  getIdToken: () => Promise<string>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [account, setAccount] = useState("ALL");
  const [show, setShow] = useState<Show>("ACTIVE");
  const [confirming, setConfirming] = useState<PaymentLine[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** One option per account that has paid anything, with what it paid that is still standing. */
  const accounts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; total: number }>();
    for (const line of payments) {
      const entry = map.get(line.accountId) ?? { id: line.accountId, name: line.accountName, count: 0, total: 0 };
      if (!line.reversed) {
        entry.count += 1;
        entry.total += line.amount;
      }
      map.set(line.accountId, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [payments]);

  const listed = useMemo(
    () => payments
      .filter((line) => account === "ALL" || line.accountId === account)
      .filter((line) => show === "ALL" || (show === "ACTIVE" ? !line.reversed : line.reversed))
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey) || a.expenseTitle.localeCompare(b.expenseTitle)),
    [payments, account, show]
  );
  const reversible = listed.filter((line) => !line.reversed);
  const listedTotal = listed.reduce((sum, line) => sum + line.amount, 0);
  const field = { ...designField, fontSize: isMobile ? 16 : 13.5 };

  const confirm = async () => {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    const result = await reversePayments(await getIdToken(), confirming.map((line) => line.id), note.trim() || null);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    const { reversed, amount, skipped } = result.data;
    const where = new Set(confirming.map((line) => line.accountName));
    onDone(
      `${reversed} payment${reversed === 1 ? "" : "s"} reversed — ${formatMoney(amount)} back into ${[...where].join(", ")}. `
      + `Those expenses are unpaid again; use Pay from… or Pay total to pay them from another account.`
      + (skipped > 0 ? ` ${skipped} were already reversed and were left alone.` : "")
    );
    setConfirming(null);
    setNote("");
  };

  const button = (tone: "bad" | "quiet") => ({
    borderRadius: 10,
    border: tone === "bad" ? "1px solid #f0c4bd" : `1px solid ${X.line}`,
    background: tone === "bad" ? "#fdeeec" : "#fff",
    color: tone === "bad" ? "#a8483c" : X.muted,
    padding: "8px 13px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap" as const,
  });

  if (confirming) {
    const total = confirming.reduce((sum, line) => sum + line.amount, 0);
    const byAccount = new Map<string, number>();
    for (const line of confirming) byAccount.set(line.accountName, (byAccount.get(line.accountName) ?? 0) + line.amount);
    return (
      <OverlayPanel title={confirming.length === 1 ? "Reverse this payment?" : `Reverse ${confirming.length} payments?`} subtitle={subtitle}
        icon={<RotateCcw size={18} />} maxWidth={520} onClose={() => setConfirming(null)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
            <button type="button" onClick={() => setConfirming(null)} style={button("quiet")}>Back</button>
            <button type="button" disabled={busy} onClick={() => void confirm()}
              style={{ ...button("bad"), background: "#a8483c", color: "#fff", border: "none", opacity: busy ? 0.5 : 1, padding: "10px 18px" }}>
              {busy ? "Reversing…" : `Reverse ${formatMoney(total)}`}
            </button>
          </div>
        }>
        <OverlayCard title="What happens">
          <div style={{ padding: "14px 16px", display: "grid", gap: 8, fontSize: 13, color: X.ink, lineHeight: 1.6 }}>
            {[...byAccount].map(([name, amount]) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span><strong>{formatMoney(amount)}</strong> goes back into <strong>{name}</strong></span>
              </div>
            ))}
            <p style={{ fontSize: 12, color: X.faint, margin: 0 }}>
              {confirming.length === 1 ? "The expense becomes" : `These ${confirming.length} expense payments make their expenses`} unpaid again,
              ready to be paid from another account. Nothing is deleted: each payment stays on the account&apos;s statement marked
              reversed, next to the entry that put the money back, and the expense&apos;s history says so.
            </p>
          </div>
        </OverlayCard>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
          <span>Reason (optional)</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Paid from the temporary UBL account; paying from income instead" style={field} />
        </label>
        {error && <p role="alert" style={{ color: "#a33a29", fontSize: 12.5, fontWeight: 600 }}>{error}</p>}
      </OverlayPanel>
    );
  }

  return (
    <OverlayPanel title={title} subtitle={subtitle} icon={<RotateCcw size={18} />} maxWidth={760} onClose={onClose}>
      <div style={{ display: "grid", gap: 11, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
          <span>Paid from</span>
          <select value={account} onChange={(event) => setAccount(event.target.value)} style={field}>
            <option value="ALL">Every account</option>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} — {option.count} payment{option.count === 1 ? "" : "s"}, {formatMoney(option.total)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, ...designLabel }}>
          <span>Show</span>
          <select value={show} onChange={(event) => setShow(event.target.value as Show)} style={field}>
            <option value="ACTIVE">Standing payments</option>
            <option value="REVERSED">Reversed</option>
            <option value="ALL">Both</option>
          </select>
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: X.muted, fontWeight: 600 }}>
          {listed.length} payment{listed.length === 1 ? "" : "s"} · {formatMoney(listedTotal)}
        </span>
        {reversible.length > 1 && (
          <button type="button" onClick={() => setConfirming(reversible)} style={button("bad")}>
            <RotateCcw size={14} /> Reverse all {reversible.length} listed
          </button>
        )}
      </div>

      <div style={{ border: `1px solid ${X.line}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
        {listed.length === 0 && (
          <p style={{ padding: "22px 16px", fontSize: 13, color: X.faint, textAlign: "center" }}>
            {show === "REVERSED" ? "Nothing has been reversed." : "No payments match."}
          </p>
        )}
        {listed.map((line, index) => (
          <div key={line.id}
            style={{
              display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: 12, padding: "12px 16px",
              flexDirection: isMobile ? "column" : "row",
              borderTop: index === 0 ? "none" : `1px solid ${X.line}`,
              opacity: line.reversed ? 0.7 : 1,
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: X.ink, textDecoration: line.reversed ? "line-through" : "none" }}>{line.expenseTitle}</div>
              <div style={{ fontSize: 11.5, color: X.faint, marginTop: 3 }}>
                {[
                  `from ${line.accountName}`,
                  `paid ${line.dayKey}`,
                  line.expenseDayKey ? `expense ${line.expenseDayKey}` : null,
                  line.by ? `by ${line.by}` : null,
                  line.reversed ? `reversed${line.reversedByName ? ` by ${line.reversedByName}` : ""}` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {line.note && <div style={{ fontSize: 11.5, color: X.faint, marginTop: 2 }}>{line.note}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: X.ink }}>{formatMoney(line.amount)}</span>
              {line.reversed
                ? <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: TONE.quiet.tint, color: TONE.quiet.color }}>Reversed</span>
                : <button type="button" onClick={() => setConfirming([line])} style={button("bad")}><RotateCcw size={13} /> Reverse</button>}
            </div>
          </div>
        ))}
      </div>
    </OverlayPanel>
  );
}
