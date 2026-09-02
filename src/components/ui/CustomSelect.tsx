"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOptionItem<T extends string = string> {
  value: T;
  label: string;
  badge?: {
    text: string;
    className: string;
  };
  icon?: React.ReactNode;
  description?: string;
}

interface CustomSelectProps<T extends string = string> {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectOptionItem<T>[];
  placeholder?: string;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  className?: string;
}

export function CustomSelect<T extends string = string>({
  id,
  value,
  onChange,
  options,
  placeholder = "Select an option...",
  disabled = false,
  leftIcon,
  className = "",
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find selected item
  const selectedOption = options.find((opt) => opt.value === value);

  // Outside click listener
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

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  return (
    <div className={`relative w-full ${className}`} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`group flex w-full items-center justify-between gap-2.5 rounded-xl border bg-slate-50/70 py-2.5 pl-3.5 pr-3 text-left transition-all ${
          isOpen
            ? "border-emerald-500 bg-white ring-4 ring-emerald-500/10 shadow-xs"
            : "border-slate-200 hover:border-slate-300 hover:bg-white focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
        } ${disabled ? "cursor-not-allowed opacity-50 bg-slate-100" : "cursor-pointer"}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          {leftIcon && (
            <span
              className={`shrink-0 transition-colors ${
                isOpen ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-500"
              }`}
            >
              {leftIcon}
            </span>
          )}

          <div className="flex items-center gap-2 min-w-0 truncate">
            {selectedOption ? (
              <>
                {selectedOption.icon && <span className="shrink-0">{selectedOption.icon}</span>}
                <span className="truncate text-sm font-semibold text-slate-800">
                  {selectedOption.label}
                </span>
                {selectedOption.badge && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${selectedOption.badge.className}`}
                  >
                    {selectedOption.badge.text}
                  </span>
                )}
              </>
            ) : (
              <span className="truncate text-sm font-medium text-slate-400">
                {placeholder}
              </span>
            )}
          </div>
        </div>

        <ChevronDown
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-emerald-600" : "group-hover:text-slate-600"
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[240px] overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-150 max-h-64 overflow-y-auto custom-scrollbar"
          style={{ transformOrigin: "top left" }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                  isSelected
                    ? "bg-emerald-50/80 font-bold text-emerald-900 shadow-xs"
                    : "font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{opt.label}</span>
                      {opt.badge && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${opt.badge.className}`}
                        >
                          {opt.badge.text}
                        </span>
                      )}
                    </div>
                    {opt.description && (
                      <span className="text-[11px] font-normal text-slate-400 truncate">
                        {opt.description}
                      </span>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <Check size={15} className="shrink-0 text-emerald-600" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
