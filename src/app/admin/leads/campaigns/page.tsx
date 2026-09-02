"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useLeads, type Lead } from "@/hooks/useLeads";
import { useEmployees } from "@/hooks/useEmployees";
import { useFinancials } from "@/hooks/useFinancials";
import { useCampaigns, type CampaignSummary } from "@/hooks/useCampaigns";
import { resolveRange, RANGE_LABELS, type RangeKey, formatBusinessDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { createCampaign } from "@/lib/clientActions";
import { SelectPill, SelectOption } from "@/app/admin/SelectPill";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { TablePanel, AdminTable, AdminThead, AdminTh, AdminTbody, AdminTr, AdminTd, EmptyTableState } from "@/components/ui/AdminTable";
import { Modal } from "@/components/ui/Modal";
import { DateTimePicker } from "@/components/ui/DateTimePicker";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { LeadDetailModal } from "@/components/LeadDetailModal";
import {
  Megaphone, Plus, Search, Filter, Calendar, DollarSign,
  TrendingUp, CheckCircle2, Clock, Tag, Globe, Building2,
  Sparkles, Eye, BarChart3, Users, Target, Layers,
  FileText, ArrowRight, Phone, Mail, UserCheck, AlertCircle
} from "lucide-react";

const PLATFORM_OPTIONS = [
  { value: "Meta Ads", label: "Meta Ads (Facebook & Instagram)" },
  { value: "Google Ads", label: "Google Ads (Search & Display)" },
  { value: "TikTok Ads", label: "TikTok Ads" },
  { value: "YouTube Ads", label: "YouTube Ads" },
  { value: "Print / Outdoor", label: "Print & Outdoor Billboards" },
  { value: "Referral / Partner", label: "Referral & Partner Network" },
  { value: "Event / Expo", label: "Event / Property Expo" },
  { value: "Manual / Direct", label: "Manual / Direct Intake" },
  { value: "Other", label: "Other Channel" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active / Running", badge: { text: "Active", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" } },
  { value: "COMPLETED", label: "Completed / Old", badge: { text: "Completed", className: "bg-slate-100 text-slate-700 border border-slate-200" } },
  { value: "PAUSED", label: "Paused", badge: { text: "Paused", className: "bg-amber-50 text-amber-700 border border-amber-200" } },
  { value: "ARCHIVED", label: "Archived", badge: { text: "Archived", className: "bg-rose-50 text-rose-700 border border-rose-200" } },
];

export default function CampaignsPage() {
  const { user, role, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin"]);
  const isAdmin = role === "admin";

  const { leads, loading: leadsLoading } = useLeads(isAdmin ? "admin" : null);
  const { employees } = useEmployees(isAdmin);

  const [periodFilter, setPeriodFilter] = useState<RangeKey>("ALL");
  const range = useMemo(() => resolveRange(periodFilter), [periodFilter]);
  const { allDeals } = useFinancials(range, isAdmin);

  const { campaigns, loading: campaignsLoading } = useCampaigns(leads, allDeals, periodFilter, isAdmin);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");

  // Campaign details modal state
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSummary | null>(null);
  const [campaignLeadSearch, setCampaignLeadSearch] = useState("");

  // Inspect specific lead inside campaign details
  const [inspectingLead, setInspectingLead] = useState<Lead | null>(null);

  // Add Old Campaign Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // Form fields for adding old campaign
  const [formName, setFormName] = useState("");
  const [formExternalId, setFormExternalId] = useState("");
  const [formPlatform, setFormPlatform] = useState("Meta Ads");
  const [formCategory, setFormCategory] = useState("Real Estate");
  const [formStatus, setFormStatus] = useState<"ACTIVE" | "COMPLETED" | "PAUSED" | "ARCHIVED">("COMPLETED");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formBudget, setFormBudget] = useState("");
  const [formHistoricalLeads, setFormHistoricalLeads] = useState("");
  const [formHistoricalRevenue, setFormHistoricalRevenue] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const resetForm = () => {
    setFormName("");
    setFormExternalId("");
    setFormPlatform("Meta Ads");
    setFormCategory("Real Estate");
    setFormStatus("COMPLETED");
    setFormStartDate("");
    setFormEndDate("");
    setFormBudget("");
    setFormHistoricalLeads("");
    setFormHistoricalRevenue("");
    setFormDescription("");
    setFormNotes("");
    setFormError(null);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim() || formName.trim().length < 2) {
      setFormError("Campaign Name is required (minimum 2 characters).");
      return;
    }

    if (formBudget && (isNaN(Number(formBudget)) || Number(formBudget) < 0)) {
      setFormError("Budget must be a valid positive number.");
      return;
    }

    if (formHistoricalLeads && (isNaN(Number(formHistoricalLeads)) || Number(formHistoricalLeads) < 0)) {
      setFormError("Historical leads count must be a valid positive number.");
      return;
    }

    if (formHistoricalRevenue && (isNaN(Number(formHistoricalRevenue)) || Number(formHistoricalRevenue) < 0)) {
      setFormError("Historical revenue must be a valid positive number.");
      return;
    }

    if (formStartDate && formEndDate && new Date(formStartDate).getTime() > new Date(formEndDate).getTime()) {
      setFormError("Start date cannot be after the end date.");
      return;
    }

    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await createCampaign(token, {
        name: formName.trim(),
        externalId: formExternalId.trim() || undefined,
        platform: formPlatform,
        category: formCategory.trim() || undefined,
        status: formStatus,
        startDate: formStartDate || undefined,
        endDate: formEndDate || undefined,
        budget: formBudget ? Number(formBudget) : undefined,
        historicalLeadsCount: formHistoricalLeads ? Number(formHistoricalLeads) : undefined,
        historicalRevenue: formHistoricalRevenue ? Number(formHistoricalRevenue) : undefined,
        description: formDescription.trim() || undefined,
        notes: formNotes.trim() || undefined,
      });

      if (!res.ok) {
        setFormError(res.error);
        setBusy(false);
        return;
      }

      setBanner({ tone: "success", text: `Campaign "${formName.trim()}" added successfully!` });
      resetForm();
      setIsAddModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || "Failed to create campaign.");
    } finally {
      setBusy(false);
    }
  };

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (platformFilter !== "ALL" && c.platform !== platformFilter) return false;
      if (q) {
        const haystack = [c.name, c.externalId, c.platform, c.category, c.description].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [campaigns, searchQuery, statusFilter, platformFilter]);

  // High-level KPI aggregations
  const stats = useMemo(() => {
    const totalCampaigns = campaigns.length;
    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE").length;
    const totalLeads = campaigns.reduce((sum, c) => sum + c.leadsCount, 0);
    const totalWon = campaigns.reduce((sum, c) => sum + c.closedWon, 0);
    const totalRevenue = campaigns.reduce((sum, c) => sum + c.revenue, 0);
    const totalProfit = campaigns.reduce((sum, c) => sum + c.profit, 0);
    const avgConversion = totalLeads > 0 ? (totalWon / totalLeads) * 100 : 0;

    return {
      totalCampaigns,
      activeCampaigns,
      totalLeads,
      totalWon,
      totalRevenue,
      totalProfit,
      avgConversion,
    };
  }, [campaigns]);

  // Keep live campaign modal selection reactive
  const liveSelectedCampaign = useMemo(() => {
    if (!selectedCampaign) return null;
    return campaigns.find((c) => c.id === selectedCampaign.id) || selectedCampaign;
  }, [campaigns, selectedCampaign]);

  // Filtered leads inside the campaign detail modal
  const filteredCampaignLeads = useMemo(() => {
    if (!liveSelectedCampaign) return [];
    const q = campaignLeadSearch.trim().toLowerCase();
    if (!q) return liveSelectedCampaign.leads;
    return liveSelectedCampaign.leads.filter((l) => {
      const haystack = [l.name, l.phone, l.email, l.city, l.status].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [liveSelectedCampaign, campaignLeadSearch]);

  const employeeName = (uid: string | null | undefined) => employees.find((e) => e.uid === uid)?.name;

  if (authLoading || leadsLoading || campaignsLoading) return <FullPageSpinner />;
  if (!user || !isAdmin) return null;

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100/80">
              <Megaphone size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Campaigns</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Track running marketing campaigns and manage historical campaigns.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200/50 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {stats.activeCampaigns} active / {campaigns.length} total
          </span>
          <button
            onClick={() => {
              resetForm();
              setIsAddModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-semibold shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>Add Old Campaign</span>
          </button>
        </div>
      </div>

      {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Total Campaigns</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-slate-800 tabular-nums">{stats.totalCampaigns}</span>
            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              {stats.activeCampaigns} Live
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Period Leads</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-slate-800 tabular-nums">{stats.totalLeads}</span>
            <Users size={16} className="text-slate-400" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Deals Won</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-emerald-600 tabular-nums">{stats.totalWon}</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Total Revenue</span>
          <div className="mt-2">
            <span className="text-base font-bold text-slate-800 tabular-nums block truncate">
              {formatMoney(stats.totalRevenue)}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Net Profit</span>
          <div className="mt-2">
            <span className="text-base font-bold text-emerald-600 tabular-nums block truncate">
              {formatMoney(stats.totalProfit)}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)] flex flex-col justify-between">
          <span className="text-[11px] font-medium text-slate-500">Avg Conv. Rate</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-bold text-indigo-600 tabular-nums">
              {stats.avgConversion.toFixed(1)}%
            </span>
            <TrendingUp size={16} className="text-indigo-400" />
          </div>
        </div>
      </div>

      {/* Filter Toolbar Card */}
      <div className="flex flex-col lg:flex-row gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-[0_2px_15px_rgba(0,0,0,0.03)]">
        <div className="relative flex-1 lg:max-w-xs flex items-center">
          <Search className="pointer-events-none absolute left-3 text-slate-400" size={15} />
          <input
            type="text"
            placeholder="Search campaigns, ID, platform..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50/50 border border-slate-200/80 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 justify-start lg:justify-end">
          {/* Period Filter (Today, This Week, This Month, All Time) */}
          <SelectPill label="Period" value={periodFilter} onChange={(v) => setPeriodFilter(v as RangeKey)} icon={<Filter size={13} className="shrink-0 text-slate-500" />}>
            {(Object.keys(RANGE_LABELS) as RangeKey[]).map((key) => (
              <SelectOption key={key} value={key}>{RANGE_LABELS[key]}</SelectOption>
            ))}
          </SelectPill>

          {/* Status Filter */}
          <SelectPill label="Status" value={statusFilter} onChange={setStatusFilter}>
            <SelectOption value="ALL">All statuses</SelectOption>
            <SelectOption value="ACTIVE">Active / Running</SelectOption>
            <SelectOption value="COMPLETED">Completed / Old</SelectOption>
            <SelectOption value="PAUSED">Paused</SelectOption>
            <SelectOption value="ARCHIVED">Archived</SelectOption>
          </SelectPill>

          {/* Platform Filter */}
          <SelectPill label="Platform" value={platformFilter} onChange={setPlatformFilter}>
            <SelectOption value="ALL">All platforms</SelectOption>
            {PLATFORM_OPTIONS.map((p) => (
              <SelectOption key={p.value} value={p.value}>{p.value}</SelectOption>
            ))}
          </SelectPill>
        </div>
      </div>

      {/* Campaigns Table List View */}
      <TablePanel>
        <div className="overflow-x-auto admin-table-scroll">
          <AdminTable>
            <AdminThead>
              <AdminTh className="w-[260px]">Campaign & ID</AdminTh>
              <AdminTh className="w-[140px]">Platform</AdminTh>
              <AdminTh className="w-[110px]">Status</AdminTh>
              <AdminTh className="w-[150px]">Timeline</AdminTh>
              <AdminTh className="w-[90px] text-right">Leads</AdminTh>
              <AdminTh className="w-[85px] text-right">Won</AdminTh>
              <AdminTh className="w-[125px] text-right">Revenue</AdminTh>
              <AdminTh className="w-[125px] text-right">Net Profit</AdminTh>
              <AdminTh className="w-[90px] text-right">Conv. %</AdminTh>
              <AdminTh className="w-[110px] text-center">Action</AdminTh>
            </AdminThead>
            <AdminTbody>
              {filteredCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-xs text-slate-500">
                    No campaigns found matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredCampaigns.map((camp) => {
                  const isLive = camp.status === "ACTIVE";
                  const isCompleted = camp.status === "COMPLETED";

                  return (
                    <AdminTr
                      key={camp.id}
                      onClick={() => {
                        setSelectedCampaign(camp);
                        setCampaignLeadSearch("");
                      }}
                      className="cursor-pointer hover:bg-slate-50/80 transition-colors group"
                    >
                      {/* Campaign Name & ID */}
                      <AdminTd className="font-medium text-slate-900">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-slate-800 text-xs group-hover:text-emerald-600 transition-colors">
                            {camp.name}
                          </span>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            {camp.externalId && (
                              <span className="font-mono bg-slate-100 text-slate-600 px-1 py-0.2 rounded border border-slate-200">
                                #{camp.externalId}
                              </span>
                            )}
                            {camp.category && <span>• {camp.category}</span>}
                          </div>
                        </div>
                      </AdminTd>

                      {/* Platform */}
                      <AdminTd>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <Globe size={11} className="text-slate-500" />
                          {camp.platform}
                        </span>
                      </AdminTd>

                      {/* Status */}
                      <AdminTd>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                            isLive
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : isCompleted
                              ? "bg-slate-100 text-slate-600 border border-slate-200"
                              : camp.status === "PAUSED"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          {camp.status === "ACTIVE" ? "Running" : camp.status === "COMPLETED" ? "Completed" : camp.status}
                        </span>
                      </AdminTd>

                      {/* Timeline */}
                      <AdminTd className="text-slate-500 text-xs">
                        <div className="flex items-center gap-1 text-[11px]">
                          <Calendar size={12} className="text-slate-400 shrink-0" />
                          <span>
                            {camp.startDate ? formatBusinessDate(camp.startDate) : "N/A"}
                            {camp.endDate ? ` → ${formatBusinessDate(camp.endDate)}` : isLive ? " → Present" : ""}
                          </span>
                        </div>
                      </AdminTd>

                      {/* Leads Count */}
                      <AdminTd className="text-right font-semibold text-slate-800 tabular-nums">
                        <div className="flex flex-col items-end">
                          <span>{camp.leadsCount}</span>
                          {camp.activeLeads > 0 && (
                            <span className="text-[10px] font-normal text-emerald-600">
                              {camp.activeLeads} active
                            </span>
                          )}
                        </div>
                      </AdminTd>

                      {/* Won Deals */}
                      <AdminTd className="text-right font-semibold text-emerald-600 tabular-nums">
                        {camp.closedWon}
                      </AdminTd>

                      {/* Revenue */}
                      <AdminTd className="text-right font-medium text-slate-800 tabular-nums">
                        {formatMoney(camp.revenue)}
                      </AdminTd>

                      {/* Net Profit */}
                      <AdminTd className="text-right font-semibold text-emerald-600 tabular-nums">
                        {formatMoney(camp.profit)}
                      </AdminTd>

                      {/* Conversion Rate */}
                      <AdminTd className="text-right tabular-nums">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          camp.conversionRate >= 15
                            ? "bg-emerald-50 text-emerald-700"
                            : camp.conversionRate > 0
                            ? "bg-indigo-50 text-indigo-700"
                            : "text-slate-400"
                        }`}>
                          {camp.conversionRate > 0 ? `${camp.conversionRate.toFixed(1)}%` : "0%"}
                        </span>
                      </AdminTd>

                      {/* Action */}
                      <AdminTd className="text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCampaign(camp);
                            setCampaignLeadSearch("");
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200/60 transition-colors"
                        >
                          <Eye size={13} />
                          <span>View</span>
                        </button>
                      </AdminTd>
                    </AdminTr>
                  );
                })
              )}
            </AdminTbody>
          </AdminTable>
        </div>
      </TablePanel>

      {/* ========================================================================= */}
      {/* 1. CAMPAIGN DETAILS DOSSIER MODAL                                         */}
      {/* ========================================================================= */}
      {liveSelectedCampaign && (
        <Modal
          isOpen={true}
          onClose={() => {
            setSelectedCampaign(null);
            setCampaignLeadSearch("");
          }}
          title={`Campaign Dossier: ${liveSelectedCampaign.name}`}
          maxWidth="max-w-3xl"
        >
          <div className="space-y-6">
            {/* Top Overview Header */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{liveSelectedCampaign.name}</h3>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      liveSelectedCampaign.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {liveSelectedCampaign.status === "ACTIVE" ? "Running" : liveSelectedCampaign.status}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200 flex items-center gap-1">
                    <Globe size={11} className="text-slate-400" />
                    {liveSelectedCampaign.platform}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-1">
                  {liveSelectedCampaign.externalId && (
                    <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">
                      ID: {liveSelectedCampaign.externalId}
                    </span>
                  )}
                  {liveSelectedCampaign.category && <span>Category: {liveSelectedCampaign.category}</span>}
                  <span className="flex items-center gap-1">
                    <Calendar size={12} className="text-slate-400" />
                    {liveSelectedCampaign.startDate ? formatBusinessDate(liveSelectedCampaign.startDate) : "N/A"}
                    {liveSelectedCampaign.endDate ? ` to ${formatBusinessDate(liveSelectedCampaign.endDate)}` : " to Ongoing"}
                  </span>
                </div>
              </div>

              {liveSelectedCampaign.budget > 0 && (
                <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 text-right">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">Total Budget</span>
                  <span className="text-sm font-bold text-slate-800 tabular-nums">
                    {formatMoney(liveSelectedCampaign.budget)}
                  </span>
                </div>
              )}
            </div>

            {/* Metric Statistics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 block">Total Leads</span>
                <span className="text-lg font-bold text-slate-800 tabular-nums mt-1 block">
                  {liveSelectedCampaign.leadsCount}
                </span>
                <span className="text-[10px] text-slate-400">
                  {liveSelectedCampaign.activeLeads} currently in progress
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 block">Deals Won</span>
                <span className="text-lg font-bold text-emerald-600 tabular-nums mt-1 block">
                  {liveSelectedCampaign.closedWon}
                </span>
                <span className="text-[10px] text-emerald-700 font-medium">
                  {liveSelectedCampaign.conversionRate.toFixed(1)}% conversion
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 block">Revenue Generated</span>
                <span className="text-lg font-bold text-slate-800 tabular-nums mt-1 block truncate">
                  {formatMoney(liveSelectedCampaign.revenue)}
                </span>
                <span className="text-[10px] text-slate-400">
                  Avg {formatMoney(liveSelectedCampaign.valuePerLead)}/lead
                </span>
              </div>

              <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 block">Net Profit</span>
                <span className="text-lg font-bold text-emerald-600 tabular-nums mt-1 block truncate">
                  {formatMoney(liveSelectedCampaign.profit)}
                </span>
                <span className="text-[10px] text-emerald-700 font-medium">
                  Direct deal returns
                </span>
              </div>
            </div>

            {/* Description & Notes (if any) */}
            {(liveSelectedCampaign.description || liveSelectedCampaign.notes) && (
              <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-100 space-y-2">
                {liveSelectedCampaign.description && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 block">Description:</span>
                    <p className="text-xs text-slate-600 mt-0.5">{liveSelectedCampaign.description}</p>
                  </div>
                )}
                {liveSelectedCampaign.notes && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 block">Historical Notes:</span>
                    <p className="text-xs text-slate-600 mt-0.5">{liveSelectedCampaign.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* Attributed Leads Table Section */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-800">Attributed Leads</h4>
                  <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200/60">
                    {liveSelectedCampaign.leads.length} leads
                  </span>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                  <input
                    type="text"
                    placeholder="Search campaign leads..."
                    value={campaignLeadSearch}
                    onChange={(e) => setCampaignLeadSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:ring-1 focus:ring-emerald-500 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>

              {filteredCampaignLeads.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Users size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-medium text-slate-600">No leads found for this campaign.</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {liveSelectedCampaign.historicalLeadsCount > 0
                      ? `${liveSelectedCampaign.historicalLeadsCount} historical aggregate leads recorded.`
                      : "New leads will appear here as soon as they are ingested."}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-72 border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-semibold">
                      <tr>
                        <th className="p-2.5">Name</th>
                        <th className="p-2.5">Contact</th>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Assignee</th>
                        <th className="p-2.5">Created</th>
                        <th className="p-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredCampaignLeads.map((lead) => {
                        return (
                          <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-2.5 font-semibold text-slate-800">
                              {lead.name}
                              {lead.city && <span className="text-[10px] text-slate-400 font-normal block">{lead.city}</span>}
                            </td>
                            <td className="p-2.5 text-slate-600">
                              <div className="flex flex-col text-[11px]">
                                {lead.phone && <span>{lead.phone}</span>}
                                {lead.email && <span className="text-slate-400 truncate max-w-[140px]">{lead.email}</span>}
                              </div>
                            </td>
                            <td className="p-2.5">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                {LEAD_STATUS_LABELS[lead.status] || lead.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-slate-600 text-[11px]">
                              {employeeName(lead.assignedUserId) || (
                                <span className="text-slate-400 italic">Unassigned</span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-500 text-[11px]">
                              {lead.createdAt ? formatBusinessDate(lead.createdAt) : "N/A"}
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                onClick={() => setInspectingLead(lead)}
                                className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md border border-emerald-200 transition-colors"
                              >
                                View Lead
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* 2. ADD OLD CAMPAIGN DATA ENTRY MODAL                                      */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => {
            if (!busy) {
              setIsAddModalOpen(false);
              resetForm();
            }
          }}
          title="Add Old / Historical Campaign"
          maxWidth="max-w-3xl"
        >
          <form onSubmit={handleCreateCampaign} className="space-y-5">
            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-rose-500" />
                <span>{formError}</span>
              </div>
            )}

            {/* Campaign Core Details Section */}
            <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80 space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Megaphone size={14} className="text-emerald-600" />
                Campaign Identification
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Campaign Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Q4 2025 Prime Housing Expo & Outdoor"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    External / Meta Campaign ID (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 23854992817 or EXPO-2025"
                    value={formExternalId}
                    onChange={(e) => setFormExternalId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Platform / Channel
                  </label>
                  <CustomSelect
                    value={formPlatform}
                    onChange={setFormPlatform}
                    options={PLATFORM_OPTIONS}
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Category / Project
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DHA Phase 6, Bahria, Commercial"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Status
                  </label>
                  <CustomSelect
                    value={formStatus}
                    onChange={(v) => setFormStatus(v as any)}
                    options={STATUS_OPTIONS}
                  />
                </div>
              </div>
            </div>

            {/* Timeline & Budget Section */}
            <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80 space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Calendar size={14} className="text-emerald-600" />
                Duration & Budgeting
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Start Date
                  </label>
                  <DateTimePicker
                    mode="date"
                    value={formStartDate}
                    onChange={setFormStartDate}
                    placeholder="Campaign start date"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    End Date
                  </label>
                  <DateTimePicker
                    mode="date"
                    value={formEndDate}
                    onChange={setFormEndDate}
                    placeholder="Campaign end date"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Total Budget / Spend (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 250000"
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Historical Aggregate Stats (For archiving old campaigns) */}
            <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/80 space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 size={14} className="text-emerald-600" />
                Historical Performance Summary (Optional)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Historical Total Leads Generated
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 45"
                    value={formHistoricalLeads}
                    onChange={(e) => setFormHistoricalLeads(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Historical Total Revenue Generated (PKR)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 4500000"
                    value={formHistoricalRevenue}
                    onChange={(e) => setFormHistoricalRevenue(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Description & Notes */}
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Description & Target Audience
                </label>
                <textarea
                  rows={2}
                  placeholder="Targeting criteria, billboard locations, or campaign objectives..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Historical Archive Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Key learnings, conversion highlights, or agency notes..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setIsAddModalOpen(false);
                  resetForm();
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 rounded-xl shadow-sm transition-all cursor-pointer"
              >
                {busy ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Saving Campaign...</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    <span>Add Campaign</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* 3. NESTED LEAD DETAIL INSPECTOR MODAL                                     */}
      {/* ========================================================================= */}
      {inspectingLead && (
        <LeadDetailModal
          lead={leads.find((l) => l.id === inspectingLead.id) || inspectingLead}
          userRole="admin"
          getIdToken={getIdToken}
          assigneeName={employeeName(inspectingLead.assignedUserId)}
          onClose={() => setInspectingLead(null)}
        />
      )}
    </div>
  );
}
