"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useFinancials } from "@/hooks/useFinancials";
import { Search, Plus } from "lucide-react";
import { Banner, FullPageSpinner, ResponsiveTableWrapper, TableRow, TableCell, LabelledInput } from "@/components/admin/AdminShared";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { Modal } from "@/components/ui/Modal";
import { addExpense, EXPENSE_CATEGORIES } from "@/lib/clientActions";
import { formatMoney, formatNegativeMoney } from "@/lib/money";
import { formatBusinessDate, resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";

export default function ExpensesPage() {
  const { role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const [rangeKey, setRangeKey] = useState<RangeKey>("MONTH");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const { expenses, totals, loading: finLoading, error: finError } = useFinancials(range, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("Marketing");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()));
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const visibleExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((exp) =>
      exp.title.toLowerCase().includes(q) ||
      (exp.description ?? "").toLowerCase().includes(q)
    );
  }, [expenses, searchQuery]);

  if (authLoading || finLoading) return <FullPageSpinner />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await addExpense(token, { title, category, amount: Number(amount), description, date });
      if (res.ok) {
        setBanner({ tone: "success", text: "Expense recorded." });
        setIsOpen(false);
        setTitle("");
        setAmount("");
        setDescription("");
      } else {
        setBanner({ tone: "error", text: res.error || "Failed to record expense." });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Office Expenses</h1>
          <p className="text-sm text-slate-500">Track and manage operational and marketing expenses.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-w-[200px]">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Expenses (This Period)</p>
          <p className="text-xl font-bold text-red-600 mt-1">
            {formatMoney(totals?.totalExpenses ?? 0)}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm justify-between items-center">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search expenses..."
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
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors w-full lg:w-auto justify-center"
          >
            <Plus size={16} /> Log Expense
          </button>
        </div>
      </div>

      {(finError || banner) && (
        <div className="space-y-2">
          {finError && <Banner tone="error" text={finError} />}
          {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
        </div>
      )}

      <ResponsiveTableWrapper minWidth={600}>
        <table className="w-full text-sm text-slate-900">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Expense Item</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleExpenses.map((exp) => (
              <TableRow key={exp.id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{exp.title}</div>
                  {exp.description && <div className="text-xs text-slate-500">{exp.description}</div>}
                </TableCell>
                <TableCell>{exp.category}</TableCell>
                <TableCell>{formatBusinessDate(exp.date)}</TableCell>
                <TableCell numeric tone="negative">{formatNegativeMoney(exp.amount)}</TableCell>
              </TableRow>
            ))}
            {visibleExpenses.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No expenses match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <Modal isOpen={isOpen} onClose={() => !busy && setIsOpen(false)} title="Record expense">
        <form onSubmit={submit} className="space-y-4">
          <LabelledInput id="exp-title" label="What was this for?" required value={title} onChange={setTitle} disabled={busy} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:opacity-50"
              disabled={busy}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <LabelledInput id="exp-amt" type="number" label="Amount (PKR)" required min="0" step="0.01" value={amount} onChange={setAmount} disabled={busy} />
          <LabelledInput id="exp-date" type="date" label="Date incurred" required value={date} onChange={setDate} disabled={busy} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Notes (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <div className="pt-2">
            <button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50">
              {busy ? "Recording..." : "Record expense"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

