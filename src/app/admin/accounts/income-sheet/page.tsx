"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useIncomeSheet } from "@/hooks/useIncomeSheet";
import { Search } from "lucide-react";
import { Banner, FullPageSpinner, ResponsiveTableWrapper, TableRow, TableCell } from "@/components/admin/AdminShared";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { formatMoney, formatNegativeMoney } from "@/lib/money";
import { formatBusinessDate, resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";

const TYPE_COLORS: Record<string, string> = {
  INCOME: "bg-emerald-100 text-emerald-800",
  RECEIVABLE: "bg-teal-100 text-teal-800",
  OFFICE_EXPENSE: "bg-amber-100 text-amber-800",
  PERSONAL_EXPENSE: "bg-rose-100 text-rose-800",
  COMMITTEE: "bg-purple-100 text-purple-800",
  INVESTMENT: "bg-blue-100 text-blue-800",
  CAPITAL_INVESTMENT: "bg-indigo-100 text-indigo-800",
};

export default function IncomeSheetPage() {
  const { role, loading: authLoading } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const [rangeKey, setRangeKey] = useState<RangeKey>("MONTH");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const { ledger, totals, loading: dataLoading, error: dataError } = useIncomeSheet(range, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");

  const visibleLedger = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((entry) =>
      entry.title.toLowerCase().includes(q)
    );
  }, [ledger, searchQuery]);

  if (authLoading || dataLoading) return <FullPageSpinner />;

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4 mb-2">
        <h1 className="text-2xl font-bold text-slate-900">Income Sheet</h1>
        <p className="text-sm text-slate-500">Aggregated view of all revenue and expenses.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Total Income</p>
          <p className="text-2xl font-bold text-success truncate">{formatMoney(totals.totalIncome)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Total Expenses</p>
          <p className="text-2xl font-bold text-critical truncate">{formatNegativeMoney(totals.totalExpenses)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between border-l-4 border-l-indigo-600">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Net Balance</p>
          <p className={`text-2xl font-bold truncate ${totals.netBalance >= 0 ? "text-success" : "text-critical"}`}>
            {formatMoney(totals.netBalance)}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm justify-between items-center">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SelectPill label="Period" value={rangeKey} onChange={(v) => setRangeKey(v as RangeKey)}>
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <SelectOption key={key} value={key}>{RANGE_LABELS[key]}</SelectOption>
            ))}
          </SelectPill>
        </div>
      </div>

      {dataError && (
        <div className="space-y-2">
          <Banner tone="error" text={dataError} />
        </div>
      )}

      <ResponsiveTableWrapper minWidth={600}>
        <table className="w-full text-sm text-slate-900">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Transaction</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleLedger.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{entry.title}</div>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${TYPE_COLORS[entry.type] || "bg-slate-100 text-slate-800"}`}>
                    {entry.type.replace('_', ' ')}
                  </span>
                </TableCell>
                <TableCell>{formatBusinessDate(entry.date)}</TableCell>
                <TableCell numeric tone={["INCOME", "RECEIVABLE"].includes(entry.type) ? "positive" : "negative"}>
                  {["INCOME", "RECEIVABLE"].includes(entry.type) ? formatMoney(entry.amount) : formatNegativeMoney(entry.amount)}
                </TableCell>
              </TableRow>
            ))}
            {visibleLedger.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No transactions match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </div>
  );
}

