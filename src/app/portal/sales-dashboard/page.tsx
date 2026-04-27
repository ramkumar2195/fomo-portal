"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ComponentType, SVGProps, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, MapPin, Play, RefreshCw, ShieldAlert, Sparkles, Target, Users2 } from "lucide-react";
import {
  ActiveMembersIcon,
  BiometricIcon,
  DashboardIcon,
  EnquiryIcon,
  ExpiredMembersIcon,
  FollowUpsIcon,
  IrregularMembersIcon,
  MembersIcon,
  PTClientsIcon,
  RenewalsMetricIcon,
  RevenueIcon,
} from "@/components/common/icons";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { TodayCheckInsTile } from "@/components/dashboard/today-check-ins-tile";
import { PendingApprovalsTile } from "@/components/dashboard/pending-approvals-tile";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService, TrainerScheduleEntry } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { resolveStaffId } from "@/lib/staff-id";
import { AuthUser, UserDesignation } from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";
import { AdminOverviewMetrics, DashboardMetrics, LeaderboardEntry } from "@/types/models";

const AdminDashboardContent = dynamic(() => import("@/app/(admin)/admin/dashboard/page"), {
  loading: () => <PageLoader label="Loading dashboard..." />,
});

interface DashboardState {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
  followUpsDueToday: number;
  overdueFollowUps: number;
}

interface MetricCard {
  label: string;
  value: string;
  subtitle: string;
  color: string;
}

interface FocusPanel {
  title: string;
  value: string;
  description: string;
  href: string;
  tone: "blue" | "emerald" | "amber" | "rose" | "violet" | "slate";
}

interface WorkspaceItem {
  title: string;
  description: string;
  href: string;
}

interface WatchlistItem {
  label: string;
  detail: string;
  tone: "neutral" | "amber" | "rose" | "green";
}

type CardKey =
  | "activeMembers"
  | "expiredMembers"
  | "irregularMembers"
  | "ptClients"
  | "revenueToday"
  | "revenueMonth"
  | "renewals"
  | "todaysInquiries"
  | "followUpsDue"
  | "overdueFollowUps"
  | "conversionRate"
  | "totalMembers"
  | "totalStaff"
  | "todaysBirthdays";

type OperationalDesignation =
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "FRONT_DESK_EXECUTIVE"
  | "FITNESS_MANAGER";

interface GymManagerSessionRow {
  key: string;
  trainer: UserDirectoryItem;
  entry: TrainerScheduleEntry;
}

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

const PRIMARY_CARD_KEYS: Record<OperationalDesignation | "DEFAULT", CardKey[]> = {
  SALES_MANAGER: [
    "todaysInquiries",
    "followUpsDue",
    "overdueFollowUps",
    "conversionRate",
    "renewals",
    "revenueToday",
  ],
  SALES_EXECUTIVE: [
    "todaysInquiries",
    "followUpsDue",
    "overdueFollowUps",
    "conversionRate",
    "renewals",
    "revenueToday",
  ],
  FRONT_DESK_EXECUTIVE: [
    "activeMembers",
    "expiredMembers",
    "renewals",
    "revenueToday",
    "totalMembers",
    "todaysBirthdays",
  ],
  // Issue #7 — was 'totalStaff' which is odd for a fitness role; the
  // adminOverview API doesn't carry a dedicated coach count today, so we
  // surface 'expiredMembers' here (recoverable retention is the most
  // fitness-relevant team-adjacent metric). A real "Active Coaches" card
  // depends on the backend expansion in issue #11.
  FITNESS_MANAGER: [
    "ptClients",
    "irregularMembers",
    "activeMembers",
    "expiredMembers",
    "renewals",
    "todaysBirthdays",
  ],
  DEFAULT: [
    "activeMembers",
    "todaysInquiries",
    "followUpsDue",
    "renewals",
    "revenueToday",
    "totalMembers",
  ],
};

const WORKSPACE_ITEMS: Record<OperationalDesignation | "DEFAULT", WorkspaceItem[]> = {
  SALES_MANAGER: [
    {
      title: "Leads & Inquiries",
      description: "Review the pipeline, assign owners, and move prospects toward trial or conversion.",
      href: "/portal/inquiries",
    },
    {
      title: "Renewals & Follow-ups",
      description: "Track expiring members and clear the overdue follow-up queue.",
      href: "/portal/renewals",
    },
    {
      title: "Reports",
      description: "Review daily conversion, collection, and sales performance trends.",
      href: "/portal/reports",
    },
    {
      title: "Members",
      description: "Check converted leads, onboarding progress, and current member context.",
      href: "/portal/members",
    },
  ],
  SALES_EXECUTIVE: [
    {
      title: "Leads & Inquiries",
      description: "Add walk-ins, qualify leads, and update the CRM without leaving the desk.",
      href: "/portal/inquiries",
    },
    {
      title: "Follow-up Queue",
      description: "Work through scheduled calls, WhatsApp nudges, and missed follow-ups.",
      href: "/portal/follow-ups",
    },
    {
      title: "Renewals",
      description: "Recover expiring members before they fall into the overdue bucket.",
      href: "/portal/renewals",
    },
    {
      title: "Members",
      description: "Search converted members and confirm onboarding details after closure.",
      href: "/portal/members",
    },
  ],
  FRONT_DESK_EXECUTIVE: [
    {
      title: "Members",
      description: "Look up member records, verify plan status, and help with branch-side requests.",
      href: "/portal/members",
    },
    {
      title: "Billing / Subscriptions",
      description: "Support quick collections, subscription actions, and front-desk billing tasks.",
      href: "/portal/billing",
    },
    {
      title: "Renewals & Follow-ups",
      description: "Handle expiring memberships and service lapses before they hit the floor team.",
      href: "/portal/renewals",
    },
    {
      title: "Leads & Inquiries",
      description: "Capture walk-ins and hand over qualified inquiries to sales with clean data.",
      href: "/portal/inquiries",
    },
  ],
  FITNESS_MANAGER: [
    {
      title: "Coaches",
      description: "Review coach roster, assigned members, and training-side ownership.",
      href: "/portal/trainers",
    },
    {
      title: "Classes & Sessions",
      description: "Monitor schedules, attendance pressure, and branch training execution.",
      href: "/portal/class-schedule",
    },
    {
      title: "Members",
      description: "Track at-risk members, PT clients, and members needing fitness intervention.",
      href: "/portal/members",
    },
    {
      title: "Reports",
      description: "Review trainer utilization, retention patterns, and performance indicators.",
      href: "/portal/reports",
    },
  ],
  DEFAULT: [
    {
      title: "Dashboard",
      description: "Start from the live operating numbers and then jump into the right module.",
      href: "/portal/sales-dashboard",
    },
    {
      title: "Members",
      description: "Inspect active member state and quickly pivot into member operations.",
      href: "/portal/members",
    },
    {
      title: "Reports",
      description: "Review summary trends when the operational queue is under control.",
      href: "/portal/reports",
    },
  ],
};

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0);
}

/**
 * Tighter, human-readable second-line for follow-up tile rows. Uses the
 * follow-up type as a sentence-cased lead ("Membership renewal · Due …")
 * instead of the legacy SHOUT_CASE primary fallback.
 */
function buildFollowUpRowSecondary(row: { followUpType?: string | null; dueAt?: string | null }): string | undefined {
  const typeLabel = row.followUpType ? humanizeFollowUpType(row.followUpType) : "Follow-up";
  if (!row.dueAt) return typeLabel;
  const due = new Date(row.dueAt);
  // For very-near-future dueAts (today), show time. For past or future days,
  // show the calendar date — operators care about "is this overdue?" not
  // "what hour was this scheduled at" once the day has passed.
  const isToday = due.toDateString() === new Date().toDateString();
  const dueLabel = isToday
    ? `Due ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `Due ${due.toLocaleDateString()}`;
  return `${typeLabel} · ${dueLabel}`;
}

const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  MEMBERSHIP_RENEWAL: "Membership renewal",
  BALANCE_DUE: "Balance due",
  GENERAL_FOLLOW_UP: "General follow-up",
  TRIAL_FOLLOW_UP: "Trial follow-up",
  ENQUIRY: "Enquiry",
  CONFIRMATION_CALLS: "Confirmation call",
  GYM_STUDIO_TRIAL: "Gym/studio trial",
};

function humanizeFollowUpType(value: string): string {
  return FOLLOW_UP_TYPE_LABELS[value] || value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

// Issue #1 — tone palettes converted from the original light theme
// (bg-*-50 / border-*-200 / text-*-700) to a dark-theme palette that
// matches the rest of the portal (bg-*-500/10 / border-*-500/30 /
// text-*-100). Keeps the semantic color signal but reads correctly
// on the dark page background.
function toneClasses(tone: FocusPanel["tone"]): string {
  switch (tone) {
    case "blue":
      return "border-blue-500/30 bg-blue-500/10 text-blue-100";
    case "emerald":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "amber":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "rose":
      return "border-rose-500/30 bg-rose-500/10 text-rose-100";
    case "violet":
      return "border-violet-500/30 bg-violet-500/10 text-violet-100";
    default:
      return "border-white/10 bg-white/[0.04] text-slate-100";
  }
}

function watchlistToneClasses(tone: WatchlistItem["tone"]): string {
  switch (tone) {
    case "green":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "amber":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "rose":
      return "border-rose-500/30 bg-rose-500/10 text-rose-100";
    default:
      return "border-white/10 bg-white/[0.04] text-slate-100";
  }
}

function displayDesignation(designation?: UserDesignation): string {
  switch (designation) {
    case "GYM_MANAGER":
      return "Branch Manager";
    case "FRONT_DESK_EXECUTIVE":
      return "Front Desk";
    case "SALES_MANAGER":
      return "Sales Manager";
    case "SALES_EXECUTIVE":
      return "Sales Executive";
    case "FITNESS_MANAGER":
      return "Fitness Manager";
    case "SUPER_ADMIN":
      return "Super Admin";
    default:
      return designation ? designation.replace(/_/g, " ") : "Staff";
  }
}

function iconForMetric(label: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (label.includes("Active")) return ActiveMembersIcon;
  if (label.includes("Expired")) return ExpiredMembersIcon;
  if (label.includes("Irregular")) return IrregularMembersIcon;
  if (label.includes("PT")) return PTClientsIcon;
  if (label.includes("Revenue")) return RevenueIcon;
  if (label.includes("Renewals")) return RenewalsMetricIcon;
  if (label.includes("Lead")) return EnquiryIcon;
  if (label.includes("Follow-up")) return FollowUpsIcon;
  if (label.includes("Birthday")) return Sparkles;
  if (label.includes("Members")) return MembersIcon;
  if (label.includes("Team")) return Users2;
  return DashboardIcon;
}

function buildAllCards(
  overview: AdminOverviewMetrics,
  metrics: DashboardMetrics,
  followUpsDueToday: number,
  overdueFollowUps: number,
): Record<CardKey, MetricCard> {
  // Issue #1 — icon-bubble palettes converted to dark variants. Same
  // semantic colour per metric, just darkened for the dark page background.
  return {
    activeMembers: {
      label: "Active Members",
      value: formatCount(overview.totalActiveMembers),
      subtitle: "Current live member base",
      color: "bg-blue-500/15 text-blue-100",
    },
    expiredMembers: {
      label: "Expired Members",
      value: formatCount(overview.expiredMembers),
      subtitle: "Memberships requiring renewal action",
      color: "bg-rose-500/15 text-rose-100",
    },
    irregularMembers: {
      label: "Irregular Members",
      value: formatCount(overview.irregularMembers),
      subtitle: "Retention watchlist",
      color: "bg-amber-500/15 text-amber-100",
    },
    ptClients: {
      label: "PT Clients",
      value: formatCount(overview.totalPtClients),
      subtitle: "Members in personal training",
      color: "bg-emerald-500/15 text-emerald-100",
    },
    revenueToday: {
      label: "Revenue Today",
      value: formatCurrency(overview.todaysRevenue || metrics.revenueToday),
      subtitle: "Collections closed today",
      color: "bg-fuchsia-500/15 text-fuchsia-100",
    },
    revenueMonth: {
      label: "Revenue This Month",
      value: formatCurrency(overview.monthRevenue || metrics.revenueThisMonth),
      subtitle: "Month-to-date collection pace",
      color: "bg-violet-500/15 text-violet-100",
    },
    renewals: {
      label: "Upcoming Renewals",
      value: formatCount(overview.upcomingRenewals7Days),
      subtitle: "Expiring in the next 7 days",
      color: "bg-indigo-500/15 text-indigo-100",
    },
    todaysInquiries: {
      label: "Today's Leads",
      value: formatCount(metrics.todaysInquiries),
      subtitle: "Fresh CRM intake for the day",
      color: "bg-green-500/15 text-green-100",
    },
    followUpsDue: {
      label: "Follow-ups Due",
      value: formatCount(followUpsDueToday),
      subtitle: "Scheduled for action today",
      color: "bg-orange-500/15 text-orange-100",
    },
    overdueFollowUps: {
      label: "Overdue Follow-ups",
      value: formatCount(overdueFollowUps),
      subtitle: "Immediate recovery queue",
      color: "bg-red-500/15 text-red-100",
    },
    conversionRate: {
      label: "Conversion Rate",
      value: formatPercent(metrics.conversionRate),
      subtitle: "Lead to member conversion",
      color: "bg-sky-500/15 text-sky-100",
    },
    totalMembers: {
      label: "Total Members",
      value: formatCount(overview.totalMembers),
      subtitle: "All registered members",
      color: "bg-slate-500/20 text-slate-100",
    },
    totalStaff: {
      label: "Team Strength",
      value: formatCount(overview.totalStaff),
      subtitle: "Staff and coach headcount",
      color: "bg-teal-500/15 text-teal-100",
    },
    todaysBirthdays: {
      label: "Birthdays Today",
      value: formatCount(overview.todaysBirthdays),
      subtitle: "Members to celebrate or notify",
      color: "bg-pink-500/15 text-pink-100",
    },
  };
}

function buildHeroCopy(designation?: UserDesignation, selectedBranchName?: string): {
  eyebrow: string;
  title: string;
  description: string;
} {
  const branchLabel =
    selectedBranchName && selectedBranchName !== "All Branches"
      ? selectedBranchName
      : "your operating scope";

  switch (designation) {
    case "SALES_MANAGER":
      return {
        eyebrow: "Sales Command Center",
        title: "Lead flow, follow-ups, and conversion momentum",
        description: `Use this board to drive the branch pipeline, protect renewals, and keep ${branchLabel} conversion-focused.`,
      };
    case "SALES_EXECUTIVE":
      return {
        eyebrow: "Daily Sales Queue",
        title: "Today's outreach and closure priorities",
        description: `Clear scheduled follow-ups, recover overdue leads, and move fresh enquiries from ${branchLabel} toward conversion.`,
      };
    case "FRONT_DESK_EXECUTIVE":
      return {
        eyebrow: "Front Desk Operations",
        title: "Member-facing service, collections, and renewals",
        description: `Track the plan health of members arriving at ${branchLabel} and keep desk-side billing friction low.`,
      };
    case "FITNESS_MANAGER":
      return {
        eyebrow: "Training Operations",
        title: "Coach readiness, PT engagement, and retention watch",
        description: `Use this view to stay ahead of at-risk members and coach execution across ${branchLabel}.`,
      };
    default:
      return {
        eyebrow: "Operations Dashboard",
        title: "Live operating view for the current role",
        description: `This workspace adapts to the logged-in designation and keeps the most relevant branch work in front.`,
      };
  }
}

function buildFocusPanels(
  designation: UserDesignation | undefined,
  state: DashboardState,
): FocusPanel[] {
  const overview = state.adminOverview;
  const metrics = state.metrics;

  switch (designation) {
    case "SALES_MANAGER":
      return [
        {
          title: "Pipeline Intake",
          value: formatCount(metrics.todaysInquiries),
          description: `${formatCount(state.followUpsDueToday)} follow-ups due today across the queue.`,
          href: "/portal/inquiries",
          tone: "blue",
        },
        {
          title: "Conversion Pressure",
          value: formatPercent(metrics.conversionRate),
          description: `${formatCount(state.overdueFollowUps)} overdue leads need immediate recovery.`,
          href: "/portal/follow-ups",
          tone: "amber",
        },
        {
          title: "Renewal Revenue",
          value: formatCurrency(overview.todaysRevenue || metrics.revenueToday),
          description: `${formatCount(overview.upcomingRenewals7Days)} memberships expire in the next 7 days.`,
          href: "/portal/renewals",
          tone: "emerald",
        },
      ];
    case "SALES_EXECUTIVE":
      return [
        {
          title: "Calls To Close",
          value: formatCount(state.followUpsDueToday),
          description: "Scheduled touches due before the day closes.",
          href: "/portal/follow-ups",
          tone: "blue",
        },
        {
          title: "Overdue Recovery",
          value: formatCount(state.overdueFollowUps),
          description: "Old follow-ups blocking conversion momentum.",
          href: "/portal/follow-ups",
          tone: "rose",
        },
        {
          title: "Fresh Leads",
          value: formatCount(metrics.todaysInquiries),
          description: "New enquiries ready for qualification or trial planning.",
          href: "/portal/inquiries",
          tone: "emerald",
        },
      ];
    case "FRONT_DESK_EXECUTIVE":
      return [
        {
          title: "Members In Good Standing",
          value: formatCount(overview.totalActiveMembers),
          description: "Active members you can service immediately at the desk.",
          href: "/portal/members",
          tone: "blue",
        },
        {
          title: "Renewal Risk",
          value: formatCount(overview.upcomingRenewals7Days),
          description: `${formatCount(overview.expiredMembers)} already expired and likely to surface at front desk.`,
          href: "/portal/renewals",
          tone: "amber",
        },
        {
          title: "Collections Today",
          value: formatCurrency(overview.todaysRevenue || metrics.revenueToday),
          description: "Collections posted through the operating day.",
          href: "/portal/billing",
          tone: "emerald",
        },
      ];
    case "FITNESS_MANAGER":
      return [
        {
          title: "PT Engagement",
          value: formatCount(overview.totalPtClients),
          description: "Members currently in structured personal training.",
          href: "/portal/trainers",
          tone: "violet",
        },
        {
          title: "Retention Watch",
          value: formatCount(overview.irregularMembers),
          description: "Members showing poor attendance and needing intervention.",
          href: "/portal/members",
          tone: "amber",
        },
        {
          title: "Coach Capacity",
          value: formatCount(overview.totalStaff),
          description: "Current staff-side strength supporting training operations.",
          href: "/portal/reports",
          tone: "blue",
        },
      ];
    default:
      return [
        {
          title: "Active Members",
          value: formatCount(overview.totalActiveMembers),
          description: "Current active members across your visible operating area.",
          href: "/portal/members",
          tone: "blue",
        },
        {
          title: "Lead Intake",
          value: formatCount(metrics.todaysInquiries),
          description: "Today's new enquiries captured in the CRM.",
          href: "/portal/inquiries",
          tone: "emerald",
        },
        {
          title: "Collections",
          value: formatCurrency(overview.todaysRevenue || metrics.revenueToday),
          description: "Collections closed so far in the day.",
          href: "/portal/billing",
          tone: "slate",
        },
      ];
  }
}

function buildWatchlist(
  designation: UserDesignation | undefined,
  state: DashboardState,
): WatchlistItem[] {
  const overview = state.adminOverview;

  switch (designation) {
    case "SALES_MANAGER":
    case "SALES_EXECUTIVE":
      return [
        {
          label: "Follow-ups due today",
          detail: `${formatCount(state.followUpsDueToday)} need action before the close of day.`,
          tone: state.followUpsDueToday > 0 ? "amber" : "green",
        },
        {
          label: "Overdue follow-ups",
          detail: `${formatCount(state.overdueFollowUps)} are already slipping the pipeline.`,
          tone: state.overdueFollowUps > 0 ? "rose" : "green",
        },
        {
          label: "Renewals this week",
          detail: `${formatCount(overview.upcomingRenewals7Days)} members are entering the renewal window.`,
          tone: overview.upcomingRenewals7Days > 0 ? "neutral" : "green",
        },
      ];
    case "FRONT_DESK_EXECUTIVE":
      return [
        {
          label: "Expired members",
          detail: `${formatCount(overview.expiredMembers)} may arrive needing desk-side support.`,
          tone: overview.expiredMembers > 0 ? "rose" : "green",
        },
        {
          label: "Birthdays today",
          detail: `${formatCount(overview.todaysBirthdays)} members can receive a service touchpoint.`,
          tone: overview.todaysBirthdays > 0 ? "neutral" : "green",
        },
        {
          label: "Renewals due soon",
          detail: `${formatCount(overview.upcomingRenewals7Days)} members are due within 7 days.`,
          tone: overview.upcomingRenewals7Days > 0 ? "amber" : "green",
        },
      ];
    case "FITNESS_MANAGER":
      return [
        {
          label: "Irregular members",
          detail: `${formatCount(overview.irregularMembers)} members need retention or programming follow-through.`,
          tone: overview.irregularMembers > 0 ? "amber" : "green",
        },
        {
          label: "PT client base",
          detail: `${formatCount(overview.totalPtClients)} members depend on training-side delivery quality.`,
          tone: "neutral",
        },
        {
          label: "Birthdays today",
          detail: `${formatCount(overview.todaysBirthdays)} members can be acknowledged by the coaching team.`,
          tone: overview.todaysBirthdays > 0 ? "neutral" : "green",
        },
      ];
    default:
      return [
        {
          label: "Upcoming renewals",
          detail: `${formatCount(overview.upcomingRenewals7Days)} memberships expire in the next week.`,
          tone: overview.upcomingRenewals7Days > 0 ? "amber" : "green",
        },
        {
          label: "Irregular members",
          detail: `${formatCount(overview.irregularMembers)} members are showing retention risk.`,
          tone: overview.irregularMembers > 0 ? "amber" : "green",
        },
      ];
  }
}

function AlertsSection({ overview }: { overview: AdminOverviewMetrics }) {
  const alerts = [
    overview.upcomingRenewals7Days > 0 && {
      label: `${formatCount(overview.upcomingRenewals7Days)} memberships expiring in 7 days`,
      tone: "amber" as const,
    },
    overview.upcomingRenewals30Days > 0 && {
      label: `${formatCount(overview.upcomingRenewals30Days)} memberships expiring in 30 days`,
      tone: "neutral" as const,
    },
    overview.expiredMembers > 0 && {
      label: `${formatCount(overview.expiredMembers)} expired memberships need attention`,
      tone: "rose" as const,
    },
    overview.irregularMembers > 0 && {
      label: `${formatCount(overview.irregularMembers)} irregular members need outreach`,
      tone: "amber" as const,
    },
  ].filter(Boolean) as { label: string; tone: "amber" | "rose" | "neutral" }[];

  if (alerts.length === 0) {
    return null;
  }

  return (
    <SectionCard title="Branch Watchlist" subtitle="Operational issues requiring follow-through">
      <div className="space-y-2">
        {alerts.map((alert) => {
          const toneClass =
            alert.tone === "rose"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-100"
              : alert.tone === "amber"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                : "border-white/10 bg-white/[0.04] text-slate-100";
          return (
            <div key={alert.label} className={`rounded-xl border px-3 py-2 text-sm font-medium ${toneClass}`}>
              {alert.label}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function entryDateKey(entry: TrainerScheduleEntry): string {
  return String(entry.startAt || "").slice(0, 10);
}

function entryTime(entry: TrainerScheduleEntry, field: "startAt" | "endAt"): string {
  return String(entry[field] || "").slice(11, 16);
}

function formatQuickTime(value: string): string {
  if (!value || value === "-") return "-";
  const [hourPart, minutePart = "00"] = value.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function entryTimeLabel(entry: TrainerScheduleEntry, field: "startAt" | "endAt"): string {
  return formatQuickTime(entryTime(entry, field));
}

function parseEntryDate(entry: TrainerScheduleEntry, field: "startAt" | "endAt"): Date | null {
  const value = entry[field];
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPendingPtEntry(entry: TrainerScheduleEntry): boolean {
  const status = String(entry.status || "SCHEDULED").toUpperCase();
  return ["", "SCHEDULED", "UPCOMING", "PENDING", "SCHEDULED_SLOT", "PT_SLOT"].includes(status);
}

function canStartQuickPtSession(entry: TrainerScheduleEntry): boolean {
  const now = new Date();
  const start = parseEntryDate(entry, "startAt");
  const end = parseEntryDate(entry, "endAt");
  return Boolean(start && end && now >= start && now <= end && isPendingPtEntry(entry));
}

function canCancelQuickPtSession(entry: TrainerScheduleEntry): boolean {
  const start = parseEntryDate(entry, "startAt");
  if (!start || !isPendingPtEntry(entry)) return false;
  const hoursUntilStart = (start.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntilStart >= 8;
}

function hasQuickPtSessionEnded(entry: TrainerScheduleEntry): boolean {
  const end = parseEntryDate(entry, "endAt");
  return Boolean(end && Date.now() > end.getTime());
}

function quickSessionStatus(entry: TrainerScheduleEntry): string {
  return String(entry.status || "SCHEDULED").toUpperCase();
}

function primaryQuickActionLabel(entry: TrainerScheduleEntry): string {
  const status = quickSessionStatus(entry);
  if (status === "IN_PROGRESS") return "In Progress";
  if (["COMPLETED", "CANCELLED", "CANCELED", "NO_SHOW"].includes(status)) return status.replace("_", " ");
  if (canCancelQuickPtSession(entry)) return "Cancel";
  if (canStartQuickPtSession(entry)) return "Start";
  if (hasQuickPtSessionEnded(entry) && isPendingPtEntry(entry)) return "Mark Completed / No Show";
  const start = entryTime(entry, "startAt");
  return start ? `Start at ${formatQuickTime(start)}` : "Scheduled";
}

function quickActionSortRank(entry: TrainerScheduleEntry): number {
  const status = quickSessionStatus(entry);
  if (status === "IN_PROGRESS" || canStartQuickPtSession(entry)) return 0;
  if (isPendingPtEntry(entry) && !hasQuickPtSessionEnded(entry)) return 1;
  if (hasQuickPtSessionEnded(entry) && isPendingPtEntry(entry)) return 2;
  return 3;
}

function GymManagerQuickActions({
  token,
  userName,
}: {
  token: string;
  userName?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<GymManagerSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = toDateKey(new Date());
      const trainers = await usersService.searchUsers(token, { role: "COACH", active: true });
      // Issue #4 — single bulk fetch instead of N per-coach round trips.
      // Server still aggregates per coach internally but the network cost
      // is now O(1) instead of O(coaches).
      const trainerIds = trainers.map((trainer) => trainer.id);
      const bulk = await trainingService
        .getTrainerSchedulesBulk(token, trainerIds, today, today)
        .catch(() => [] as Awaited<ReturnType<typeof trainingService.getTrainerSchedulesBulk>>);
      const scheduleByTrainer = new Map(bulk.map((s) => [String(s.trainerId), s]));
      const schedules = trainers.map((trainer) => ({
        trainer,
        schedule: scheduleByTrainer.get(String(trainer.id)) || null,
      }));
      const nextRows = schedules.flatMap(({ trainer, schedule }) =>
        (schedule?.entries || [])
          .filter((entry) => (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && entryDateKey(entry) === today)
          .map((entry) => ({
            key: `${trainer.id}-${entry.entryType}-${entry.referenceId || entry.assignmentId || entry.startAt}`,
            trainer,
            entry,
          })),
      );
      nextRows.sort((left, right) => {
        const rankDiff = quickActionSortRank(left.entry) - quickActionSortRank(right.entry);
        if (rankDiff !== 0) return rankDiff;
        return entryTime(left.entry, "startAt").localeCompare(entryTime(right.entry, "startAt"));
      });
      setRows(nextRows);
    } catch (quickActionError) {
      setError(quickActionError instanceof Error ? quickActionError.message : "Unable to load PT quick actions.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const materializeSession = async (row: GymManagerSessionRow): Promise<number> => {
    const { entry, trainer } = row;
    if (entry.entryType === "PT_SESSION" && entry.referenceId) {
      return Number(entry.referenceId);
    }
    const assignmentId = Number(entry.assignmentId || 0);
    const memberId = Number(entry.memberId || 0);
    const sessionDate = entryDateKey(entry);
    const sessionTime = entryTime(entry, "startAt");
    if (!assignmentId || !memberId || !sessionDate || !sessionTime) {
      throw new Error("PT slot is missing assignment or member details.");
    }
    const created = await trainingService.createPtSession(token, {
      assignmentId,
      coachId: Number(trainer.id),
      memberId,
      sessionDate,
      sessionTime,
      notes: "Created from gym manager quick actions.",
    });
    const record = typeof created === "object" && created !== null ? (created as Record<string, unknown>) : {};
    const createdId = Number(record.id || record.sessionId || 0);
    if (!createdId) {
      throw new Error("PT session was created but no session ID was returned.");
    }
    return createdId;
  };

  const runSessionAction = async (
    row: GymManagerSessionRow,
    action: "start" | "cancel" | "complete" | "no-show",
  ) => {
    setBusyKey(row.key);
    setError(null);
    try {
      const sessionId = await materializeSession(row);
      if (action === "start") {
        await trainingService.startSession(token, sessionId, userName || "GYM_MANAGER");
      } else if (action === "cancel") {
        await trainingService.cancelPtSession(token, sessionId);
      } else if (action === "complete") {
        await trainingService.markSessionComplete(token, sessionId);
      } else {
        await trainingService.markSessionNoShow(token, sessionId);
      }
      await loadRows();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update PT session.");
    } finally {
      setBusyKey(null);
    }
  };

  const openRegister = (entry: TrainerScheduleEntry) => {
    if (!entry.memberId) return;
    const assignmentQuery = entry.assignmentId ? `&assignmentId=${entry.assignmentId}` : "";
    router.push(`/admin/members/${entry.memberId}?tab=personal-training&section=session-register${assignmentQuery}`);
  };

  return (
    <SectionCard title="Today’s PT Control" subtitle="Compact session actions for the gym manager">
      {error ? <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-slate-500">Loading today&apos;s PT sessions...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No PT sessions are scheduled for today.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Trainer</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => {
                const { entry } = row;
                const memberLabel = entry.couple && entry.secondaryMemberName
                  ? `${entry.memberName || "Client"} & ${entry.secondaryMemberName}`
                  : entry.memberName || "Client";
                const canCancel = canCancelQuickPtSession(entry);
                const canStart = canStartQuickPtSession(entry);
                const canResolvePast = hasQuickPtSessionEnded(entry) && isPendingPtEntry(entry);
                const label = primaryQuickActionLabel(entry);
                return (
                  <tr key={row.key} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-3 font-semibold text-slate-900">
                      {entryTimeLabel(entry, "startAt")} - {entryTimeLabel(entry, "endAt")}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.trainer.name}</td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">{memberLabel}</p>
                      <button
                        type="button"
                        onClick={() => openRegister(entry)}
                        className="mt-1 text-xs font-semibold text-[#C42429] hover:underline"
                      >
                        Open register
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        {canCancel ? (
                          <button
                            type="button"
                            onClick={() => void runSessionAction(row, "cancel")}
                            disabled={busyKey === row.key}
                            className="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50"
                          >
                            {busyKey === row.key ? "Saving..." : "Cancel"}
                          </button>
                        ) : canStart ? (
                          <button
                            type="button"
                            onClick={() => void runSessionAction(row, "start")}
                            disabled={busyKey === row.key}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#C42429] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#a61e22] disabled:opacity-50"
                          >
                            <Play className="h-3.5 w-3.5" />
                            {busyKey === row.key ? "Starting..." : "Start"}
                          </button>
                        ) : canResolvePast ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void runSessionAction(row, "complete")}
                              disabled={busyKey === row.key}
                              className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                            >
                              Completed
                            </button>
                            <button
                              type="button"
                              onClick={() => void runSessionAction(row, "no-show")}
                              disabled={busyKey === row.key}
                              className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                            >
                              No Show
                            </button>
                          </>
                        ) : (
                          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500">
                            {label}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 8 ? <p className="mt-3 text-xs text-slate-500">Showing first 8 sessions. Open trainer schedule for the full day.</p> : null}
    </SectionCard>
  );
}

function LeaderboardSection({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  if (leaderboard.length === 0) {
    return (
      <SectionCard title="Conversion Leaderboard" subtitle="Available when team ranking data is returned">
        <p className="text-sm text-slate-400">No leaderboard data is available for this role right now.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Conversion Leaderboard" subtitle="Top team members by conversion and revenue">
      <div className="space-y-3">
        {leaderboard.slice(0, 5).map((entry, index) => (
          <div
            key={entry.userId}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-white">
                {index + 1}. {entry.userName}
              </p>
              <p className="text-xs text-slate-400">{formatCount(entry.conversions)} conversions</p>
            </div>
            <p className="text-sm font-semibold text-slate-200">{formatCurrency(entry.revenue)}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// -----------------------------------------------------------------------------
// QuickActionTiles (A2) — a role-filtered grid of small actionable lists.
// Each tile renders up to 5 rows of live data and a "View all →" deep link so
// the dashboard stops being a KPI board and becomes today's work list.
//
// Data sources (existing, no backend change):
//   expiringMembers   : engagementService.getAdminDashboardDrilldown (EXPIRING_MEMBERSHIPS)
//   expiredMembers    : getAdminDashboardDrilldown (INACTIVE_MEMBERS)
//   irregularMembers  : getAdminDashboardDrilldown (AT_RISK_MEMBERS)
//   followUpsDueToday : subscriptionFollowUpService.searchFollowUpQueuePaged
//   followUpsOverdue  : same, overdueOnly:true
//   myFollowUps       : same, assignedToStaffId:me
//   balanceDue        : subscriptionService.getBalanceDue
// -----------------------------------------------------------------------------

type TileKey =
  | "EXPIRING"
  | "DUE_TODAY"
  | "OVERDUE"
  | "MINE"
  | "IRREGULAR"
  | "EXPIRED"
  | "PAYMENT_DUE";

const TILE_VISIBILITY_BY_DESIGNATION: Record<string, TileKey[]> = {
  SUPER_ADMIN: ["EXPIRING", "DUE_TODAY", "OVERDUE", "MINE", "IRREGULAR", "EXPIRED", "PAYMENT_DUE"],
  GYM_MANAGER: ["EXPIRING", "DUE_TODAY", "OVERDUE", "MINE", "IRREGULAR", "EXPIRED", "PAYMENT_DUE"],
  SALES_MANAGER: ["DUE_TODAY", "OVERDUE", "MINE", "PAYMENT_DUE"],
  SALES_EXECUTIVE: ["DUE_TODAY", "OVERDUE", "MINE", "PAYMENT_DUE"],
  FRONT_DESK_EXECUTIVE: ["DUE_TODAY", "OVERDUE", "MINE", "PAYMENT_DUE"],
  FITNESS_MANAGER: ["EXPIRING", "IRREGULAR"],
};

interface QuickTileRow {
  key: string;
  primary: string;
  secondary?: string;
  badge?: string;
  href?: string;
}

interface QuickTileData {
  rows: QuickTileRow[];
  loading: boolean;
  error?: string | null;
  totalCount?: number;
}

function QuickActionTile({
  title,
  subtitle,
  tile,
  viewAllHref,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  tile: QuickTileData;
  viewAllHref: string;
  emptyLabel: string;
}) {
  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      actions={
        <Link
          href={viewAllHref}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
        >
          View all
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {tile.loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : tile.error ? (
        <p className="text-sm text-rose-300">{tile.error}</p>
      ) : tile.rows.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {tile.rows.map((row) => {
            const content = (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 hover:bg-white/[0.06]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{row.primary}</p>
                  {row.secondary ? (
                    <p className="truncate text-xs text-slate-400">{row.secondary}</p>
                  ) : null}
                </div>
                {row.badge ? (
                  <span className="shrink-0 rounded-full border border-[#c42924]/40 bg-[#c42924]/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ffd6d4]">
                    {row.badge}
                  </span>
                ) : null}
              </div>
            );
            return row.href ? (
              <Link key={row.key} href={row.href} className="block">
                {content}
              </Link>
            ) : (
              <div key={row.key}>{content}</div>
            );
          })}
          {typeof tile.totalCount === "number" && tile.totalCount > tile.rows.length ? (
            <p className="pt-1 text-xs text-slate-500">
              Showing {tile.rows.length} of {tile.totalCount}
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function QuickActionTiles({
  token,
  user,
  effectiveBranchId,
  selectedBranchCode,
}: {
  token: string;
  user: AuthUser | null;
  effectiveBranchId: number | undefined;
  selectedBranchCode: string | undefined;
}) {
  const [tiles, setTiles] = useState<Record<TileKey, QuickTileData>>({
    EXPIRING: { rows: [], loading: true },
    DUE_TODAY: { rows: [], loading: true },
    OVERDUE: { rows: [], loading: true },
    MINE: { rows: [], loading: true },
    IRREGULAR: { rows: [], loading: true },
    EXPIRED: { rows: [], loading: true },
    PAYMENT_DUE: { rows: [], loading: true },
  });
  const [showEmptyTiles, setShowEmptyTiles] = useState(false);

  const designation = user?.designation;
  const visibleTiles: TileKey[] =
    (designation && TILE_VISIBILITY_BY_DESIGNATION[designation]) || [];

  const loadTiles = useCallback(async () => {
    if (!token || !user || visibleTiles.length === 0) return;

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);
    const thirtyDays = new Date(today);
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const staffId = resolveStaffId(user) || undefined;
    const branchIdStr = effectiveBranchId ? String(effectiveBranchId) : undefined;

    // Helper to update a single tile's state without disturbing the others.
    const setTile = (key: TileKey, patch: Partial<QuickTileData>) =>
      setTiles((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

    const want = (key: TileKey) => visibleTiles.includes(key);

    const tasks: Promise<void>[] = [];

    if (want("EXPIRING")) {
      tasks.push(
        engagementService
          .getAdminDashboardDrilldown(token, {
            metricType: "EXPIRING_MEMBERSHIPS",
            period: "CUSTOM",
            from: startOfDay.toISOString().slice(0, 10),
            to: thirtyDays.toISOString().slice(0, 10),
            branchId: branchIdStr,
            page: 0,
            size: 5,
          })
          .then((res) => {
            setTile("EXPIRING", {
              loading: false,
              rows: res.content.slice(0, 5).map((raw) => {
                const r = raw as Record<string, unknown>;
                const mid = String(r.memberId ?? "");
                return {
                  key: `exp-${mid}`,
                  primary: String(r.fullName ?? r.memberName ?? "Member"),
                  secondary: r.expiresAt
                    ? `Expires ${new Date(String(r.expiresAt)).toLocaleDateString()}`
                    : String(r.planName ?? ""),
                  href: mid ? `/admin/members/${mid}` : undefined,
                };
              }),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("EXPIRING", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    if (want("EXPIRED")) {
      tasks.push(
        engagementService
          .getAdminDashboardDrilldown(token, {
            metricType: "INACTIVE_MEMBERS",
            branchId: branchIdStr,
            page: 0,
            size: 5,
          })
          .then((res) => {
            setTile("EXPIRED", {
              loading: false,
              rows: res.content.slice(0, 5).map((raw) => {
                const r = raw as Record<string, unknown>;
                const mid = String(r.memberId ?? "");
                return {
                  key: `expired-${mid}`,
                  primary: String(r.fullName ?? r.memberName ?? "Member"),
                  secondary: String(r.mobileNumber ?? r.planName ?? "-"),
                  href: mid ? `/admin/members/${mid}` : undefined,
                };
              }),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("EXPIRED", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    if (want("IRREGULAR")) {
      tasks.push(
        engagementService
          .getAdminDashboardDrilldown(token, {
            metricType: "AT_RISK_MEMBERS",
            branchId: branchIdStr,
            page: 0,
            size: 5,
          })
          .then((res) => {
            setTile("IRREGULAR", {
              loading: false,
              rows: res.content.slice(0, 5).map((raw) => {
                const r = raw as Record<string, unknown>;
                const mid = String(r.memberId ?? "");
                return {
                  key: `irr-${mid}`,
                  primary: String(r.fullName ?? r.memberName ?? "Member"),
                  secondary: r.lastVisitAt
                    ? `Last visit ${new Date(String(r.lastVisitAt)).toLocaleDateString()}`
                    : String(r.mobileNumber ?? "-"),
                  href: mid ? `/admin/members/${mid}` : undefined,
                };
              }),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("IRREGULAR", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    if (want("DUE_TODAY")) {
      tasks.push(
        subscriptionFollowUpService
          .searchFollowUpQueuePaged(
            token,
            {
              status: "SCHEDULED",
              dueFrom: startOfDay.toISOString(),
              dueTo: endOfDay.toISOString(),
              branchId: effectiveBranchId,
            },
            0,
            5,
          )
          .then((res) => {
            setTile("DUE_TODAY", {
              loading: false,
              rows: res.content.slice(0, 5).map((row) => ({
                key: `due-${row.followUpId}`,
                primary: row.memberName || row.inquiryName || `Follow-up #${row.followUpId}`,
                secondary: buildFollowUpRowSecondary(row),
                href: row.memberId
                  ? `/admin/members/${row.memberId}`
                  : row.inquiryId
                    ? `/portal/inquiries?focusInquiryId=${row.inquiryId}`
                    : undefined,
              })),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("DUE_TODAY", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    if (want("OVERDUE")) {
      tasks.push(
        subscriptionFollowUpService
          .searchFollowUpQueuePaged(
            token,
            {
              status: "SCHEDULED",
              overdueOnly: true,
              branchId: effectiveBranchId,
            },
            0,
            5,
          )
          .then((res) => {
            setTile("OVERDUE", {
              loading: false,
              rows: res.content.slice(0, 5).map((row) => ({
                key: `overdue-${row.followUpId}`,
                primary: row.memberName || row.inquiryName || `Follow-up #${row.followUpId}`,
                secondary: buildFollowUpRowSecondary(row),
                badge: "OVERDUE",
                href: row.memberId
                  ? `/admin/members/${row.memberId}`
                  : row.inquiryId
                    ? `/portal/inquiries?focusInquiryId=${row.inquiryId}`
                    : undefined,
              })),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("OVERDUE", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    if (want("MINE") && staffId) {
      tasks.push(
        subscriptionFollowUpService
          .searchFollowUpQueuePaged(
            token,
            {
              status: "SCHEDULED",
              assignedToStaffId: Number(staffId),
              branchId: effectiveBranchId,
            },
            0,
            5,
          )
          .then((res) => {
            setTile("MINE", {
              loading: false,
              rows: res.content.slice(0, 5).map((row) => ({
                key: `mine-${row.followUpId}`,
                primary: row.memberName || row.inquiryName || `Follow-up #${row.followUpId}`,
                secondary: buildFollowUpRowSecondary(row),
                href: row.memberId
                  ? `/admin/members/${row.memberId}`
                  : row.inquiryId
                    ? `/portal/inquiries?focusInquiryId=${row.inquiryId}`
                    : undefined,
              })),
              totalCount: res.totalElements,
            });
          })
          .catch((e: unknown) => setTile("MINE", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    } else if (want("MINE")) {
      setTile("MINE", { loading: false, rows: [] });
    }

    if (want("PAYMENT_DUE")) {
      tasks.push(
        subscriptionService
          .getBalanceDue(token, { branchCode: selectedBranchCode })
          .then((rows) => {
            const arr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
            setTile("PAYMENT_DUE", {
              loading: false,
              rows: arr.slice(0, 5).map((r, i) => {
                const mid = String(r.memberId ?? "");
                const amount = typeof r.balanceAmount === "number" ? r.balanceAmount : Number(r.balanceAmount ?? 0);
                return {
                  key: `bal-${mid || i}`,
                  primary: String(r.memberName ?? r.fullName ?? r.customerName ?? "Member"),
                  secondary: `Balance ${formatCurrency(amount)}`,
                  href: mid ? `/admin/members/${mid}` : undefined,
                };
              }),
              totalCount: arr.length,
            });
          })
          .catch((e: unknown) => setTile("PAYMENT_DUE", { loading: false, error: e instanceof Error ? e.message : "Failed" })),
      );
    }

    await Promise.all(tasks);
  }, [token, user, effectiveBranchId, selectedBranchCode, visibleTiles.join(",")]);

  useEffect(() => {
    void loadTiles();
  }, [loadTiles]);

  if (!user || visibleTiles.length === 0) return null;

  const tileConfig: Record<TileKey, { title: string; subtitle: string; viewAllHref: string; emptyLabel: string }> = {
    EXPIRING: {
      title: "Memberships expiring",
      subtitle: "Next 30 days · member-scoped to this branch",
      viewAllHref: "/portal/renewals",
      emptyLabel: "No memberships expiring in the next 30 days.",
    },
    DUE_TODAY: {
      title: "Follow-ups due today",
      subtitle: "Scheduled for today · any staff",
      viewAllHref: "/portal/follow-ups",
      emptyLabel: "Nothing due today.",
    },
    OVERDUE: {
      title: "Overdue follow-ups",
      subtitle: "Missed their due date · still open",
      viewAllHref: "/portal/follow-ups",
      emptyLabel: "No overdue follow-ups.",
    },
    MINE: {
      title: "My follow-ups",
      subtitle: "Assigned to you and still open",
      viewAllHref: "/portal/follow-ups",
      emptyLabel: "Nothing on your plate right now.",
    },
    IRREGULAR: {
      title: "Irregular members",
      subtitle: "Low-frequency visitors this month",
      viewAllHref: "/portal/members",
      emptyLabel: "No irregular members flagged.",
    },
    EXPIRED: {
      title: "Expired members",
      subtitle: "Past expiry · no renewal yet",
      viewAllHref: "/portal/members",
      emptyLabel: "No expired memberships.",
    },
    PAYMENT_DUE: {
      title: "Payment follow-ups",
      subtitle: "Invoices with an open balance",
      viewAllHref: "/portal/billing",
      emptyLabel: "All invoices paid up.",
    },
  };

  // Issue L2 + S3 — hide empty tiles by default. Operator scrolls past
  // a wall of "No X." otherwise. A small toggle reveals them on demand.
  const populatedTiles = visibleTiles.filter((k) => {
    const t = tiles[k];
    return t.loading || (t.rows && t.rows.length > 0) || t.error;
  });
  const emptyTileCount = visibleTiles.length - populatedTiles.length;
  const tilesToRender = showEmptyTiles ? visibleTiles : populatedTiles;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">
            Quick actions
          </h2>
          <p className="text-xs text-slate-500">Today&apos;s work, grouped by what needs attention.</p>
        </div>
        {emptyTileCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowEmptyTiles((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
          >
            {showEmptyTiles ? `Hide ${emptyTileCount} empty` : `Show ${emptyTileCount} empty`}
          </button>
        ) : null}
      </div>
      {populatedTiles.length === 0 && !showEmptyTiles ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 text-sm text-emerald-100">
          Nothing on your plate right now — every queue is clear. Use the toggle above to peek at the empty tiles.
        </div>
      ) : null}
      {/* Auto-resize: when fewer tiles are visible than would fill the
          standard 3-column grid, the grid expands each tile to use the
          available row instead of leaving empty columns. minmax(280px, 1fr)
          + auto-fit gives us 1/2/3-column responsive behavior with no
          breakpoint hardcoding. */}
      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {tilesToRender.map((key) => (
          <QuickActionTile
            key={key}
            title={tileConfig[key].title}
            subtitle={tileConfig[key].subtitle}
            viewAllHref={tileConfig[key].viewAllHref}
            emptyLabel={tileConfig[key].emptyLabel}
            tile={tiles[key]}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Compact header for the SUPER_ADMIN and GYM_MANAGER dashboard paths
 * (Path 1 + Path 2). Adds a greeting (issue #2), a refresh button
 * (issue #3), and a branch-scope pill (issue #8) — all of which Path 3
 * already has but the rich admin dashboard was missing.
 *
 * <p>Refresh uses next/navigation's {@code router.refresh()} which
 * re-runs RSC data fetches and forces the dynamically-imported
 * {@code AdminDashboardContent} subtree to re-fetch its
 * {@code getAdminDashboard} call.
 */
function AdminDashboardHeader({
  userName,
  designation,
  selectedBranchName,
  isAllBranches,
  onRefresh,
}: {
  userName?: string;
  designation?: UserDesignation;
  selectedBranchName?: string;
  isAllBranches: boolean;
  onRefresh: () => void;
}) {
  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good Morning" : greetingHour < 17 ? "Good Afternoon" : "Good Evening";
  const branchLabel = isAllBranches ? "All Branches" : selectedBranchName || "Branch";

  return (
    <section className="rounded-[28px] border border-white/10 bg-gradient-to-br from-[#1a2030] via-[#121722] to-[#7f1d1d]/40 p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-200/80">
            {displayDesignation(designation)} dashboard
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {greeting}
            {userName ? `, ${userName.split(" ")[0]}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
            <MapPin className="h-3.5 w-3.5" />
            {branchLabel}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#C42429] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#a61e22]"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>
    </section>
  );
}

export default function UnifiedDashboardPage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const { selectedBranchName, effectiveBranchId, selectedBranchCode } = useBranch();
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Issue #12 — any ADMIN role gets the full admin dashboard, not just the
  // SUPER_ADMIN designation. Avoids the silent fallthrough to Path 3 if an
  // ADMIN user ever lands without a designation (or with a non-standard one).
  const isSuperAdmin = user?.role === "ADMIN";
  const isGymManager = user?.role === "STAFF" && user.designation === "GYM_MANAGER";
  const designation = user?.designation;

  const loadDashboard = useCallback(async () => {
    if (!token || !user || isSuperAdmin || isGymManager) {
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

      const [dashboardResponse, dueTodayPage, overduePage] = await Promise.all([
        engagementService.getSalesDashboard(token, user.id, user.role),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            assignedToStaffId: staffId || undefined,
            status: "SCHEDULED",
            dueFrom: startOfDay.toISOString(),
            dueTo: endOfDay.toISOString(),
          },
          0,
          1,
        ),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            assignedToStaffId: staffId || undefined,
            status: "SCHEDULED",
            overdueOnly: true,
          },
          0,
          1,
        ),
      ]);

      setState({
        ...dashboardResponse,
        followUpsDueToday: dueTodayPage.totalElements,
        overdueFollowUps: overduePage.totalElements,
      });
    } catch (dashboardError) {
      setError(
        dashboardError instanceof Error ? dashboardError.message : "Unable to load dashboard",
      );
    } finally {
      setLoading(false);
    }
  }, [isGymManager, isSuperAdmin, token, user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const allCards = useMemo(
    () =>
      buildAllCards(
        state.adminOverview,
        state.metrics,
        state.followUpsDueToday,
        state.overdueFollowUps,
      ),
    [state],
  );

  const roleKey =
    designation === "SALES_MANAGER" ||
    designation === "SALES_EXECUTIVE" ||
    designation === "FRONT_DESK_EXECUTIVE" ||
    designation === "FITNESS_MANAGER"
      ? designation
      : "DEFAULT";

  const hero = useMemo(
    () => buildHeroCopy(designation, selectedBranchName),
    [designation, selectedBranchName],
  );

  const primaryCards = PRIMARY_CARD_KEYS[roleKey]
    .map((key) => allCards[key])
    .filter(Boolean);

  const focusPanels = useMemo(() => buildFocusPanels(designation, state), [designation, state]);
  const workspaceItems = WORKSPACE_ITEMS[roleKey];
  const watchlist = useMemo(() => buildWatchlist(designation, state), [designation, state]);

  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12 ? "Good Morning" : greetingHour < 17 ? "Good Afternoon" : "Good Evening";

  // Issue #3 — refresh trigger for admin/manager paths. router.refresh()
  // re-runs server data fetches; window.location.reload() is a hard fallback
  // to also refresh the dynamically-imported admin dashboard subtree.
  const handleRefresh = useCallback(() => {
    router.refresh();
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, [router]);

  const isAllBranches = !selectedBranchName || selectedBranchName === "All Branches";

  if (isSuperAdmin) {
    return (
      <div className="space-y-8 pb-12">
        {/* Issue #2/#3/#8 — greeting + branch indicator + refresh button. */}
        <AdminDashboardHeader
          userName={user?.name}
          designation={designation}
          selectedBranchName={selectedBranchName}
          isAllBranches={isAllBranches}
          onRefresh={handleRefresh}
        />
        {/* Live flap-gate entries — placed at the top so whoever opens the
            dashboard first sees who's in the gym right now. */}
        {token ? <TodayCheckInsTile /> : null}
        {/* Pending approvals — surfaces gated risky-op queue (DEC-019). */}
        {token ? <PendingApprovalsTile /> : null}
        {token ? (
          <QuickActionTiles
            token={token}
            user={user}
            effectiveBranchId={effectiveBranchId}
            selectedBranchCode={selectedBranchCode}
          />
        ) : null}
        <AdminDashboardContent hideHeading />
      </div>
    );
  }

  if (isGymManager) {
    return (
      <div className="space-y-8 pb-12">
        <AdminDashboardHeader
          userName={user?.name}
          designation={designation}
          selectedBranchName={selectedBranchName}
          isAllBranches={isAllBranches}
          onRefresh={handleRefresh}
        />
        {token ? <GymManagerQuickActions token={token} userName={user?.name} /> : null}
        {token ? <TodayCheckInsTile /> : null}
        {token ? <PendingApprovalsTile /> : null}
        {token ? (
          <QuickActionTiles
            token={token}
            user={user}
            effectiveBranchId={effectiveBranchId}
            selectedBranchCode={selectedBranchCode}
          />
        ) : null}
        <AdminDashboardContent
          branchScoped
          hideHeading
          headingTitle={`${selectedBranchName || "Branch"} Dashboard`}
          headingSubtitle={`${selectedBranchName || "Selected branch"} overview`}
        />
      </div>
    );
  }

  if (loading) {
    return <PageLoader label="Loading dashboard..." />;
  }

  // Issue #10 — empty-state hint for the metric-card grid below. Path 3
  // hydrates state from the staff dashboard endpoint which today returns
  // only check-ins + currently-inside (issue #11), so every primary card
  // value resolves to 0. Until the backend expansion lands, render a
  // gentle "no data wired yet" note instead of a wall of zeros.
  const allPrimaryCardsZero = primaryCards.every((card) => {
    const numeric = String(card.value).replace(/[^0-9.-]/g, "");
    return numeric === "0" || numeric === "" || numeric === "0.0";
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Issue #6 — TodayCheckInsTile is now visible to every staff designation
          on the dashboard, not just FRONT_DESK_EXECUTIVE. Sales / Fitness
          staff also benefit from the "is so-and-so already in the gym today?"
          context (chasing renewals, recovering at-risk members, etc.). */}
      {token ? <TodayCheckInsTile /> : null}
      {/* Issue #5 — PendingApprovalsTile surfaces requests the operator has
          submitted (DISCOUNT, VOID_*, DELETE_PAYMENT, BACKDATE_SUBSCRIPTION
          per DEC-019). Backend filters to "approvals visible to caller" so
          non-approver staff see only their own pending submissions. */}
      {token ? <PendingApprovalsTile /> : null}
      {token ? (
        <QuickActionTiles
          token={token}
          user={user}
          effectiveBranchId={effectiveBranchId}
          selectedBranchCode={selectedBranchCode}
        />
      ) : null}
      {/* Issue #1 — hero + side panel converted from light theme to the
          portal's dark palette so Path 3 reads as a single coherent surface. */}
      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#15181f] shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[1.8fr_1fr]">
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(196,36,41,0.18),_transparent_45%),linear-gradient(135deg,#111827_0%,#1f2937_45%,#7f1d1d_100%)] px-6 py-8 text-white sm:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-100">
              {hero.eyebrow}
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              {greeting}
              {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-2 text-lg font-semibold text-white/90">
              {displayDesignation(designation)}
              {selectedBranchName && selectedBranchName !== "All Branches"
                ? ` · ${selectedBranchName}`
                : ""}
            </p>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-rose-50/90">{hero.description}</p>
          </div>

          <div className="grid gap-0 border-t border-white/8 bg-white/[0.02] lg:border-t-0 lg:border-l">
            <div className="border-b border-white/8 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white/[0.06] p-3 text-[#ffd6d4] shadow-sm">
                  <Target className="h-5 w-5" />
                </div>
                <div>
                  {/* Issue #9 — was "Main KPI" hardcoded, but the actual lane
                      is whatever the first focus panel is for this designation
                      (e.g. "Lead Pipeline" for sales, "Member Health" for
                      front desk). Show the panel's own title here. */}
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {focusPanels[0]?.title || "Operating summary"}
                  </p>
                  <p className="text-xl font-bold text-white">{focusPanels[0]?.value || "0"}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {focusPanels[0]?.description || "Live branch-side indicators update from the backend."}
              </p>
            </div>

            <div className="grid gap-3 p-5">
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Today&apos;s Watch
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {formatCount(state.followUpsDueToday)} follow-ups due, {formatCount(state.overdueFollowUps)} overdue
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Branch Pulse
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {formatCount(state.adminOverview.totalActiveMembers)} active members, {formatCount(state.adminOverview.upcomingRenewals7Days)} renewals due
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#C42429] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#a61e22]"
              >
                Refresh Dashboard
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {primaryCards.map((card) => {
          const MetricIcon = iconForMetric(card.label);
          return (
            <article
              key={card.label}
              className="rounded-2xl border border-white/10 bg-[#15181f] p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-400">{card.label}</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-white">{card.value}</p>
                  <p className="mt-2 text-sm text-slate-400">{card.subtitle}</p>
                </div>
                <div className={`rounded-2xl p-3 ${card.color}`}>
                  <MetricIcon className="h-5 w-5" />
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {allPrimaryCardsZero && !loading ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-semibold">No metrics loaded yet for this role.</p>
          <p className="mt-1 text-amber-100/80">
            The branch-scoped staff dashboard endpoint is being expanded (tracked as issue #11). The
            counts above will populate once the backend wiring lands. Quick Actions tiles above
            already pull live data and are the most reliable signal in the meantime.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <SectionCard
          title="Role Focus"
          subtitle="The most important lanes for this designation right now"
        >
          <div className="grid gap-4 md:grid-cols-3">
            {focusPanels.map((panel) => (
              <Link
                key={panel.title}
                href={panel.href}
                className={`rounded-2xl border p-4 transition hover:shadow-sm ${toneClasses(panel.tone)}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em]">{panel.title}</p>
                <p className="mt-3 text-3xl font-bold">{panel.value}</p>
                <p className="mt-2 text-sm leading-6">{panel.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
                  Open module
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Watchlist" subtitle="Operational items that need attention">
          <div className="space-y-3">
            {watchlist.map((item) => (
              <div
                key={item.label}
                className={`rounded-2xl border px-4 py-3 ${watchlistToneClasses(item.tone)}`}
              >
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="mt-1 text-sm">{item.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          title="Workspace"
          subtitle="Jump into the modules that matter for this role"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {workspaceItems.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="group rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-[#c42924] hover:bg-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
                  </div>
                  <ArrowRight className="mt-1 h-5 w-5 text-slate-500 transition group-hover:text-[#ffd6d4]" />
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>

        {(designation === "SALES_MANAGER" || designation === "SALES_EXECUTIVE") ? (
          <LeaderboardSection leaderboard={state.leaderboard} />
        ) : (
          <SectionCard
            title="Operating Notes"
            subtitle="What this dashboard currently represents"
          >
            <div className="space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <Clock3 className="mt-0.5 h-4 w-4 text-slate-400" />
                <p>The portal already supports a single dashboard route with role-specific content instead of separate dashboard entries.</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-slate-400" />
                <p>Operational cards here are built from live backend metrics already exposed by the existing dashboard and follow-up APIs.</p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <BiometricIcon className="mt-0.5 h-4 w-4 text-slate-400" />
                <p>Branch managers continue to use the richer branch-scoped HQ dashboard, while coach users remain blocked from portal access.</p>
              </div>
            </div>
          </SectionCard>
        )}
      </div>

      {(designation === "SALES_MANAGER" || designation === "FITNESS_MANAGER") ? (
        <AlertsSection overview={state.adminOverview} />
      ) : null}
    </div>
  );
}
