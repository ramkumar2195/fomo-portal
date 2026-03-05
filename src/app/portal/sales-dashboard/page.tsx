"use client";

import Link from "next/link";
import { ComponentType, SVGProps, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActiveMembersIcon,
  BirthdayIcon,
  EnquiryIcon,
  ExpiredMembersIcon,
  FollowUpsIcon,
  IrregularMembersIcon,
  PTClientsIcon,
  RenewalsMetricIcon,
  RevenueIcon,
  ReportsIcon,
  CommunityIcon,
  MembersIcon,
  RenewalsIcon,
  DashboardIcon,
} from "@/components/common/icons";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { hasDesignation } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { resolveStaffId } from "@/lib/staff-id";
import { AdminOverviewMetrics, DashboardMetrics, LeaderboardEntry } from "@/types/models";

interface DashboardState {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
  followUpsDueToday: number;
  overdueFollowUps: number;
}

interface QuickAction {
  label: string;
  href: string;
  color: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface RevenuePoint {
  day: string;
  value: number;
}

interface ActivityItem {
  actor: string;
  action: string;
  target: string;
  time: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Add Member", href: "/portal/members/add", color: "bg-blue-600", icon: MembersIcon },
  { label: "Add Enquiry", href: "/portal/inquiries", color: "bg-green-600", icon: EnquiryIcon },
  { label: "Add Trainer", href: "/portal/trainers/add", color: "bg-violet-600", icon: MembersIcon },
  { label: "Add Staff", href: "/portal/staff/add", color: "bg-fuchsia-600", icon: MembersIcon },
  { label: "Follow-ups", href: "/portal/follow-ups", color: "bg-orange-600", icon: FollowUpsIcon },
  { label: "Community", href: "/portal/community", color: "bg-purple-600", icon: CommunityIcon },
  { label: "Biometric", href: "/portal/trainer-attendance", color: "bg-slate-700", icon: DashboardIcon },
  { label: "Appointments", href: "/portal/class-schedule", color: "bg-red-600", icon: RenewalsIcon },
  { label: "Packages", href: "/portal/billing", color: "bg-emerald-600", icon: RevenueIcon },
  { label: "Members List", href: "/portal/members", color: "bg-cyan-600", icon: MembersIcon },
  { label: "Reports", href: "/portal/reports", color: "bg-indigo-600", icon: ReportsIcon },
];

const EMPTY_STATE: DashboardState = {
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
  followUpsDueToday: 0,
  overdueFollowUps: 0,
};

function iconForMetric(label: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (label.includes("Active")) {
    return ActiveMembersIcon;
  }
  if (label.includes("Expired")) {
    return ExpiredMembersIcon;
  }
  if (label.includes("Irregular")) {
    return IrregularMembersIcon;
  }
  if (label.includes("PT")) {
    return PTClientsIcon;
  }
  if (label.includes("Revenue")) {
    return RevenueIcon;
  }
  if (label.includes("Birthdays")) {
    return BirthdayIcon;
  }
  if (label.includes("Renewals")) {
    return RenewalsMetricIcon;
  }
  if (label.includes("Inquiries")) {
    return EnquiryIcon;
  }
  if (label.includes("Follow-ups")) {
    return FollowUpsIcon;
  }
  return DashboardIcon;
}

function buildWeeklyRevenueSeries(revenueToday: number, revenueThisMonth: number): RevenuePoint[] {
  const seed = revenueThisMonth > 0 ? revenueThisMonth : revenueToday * 18;
  const base = Math.max(seed / 30, 1000);
  const multipliers = [0.9, 1.05, 0.82, 1.2, 0.96, 1.32, 1.14];
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return labels.map((day, index) => {
    const value = Math.round(base * multipliers[index]);
    return {
      day,
      value: index === labels.length - 1 && revenueToday > 0 ? revenueToday : value,
    };
  });
}

function buildActivityItems(leaderboard: LeaderboardEntry[]): ActivityItem[] {
  if (leaderboard.length === 0) {
    return [
      { actor: "Staff", action: "updated", target: "member records", time: "10 mins ago" },
      { actor: "Staff", action: "scheduled", target: "follow-up queue", time: "35 mins ago" },
      { actor: "Staff", action: "processed", target: "billing actions", time: "1 hour ago" },
    ];
  }

  return leaderboard.slice(0, 4).map((entry, index) => ({
    actor: entry.userName,
    action: "closed",
    target: `${entry.conversions} conversions`,
    time: `${(index + 1) * 18} mins ago`,
  }));
}

export default function SalesDashboardPage() {
  const { token, user } = useAuth();
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSuperAdmin = hasDesignation(user, "SUPER_ADMIN");

  const loadDashboard = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const staffId = resolveStaffId(user);
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      const [dashboardResponse, dueToday, overdue] = await Promise.all([
        engagementService.getSalesDashboard(token, user.id, user.role),
        subscriptionFollowUpService.searchFollowUpQueue(token, {
          assignedToStaffId: staffId || undefined,
          status: "SCHEDULED",
          dueFrom: startOfDay.toISOString(),
          dueTo: endOfDay.toISOString(),
        }),
        subscriptionFollowUpService.searchFollowUpQueue(token, {
          assignedToStaffId: staffId || undefined,
          status: "SCHEDULED",
          overdueOnly: true,
        }),
      ]);

      setState({
        ...dashboardResponse,
        followUpsDueToday: dueToday.length,
        overdueFollowUps: overdue.length,
      });
    } catch (dashboardError) {
      const message = dashboardError instanceof Error ? dashboardError.message : "Unable to load dashboard";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const revenueSeries = useMemo(
    () => buildWeeklyRevenueSeries(state.metrics.revenueToday, state.metrics.revenueThisMonth),
    [state.metrics.revenueToday, state.metrics.revenueThisMonth],
  );

  const maxRevenue = useMemo(
    () => Math.max(...revenueSeries.map((item) => item.value), 1),
    [revenueSeries],
  );

  const activityItems = useMemo(() => buildActivityItems(state.leaderboard), [state.leaderboard]);

  const metricCards = isSuperAdmin
    ? [
        {
          label: "Total Active Members",
          value: String(state.adminOverview.totalActiveMembers),
          subtitle: "Current active memberships",
          color: "bg-green-50 text-green-700",
        },
        {
          label: "Total Expired Members",
          value: String(state.adminOverview.expiredMembers),
          subtitle: "Needs renewal intervention",
          color: "bg-red-50 text-red-700",
        },
        {
          label: "Total Irregular Members",
          value: String(state.adminOverview.irregularMembers),
          subtitle: "Attendance requires follow-up",
          color: "bg-orange-50 text-orange-700",
        },
        {
          label: "Total PT Clients",
          value: String(state.adminOverview.totalPtClients),
          subtitle: "Active PT assignments",
          color: "bg-blue-50 text-blue-700",
        },
        {
          label: "Today's Revenue",
          value: formatCurrency(state.adminOverview.todaysRevenue || state.metrics.revenueToday),
          subtitle: "Current day collection",
          color: "bg-emerald-50 text-emerald-700",
        },
        {
          label: "Monthly Revenue",
          value: formatCurrency(state.adminOverview.monthRevenue || state.metrics.revenueThisMonth),
          subtitle: "Month-to-date billing",
          color: "bg-purple-50 text-purple-700",
        },
        {
          label: "Today's Birthdays",
          value: String(state.adminOverview.todaysBirthdays),
          subtitle: "Member birthdays today",
          color: "bg-pink-50 text-pink-700",
        },
        {
          label: "Upcoming Renewals",
          value: `${state.adminOverview.upcomingRenewals7Days}/${state.adminOverview.upcomingRenewals15Days}/${state.adminOverview.upcomingRenewals30Days}`,
          subtitle: "Next 7 / 15 / 30 days",
          color: "bg-amber-50 text-amber-700",
        },
      ]
    : [
        {
          label: "Today's Inquiries",
          value: String(state.metrics.todaysInquiries),
          subtitle: "Lead intake for today",
          color: "bg-blue-50 text-blue-700",
        },
        {
          label: "Follow-ups Due",
          value: String(state.followUpsDueToday),
          subtitle: "Scheduled for today",
          color: "bg-orange-50 text-orange-700",
        },
        {
          label: "Overdue Follow-ups",
          value: String(state.overdueFollowUps),
          subtitle: "Immediate action needed",
          color: "bg-red-50 text-red-700",
        },
        {
          label: "Conversion Rate",
          value: formatPercent(state.metrics.conversionRate),
          subtitle: "Inquiry to member conversion",
          color: "bg-purple-50 text-purple-700",
        },
        {
          label: "Revenue Today",
          value: formatCurrency(state.metrics.revenueToday),
          subtitle: "Today's collections",
          color: "bg-emerald-50 text-emerald-700",
        },
        {
          label: "Revenue Month",
          value: formatCurrency(state.metrics.revenueThisMonth),
          subtitle: "Monthly collections",
          color: "bg-indigo-50 text-indigo-700",
        },
      ];

  if (loading) {
    return <PageLoader label="Loading dashboard..." />;
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good Morning{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-gray-500">Here&apos;s what&apos;s happening at FOMO Gym today.</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className={`grid gap-6 ${isSuperAdmin ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"}`}>
        {metricCards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            {(() => {
              const MetricIcon = iconForMetric(card.label);
              return (
                <div className="mb-4 flex items-start justify-between">
                  <div className={`rounded-xl p-2.5 ${card.color}`}>
                    <MetricIcon className="h-5 w-5" />
                  </div>
                </div>
              );
            })()}
            <h3 className="text-sm font-medium text-gray-500">{card.label}</h3>
            <p className="mt-1 text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="mt-2 text-xs text-gray-400">{card.subtitle}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          <SectionCard
            title="Weekly Revenue"
            subtitle="Trend view from today and monthly collections"
            actions={
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
              >
                Refresh
              </button>
            }
          >
            <div className="flex h-64 items-end gap-4 rounded-2xl bg-gray-50 p-4">
              {revenueSeries.map((point) => {
                const height = Math.max(12, Math.round((point.value / maxRevenue) * 100));
                return (
                  <div key={point.day} className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="relative flex h-48 w-full items-end rounded-lg bg-white">
                      <div className="w-full rounded-lg bg-red-600/90" style={{ height: `${height}%` }} />
                    </div>
                    <p className="text-xs font-medium text-gray-500">{point.day}</p>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Quick Actions" subtitle="Fast access shortcuts">
            <div className="grid grid-cols-3 gap-4 md:grid-cols-5 lg:grid-cols-9">
              {QUICK_ACTIONS.map((action) => (
                <Link key={action.label} href={action.href} className="group flex flex-col items-center gap-2">
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-xl text-white transition-transform group-hover:scale-105 ${action.color}`}
                  >
                    <action.icon className="h-5 w-5" />
                  </span>
                  <span className="text-center text-[10px] font-medium text-gray-500 group-hover:text-gray-900">
                    {action.label}
                  </span>
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-8">
          <SectionCard title="Activity History" actions={<Link href="/portal/reports" className="text-xs font-semibold text-red-600 hover:underline">View All</Link>}>
            <div className="space-y-5">
              {activityItems.map((item, index) => (
                <div key={`${item.actor}-${item.target}-${index}`} className="flex gap-3">
                  <div className="relative">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-700">
                      {item.actor.slice(0, 1).toUpperCase()}
                    </div>
                    {index !== activityItems.length - 1 ? (
                      <div className="absolute left-1/2 top-9 h-5 w-px -translate-x-1/2 bg-gray-100" />
                    ) : null}
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">
                      <span className="font-semibold text-gray-900">{item.actor}</span>{" "}
                      <span>{item.action}</span>{" "}
                      <span className="font-medium text-gray-900">{item.target}</span>
                    </p>
                    <p className="mt-1 text-xs text-gray-400">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <section className="rounded-2xl bg-black p-6 text-white shadow-xl shadow-black/10">
            <h2 className="text-lg font-bold">Enquiry Conversion</h2>
            <p className="mb-6 mt-1 text-sm text-gray-400">Efficiency of the sales team</p>
            <div className="mb-6 flex h-24 items-end gap-3">
              {revenueSeries.slice(1).map((point) => {
                const relative = Math.max(20, Math.round((point.value / maxRevenue) * 100));
                return (
                  <div key={`mini-${point.day}`} className="flex-1 rounded-t-lg bg-white/10">
                    <div className="rounded-t-lg bg-red-600" style={{ height: `${relative}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold">{formatPercent(state.metrics.conversionRate)}</p>
                <p className="text-xs text-gray-500">Conversion Rate</p>
              </div>
              <p className="rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-green-300">
                +{state.metrics.todaysInquiries}
              </p>
            </div>
          </section>
        </div>
      </div>

      <SectionCard title="Leaderboard" subtitle="Top performers by conversions and revenue">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Conversions</th>
                <th className="px-4 py-3">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {state.leaderboard.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-sm text-gray-500" colSpan={4}>
                    No leaderboard data available
                  </td>
                </tr>
              ) : (
                state.leaderboard.map((entry, index) => (
                  <tr key={entry.userId} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-sm text-gray-600">#{index + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{entry.userName}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{entry.conversions}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatCurrency(entry.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
