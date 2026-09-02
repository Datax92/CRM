"use client";

import { useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useLeads } from "@/hooks/useLeads";
import { useFinancials } from "@/hooks/useFinancials";
import { DEFAULT_JOB_TITLE } from "@/lib/constants/roles";
import { buildEmployeeMetrics } from "@/lib/metrics";
import { FullPageSpinner, Kpi } from "@/components/admin/AdminShared";
import { DollarSign, BarChart3, Target, Activity } from "lucide-react";
import { formatMoney } from "@/lib/money";

export default function MyStatsPage() {
  const { role, loading: authLoading, user } = useAuth();
  useProtectedRoute(["employee"]);
  const { leads, loading: leadsLoading } = useLeads(user?.uid ? "employee" : null, user?.uid);
  const { allDeals, loading: finLoading } = useFinancials({ key: "ALL", from: null, to: null, label: "ALL" }, false);

  const myMetrics = useMemo(() => {
    if (!user?.uid) return null;
    const metricsArray = buildEmployeeMetrics([{ uid: user.uid, email: user.email || "", name: user.email?.split("@")[0] || "Me", status: "ACTIVE", priority: 1, jobTitle: DEFAULT_JOB_TITLE }], leads, allDeals);
    return metricsArray[0] || null;
  }, [user, leads, allDeals]);

  if (authLoading || leadsLoading || finLoading) return <FullPageSpinner />;

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

