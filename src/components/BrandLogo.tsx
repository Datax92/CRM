import type { CSSProperties } from "react";

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

export function BrandLogo({ compact = false, className }: BrandLogoProps) {
  const iconStyle: CSSProperties = {
    filter: "drop-shadow(0 8px 18px rgb(15 160 111 / 0.24))",
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 96 96"
          className="h-10 w-10 shrink-0"
          aria-hidden="true"
          style={iconStyle}
        >
          <defs>
            <linearGradient id="leadwayBrand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#15c58a" />
              <stop offset="100%" stopColor="#0b7e5e" />
            </linearGradient>
          </defs>
          <path
            d="M10 50L48 16L76 38L69 46L48 28L18 54Z"
            fill="url(#leadwayBrand)"
          />
          <path
            d="M20 53V78H34V66H62V78H76V53H84V86H12V53Z"
            fill="#263140"
          />
          <path
            d="M10 70L40 40L53 53L84 20L90 30L53 67L40 55L16 79Z"
            fill="url(#leadwayBrand)"
          />
        </svg>

        {!compact && (
          <div className="leading-none">
            <p className="font-heading text-2xl font-extrabold tracking-tight text-slate-900">Leadway</p>
            <p className="-mt-0.5 text-base font-extrabold uppercase tracking-[0.12em] text-emerald-600">CRM</p>
          </div>
        )}
      </div>
    </div>
  );
}
