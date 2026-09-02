"use client";

/**
 * "What have I earned?" — one person's share of the deals they worked.
 *
 * Rendered by the employee's own earnings page and by a sub admin's, because
 * the question and the answer are the same shape; only the scope differs, and
 * that is decided by the query in `useMyPayouts`, not here.
 *
 * **This screen can only ever show what its reader is entitled to see** (§22).
 * It reads `dealPayouts`, where each row carries one recipient's own number and
 * nothing else — the full split, including the company's share and every other
 * recipient's percentage, lives in a collection only the admin can read. So
 * there is no filtering to get wrong in this component: the database will not
 * hand it anything it should not draw.
 */

import { useMemo } from "react";
import { Wallet, TrendingUp, Users } from "lucide-react";
import { useMyPayouts } from "@/hooks/useDistributions";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate } from "@/lib/dates";

export function EarningsPanel({
  uid,
  scope,
  enabled = true,
}: {
  uid: string | undefined;
  /** `self` for an employee; `team` for a sub admin, which includes their own. */
  scope: "self" | "team";
  enabled?: boolean;
}) {
  const { payouts, loading, error } = useMyPayouts(uid, scope, enabled);

  const totals = useMemo(() => {
    const mine = payouts.filter((payout) => payout.recipientUid === uid);
    return {
      mine: mine.reduce((total, payout) => total + payout.amount, 0),
      mineCount: mine.length,
      team: payouts.reduce((total, payout) => total + payout.amount, 0),
      teamCount: payouts.length,
    };
  }, [payouts, uid]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-7 sm:px-7">
      <header className="mb-6 flex items-center gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: "#e2f0ee", color: "#2f7d78" }}
          aria-hidden
        >
          <Wallet size={20} />
        </span>
        <div>
          <h1 className="text-[22px] font-semibold text-[#1f3b39]">
            {scope === "team" ? "Team Earnings" : "My Earnings"}
          </h1>
          <p className="text-[13px] text-[#7e918f]">
            Your share of every deal the admin has finalised.
          </p>
        </div>
      </header>

      <div className={`mb-6 grid gap-4 ${scope === "team" ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        <Tile
          icon={<TrendingUp size={16} />}
          label="My total"
          value={formatMoney(totals.mine)}
          note={`${totals.mineCount} deal${totals.mineCount === 1 ? "" : "s"}`}
        />
        {scope === "team" && (
          <Tile
            icon={<Users size={16} />}
            label="Team total"
            value={formatMoney(totals.team)}
            note={`${totals.teamCount} payout${totals.teamCount === 1 ? "" : "s"} across your team`}
          />
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-[#f0c4bd] bg-[#fdeeeb] p-3.5 text-xs text-[#a33a29]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="rounded-xl border border-dashed border-[#cfe2e0] bg-white/70 p-8 text-center text-[13px] text-[#7e918f]">
          Loading…
        </p>
      ) : payouts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#cfe2e0] bg-white/70 p-8 text-center text-[13px] text-[#7e918f]">
          Nothing yet. A share appears here once the admin finalises the distribution for a deal
          you were part of.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#e0eeec] bg-white">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-[#f0f6f5] text-left text-[11px] tracking-[0.6px] text-[#7e918f] uppercase">
                <th className="px-4 py-3 font-semibold">Client</th>
                {scope === "team" && <th className="px-4 py-3 font-semibold">Recipient</th>}
                <th className="w-[86px] px-4 py-3 text-right font-semibold">Share</th>
                <th className="w-[130px] px-4 py-3 text-right font-semibold">Amount</th>
                <th className="w-[120px] px-4 py-3 text-right font-semibold">Finalised</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr key={payout.id} className="border-b border-[#f6faf9] last:border-0">
                  <td className="truncate px-4 py-3 text-[13px] text-[#1f3b39]">
                    {payout.customerName ?? "Client"}
                  </td>
                  {scope === "team" && (
                    <td className="truncate px-4 py-3 text-[13px] text-[#5b6d6b]">
                      {payout.recipientUid === uid ? "You" : payout.recipientName}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[#5b6d6b]">
                    {payout.percentage}%
                  </td>
                  <td className="px-4 py-3 text-right text-[13px] font-semibold tabular-nums text-[#2f7d78]">
                    {formatMoney(payout.amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-[#9aacaa]">
                    {payout.finalizedAt ? formatBusinessDate(payout.finalizedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The one thing this screen deliberately does not show, said plainly —
          otherwise its absence reads as a bug. */}
      <p className="mt-4 text-[12px] text-[#9aacaa]">
        {scope === "team"
          ? "Company profit and other sub admins' shares are not shown here — only your own team's."
          : "Only your own share is shown. Company profit and colleagues' commissions are not visible."}
      </p>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-[#e0eeec] bg-white px-5 py-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.6px] text-[#7e918f] uppercase">
        <span style={{ color: "#2f7d78" }} aria-hidden>
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-1.5 text-[22px] font-bold tabular-nums text-[#1f3b39]">{value}</p>
      <p className="text-[12px] text-[#9aacaa]">{note}</p>
    </div>
  );
}
