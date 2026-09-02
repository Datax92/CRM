"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useInvestments } from "@/hooks/useAccounts";
import { Search, Plus } from "lucide-react";
import { Banner, FullPageSpinner, ResponsiveTableWrapper, TableRow, TableCell, LabelledInput } from "@/components/admin/AdminShared";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { Modal } from "@/components/ui/Modal";
import { addInvestmentRecord } from "@/lib/clientActions";
import { formatMoney } from "@/lib/money";
import { formatBusinessDate, resolveRange, RANGE_LABELS, type RangeKey } from "@/lib/dates";

export default function InvestmentPage() {
  const { role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const [rangeKey, setRangeKey] = useState<RangeKey>("MONTH");
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const { records, loading: dataLoading, error: dataError } = useInvestments(range, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date()));
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const visibleRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter((rec) =>
      rec.title.toLowerCase().includes(q) || (rec.description ?? "").toLowerCase().includes(q)
    );
  }, [records, searchQuery]);

  const totalAmount = useMemo(() => {
    return records.reduce((sum, rec) => sum + (Number(rec.amount) || 0), 0);
  }, [records]);

  if (authLoading || dataLoading) return <FullPageSpinner />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await addInvestmentRecord(token, { title, description, amount: Number(amount), date });
      if (res.ok) {
        setBanner({ tone: "success", text: "Record added successfully." });
        setIsOpen(false);
        setTitle("");
        setDescription("");
        setAmount("");
      } else {
        setBanner({ tone: "error", text: res.error || "Failed to add record." });
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
          <h1 className="text-2xl font-bold text-slate-900">Investment</h1>
          <p className="text-sm text-slate-500">Track and manage investments.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm min-w-[200px]">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Investment (This Period)</p>
          <p className="text-xl font-bold text-indigo-600 mt-1">
            {formatMoney(totalAmount)}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm justify-between items-center">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="search"
            placeholder="Search records..."
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
            <Plus size={16} /> Add Record
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
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleRecords.map((rec) => (
              <TableRow key={rec.id}>
                <TableCell>
                  <div className="font-semibold text-slate-900">{rec.title}</div>
                  {rec.description && <div className="text-xs text-slate-500">{rec.description}</div>}
                </TableCell>
                <TableCell>{formatBusinessDate(rec.date)}</TableCell>
                <TableCell numeric tone="positive">{formatMoney(rec.amount)}</TableCell>
              </TableRow>
            ))}
            {visibleRecords.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                  No records match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTableWrapper>

      <Modal isOpen={isOpen} onClose={() => !busy && setIsOpen(false)} title="Add Investment Record">
        <form onSubmit={submit} className="space-y-4">
          <LabelledInput id="rec-title" label="Title" required value={title} onChange={setTitle} disabled={busy} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <LabelledInput id="rec-amt" type="number" label="Amount (PKR)" required min="0" step="0.01" value={amount} onChange={setAmount} disabled={busy} />
          <LabelledInput id="rec-date" type="date" label="Date incurred" required value={date} onChange={setDate} disabled={busy} />
          <div className="pt-2">
            <button type="submit" disabled={busy} className="w-full bg-primary hover:bg-primary/90 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50">
              {busy ? "Saving..." : "Save record"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

