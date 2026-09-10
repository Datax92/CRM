"use client";

/**
 * Committee and Capital Investment.
 *
 * **Neither is a module.** The owner's own workbook draws both the same way —
 * a named pot with `Amount Received | Description` on one side and
 * `SPENDINGS: Amount Spent | Description` on the other, each totalled — which
 * is an account statement. So each pot here is an account of that kind, and
 * opening one shows the statement in that exact layout.
 *
 * This is what makes "if I pay an office expense from the Committee, it should
 * appear in the Committee" true without anybody writing it: the expense's
 * payment posts a transaction against the Committee account, and this page
 * reads that account's transactions.
 */

import { useState } from "react";
import Link from "next/link";
import { Plus, Landmark, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLedger } from "@/hooks/useLedger";
import { EmptyState, A, CARD, Button, StatusPill, Skeleton } from "./accountsChrome";
import { useIsMobile } from "@/hooks/useIsMobile";

/** The section tokens; `E` was the old alias. */
const E = A;
import { formatMoney } from "@/lib/money";
import { karachiDayKey } from "@/lib/dates";
import { ACCOUNT_KIND_LABELS, type AccountKind } from "@/lib/ledger";
import { createAccount } from "@/lib/clientActions";
import { OverlayPanel, OverlayCard } from "@/components/ui/OverlayPanel";

export function AccountKindView({
  kind, title, blurb, addLabel,
}: {
  kind: AccountKind;
  title: string;
  blurb: string;
  addLabel: string;
}) {
  const { role, getIdToken } = useAuth();
  const ready = role === "admin" || role === "subadmin";
  const { accounts, balances, loading } = useLedger(ready);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [dayKey, setDayKey] = useState(karachiDayKey());
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const mine = accounts.filter((a) => a.kind === kind);

  if (!ready) return <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" body="{title} is for administrators and HR." />;

  return (
    <div style={{ fontFamily: "var(--font-directory), system-ui, sans-serif" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontFamily: "inherit", fontSize: 22, fontWeight: 700, color: E.ink }}>{title}</h1>
          <p style={{ fontSize: 12.5, color: E.faint, maxWidth: 620 }}>{blurb}</p>
        </div>
        <Button primary icon={<Plus size={14} />} full={isMobile} onClick={() => setAdding(true)}>{addLabel}</Button>
      </header>

      {banner && <p role="status" style={{ marginBottom: 12, borderRadius: 10, background: E.tealTint, padding: "10px 13px", fontSize: 12.5, fontWeight: 600, color: E.deep }}>{banner}</p>}

      {loading ? (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(280px,1fr))" }}>
          <Skeleton height={150} count={3} />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState icon={<Wallet size={20} />} title="Nothing here yet" body="No {title.toLowerCase()} yet. Create one, and anything paid from it — an office expense, a
          reimbursement — records itself here automatically." />
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {mine.map((account) => {
            const balance = balances.get(account.id);
            return (
              <Link key={account.id} href={`/admin/accounts/ledger/${account.id}`} className="acc-in acc-lift"
                style={{ ...CARD, display: "block", padding: "16px 18px", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <Landmark size={13} style={{ color: E.teal }} />
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: E.faint }}>
                    {ACCOUNT_KIND_LABELS[account.kind]}
                  </span>
                </div>
                <p style={{ fontSize: 15.5, fontWeight: 700, color: E.ink }}>{account.name}</p>
                {account.status === "ARCHIVED" && <div style={{ marginTop: 4 }}><StatusPill status="ARCHIVED" small /></div>}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${E.rowBorder}`, fontSize: 12 }}>
                  {/*
                    **The pot, not the inflow.** This used to read
                    `balance.inflow` — the sum of money-in *transactions* — which
                    is 0 for a committee, because the amount lives on the account
                    itself and was deliberately never made a transaction. The
                    card said "Received Rs 0" beside a real spend.
                  */}
                  <span style={{ color: E.faint }}>
                    Received{" "}
                    <strong style={{ color: E.tealInk, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(account.openingBalance ?? 0)}
                    </strong>
                  </span>
                  <span style={{ color: E.faint }}>
                    Spent{" "}
                    <strong style={{ color: E.red, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(balance?.outflow ?? 0)}
                    </strong>
                  </span>
                </div>
                {/* The headline figure needs saying what it is — it read as a
                    bare number under two labelled ones. */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 7 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: E.faint }}>Remaining</span>
                  <span style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: (balance?.balance ?? 0) < 0 ? E.red : E.tealInk }}>
                    {formatMoney(balance?.balance ?? 0)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {adding && (
        <OverlayPanel title={addLabel} icon={<Landmark size={18} />} maxWidth={440} onClose={() => setAdding(false)}
          footer={
            <button type="button" disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                // A committee's pot arrives — it is a row under Amount
                // Received, not a silent opening balance. See `actions/ledger`.
                const res = await createAccount(await getIdToken(), {
                  name, kind, openingBalance: Number(opening) || 0, dayKey,
                });
                setBusy(false);
                if (res.ok) { setBanner(`${name.trim()} created.`); setAdding(false); setName(""); setOpening(""); }
              }}
              style={{ borderRadius: 10, border: "none", background: E.teal, color: "#fff", padding: "10px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: busy || !name.trim() ? 0.5 : 1 }}>
              {busy ? "Creating…" : "Create"}
            </button>
          }>
          <OverlayCard title="Details">
            <div style={{ display: "grid", gap: 10 }}>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder={kind === "COMMITTEE" ? "December Committee" : "Car Investment · State Life Loan"}
                style={{ width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: E.muted }}>
                Amount received
                <input type="number" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0"
                  style={{ width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, padding: "9px 11px", fontSize: 16, fontFamily: "inherit", outline: "none" }} />
                <span style={{ fontSize: 11, color: E.faint, fontWeight: 500 }}>
                  The whole pot. Everything you spend out of it comes off this.
                </span>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: E.muted }}>
                Date
                <input type="date" value={dayKey} max={karachiDayKey()} onChange={(e) => setDayKey(e.target.value)}
                  style={{ width: "100%", borderRadius: 9, border: `1px solid ${E.border}`, padding: "9px 11px", fontSize: 16, fontFamily: "inherit", outline: "none" }} />
              </label>
            </div>
          </OverlayCard>
        </OverlayPanel>
      )}
    </div>
  );
}
