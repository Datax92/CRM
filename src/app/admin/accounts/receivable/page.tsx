"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useReceivables } from "@/hooks/useReceivables";
import { Search, Plus } from "lucide-react";
import { Banner, FullPageSpinner, ResponsiveTableWrapper, TableRow, TableCell, LabelledInput } from "@/components/admin/AdminShared";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { Modal } from "@/components/ui/Modal";
import { addReceivable, RECEIVABLE_SIZES } from "@/lib/clientActions";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";

export default function ReceivablesPage() {
  const { role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const [rangeKey, setRangeKey] = useState<RangeKey>("MONTH");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const { receivables, loading: dataLoading, error: dataError } = useReceivables(range, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<string>("Small");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()));
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const visibleReceivables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return receivables;
    return receivables.filter((rec) =>
      rec.title.toLowerCase().includes(q)
    );
  }, [receivables, searchQuery]);

  const totalReceivables = useMemo(() => {
    return receivables.reduce((sum, rec) => sum + (Number(rec.amount) || 0), 0);
  }, [receivables]);

  if (authLoading || dataLoading) return <FullPageSpinner />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await addReceivable(token, { title, size, amount: Number(amount), date });
      if (res.ok) {
        setBanner({ tone: "success", text: "Receivable recorded." });
        setIsOpen(false);
        setTitle("");
        setAmount("");
      } else {
        setBanner({ tone: "error", text: res.error || "Failed to record receivable." });
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
          <h1 className="text-2xl font-bold text-slate-900">Receivables</h1>
          <p className="text-sm text-slate-500">Track and manage incoming receivables.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-w-[200px]">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Receivables (This Period)</p>
          <p className="text-xl font-bold text-indigo-600 mt-1">
            {formatMoney(totalReceivables)}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm justify-between items-center">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search receivables..."
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
            <Plus size={16} /> Log Receivable
          </button>
        </div>
      </div>

      {(dataError || banner) && (
        <div className="space-y-2">
          {dataError && <Banner tone="error" text={dataError} />}
          {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}
        </div>
      )}

      <ResponsiveTableWrapper minWidth={600}>
        <table className="w-full text-sm text-slate-900">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-4 py-3 text-left">Receivable Item</th>
              <th className="px-4 py-3 text-left">Size</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleReceivables.map((rec) => (
              <TableRow key={rec.id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{rec.title}</div>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    rec.size === "Large" ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-800"
                  }`}>
                    {rec.size}
                  </span>
                </TableCell>
                <TableCell>{formatBusinessDate(rec.date)}</TableCell>
                <TableCell numeric tone="positive">{formatMoney(rec.amount)}</TableCell>
              </TableRow>
            ))}
            {visibleReceivables.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No receivables match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <Modal isOpen={isOpen} onClose={() => !busy && setIsOpen(false)} title="Record receivable">
        <form onSubmit={submit} className="space-y-4">
          <LabelledInput id="rec-title" label="What was this for?" required value={title} onChange={setTitle} disabled={busy} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:opacity-50"
              disabled={busy}
            >
              {RECEIVABLE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <LabelledInput id="rec-amt" type="number" label="Amount (PKR)" required min="0" step="0.01" value={amount} onChange={setAmount} disabled={busy} />
          <LabelledInput id="rec-date" type="date" label="Date incurred" required value={date} onChange={setDate} disabled={busy} />
          <div className="pt-2">
            <button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50">
              {busy ? "Recording..." : "Record receivable"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

