"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { getMonitoringConfig, setNoFollowUpHours, getAttendanceConfig } from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import Link from "next/link";
import { Settings as SettingsIcon, Clock, Wifi } from "lucide-react";

export default function SettingsPage() {
  const { getIdToken, loading: authLoading } = useAuth();
  useProtectedRoute(["admin"]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hours, setHours] = useState<number>(24);
  const [savedHours, setSavedHours] = useState<number>(24);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // Shown for reference only. The address is recorded on every punch and never
  // matched — see the Office network card below.
  const [yourIp, setYourIp] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        const res = await getMonitoringConfig(token);
        if (cancelled) return;
        if (res.ok) {
          setHours(res.data.noFollowUpHours);
          setSavedHours(res.data.noFollowUpHours);
        } else {
          setBanner({ tone: "error", text: res.error });
        }

        const attendance = await getAttendanceConfig(token);
        if (!cancelled && attendance.ok) setYourIp(attendance.data.yourIp);
      } catch {
        if (!cancelled) setBanner({ tone: "error", text: "Could not load settings." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  if (authLoading || loading) return <FullPageSpinner />;

  const dirty = hours !== savedHours;

  const handleSave = async () => {
    setSaving(true);
    setBanner(null);
    try {
      const token = await getIdToken();
      const res = await setNoFollowUpHours(token, hours);
      if (res.ok) {
        setSavedHours(hours);
        setBanner({ tone: "success", text: "Saved. Takes effect on the next cron run." });
      } else {
        setBanner({ tone: "error", text: res.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-enter flex flex-col min-h-screen bg-background p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <SettingsIcon size={22} className="text-slate-500" />
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        </div>
        <p className="text-sm text-slate-500">System-wide configuration for distribution and monitoring.</p>
      </div>

      {banner && <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />}

      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm max-w-xl space-y-4">
        <div className="flex items-start gap-3">
          <Clock size={18} className="text-slate-400 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">No-follow-up monitoring window (FR-18)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              How many hours a lead can go without a follow-up before the cron job flags it and
              notifies Admin. Default is 24 hours.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={720}
            step={1}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            disabled={saving}
            className="w-28 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary outline-none disabled:opacity-50"
          />
          <span className="text-sm text-slate-500">hours</span>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {dirty && !saving && (
            <span className="text-xs text-slate-500">Unsaved change — currently live value is {savedHours}h.</span>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Where the office network is configured now                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm max-w-xl">
        <div className="flex items-start gap-3">
          <Wifi size={18} className="text-slate-400 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Office network</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The office IP allow-list that used to live here is gone. A business line&rsquo;s public
              address is dynamic, so a list built from today&rsquo;s address stops matching the moment
              the ISP hands out a new one — and check-in then refuses everybody. Attendance now
              recognises the office by its <strong>Wi-Fi network name</strong>, which does not change.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Set it in{" "}
              <Link href="/admin/attendance/settings" className="font-semibold text-primary hover:underline">
                Attendance → Settings
              </Link>
              , where the rest of the attendance policy lives. This request came from{" "}
              <span className="tabular-nums font-semibold text-slate-700">{yourIp || "an unknown address"}</span>
              , which is still recorded on every punch — it is simply never matched against anything.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
