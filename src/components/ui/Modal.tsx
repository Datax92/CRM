"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  /** Overrides the default body padding — use "" for content that manages its own padding (e.g. sticky tab bars/footers). */
  bodyClassName?: string;
}

/**
 * App-wide modal shell.
 *
 * Rendered through a portal straight into `document.body` so it is always
 * positioned against the real viewport — never clipped, offset, or visually
 * "glued" to the app header no matter what layout/stacking context it's
 * triggered from. The card itself is a fixed-height flex column (header /
 * scrollable body / optional sticky footer), so tall forms scroll internally
 * instead of stretching the whole dialog to the edge of the screen.
 */
export function Modal({ isOpen, onClose, title, subtitle, icon, children, maxWidth = "max-w-xl", bodyClassName = "p-6 sm:p-7" }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "unset";
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-modal-fade"
        onClick={onClose}
      />
      <div
        className={`relative flex w-full ${maxWidth} max-h-[88vh] flex-col overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-[0_24px_70px_-15px_rgba(15,23,42,0.35)] animate-modal-pop`}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-6 py-5 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold tracking-tight text-slate-900">{title}</h3>
              {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}