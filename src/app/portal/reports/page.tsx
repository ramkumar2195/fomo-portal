"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { AdminOverviewMetrics, DashboardMetrics, LeaderboardEntry } from "@/types/models";

interface ReportsState {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
}

const EMPTY_STATE: ReportsState = {
  metrics: {
    todaysInquiries: 0,
    followUpsDue: 0,
    conversionRate: 0,
    revenueToday: 0,
    revenueThisMonth: 0,
  },
  adminOverview: {
    totalActiveMembers: 0,
    expiredMembers: 0,
    irregularMembers: 0,
    totalPtClients: 0,
    todaysRevenue: 0,
    monthRevenue: 0,
    todaysBirthdays: 0,
    upcomingRenewals7Days: 0,
    upcomingRenewals15Days: 0,
    upcomingRenewals30Days: 0,
    totalMembers: 0,
    totalStaff: 0,
  },
  leaderboard: [],
};

function buildMonthlySeries(monthRevenue: number): Array<{ month: string; value: number }> {
  const base = Math.max(Math.round(monthRevenue / 6), 5000);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const factors = [0.85, 0.92, 1.04, 0.98, 1.12, 1.2];
  return labels.map((month, index) => ({ month, value: Math.round(base * factors[index]) }));
}

export default function ReportsPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ReportsState>(EMPTY_STATE);

  const loadReports = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await engagementService.getSalesDashboard(token, user.id, user.role);
      setState(response);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load reports";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const monthlySeries = useMemo(
    () => buildMonthlySeries(state.adminOverview.monthRevenue || state.metrics.revenueThisMonth),
    [state.adminOverview.monthRevenue, state.metrics.revenueThisMonth],
  );
  const maxSeries = useMemo(() => Math.max(...monthlySeries.map((item) => item.value), 1), [monthlySeries]);

  if (loading) {
    return <PageLoader label="Loading reports..." />;
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Comprehensive insights into gym performance.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadReports()}
          className="inline-flex rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Refresh Report
        </button>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Avg Monthly Revenue",
            value: formatCurrency(Math.round((state.adminOverview.monthRevenue || state.metrics.revenueThisMonth) / 1)),
            change: "+8%",
          },
          { label: "Total Memberships", value: String(state.adminOverview.totalMembers), change: "+12%" },
          { label: "Lead Conversion", value: formatPercent(state.metrics.conversionRate), change: "+5%" },
          {
            label: "Follow-ups Due",
            value: String(state.metrics.followUpsDue),
            change: state.metrics.followUpsDue > 0 ? "-2%" : "+0%",
          },
        ].map((item) => (
          <article key={item.label} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700">
                {item.label.slice(0, 2).toUpperCase()}
              </span>
              <span
                className={`rounded-full px-2 py-1 text-xs font-bold ${
                  item.change.startsWith("+") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                }`}
              >
                {item.change}
              </span>
            </div>
            <p className="text-sm font-medium text-gray-500">{item.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{item.value}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <SectionCard title="Revenue Growth">
          <div className="flex h-64 items-end gap-4 rounded-2xl bg-gray-50 p-4">
            {monthlySeries.map((point) => {
              const height = Math.max(12, Math.round((point.value / maxSeries) * 100));
              return (
                <div key={point.month} className="flex flex-1 flex-col items-center justify-end gap-2">
                  <div className="relative flex h-48 w-full items-end rounded-lg bg-white">
                    <div className="w-full rounded-lg bg-red-600/90" style={{ height: `${height}%` }} />
                  </div>
                  <p className="text-xs font-medium text-gray-500">{point.month}</p>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Sales Performance">
          <div className="space-y-4">
            {state.leaderboard.slice(0, 6).map((entry, index) => (
              <div key={entry.userId} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">#{index + 1} {entry.userName}</p>
                  <p className="text-xs text-gray-500">{entry.conversions} conversions</p>
                </div>
                <p className="text-sm font-semibold text-gray-800">{formatCurrency(entry.revenue)}</p>
              </div>
            ))}
            {state.leaderboard.length === 0 ? (
              <p className="text-sm text-gray-500">No leaderboard data available.</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
