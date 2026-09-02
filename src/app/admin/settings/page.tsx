"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import {
  getMonitoringConfig,
  setNoFollowUpHours,
  getAttendanceConfig,
  setAttendanceConfig,
} from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { Settings as SettingsIcon, Clock, Wifi, Plus, X, Check } from "lucide-react";

export default function SettingsPage() {
  const { getIdToken, loading: authLoading } = useAuth();
  useProtectedRoute(["admin"]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hours, setHours] = useState<number>(24);
  const [savedHours, setSavedHours] = useState<number>(24);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  // Office network — the addresses that make a working day count as "Office".
  const [officeIps, setOfficeIps] = useState<string[]>([]);
  const [savedIps, setSavedIps] = useState<string[]>([]);
  const [yourIp, setYourIp] = useState("");
  const [savingIps, setSavingIps] = useState(false);

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
        if (!cancelled && attendance.ok) {
          setOfficeIps(attendance.data.officeIps);
          setSavedIps(attendance.data.officeIps);
          setYourIp(attendance.data.yourIp);
        }
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

  const ipsDirty = JSON.stringify(officeIps) !== JSON.stringify(savedIps);

  const saveIps = async () => {
    setSavingIps(true);
    setBanner(null);
    try {
      const res = await setAttendanceConfig(await getIdToken(), officeIps.filter(Boolean));
      if (res.ok) {
        setOfficeIps(res.data.officeIps);
        setSavedIps(res.data.officeIps);
        setBanner({
          tone: "success",
          text:
            res.data.officeIps.length === 0
              ? "Office network cleared — every day will be recorded as Remote."
              : "Office network saved. New sign-ins from it are recorded as Office.",
        });
      } else {
        setBanner({ tone: "error", text: res.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setSavingIps(false);
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
      {/* Office network — what makes attendance count as "Office"          */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm max-w-xl space-y-4">
        <div className="flex items-start gap-3">
          <Wifi size={18} className="text-slate-400 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Office network</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              The public IP address your office internet connection shows to the outside world —
              everyone on the office wifi shares it. A working day recorded from one of these
              addresses is marked <strong>Office</strong>; anything else is <strong>Remote</strong>.
              The check runs on the server, so it cannot be faked from a browser.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Leave this empty and attendance still records hours — days are simply labelled
              &ldquo;Unverified&rdquo; instead of Office or Remote. Add a second address if you have
              a backup line.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">You are connecting from</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">
              {yourIp || "unknown"}
            </div>
          </div>
          <button
            type="button"
            disabled={!yourIp || officeIps.includes(yourIp)}
            onClick={() => setOfficeIps((prev) => [...prev, yourIp])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {officeIps.includes(yourIp) ? <Check size={13} /> : <Plus size={13} />}
            {officeIps.includes(yourIp) ? "Already added" : "Use my current IP"}
          </button>
        </div>

        <div className="space-y-2">
          {officeIps.length === 0 && (
            <p className="text-xs text-slate-400">
              No office address set — every day is currently recorded as Unverified.
            </p>
          )}
          {officeIps.map((ip, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={ip}
                onChange={(e) =>
                  setOfficeIps((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
                }
                placeholder="e.g. 203.0.113.9"
                disabled={savingIps}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums text-slate-900 focus:ring-2 focus:ring-primary outline-none disabled:opacity-50"
              />
              <button
                type="button"
                aria-label="Remove this address"
                onClick={() => setOfficeIps((prev) => prev.filter((_, i) => i !== index))}
                className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:text-red-600 hover:border-red-200 transition"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOfficeIps((prev) => [...prev, ""])}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Plus size={13} />
            Add another address
          </button>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={saveIps}
            disabled={savingIps || !ipsDirty}
            className="rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
          >
            {savingIps ? "Saving..." : "Save office network"}
          </button>
          {ipsDirty && !savingIps && (
            <span className="text-xs text-slate-500">Unsaved change.</span>
          )}
        </div>
      </div>
    </div>
  );
}
