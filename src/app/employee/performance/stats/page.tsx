"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useLeads } from "@/hooks/useLeads";
import { useMyDeals } from "@/hooks/useFinancials";
import { useMyProfile } from "@/hooks/useEmployees";
import { resolveRange } from "@/lib/dates";
import { buildEmployeeMetrics } from "@/lib/metrics";
import { FullPageSpinner, Kpi } from "@/components/admin/AdminShared";
import { DollarSign, BarChart3, Target, Activity } from "lucide-react";
import { formatMoney } from "@/lib/money";

/** Lifetime, as the heading says — resolved once at module scope. */
const ALL_TIME = resolveRange("ALL");

export default function MyStatsPage() {
  const { loading: authLoading, user } = useAuth();
  useProtectedRoute(["employee"]);
  const { leads, loading: leadsLoading } = useLeads(user?.uid ? "employee" : null, user?.uid);
  /*
    **Their own closed deals, not the company's.**

    This used to call `useFinancials(…, false)` — the whole-company deals query,
    switched **off**. So `allDeals` was permanently `[]` and every figure derived
    from it, including the "Profit Generated" card at the top of this page, read
    Rs 0 for everybody for ever. The data was never unavailable: an employee may
    read `closedDeals where userId == me`, which is exactly what `useMyDeals`
    asks and what the Security Rule is written to allow.
  */
  const { deals: myDeals, loading: dealsLoading } = useMyDeals(user?.uid, ALL_TIME);
  // Their real name and job title, rather than the local part of their email
  // and a hardcoded default.
  const { name, jobTitle, loading: profileLoading } = useMyProfile(user?.uid);

  const myMetrics = useMemo(() => {
    if (!user?.uid) return null;
    const metricsArray = buildEmployeeMetrics(
      [{
        uid: user.uid,
        email: user.email || "",
        name: name ?? user.email?.split("@")[0] ?? "Me",
        status: "ACTIVE",
        priority: 1,
        jobTitle: jobTitle ?? "",
      }],
      leads,
      myDeals
    );
    return metricsArray[0] || null;
  }, [user, leads, myDeals, name, jobTitle]);

  if (authLoading || leadsLoading || dealsLoading || profileLoading) return <FullPageSpinner />;

  if (!myMetrics) {
    return (
      <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">My Stats</h1>
        <div className="text-slate-500">Unable to load your performance data.</div>
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold text-slate-900">My Stats</h1>
        <p className="text-sm text-slate-500">Your lifetime performance and conversion metrics.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi 
          label="Profit Generated" 
          value={formatMoney(myMetrics.profit)} 
          hint="Lifetime profit" 
          icon={DollarSign} 
          tone={myMetrics.profit >= 0 ? "positive" : "negative"} 
        />
        <Kpi 
          label="Closed Won" 
          value={myMetrics.closedWon.toString()} 
          hint="Successful deals" 
          icon={Target} 
          tone="positive" 
        />
        <Kpi 
          label="Closed Lost" 
          value={myMetrics.lost.toString()} 
          hint="Unsuccessful leads" 
          icon={BarChart3} 
          tone="negative" 
        />
        <Kpi 
          label="Total Handled" 
          value={myMetrics.assigned.toString()} 
          hint="All assigned leads" 
          icon={Activity} 
        />
      </div>
    </div>
  );
}

