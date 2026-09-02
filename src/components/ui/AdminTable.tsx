import type { ReactNode } from "react";

/** Contained horizontal scroll — never forces page-level overflow. */
export function TablePanel({
  children,
  footer,
  minWidth = 640,
}: {
  children: ReactNode;
  footer?: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="max-w-full overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <div className="admin-table-scroll max-w-full overflow-x-auto lg:overflow-x-visible">
        <div className="w-full" style={{ minWidth }}>{children}</div>
      </div>
      {footer && (
        <div className="border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">{footer}</div>
      )}
    </div>
  );
}

export function AdminTable({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <table
      className="w-full table-fixed border-collapse text-left text-xs"
      style={minWidth ? { minWidth } : undefined}
    >
      {children}
    </table>
  );
}

export function AdminThead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-emerald-100 bg-emerald-50/60 font-semibold uppercase tracking-wider text-slate-600">
      <tr>
        {children}
      </tr>
    </thead>
  );
}

export function AdminTh({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-[11px] ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </th>
  );
}

export function AdminTbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-200">{children}</tbody>;
}

export function AdminTr({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function AdminTd({
  children,
  align = "left",
  numeric = false,
  tone = "default",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right";
  numeric?: boolean;
  tone?: "default" | "profit" | "loss";
  className?: string;
}) {
  const toneClass =
    tone === "profit"
      ? "text-emerald-600 font-semibold"
      : tone === "loss"
        ? "text-red-600 font-semibold"
        : "text-slate-900";

  return (
    <td
      className={`px-4 py-3 align-top ${align === "right" ? "text-right" : "text-left"} ${
        numeric ? "tabular-nums" : ""
      } ${toneClass} ${className}`}
    >
      {children}
    </td>
  );
}

/** Employee ACTIVE/DISABLED - blue/amber badges (not profit green / alert red).
 * Also used for expense categories with status="info" and a label prop. */
export function EmployeeStatusBadge({ status, label }: { status: string; label?: string }) {
  const norm = (status || "").toUpperCase();
  const isActive = norm === "ACTIVE";
  const displayText = label ?? (isActive ? "Active" : "Disabled");
  const isInfo = norm === "INFO";
  return (
    <span
      className={`inline-block rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
        isInfo
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : isActive
            ? "border-emerald-300 bg-emerald-100 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {displayText}
    </span>
  );
}

export function TabSectionHeading({
  title,
  subtitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

export function EmptyTableState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-emerald-200 bg-white p-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

/** Profit column: green if >=0, red if negative. */
export function profitTone(value: number): "profit" | "loss" {
  return value >= 0 ? "profit" : "loss";
}

/** Missed counts / expense amounts - red when meaningful loss. */
export function lossTone(value: number): "default" | "loss" {
  return value > 0 ? "loss" : "default";
}
