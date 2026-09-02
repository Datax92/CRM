"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
  Check,
  RotateCcw
} from "lucide-react";

interface DateTimePickerProps {
  id?: string;
  value?: string; // "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" or ""
  onChange: (value: string) => void;
  mode?: "date" | "datetime";
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  max?: string;
  min?: string;
  className?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseValue(value?: string, mode: "date" | "datetime" = "datetime") {
  if (!value) {
    const now = new Date();
    return {
      hasValue: false,
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hours24: now.getHours(),
      hours12: (now.getHours() % 12) || 12,
      minutes: now.getMinutes(),
      period: now.getHours() >= 12 ? ("PM" as const) : ("AM" as const),
    };
  }

  try {
    if (mode === "date") {
      const [y, m, d] = value.split("-").map((v) => parseInt(v, 10));
      return {
        hasValue: true,
        year: y || new Date().getFullYear(),
        month: (m || 1) - 1,
        day: d || 1,
        hours24: 0,
        hours12: 12,
        minutes: 0,
        period: "AM" as const,
      };
    } else {
      const [datePart, timePart] = value.split("T");
      const [y, m, d] = (datePart || "").split("-").map((v) => parseInt(v, 10));
      const [h, min] = (timePart || "00:00").split(":").map((v) => parseInt(v, 10));
      const h24 = isNaN(h) ? 0 : h;
      return {
        hasValue: true,
        year: y || new Date().getFullYear(),
        month: (m || 1) - 1,
        day: d || 1,
        hours24: h24,
        hours12: h24 % 12 || 12,
        minutes: isNaN(min) ? 0 : min,
        period: h24 >= 12 ? ("PM" as const) : ("AM" as const),
      };
    }
  } catch {
    const now = new Date();
    return {
      hasValue: false,
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hours24: now.getHours(),
      hours12: (now.getHours() % 12) || 12,
      minutes: now.getMinutes(),
      period: now.getHours() >= 12 ? ("PM" as const) : ("AM" as const),
    };
  }
}

function padZero(num: number): string {
  return num.toString().padStart(2, "0");
}

function formatOutput(
  year: number,
  month: number,
  day: number,
  hours24: number,
  minutes: number,
  mode: "date" | "datetime"
): string {
  const yStr = year.toString();
  const mStr = padZero(month + 1);
  const dStr = padZero(day);

  if (mode === "date") {
    return `${yStr}-${mStr}-${dStr}`;
  }
  return `${yStr}-${mStr}-${dStr}T${padZero(hours24)}:${padZero(minutes)}`;
}

export function DateTimePicker({
  id,
  value = "",
  onChange,
  mode = "datetime",
  placeholder,
  disabled = false,
  required = false,
  max,
  min,
  className = "",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => parseValue(value, mode), [value, mode]);

  // Internal view navigation state
  const [viewYear, setViewYear] = useState<number>(parsed.year);
  const [viewMonth, setViewMonth] = useState<number>(parsed.month);
  const [selectedHours12, setSelectedHours12] = useState<number>(parsed.hours12);
  const [selectedMinutes, setSelectedMinutes] = useState<number>(parsed.minutes);
  const [selectedPeriod, setSelectedPeriod] = useState<"AM" | "PM">(parsed.period);

  // Sync view when opened
  useEffect(() => {
    if (isOpen) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
      setSelectedHours12(parsed.hours12);
      setSelectedMinutes(parsed.minutes);
      setSelectedPeriod(parsed.period);
    }
  }, [isOpen, parsed]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Days matrix calculation
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay();
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: Array<{
      day: number;
      month: number;
      year: number;
      isCurrentMonth: boolean;
      isToday: boolean;
      isSelected: boolean;
      isDisabled: boolean;
    }> = [];

    const today = new Date();
    const isTodayYearMonth =
      today.getFullYear() === viewYear && today.getMonth() === viewMonth;

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({
        day: d,
        month: m,
        year: y,
        isCurrentMonth: false,
        isToday: false,
        isSelected:
          parsed.hasValue &&
          parsed.year === y &&
          parsed.month === m &&
          parsed.day === d,
        isDisabled: isDateDisabled(y, m, d, min, max),
      });
    }

    // Current month days
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const isToday = isTodayYearMonth && today.getDate() === d;
      const isSelected =
        parsed.hasValue &&
        parsed.year === viewYear &&
        parsed.month === viewMonth &&
        parsed.day === d;

      days.push({
        day: d,
        month: viewMonth,
        year: viewYear,
        isCurrentMonth: true,
        isToday,
        isSelected,
        isDisabled: isDateDisabled(viewYear, viewMonth, d, min, max),
      });
    }

    // Next month filler days to complete 6 weeks grid (42 cells) or 5 weeks
    const totalCells = days.length <= 35 ? 35 : 42;
    const remaining = totalCells - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      days.push({
        day: d,
        month: m,
        year: y,
        isCurrentMonth: false,
        isToday: false,
        isSelected:
          parsed.hasValue &&
          parsed.year === y &&
          parsed.month === m &&
          parsed.day === d,
        isDisabled: isDateDisabled(y, m, d, min, max),
      });
    }

    return days;
  }, [viewYear, viewMonth, parsed, min, max]);

  function isDateDisabled(y: number, m: number, d: number, minStr?: string, maxStr?: string) {
    const formatted = `${y}-${padZero(m + 1)}-${padZero(d)}`;
    if (minStr) {
      const minDatePart = minStr.split("T")[0];
      if (formatted < minDatePart) return true;
    }
    if (maxStr) {
      const maxDatePart = maxStr.split("T")[0];
      if (formatted > maxDatePart) return true;
    }
    return false;
  }

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function calculate24Hour(h12: number, period: "AM" | "PM"): number {
    if (period === "AM") {
      return h12 === 12 ? 0 : h12;
    } else {
      return h12 === 12 ? 12 : h12 + 12;
    }
  }

  function handleSelectDay(y: number, m: number, d: number) {
    const h24 = calculate24Hour(selectedHours12, selectedPeriod);
    const formatted = formatOutput(y, m, d, h24, selectedMinutes, mode);
    onChange(formatted);
    if (mode === "date") {
      setIsOpen(false);
    }
  }

  function handleTimeChange(h12: number, min: number, period: "AM" | "PM") {
    setSelectedHours12(h12);
    setSelectedMinutes(min);
    setSelectedPeriod(period);

    const activeYear = parsed.hasValue ? parsed.year : viewYear;
    const activeMonth = parsed.hasValue ? parsed.month : viewMonth;
    const activeDay = parsed.hasValue ? parsed.day : new Date().getDate();

    const h24 = calculate24Hour(h12, period);
    const formatted = formatOutput(activeYear, activeMonth, activeDay, h24, min, mode);
    onChange(formatted);
  }

  function handleSetNow() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const h24 = now.getHours();
    const min = now.getMinutes();

    setViewYear(y);
    setViewMonth(m);
    setSelectedHours12(h24 % 12 || 12);
    setSelectedMinutes(min);
    setSelectedPeriod(h24 >= 12 ? "PM" : "AM");

    onChange(formatOutput(y, m, d, h24, min, mode));
    if (mode === "date") setIsOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  // Display text formatted nicely
  const formattedDisplay = useMemo(() => {
    if (!parsed.hasValue) return "";
    const monthShort = MONTHS[parsed.month]?.slice(0, 3);
    if (mode === "date") {
      return `${monthShort} ${parsed.day}, ${parsed.year}`;
    }
    const minStr = padZero(parsed.minutes);
    return `${monthShort} ${parsed.day}, ${parsed.year} • ${parsed.hours12}:${minStr} ${parsed.period}`;
  }, [parsed, mode]);

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Hidden input to support form validation if required */}
      {required && (
        <input
          type="text"
          id={id}
          value={value}
          required={required}
          onChange={() => {}}
          className="sr-only"
          tabIndex={-1}
        />
      )}

      {/* Main Trigger Input Field */}
      <button
        type="button"
        id={id ? `${id}-btn` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`group flex w-full items-center justify-between gap-2.5 rounded-xl border bg-slate-50/70 py-2.5 pl-3.5 pr-3 text-left transition-all ${
          isOpen
            ? "border-emerald-500 bg-white ring-4 ring-emerald-500/10 shadow-xs"
            : "border-slate-200 hover:border-slate-300 hover:bg-white focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
        } ${disabled ? "cursor-not-allowed opacity-50 bg-slate-100" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <CalendarIcon
            size={15}
            className={`shrink-0 transition-colors ${
              isOpen || parsed.hasValue ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-500"
            }`}
          />
          <span
            className={`truncate text-sm font-medium ${
              parsed.hasValue ? "text-slate-800 font-semibold" : "text-slate-400"
            }`}
          >
            {formattedDisplay || placeholder || (mode === "date" ? "Select date..." : "Select date & time...")}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {parsed.hasValue && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-600 transition-colors"
              title="Clear date"
            >
              <X size={13} />
            </span>
          )}
        </div>
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-full min-w-[310px] max-w-[360px] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl shadow-slate-900/15 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150"
          style={{ transformOrigin: "top left" }}
        >
          {/* Header Month / Year controls */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-slate-800 tracking-tight">
                {MONTHS[viewMonth]} {viewYear}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Previous Month"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Next Month"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* Days Weekday Legend */}
          <div className="mb-1.5 grid grid-cols-7 text-center">
            {DAYS_SHORT.map((day) => (
              <span key={day} className="text-[11px] font-bold uppercase tracking-wider text-slate-400 py-1">
                {day}
              </span>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((cDay, idx) => {
              const isCurrent = cDay.isCurrentMonth;
              const isSelected = cDay.isSelected;
              const isToday = cDay.isToday;
              const isDisabled = cDay.isDisabled;

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectDay(cDay.year, cDay.month, cDay.day)}
                  className={`relative flex h-8 w-full items-center justify-center rounded-xl text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-gradient-to-tr from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/25 scale-[1.03]"
                      : isToday
                      ? "border border-emerald-500/80 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100"
                      : isCurrent
                      ? "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                      : "text-slate-300 hover:bg-slate-50 hover:text-slate-500"
                  } ${isDisabled ? "opacity-25 cursor-not-allowed hover:bg-transparent" : "cursor-pointer"}`}
                >
                  <span>{cDay.day}</span>
                  {isToday && !isSelected && (
                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-emerald-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Time Picker Controls (for mode="datetime") */}
          {mode === "datetime" && (
            <div className="mt-3.5 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Clock size={13} className="text-emerald-600" />
                  <span>Time</span>
                </div>
                <span className="text-[11px] font-medium text-slate-400">
                  {padZero(selectedHours12)}:{padZero(selectedMinutes)} {selectedPeriod}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Hours selector */}
                <select
                  value={selectedHours12}
                  onChange={(e) =>
                    handleTimeChange(parseInt(e.target.value, 10), selectedMinutes, selectedPeriod)
                  }
                  className="flex-1 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {padZero(h)} hr
                    </option>
                  ))}
                </select>

                <span className="text-xs font-bold text-slate-400">:</span>

                {/* Minutes selector */}
                <select
                  value={selectedMinutes}
                  onChange={(e) =>
                    handleTimeChange(selectedHours12, parseInt(e.target.value, 10), selectedPeriod)
                  }
                  className="flex-1 cursor-pointer rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <option key={m} value={m}>
                      {padZero(m)} min
                    </option>
                  ))}
                </select>

                {/* AM / PM Segmented Control */}
                <div className="flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5">
                  <button
                    type="button"
                    onClick={() => handleTimeChange(selectedHours12, selectedMinutes, "AM")}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold transition-all ${
                      selectedPeriod === "AM"
                        ? "bg-white text-emerald-700 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTimeChange(selectedHours12, selectedMinutes, "PM")}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold transition-all ${
                      selectedPeriod === "PM"
                        ? "bg-white text-emerald-700 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quick Footer Action Bar */}
          <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={handleSetNow}
              className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
            >
              <RotateCcw size={11} />
              <span>{mode === "date" ? "Today" : "Set to Now"}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-colors"
            >
              <Check size={12} />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
