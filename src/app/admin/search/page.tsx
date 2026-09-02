"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useEmployees } from "@/hooks/useEmployees";
import { useFinancials, type DealRecord } from "@/hooks/useFinancials";
import { ClosedDealRecord } from "@/components/financials/ClosedDealRecord";
import { LeadDetailModal } from "@/components/LeadDetailModal";
import { LeadSection, FullPageSpinner, Banner, ResponsiveTableWrapper, TableRow, TableCell } from "@/components/admin/AdminShared";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatBusinessDate, resolveRange } from "@/lib/dates";
import { Search as SearchIcon } from "lucide-react";

/** Search field text pulled from a lead. */
function leadHaystack(lead: Lead): string {
  return [lead.name, lead.phone, lead.email, lead.city, lead.campaignName, lead.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Search field text pulled from a closed deal / customer record. */
function dealHaystack(deal: DealRecord): string {
  return [
    deal.customer?.name,
    deal.customer?.phone,
    deal.customer?.email,
    deal.customer?.cnic,
    deal.customer?.city,
    deal.campaignName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const RESULT_CAP = 50;

function GlobalSearchInner() {
  const { user, role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";
  const router = useRouter();
  const searchParams = useSearchParams();

  const { leads, loading: leadsLoading, error: leadsError } = useLeads(isAdmin ? "admin" : null);
  const { employees, error: employeesError } = useEmployees(isAdmin);
  const { allDeals, loading: dealsLoading, error: dealsError } = useFinancials(
    useMemo(() => resolveRange("ALL"), []),
    isAdmin
  );

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [viewingLead, setViewingLead] = useState<Lead | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<DealRecord | null>(null);

  const employeeName = (uid: string | null | undefined) => employees.find((e) => e.uid === uid)?.name;

  const q = query.trim().toLowerCase();

  const matchedLeads = useMemo(() => {
    if (q.length < 2) return [];
    return leads.filter((lead) => leadHaystack(lead).includes(q)).slice(0, RESULT_CAP);
  }, [leads, q]);

  const matchedDeals = useMemo(() => {
    if (q.length < 2) return [];
    return allDeals.filter((deal) => dealHaystack(deal).includes(q)).slice(0, RESULT_CAP);
  }, [allDeals, q]);

  const submitQuery = (value: string) => {
    setQuery(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    router.replace(`/admin/search${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const loading = authLoading || (isAdmin && (leadsLoading || dealsLoading));
  if (loading) return <FullPageSpinner />;
  if (!user || !isAdmin) return null;

  const hasQuery = q.length >= 2;
  const totalResults = matchedLeads.length + matchedDeals.length;

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">Search</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Look up a lead or a customer by name, phone, email, CNIC, city, or campaign — across every stage and closed deal.
        </p>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)]">
        <div className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3.5 text-slate-400" size={16} />
          <input
            type="text"
            autoFocus
            placeholder="Search leads and customers (name, phone, email, CNIC, city, campaign)..."
            value={query}
            onChange={(e) => submitQuery(e.target.value)}
            className="w-full bg-slate-50/50 border border-slate-200/80 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-800 focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all placeholder:text-slate-400"
          />
        </div>
        {query.trim().length > 0 && query.trim().length < 2 && (
          <p className="text-xs text-slate-400 mt-2 pl-1">Keep typing — at least 2 characters.</p>
        )}
      </div>

      {(leadsError || employeesError || dealsError) && (
        <div className="space-y-2">
          {leadsError && <Banner tone="error" text={leadsError} />}
          {employeesError && <Banner tone="error" text={employeesError} />}
          {dealsError && <Banner tone="error" text={dealsError} />}
        </div>
      )}

      {!hasQuery ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
          Start typing to search across active, new, and closed leads, plus every closed deal&apos;s customer record.
        </div>
      ) : (
        <div className="space-y-8">
          <p className="text-xs text-slate-400">
            {totalResults} result{totalResults === 1 ? "" : "s"} for &ldquo;{query.trim()}&rdquo;
            {(matchedLeads.length === RESULT_CAP || matchedDeals.length === RESULT_CAP) && " (showing top matches)"}
          </p>

          <LeadSection
            title="Leads"
            leads={matchedLeads}
            actionText="View"
            onLeadClick={(lead) => setViewingLead(lead)}
            employeeName={employeeName}
            emptyText="No leads match this search."
          />

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
                <span>Closed Deals / Customers</span>
                <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  {matchedDeals.length}
                </span>
              </h2>
            </div>

            {matchedDeals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
                No closed deals match this search.
              </div>
            ) : (
              <ResponsiveTableWrapper minWidth={720}>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-5 py-3.5">Customer</th>
                      <th className="px-5 py-3.5">Closed By</th>
                      <th className="px-5 py-3.5">Campaign</th>
                      <th className="px-5 py-3.5">Closed Date</th>
                      <th className="px-5 py-3.5 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {matchedDeals.map((deal) => (
                      <TableRow key={deal.id} onClick={() => setSelectedDeal(deal)}>
                        <TableCell>
                          <div className="font-semibold text-slate-900">{deal.customer?.name || "Unknown"}</div>
                          <div className="text-xs text-slate-400 font-normal mt-0.5">
                            {deal.customer?.phone ? formatPhone(deal.customer.phone) : deal.customer?.email || "No contact info"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-slate-700 font-medium text-xs">{employeeName(deal.userId) || "Unknown"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-slate-800 font-medium text-xs">{deal.campaignName || "Organic / None"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-slate-600 text-xs">
                            {deal.dealDate ? formatBusinessDate(deal.dealDate) : deal.enteredAt ? formatBusinessDate(deal.enteredAt) : "N/A"}
                          </span>
                        </TableCell>
                        <TableCell numeric>
                          <span className="font-semibold text-emerald-700 text-xs">{formatMoney(deal.amountReceived)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
            )}
          </section>
        </div>
      )}

      {viewingLead && (
        <LeadDetailModal
          lead={leads.find((l) => l.id === viewingLead.id) || viewingLead}
          onClose={() => setViewingLead(null)}
          userRole="admin"
          getIdToken={getIdToken}
          assigneeName={employeeName(viewingLead.assignedUserId)}
        />
      )}

      {selectedDeal && (
        <ClosedDealRecord
          deal={selectedDeal}
          employeeName={employeeName(selectedDeal.userId)}
          isAdmin
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </div>
  );
}

export default function GlobalSearchPage() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <GlobalSearchInner />
    </Suspense>
  );
}
