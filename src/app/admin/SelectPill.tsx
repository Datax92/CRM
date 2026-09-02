"use client";

import type { ReactNode } from "react";

interface SelectPillProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  icon?: ReactNode;
}

export function SelectPill({ label, value, onChange, children, icon }: SelectPillProps) {
  return (
    <div className="relative min-w-[130px] flex-1 lg:flex-none">
      <div className="relative flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs shadow-xs transition-all hover:border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/10">
        <span className="text-slate-400 font-medium text-[11px] shrink-0">{label}:</span>
        {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-xs font-semibold text-slate-800 outline-none focus:outline-none pr-1"
          style={{ colorScheme: "light" }}
        >
          {children}
        </select>
      </div>
    </div>
  );
}

export function SelectOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <option value={value} className="bg-white text-slate-900">
      {children}
    </option>
  );
}