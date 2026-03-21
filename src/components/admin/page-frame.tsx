"use client";

import { ReactNode } from "react";

interface FilterOption {
  label: string;
  value: string;
}

interface FilterDefinition {
  id?: string;
  label: string;
  options: Array<string | FilterOption>;
}

interface AdminPageFrameProps {
  title: string;
  description?: string;
  children: ReactNode;
  hideToolbar?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: FilterDefinition[];
  filterValues?: Record<string, string>;
  onFilterChange?: (filterId: string, value: string) => void;
  action?: ReactNode;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
}

export function AdminPageFrame({
  title,
  description,
  children,
  hideToolbar = false,
  searchPlaceholder = "Search...",
  searchValue,
  onSearchChange,
  filters = [],
  filterValues,
  onFilterChange,
  action,
}: AdminPageFrameProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
          {description ? <p className="text-sm text-slate-400">{description}</p> : null}
        </div>
        {action}
      </div>

      {!hideToolbar ? (
        <div className="rounded-[28px] border border-white/8 bg-[#131925] p-4 shadow-[0_22px_65px_rgba(0,0,0,0.3)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <input
              className="h-10 flex-1 rounded-xl border border-white/8 bg-white/[0.04] px-3 text-sm text-slate-100 outline-none ring-red-500 transition focus:bg-white/[0.08] focus:ring-1"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(event) => onSearchChange?.(event.target.value)}
            />
            <div className="grid gap-2 sm:grid-cols-2 xl:flex">
              {filters.map((filter, index) => {
                const filterId = filter.id || `filter-${index}`;
                return (
                  <label key={filter.label} className="flex flex-col gap-1 text-xs text-slate-500">
                    {filter.label}
                    <select
                      className="h-10 min-w-40 rounded-xl border border-white/8 bg-white/[0.04] px-3 text-sm text-slate-100 outline-none ring-red-500 focus:ring-1"
                      value={filterValues?.[filterId]}
                      onChange={(event) => onFilterChange?.(filterId, event.target.value)}
                    >
                      {filter.options.map((option, optionIndex) => {
                        const value = typeof option === "string" ? option : option.value;
                        const label = typeof option === "string" ? option : option.label;
                        return (
                          <option key={`${filter.label}-${value}-${optionIndex}`} value={value}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {children}
    </div>
  );
}

export function SurfaceCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-white/8 bg-[#131925] p-4 shadow-[0_22px_65px_rgba(0,0,0,0.3)]">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function MetricCard({ title, value, subtitle, icon }: MetricCardProps) {
  return (
    <article className="rounded-[28px] border border-white/8 bg-[#131925] p-4 shadow-[0_22px_65px_rgba(0,0,0,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
        </div>
        <div className="rounded-xl bg-white/[0.05] p-2 text-[#c42924]">{icon}</div>
      </div>
      {subtitle ? <p className="mt-3 text-xs text-slate-400">{subtitle}</p> : null}
    </article>
  );
}

export function StatusBadge({ value }: { value: "Active" | "At Risk" | "Inactive" }) {
  const styleByStatus = {
    Active: "bg-emerald-100 text-emerald-700",
    "At Risk": "bg-amber-100 text-amber-700",
    Inactive: "bg-rose-100 text-rose-700",
  } as const;

  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${styleByStatus[value]}`}>{value}</span>;
}

export function TabStrip({ tabs }: { tabs: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-white/8 bg-[#131925] p-2 shadow-[0_16px_45px_rgba(0,0,0,0.24)]">
      {tabs.map((tab, index) => (
        <button
          key={tab}
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            index === 0 ? "bg-[#c42924] text-white" : "text-slate-300 hover:bg-white/[0.06]"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
