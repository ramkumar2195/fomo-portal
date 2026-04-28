"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  IndianRupee,
  Layers3,
  UserPlus,
  Users,
} from "lucide-react";
import { DashboardDrilldownModal } from "@/components/admin/dashboard-drilldown-modal";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { DonutLegendChart, FunnelChart } from "@/components/admin/charts";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { ApiError } from "@/lib/api/http-client";
import { usersService } from "@/lib/api/services/users-service";
import { normalizeInquirySourceLabel } from "@/lib/inquiry-source";
import { DashboardDrilldownMetricKey, SuperAdminDashboardResponse } from "@/types/models";

type JsonRecord = Record<string, unknown>;

interface DashboardMetricCard {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  iconClass: string;
  metricKey: DashboardDrilldownMetricKey;
}

const STATUS_ORDER = ["NEW", "CONTACTED", "FOLLOW_UP", "TRIAL_BOOKED", "CONVERTED", "NOT_INTERESTED", "LOST"] as const;

const EMPTY_DASHBOARD: SuperAdminDashboardResponse = {
  generatedAt: undefined,
  summary: {
    members: {
      totalMembers: 0,
      activeMembers: 0,
      inactiveMembers: 0,
      expiredMembers: 0,
      irregularMembers: 0,
    },
    pt: {
      ptClients: 0,
      ptActiveClients: 0,
      ptInactiveClients: 0,
    },
    revenue: {
      revenueToday: 0,
      revenueThisMonth: 0,
      revenueThisYear: 0,
      revenueLifetime: 0,
    },
    subscriptions: {
      activeSubscriptions: 0,
      inactiveSubscriptions: 0,
      balanceDueInvoices: 0,
      balanceDueAmount: 0,
    },
    newMembers: {
      today: 0,
      month: 0,
    },
    staff: {
      totalStaff: 0,
      activeStaff: 0,
    },
    coaches: {
      totalCoaches: 0,
      activeCoaches: 0,
    },
  },
  metrics: {
    totalMembers: 0,
    activeMembers: 0,
    expiredMembers: 0,
    irregularMembers: 0,
    ptClients: 0,
    ptActiveClients: 0,
    ptInactiveClients: 0,
    newMembersToday: 0,
    totalLeadsToday: 0,
    conversionRate: 0,
    revenueToday: 0,
    revenueThisMonth: 0,
    revenueThisYear: 0,
    revenueLifetime: 0,
    activeSubscriptions: 0,
    ptSessionsScheduledToday: 0,
    classesRunningToday: 0,
  },
  inquiryAnalytics: {
    totalInquiries: 0,
    convertedInquiries: 0,
    statusDistribution: [],
    sourceDistribution: [],
  },
  multiBranchInsights: [],
  alerts: {
    membershipsExpiringSoon: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
    creditsExpiringSoon: 0,
    trainerScheduleConflicts: 0,
  },
  users: {
    totalUsers: 0,
    totalMembers: 0,
    totalStaff: 0,
    totalCoaches: 0,
    activeMembers: 0,
    inactiveMembers: 0,
    activeStaff: 0,
    activeCoaches: 0,
  },
  inquiries: {
    total: 0,
    open: 0,
    converted: 0,
    closed: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
  },
  revenue: {
    todayCollected: 0,
    monthCollected: 0,
    yearCollected: 0,
    lifetimeCollected: 0,
    monthOutstanding: 0,
    yearOutstanding: 0,
    lifetimeOutstanding: 0,
    monthAverageInvoiceValue: 0,
  },
  subscriptions: {
    activeSubscriptions: 0,
    ptClients: 0,
    expiringIn7Days: 0,
    expiringIn30Days: 0,
    expiredSubscriptions: 0,
    inactiveSubscriptions: 0,
    balanceDueInvoices: 0,
    balanceDueAmount: 0,
  },
  engagement: {
    todayCheckIns: 0,
    currentlyInside: 0,
    onlineUsers: 0,
    atRiskMembers: 0,
    inactiveMembers3To5Days: 0,
    inactiveMembers5PlusDays: 0,
  },
  warnings: [],
};

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

/**
 * Compact currency for the dashboard's metric cards. Indian convention:
 *   ≥ 1 crore   → "₹1.27 Cr"
 *   ≥ 1 lakh    → "₹4.40 L"
 *   < 1 lakh    → fall back to standard formatInr (e.g. "₹98,500")
 *
 * Used in Revenue cards where the full number "₹1,27,12,427" was wrapping
 * to two lines and misaligning the icon. The card title still gets the
 * exact value via {@link formatInr} on click drill-down; the card face
 * just needs an at-a-glance number.
 */
function formatInrCompact(value: number): string {
  const v = value || 0;
  if (v >= 10_000_000) {
    return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  }
  if (v >= 100_000) {
    return `₹${(v / 100_000).toFixed(2)} L`;
  }
  return formatInr(v);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0);
}

function HeroStatCard({
  card,
  accentClass,
  badge,
  onClick,
}: {
  card: DashboardMetricCard;
  accentClass: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border border-white/10 bg-[#121722] p-5 text-left shadow-sm transition hover:border-[#C42429] hover:bg-[#171d29] hover:shadow-md ${accentClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 break-words">{card.title}</p>
          {/* truncate + whitespace-nowrap keeps the metric value on a
              single line even when the underlying number is long. The
              accompanying revenue cards already use formatInrCompact so
              this is a belt-and-braces guarantee against future regressions. */}
          <p className="mt-3 truncate whitespace-nowrap text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">{card.value}</p>
          <p className="mt-2 break-words text-sm leading-6 text-slate-300">{card.subtitle}</p>
        </div>
        <div className={`inline-flex shrink-0 rounded-2xl border border-white/10 p-3 shadow-sm [&_svg]:h-5 [&_svg]:w-5 ${card.iconClass}`}>{card.icon}</div>
      </div>
      {badge ? (
        <span className="mt-4 inline-flex max-w-full break-words rounded-full bg-[#E8F2D7] px-3 py-1 text-xs font-semibold text-[#5B7F2B]">{badge}</span>
      ) : null}
    </button>
  );
}

function DashboardPill({ label, tone = "neutral" }: { label: string; tone?: "green" | "amber" | "neutral" | "rose" }) {
  const toneClass =
    tone === "green"
      ? "bg-[#E8F2D7] text-[#5B7F2B]"
      : tone === "amber"
        ? "bg-[#F8ECD0] text-[#8B5C11]"
        : tone === "rose"
          ? "bg-[#FCE7E8] text-[#B42318]"
          : "bg-slate-100 text-slate-600";

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${toneClass}`}>{label}</span>;
}

function createMetricCard(
  title: string,
  value: string,
  subtitle: string,
  icon: React.ReactNode,
  iconClass: string,
  metricKey: DashboardDrilldownMetricKey,
): DashboardMetricCard {
  return {
    title,
    value,
    subtitle,
    icon,
    iconClass,
    metricKey,
  };
}

function MetricValueCard({
  card,
  onClick,
  badge,
}: {
  card: DashboardMetricCard;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-3xl border border-white/10 bg-[#121722] p-5 text-left shadow-sm transition hover:border-[#C42429] hover:bg-[#171d29] hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-slate-100">{card.title}</p>
          {/* whitespace-nowrap + truncate keeps the metric value on a
              single line so the icon bubble stays vertically aligned
              across cards on the same row. Font sized to fit 5-up at
              xl breakpoint — text-3xl was overflowing on Revenue cards
              packed tighter than 4-up. */}
          <p className="mt-4 truncate whitespace-nowrap text-2xl font-bold leading-tight tracking-tight text-white xl:text-3xl">{card.value}</p>
          <p className="mt-2 break-words text-sm leading-6 text-slate-400">{card.subtitle}</p>
        </div>
        <div className={`inline-flex shrink-0 rounded-2xl border border-white/10 p-3 shadow-sm [&_svg]:h-5 [&_svg]:w-5 ${card.iconClass}`}>{card.icon}</div>
      </div>
      {badge ? <div className="mt-4">{badge}</div> : null}
    </button>
  );
}

function CompactMetricCard({
  card,
  onClick,
  badge,
}: {
  card: DashboardMetricCard;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/10 bg-[#121722] p-4 text-left transition hover:border-[#C42429] hover:bg-[#171d29] hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-slate-200">{card.title}</p>
          <p className="mt-2 break-words text-2xl font-bold leading-tight tracking-tight text-white xl:text-3xl">{card.value}</p>
        </div>
        <div className={`inline-flex shrink-0 rounded-2xl border border-white/10 p-2.5 shadow-sm [&_svg]:h-4 [&_svg]:w-4 ${card.iconClass}`}>{card.icon}</div>
      </div>
      {badge ? <div className="mt-3">{badge}</div> : <p className="mt-2 break-words text-xs leading-5 text-slate-400">{card.subtitle}</p>}
    </button>
  );
}

function SnapshotStat({
  label,
  value,
  subtitle,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone?: "neutral" | "green" | "amber" | "rose" | "blue";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-400/20 bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-400/20 bg-amber-500/10"
        : tone === "rose"
          ? "border-rose-400/20 bg-rose-500/10"
          : tone === "blue"
            ? "border-sky-400/20 bg-sky-500/10"
            : "border-white/8 bg-white/[0.03]";

  const className = `rounded-2xl border p-4 ${toneClass}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${className} text-left transition hover:border-[#C42429] hover:bg-white/[0.05]`}
      >
        <p className="break-words text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className="mt-3 break-words text-2xl font-bold leading-tight tracking-tight text-white xl:text-3xl">{value}</p>
        <p className="mt-2 break-words text-sm leading-6 text-slate-300">{subtitle}</p>
      </button>
    );
  }

  return (
    <div className={className}>
      <p className="break-words text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 break-words text-2xl font-bold leading-tight tracking-tight text-white xl:text-3xl">{value}</p>
      <p className="mt-2 break-words text-sm leading-6 text-slate-300">{subtitle}</p>
    </div>
  );
}

function formatGeneratedDate(value?: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function toLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatSourceLabel(value?: string): string {
  return normalizeInquirySourceLabel(value);
}

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseDistribution(
  value: unknown,
  labelKeys: string[],
  valueKeys: string[],
  normalizeLabel: boolean,
): Map<string, number> {
  if (!value) {
    return new Map();
  }

  if (Array.isArray(value)) {
    const map = new Map<string, number>();
    value.forEach((entry) => {
      const record = toRecord(entry);
      const rawLabel = labelKeys
        .map((key) => record[key])
        .find((candidate) => typeof candidate === "string" || typeof candidate === "number");
      const rawValue = valueKeys.map((key) => toNumber(record[key])).find((candidate) => candidate !== undefined);
      if (!rawLabel || rawValue === undefined) {
        return;
      }
      const label = String(rawLabel).trim();
      map.set(normalizeLabel ? label.toUpperCase() : label, rawValue);
    });
    return map;
  }

  if (typeof value === "object" && value !== null) {
    const map = new Map<string, number>();
    Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
      const parsed = toNumber(raw);
      if (parsed !== undefined) {
        map.set(normalizeLabel ? key.toUpperCase() : key, parsed);
      }
    });
    return map;
  }

  return new Map();
}

function summarizeWarnings(warnings: string[]): string[] {
  const coachIds = new Set<string>();
  let trainingServiceIssue = false;
  const normalized = new Set<string>();

  warnings.forEach((warning) => {
    const clean = warning.replace(/\s+/g, " ").trim();
    const coachMatch = clean.match(/Coach not found:\s*([0-9]+)/i);
    if (coachMatch) {
      coachIds.add(coachMatch[1]);
      trainingServiceIssue = true;
      return;
    }

    if (/training-service call failed/i.test(clean)) {
      trainingServiceIssue = true;
      return;
    }

    if (/branch-service call failed/i.test(clean)) {
      normalized.add("Branch dashboard data is partially unavailable right now.");
      return;
    }

    if (clean) {
      normalized.add(clean);
    }
  });

  if (coachIds.size > 0) {
    normalized.add(
      `Trainer-related dashboard data is partial because ${coachIds.size} coach record${coachIds.size > 1 ? "s" : ""} could not be resolved.`,
    );
  } else if (trainingServiceIssue) {
    normalized.add("Trainer-related dashboard data is partially unavailable right now.");
  }

  return [...normalized];
}

interface AdminDashboardProps {
  /** Hide multi-branch insights and strategic revenue (year/lifetime) for branch-scoped managers */
  branchScoped?: boolean;
  /** Override the heading title */
  headingTitle?: string;
  /** Override the heading subtitle */
  headingSubtitle?: string;
  /**
   * Suppress the heading + Live pill row entirely. Used when this dashboard
   * is embedded inside the Super Admin / Gym Manager sales-dashboard route
   * which renders its own AdminDashboardHeader at the top — without this
   * the page shows two competing heading rows (issue L1).
   */
  hideHeading?: boolean;
}

export default function AdminDashboardPage({
  branchScoped = false,
  headingTitle,
  headingSubtitle,
  hideHeading = false,
}: AdminDashboardProps = {}) {
  const { token } = useAuth();
  const { isLoadingBranches, effectiveBranchId, selectedBranchName } = useBranch();

  const [dashboard, setDashboard] = useState<SuperAdminDashboardResponse>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<DashboardMetricCard | null>(null);

  useEffect(() => {
    if (!token || isLoadingBranches) {
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await usersService.getSuperAdminDashboard(token, effectiveBranchId);
        if (!active) {
          return;
        }
        setDashboard(response);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load dashboard.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [isLoadingBranches, token, effectiveBranchId]);

  const statusDistribution = useMemo(
    () => parseDistribution(dashboard.inquiryAnalytics.statusDistribution, ["status", "name", "label", "key"], ["count", "value", "total"], true),
    [dashboard.inquiryAnalytics.statusDistribution],
  );

  const sourceDistribution = useMemo(
    () => parseDistribution(dashboard.inquiryAnalytics.sourceDistribution, ["source", "name", "label", "key"], ["count", "value", "total"], false),
    [dashboard.inquiryAnalytics.sourceDistribution],
  );

  const inquiryStages = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        key: status,
        label: toLabel(status),
        value: statusDistribution.get(status) ?? 0,
      })),
    [statusDistribution],
  );

  const inquiryTotal = dashboard.inquiryAnalytics.totalInquiries || 0;
  const convertedTotal = dashboard.inquiryAnalytics.convertedInquiries || 0;

  const sourceSlices = useMemo(() => {
    const palette = ["#C42429", "#F97316", "#16A34A", "#0284C7", "#7C3AED", "#475569"];
    const normalizedCounts = [...sourceDistribution.entries()].reduce<Map<string, number>>((bucket, [label, value]) => {
      const normalizedLabel = formatSourceLabel(label);
      bucket.set(normalizedLabel, (bucket.get(normalizedLabel) || 0) + value);
      return bucket;
    }, new Map());

    return [...normalizedCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], index) => ({
        label,
        value,
        color: palette[index % palette.length],
      }));
  }, [sourceDistribution]);

  const closedInquiries = useMemo(
    () => (statusDistribution.get("NOT_INTERESTED") ?? 0) + (statusDistribution.get("LOST") ?? 0),
    [statusDistribution],
  );

  const openInquiries = useMemo(
    () => Math.max(inquiryTotal - convertedTotal - closedInquiries, 0),
    [closedInquiries, convertedTotal, inquiryTotal],
  );

  const resolvedConversionRate = useMemo(() => {
    if (dashboard.metrics.conversionRate > 0) {
      return dashboard.metrics.conversionRate;
    }
    if (inquiryTotal > 0) {
      return (convertedTotal / inquiryTotal) * 100;
    }
    return 0;
  }, [convertedTotal, dashboard.metrics.conversionRate, inquiryTotal]);

  const resolvedFollowUpsOverdue = useMemo(
    () => dashboard.inquiries.followUpsOverdue || dashboard.alerts.followUpsOverdue || 0,
    [dashboard.alerts.followUpsOverdue, dashboard.inquiries.followUpsOverdue],
  );

  const resolvedFollowUpsDueToday = useMemo(
    () => dashboard.inquiries.followUpsDueToday || dashboard.alerts.followUpsDueToday || 0,
    [dashboard.alerts.followUpsDueToday, dashboard.inquiries.followUpsDueToday],
  );

  const resolvedExpiringSoon = useMemo(
    () => dashboard.subscriptions.expiringIn7Days || dashboard.alerts.membershipsExpiringSoon || 0,
    [dashboard.alerts.membershipsExpiringSoon, dashboard.subscriptions.expiringIn7Days],
  );

  const resolvedBalanceDueInvoices = useMemo(
    () => dashboard.subscriptions.balanceDueInvoices || 0,
    [dashboard.subscriptions.balanceDueInvoices],
  );

  const resolvedBalanceDueAmount = useMemo(
    () => dashboard.subscriptions.balanceDueAmount || 0,
    [dashboard.subscriptions.balanceDueAmount],
  );

  const heroCards = useMemo<DashboardMetricCard[]>(() => {
    const summary = dashboard.summary;
    return [
      createMetricCard(
        "Total Members",
        formatCount(summary.members.totalMembers),
        "All registered members",
        <Users className="h-4 w-4" />,
        "bg-slate-500/15 text-slate-100",
        "TOTAL_MEMBERS",
      ),
      createMetricCard(
        "Revenue This Month",
        formatInrCompact(summary.revenue.revenueThisMonth),
        "Current month collection",
        <IndianRupee className="h-4 w-4" />,
        "bg-rose-500/15 text-rose-100",
        "REVENUE_THIS_MONTH",
      ),
      createMetricCard(
        "Active Subscriptions",
        formatCount(summary.subscriptions.activeSubscriptions),
        "Live subscription count",
        <Layers3 className="h-4 w-4" />,
        "bg-indigo-500/15 text-indigo-100",
        "ACTIVE_SUBSCRIPTIONS",
      ),
      createMetricCard(
        "New Members This Month",
        formatCount(summary.newMembers.month),
        "Joined this month",
        <UserPlus className="h-4 w-4" />,
        "bg-violet-500/15 text-violet-100",
        "NEW_MEMBERS_THIS_MONTH",
      ),
    ];
  }, [dashboard.summary]);

  const revenueCards = useMemo<DashboardMetricCard[]>(() => {
    const summary = dashboard.summary;
    // formatInrCompact keeps each card's value to a single line — large
    // cumulative amounts like Revenue Lifetime would otherwise read as
    // "₹1,27,12,427" and break to a second line, misaligning the icon
    // bubble against neighboring cards.
    return [
      createMetricCard(
        "Revenue Today",
        formatInrCompact(summary.revenue.revenueToday),
        "Collected today",
        <IndianRupee className="h-4 w-4" />,
        "bg-emerald-500/15 text-emerald-100",
        "REVENUE_TODAY",
      ),
      createMetricCard(
        "Revenue This Month",
        formatInrCompact(summary.revenue.revenueThisMonth),
        "Current month collection",
        <IndianRupee className="h-4 w-4" />,
        "bg-rose-500/15 text-rose-100",
        "REVENUE_THIS_MONTH",
      ),
      ...(
        branchScoped
          ? []
          : [
              createMetricCard(
                "Revenue This Year",
                formatInrCompact(summary.revenue.revenueThisYear),
                "Jan 1 to today",
                <IndianRupee className="h-4 w-4" />,
                "bg-violet-500/15 text-violet-100",
                "REVENUE_THIS_YEAR",
              ),
              createMetricCard(
                "Revenue Lifetime",
                formatInrCompact(summary.revenue.revenueLifetime),
                "Platform lifetime collection",
                <IndianRupee className="h-4 w-4" />,
                "bg-amber-500/15 text-amber-100",
                "REVENUE_LIFETIME",
              ),
            ]
      ),
    ];
  }, [branchScoped, dashboard.summary]);

  const memberHealthCards = useMemo<DashboardMetricCard[]>(() => {
    const summary = dashboard.summary;
    return [
      createMetricCard(
        "Active Members",
        formatCount(summary.members.activeMembers),
        "Current active memberships",
        <Users className="h-4 w-4" />,
        "bg-emerald-500/15 text-emerald-100",
        "ACTIVE_MEMBERS",
      ),
      createMetricCard(
        "Expired Members",
        formatCount(summary.members.expiredMembers),
        "Membership expired",
        <Users className="h-4 w-4" />,
        "bg-rose-500/15 text-rose-100",
        "EXPIRED_MEMBERS",
      ),
      createMetricCard(
        "Irregular Members",
        formatCount(summary.members.irregularMembers),
        "Needs attendance recovery",
        <Activity className="h-4 w-4" />,
        "bg-amber-500/15 text-amber-100",
        "IRREGULAR_MEMBERS",
      ),
      createMetricCard(
        "Inactive Members",
        formatCount(summary.members.inactiveMembers),
        "Not currently active",
        <Users className="h-4 w-4" />,
        "bg-slate-500/15 text-slate-100",
        "INACTIVE_MEMBERS",
      ),
    ];
  }, [dashboard.summary]);

  const ptHealthCards = useMemo<DashboardMetricCard[]>(() => {
    const summary = dashboard.summary;
    return [
      createMetricCard(
        "PT Active",
        formatCount(summary.pt.ptActiveClients),
        "Members with current PT",
        <Users className="h-4 w-4" />,
        "bg-emerald-500/15 text-emerald-100",
        "PT_ACTIVE_CLIENTS",
      ),
      createMetricCard(
        "PT Inactive",
        formatCount(summary.pt.ptInactiveClients),
        "Members with PT history but no live PT",
        <Users className="h-4 w-4" />,
        "bg-slate-500/15 text-slate-100",
        "PT_INACTIVE_CLIENTS",
      ),
      createMetricCard(
        "Total PT Clients",
        formatCount(summary.pt.ptClients),
        "All PT-linked members",
        <Users className="h-4 w-4" />,
        "bg-violet-500/15 text-violet-100",
        "PT_CLIENTS",
      ),
    ];
  }, [dashboard.summary]);

  const teamCards = useMemo<DashboardMetricCard[]>(() => {
    const summary = dashboard.summary;
    return [
      createMetricCard(
        "Total Staff",
        formatCount(summary.staff.totalStaff),
        "All staff records",
        <Users className="h-4 w-4" />,
        "bg-slate-500/15 text-slate-100",
        "TOTAL_STAFF",
      ),
      createMetricCard(
        "Active Staff",
        formatCount(summary.staff.activeStaff),
        "Currently active staff",
        <Users className="h-4 w-4" />,
        "bg-emerald-500/15 text-emerald-100",
        "ACTIVE_STAFF",
      ),
      createMetricCard(
        "Total Coaches",
        formatCount(summary.coaches.totalCoaches),
        "All coach records",
        <Users className="h-4 w-4" />,
        "bg-slate-500/15 text-slate-100",
        "TOTAL_COACHES",
      ),
      createMetricCard(
        "Active Coaches",
        formatCount(summary.coaches.activeCoaches),
        "Currently active coach records",
        <Users className="h-4 w-4" />,
        "bg-violet-500/15 text-violet-100",
        "ACTIVE_COACHES",
      ),
    ];
  }, [dashboard.summary]);
  const generatedDateLabel = useMemo(() => formatGeneratedDate(dashboard.generatedAt), [dashboard.generatedAt]);

  // Each alert chip is now clickable — the operator's intuitive next step
  // when they see "Follow-ups Overdue: 24" is to dive into that filtered
  // list. href maps each alert to the right page + filter. Routes are
  // defensive: if the target page doesn't yet support the query param,
  // it'll just open the unfiltered list (no broken state).
  const alerts = useMemo(
    () => [
      {
        title: "Memberships Expiring Soon",
        value: formatCount(dashboard.alerts.membershipsExpiringSoon),
        subtitle: "Next 7 days",
        href: "/portal/renewals",
      },
      {
        title: "Follow-ups Due Today",
        value: formatCount(dashboard.alerts.followUpsDueToday),
        subtitle: "Needs same-day action",
        href: "/portal/follow-ups?dueWindow=TODAY",
      },
      {
        title: "Follow-ups Overdue",
        value: formatCount(dashboard.alerts.followUpsOverdue),
        subtitle: "Requires immediate action",
        href: "/portal/follow-ups?status=OVERDUE",
      },
      {
        title: "Credits Expiring",
        value: formatCount(dashboard.alerts.creditsExpiringSoon),
        subtitle: "Expiring soon",
        href: "/admin/credits?filter=EXPIRING",
      },
      {
        title: "Trainer Schedule Conflicts",
        value: formatCount(dashboard.alerts.trainerScheduleConflicts),
        subtitle: "Overlapping trainer sessions",
        href: "/portal/trainers?filter=CONFLICTS",
      },
    ],
    [dashboard],
  );

  const warningMessages = useMemo(() => summarizeWarnings(dashboard.warnings), [dashboard.warnings]);

  return (
    <AdminPageFrame title="" description="" hideToolbar>
      {error ? <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div> : null}

      {warningMessages.length > 0 ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {warningMessages.join(" | ")}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-12">
          <section className="rounded-[30px] border border-white/10 bg-[#121722] p-6 shadow-sm">
            {hideHeading ? null : (
              <div className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-4xl font-bold tracking-tight text-white">{headingTitle || "Super Admin"}</p>
                  <p className="mt-2 text-base text-slate-300">
                    {headingSubtitle || (selectedBranchName && selectedBranchName !== "All Branches" ? `${selectedBranchName} overview` : "All branches overview")}{generatedDateLabel ? ` - ${generatedDateLabel}` : ""}
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#E8F2D7] px-4 py-2 text-sm font-semibold text-[#5B7F2B]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#84CC16] opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#84CC16]" />
                  </span>
                  Live
                </div>
              </div>
            )}

            <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${hideHeading ? "" : "mt-6"}`}>
              {heroCards.map((card) => {
                const accentClass =
                  card.metricKey === "TOTAL_MEMBERS"
                    ? "border-l-4 border-l-[#3B82F6]"
                    : card.metricKey === "REVENUE_THIS_MONTH"
                      ? "border-l-4 border-l-[#84CC16]"
                      : card.metricKey === "ACTIVE_SUBSCRIPTIONS"
                        ? "border-l-4 border-l-[#6366F1]"
                        : "border-l-4 border-l-[#A855F7]";

                const badge =
                  card.metricKey === "TOTAL_MEMBERS"
                    ? `${formatCount(dashboard.summary.members.activeMembers)} active`
                    : card.metricKey === "REVENUE_THIS_MONTH"
                      ? `${formatInrCompact(dashboard.summary.revenue.revenueToday)} today`
                      : card.metricKey === "ACTIVE_SUBSCRIPTIONS"
                        ? `${formatCount(resolvedExpiringSoon)} expire soon`
                        : `+${formatCount(dashboard.summary.newMembers.today)} today`;

                return (
                  <HeroStatCard
                    key={card.metricKey}
                    card={card}
                    onClick={() => setSelectedCard(card)}
                    accentClass={accentClass}
                    badge={badge}
                  />
                );
              })}
            </div>
          </section>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-12">
          <SurfaceCard title="CRM">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <SnapshotStat label="Total Enquiries" value={formatCount(inquiryTotal)} subtitle="CRM pipeline volume" tone="blue" />
                <SnapshotStat label="Open Enquiries" value={formatCount(openInquiries)} subtitle="Still in progress" tone="neutral" />
                <SnapshotStat label="Converted" value={formatCount(convertedTotal)} subtitle="Moved to members" tone="green" />
                <SnapshotStat label="Due Today" value={formatCount(resolvedFollowUpsDueToday)} subtitle="Follow-ups scheduled today" tone="amber" />
                <SnapshotStat label="Overdue" value={formatCount(resolvedFollowUpsOverdue)} subtitle="Needs immediate action" tone="rose" />
                <SnapshotStat label="Conversion Rate" value={`${resolvedConversionRate.toFixed(1)}%`} subtitle="Enquiry to conversion ratio" tone="green" />
              </div>
              <div className="grid items-stretch gap-4 xl:grid-cols-2">
                <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Enquiry Funnel</p>
                      <p className="text-sm text-slate-400">Current stage distribution across the selected scope.</p>
                    </div>
                    <DashboardPill
                      label={inquiryTotal > 0 ? `${convertedTotal}/${inquiryTotal} converted` : "No enquiries yet"}
                      tone="green"
                    />
                  </div>
                  <div className="mt-4">
                    <FunnelChart
                      stages={inquiryStages.map((stage) => ({
                        label: stage.label,
                        value: stage.value,
                      }))}
                    />
                  </div>
                </div>
                <div className="min-h-[360px]">
                  <DonutLegendChart
                    title="Top Sources"
                    slices={
                      sourceSlices.length > 0
                        ? sourceSlices
                        : [
                            {
                              label: "No source data",
                              value: 0,
                              color: "#94a3b8",
                            },
                          ]
                    }
                  />
                </div>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-12">
          <SurfaceCard title="Revenue">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {revenueCards.map((card) => (
                <MetricValueCard
                  key={card.metricKey}
                  card={card}
                  onClick={() => setSelectedCard(card)}
                  badge={
                    card.metricKey === "REVENUE_TODAY"
                      ? <DashboardPill label={dashboard.summary.revenue.revenueToday > 0 ? "Recorded" : "No collections"} tone="neutral" />
                      : undefined
                  }
                />
              ))}
              {/* Pending Revenue rendered as a MetricValueCard for icon
                  parity with the other 4 revenue cards on this row. Was a
                  SnapshotStat which doesn't carry an icon — looked like
                  the odd one out. */}
              <MetricValueCard
                card={createMetricCard(
                  "Pending Revenue",
                  formatInrCompact(resolvedBalanceDueAmount),
                  `${formatCount(resolvedBalanceDueInvoices)} invoice${resolvedBalanceDueInvoices === 1 ? "" : "s"} awaiting collection`,
                  <IndianRupee className="h-4 w-4" />,
                  "bg-amber-500/15 text-amber-100",
                  "PENDING_REVENUE",
                )}
                onClick={() =>
                  setSelectedCard(
                    createMetricCard(
                      "Pending Revenue",
                      formatInr(resolvedBalanceDueAmount),
                      `${formatCount(resolvedBalanceDueInvoices)} invoice${resolvedBalanceDueInvoices === 1 ? "" : "s"} awaiting collection`,
                      <IndianRupee className="h-4 w-4" />,
                      "bg-amber-500/15 text-amber-100",
                      "PENDING_REVENUE",
                    ),
                  )
                }
              />
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <SurfaceCard title="Member Health">
            <div className="grid gap-4 md:grid-cols-2">
              {memberHealthCards.map((card) => (
                <CompactMetricCard
                  key={card.metricKey}
                  card={card}
                  onClick={() => setSelectedCard(card)}
                  badge={
                    card.metricKey === "ACTIVE_MEMBERS"
                      ? <DashboardPill label="Healthy base" tone="green" />
                      : card.metricKey === "IRREGULAR_MEMBERS"
                        ? <DashboardPill label="Needs care" tone="amber" />
                        : card.metricKey === "EXPIRED_MEMBERS"
                          ? <DashboardPill label="Renewal risk" tone="rose" />
                          : undefined
                  }
                />
              ))}
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-4">
          <SurfaceCard title="PT Health">
            {/* PT Health was 3 cards stacked vertically (md:grid-cols-1)
                while Member Health on its left rendered 4 cards as 2x2.
                Heights mismatched. Now: 2 cards (Active + Inactive) in a
                2-up grid for visual parity, total surfaced as a footer
                line — matches the Team card pattern. */}
            <div className="grid gap-4 md:grid-cols-2">
              {ptHealthCards
                .filter((c) => c.metricKey === "PT_ACTIVE_CLIENTS" || c.metricKey === "PT_INACTIVE_CLIENTS")
                .map((card) => (
                  <CompactMetricCard
                    key={card.metricKey}
                    card={card}
                    onClick={() => setSelectedCard(card)}
                    badge={
                      card.metricKey === "PT_ACTIVE_CLIENTS"
                        ? <DashboardPill label="Active PT cycles" tone="green" />
                        : <DashboardPill label="Historical PT" tone="neutral" />
                    }
                  />
                ))}
            </div>
            <div className="mt-4 border-t border-white/8 pt-4 text-sm text-slate-300">
              {formatCount(dashboard.summary.pt.ptClients)} total PT-linked members across active and historical cycles.
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-4">
          <SurfaceCard title="Subscription Health">
            {/* Issue L5 — was 2x2 grid; flatten to a tighter 2x2 with smaller gap. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <SnapshotStat
                label="Active Subscriptions"
                value={formatCount(dashboard.summary.subscriptions.activeSubscriptions)}
                subtitle="Currently live memberships"
                tone="green"
                onClick={() =>
                  setSelectedCard(
                    createMetricCard(
                      "Active Subscriptions",
                      formatCount(dashboard.summary.subscriptions.activeSubscriptions),
                      "Currently live memberships",
                      <Layers3 className="h-4 w-4" />,
                      "bg-emerald-500/15 text-emerald-100",
                      "ACTIVE_SUBSCRIPTIONS",
                    ),
                  )
                }
              />
              <SnapshotStat
                label="Inactive Subscriptions"
                value={formatCount(dashboard.summary.subscriptions.inactiveSubscriptions || dashboard.subscriptions.inactiveSubscriptions || dashboard.subscriptions.expiredSubscriptions)}
                subtitle="Expired or no longer live"
                tone="neutral"
                onClick={() =>
                  setSelectedCard(
                    createMetricCard(
                      "Inactive Subscriptions",
                      formatCount(dashboard.summary.subscriptions.inactiveSubscriptions || dashboard.subscriptions.inactiveSubscriptions || dashboard.subscriptions.expiredSubscriptions),
                      "Expired or no longer live",
                      <Layers3 className="h-4 w-4" />,
                      "bg-slate-500/15 text-slate-100",
                      "INACTIVE_SUBSCRIPTIONS",
                    ),
                  )
                }
              />
              <SnapshotStat
                label="Expiring Soon"
                value={formatCount(resolvedExpiringSoon)}
                subtitle="Due for renewal shortly"
                tone="amber"
                onClick={() =>
                  setSelectedCard(
                    createMetricCard(
                      "Expiring Soon",
                      formatCount(resolvedExpiringSoon),
                      "Due for renewal shortly",
                      <Layers3 className="h-4 w-4" />,
                      "bg-amber-500/15 text-amber-100",
                      "EXPIRING_SOON",
                    ),
                  )
                }
              />
              <SnapshotStat
                label="Balance Due Invoices"
                value={formatCount(resolvedBalanceDueInvoices)}
                subtitle="Invoices awaiting collection"
                tone="rose"
                onClick={() =>
                  setSelectedCard(
                    createMetricCard(
                      "Balance Due Invoices",
                      formatCount(resolvedBalanceDueInvoices),
                      "Invoices awaiting collection",
                      <IndianRupee className="h-4 w-4" />,
                      "bg-rose-500/15 text-rose-100",
                      "PENDING_REVENUE",
                    ),
                  )
                }
              />
            </div>
          </SurfaceCard>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        {/* Team promoted from col-span-6 to col-span-12 (full row) so the
            right half doesn't sit empty since Alerts moved to its own row.
            Cards inside go from 2x2 to 4-up at xl. */}
        <div className="xl:col-span-12">
          <SurfaceCard title="Team">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {teamCards.map((card) => (
                <CompactMetricCard
                  key={card.metricKey}
                  card={card}
                  onClick={() => setSelectedCard(card)}
                  badge={
                    card.metricKey === "ACTIVE_STAFF"
                      ? <DashboardPill label="On duty" tone="green" />
                      : card.metricKey === "ACTIVE_COACHES"
                        ? <DashboardPill label="Coaching live" tone="green" />
                      : card.metricKey === "TOTAL_COACHES"
                        ? <DashboardPill label={`${formatCount(dashboard.summary.coaches.activeCoaches)} active`} tone="green" />
                        : undefined
                  }
                />
              ))}
            </div>
            <div className="mt-4 border-t border-white/8 pt-4 text-sm text-slate-300">
              {formatCount(dashboard.summary.staff.activeStaff)} staff and {formatCount(dashboard.summary.coaches.activeCoaches)} coaches are active in the selected scope.
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-12">
          <SurfaceCard title="Alerts">
            {/* Single horizontal row with horizontal scroll on narrow
                viewports. flex-1 + min-w-0 on each chip means they share
                the row equally; flex-nowrap + overflow-x-auto stops the
                grid from breaking into multiple congested rows. Each
                chip is now a Link so clicking jumps to the matching
                filtered page. */}
            <div className="flex gap-3 overflow-x-auto pb-1">
              {alerts.map((item) => {
                const tone = item.value !== "0"
                  ? "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                  : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06]";
                const numberClass = item.value !== "0" ? "text-amber-100" : "text-white";
                return (
                  <Link
                    key={item.title}
                    href={item.href || "#"}
                    className={`flex min-w-[180px] flex-1 items-center gap-3 rounded-2xl border px-4 py-3 transition ${tone}`}
                  >
                    <span className={`text-2xl font-bold tracking-tight tabular-nums ${numberClass}`}>{item.value}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300 leading-tight">{item.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{item.subtitle}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </SurfaceCard>
        </div>
      </section>

      {selectedCard ? (
        <DashboardDrilldownModal
          open={Boolean(selectedCard)}
          title={selectedCard.title}
          metricKey={selectedCard.metricKey}
          token={token}
          branchId={effectiveBranchId}
          onClose={() => setSelectedCard(null)}
        />
      ) : null}

      {loading ? <div className="text-sm text-slate-500">Loading dashboard...</div> : null}
    </AdminPageFrame>
  );
}
