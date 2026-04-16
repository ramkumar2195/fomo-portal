"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { DataTable } from "@/components/common/data-table";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { branchService } from "@/lib/api/services/branch-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { TrainerUtilizationRow } from "@/types/admin";
import { FollowUpRecord } from "@/types/follow-up";
import { InquiryRecord } from "@/types/inquiry";
import { AdminOverviewMetrics, DashboardMetrics, LeaderboardEntry } from "@/types/models";

interface ReportsState {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
}

interface AnalysisCardModel {
  title: string;
  value: string;
  helper: string;
  series: Array<{ label: string; value: number }>;
}

interface AnalyticsSnapshot {
  inquiries: InquiryRecord[];
  followUps: FollowUpRecord[];
  renewals: Array<Record<string, unknown>>;
  receipts: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  membersSummary: {
    activeMembers: number;
    expiredMembers: number;
    irregularMembers: number;
    ptClients: number;
  };
}

interface ReportDownloadCard {
  key: string;
  title: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string;
  loadRows: () => Promise<Record<string, unknown>[]>;
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

const EMPTY_ANALYTICS: AnalyticsSnapshot = {
  inquiries: [],
  followUps: [],
  renewals: [],
  receipts: [],
  subscriptions: [],
  membersSummary: {
    activeMembers: 0,
    expiredMembers: 0,
    irregularMembers: 0,
    ptClients: 0,
  },
};

function buildMonthlySeries(monthRevenue: number): Array<{ month: string; value: number }> {
  const base = Math.max(Math.round(monthRevenue / 6), 5000);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const factors = [0.85, 0.92, 1.04, 0.98, 1.12, 1.2];
  return labels.map((month, index) => ({ month, value: Math.round(base * factors[index]) }));
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeText(value: unknown, fallback = "Unknown"): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function toBarSeries(entries: Array<[string, number]>, limit = 4): Array<{ label: string; value: number }> {
  return entries
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

function buildCountMap(values: unknown[], fallback = "Unknown"): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const key = normalizeText(value, fallback);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const headers = Array.from(rows.reduce((keys, row) => {
    Object.keys(row).forEach((key) => keys.add(key));
    return keys;
  }, new Set<string>()));
  const csvRows = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => `"${formatCsvValue(row[header]).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function todayFileSuffix(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const { token, user } = useAuth();
  const { effectiveBranchId, selectedBranchCode } = useBranch();
  const canDownloadReports = user?.role === "ADMIN";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ReportsState>(EMPTY_STATE);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot>(EMPTY_ANALYTICS);
  const [trainerRows, setTrainerRows] = useState<TrainerUtilizationRow[]>([]);
  const [downloadBusyKey, setDownloadBusyKey] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, utilizationResult, membersDirectoryResult, inquiriesResult, followUpsResult, renewalsResult, receiptsResult, subscriptionsResult] = await Promise.allSettled([
        engagementService.getSalesDashboard(token, user.id, user.role),
        engagementService.getTrainerUtilization(token, {
          branchId: effectiveBranchId || undefined,
        }),
        effectiveBranchId
          ? branchService.getBranchMembersDirectory(token, effectiveBranchId, { filter: "ALL", page: 0, size: 500 })
          : branchService.getGlobalMembersDirectory(token, { branchId: effectiveBranchId, filter: "ALL", page: 0, size: 500 }),
        subscriptionService.searchInquiriesPaged(
          token,
          { ...(selectedBranchCode ? { branchCode: selectedBranchCode } : {}) },
          0,
          500,
        ),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          { ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
          0,
          500,
        ),
        subscriptionService.getRenewalsQueue(token, { daysAhead: 30 }),
        subscriptionService.getReceiptRegister(token),
        subscriptionService.getSubscriptionRegister(token),
      ]);
      if (dashboardResult.status === "fulfilled") {
        setState(dashboardResult.value);
      } else {
        setState(EMPTY_STATE);
      }
      if (utilizationResult.status === "fulfilled") {
        setTrainerRows(utilizationResult.value?.content ?? []);
      } else {
        setTrainerRows([]);
      }
      setAnalytics({
        inquiries: inquiriesResult.status === "fulfilled" ? inquiriesResult.value.content ?? [] : [],
        followUps: followUpsResult.status === "fulfilled" ? followUpsResult.value.content ?? [] : [],
        renewals: renewalsResult.status === "fulfilled" ? renewalsResult.value.map((item) => toRecord(item)) : [],
        receipts: receiptsResult.status === "fulfilled" ? receiptsResult.value.map((item) => toRecord(item)) : [],
        subscriptions: subscriptionsResult.status === "fulfilled" ? subscriptionsResult.value.map((item) => toRecord(item)) : [],
        membersSummary:
          membersDirectoryResult.status === "fulfilled"
            ? {
                activeMembers: membersDirectoryResult.value.summary.activeMembers || 0,
                expiredMembers: membersDirectoryResult.value.summary.expiredMembers || 0,
                irregularMembers: membersDirectoryResult.value.summary.irregularMembers || 0,
                ptClients: membersDirectoryResult.value.summary.ptClients || 0,
              }
            : EMPTY_ANALYTICS.membersSummary,
      });
      if (
        dashboardResult.status === "rejected" &&
        utilizationResult.status === "rejected" &&
        membersDirectoryResult.status === "rejected" &&
        inquiriesResult.status === "rejected" &&
        followUpsResult.status === "rejected"
      ) {
        setError("Analysis data is partially unavailable for this role.");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load reports");
    } finally {
      setLoading(false);
    }
  }, [token, user, effectiveBranchId]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const monthlySeries = useMemo(
    () => buildMonthlySeries(state.adminOverview.monthRevenue || state.metrics.revenueThisMonth),
    [state.adminOverview.monthRevenue, state.metrics.revenueThisMonth],
  );
  const maxSeries = useMemo(() => Math.max(...monthlySeries.map((item) => item.value), 1), [monthlySeries]);
  const analysisCards = useMemo<AnalysisCardModel[]>(() => {
    const inquirySourceSeries = toBarSeries(Array.from(buildCountMap(analytics.inquiries.map((item) => item.promotionSource), "Unknown source").entries()));
    const followUpDueToday = analytics.followUps.filter((item) => {
      const dueAt = new Date(item.dueAt).getTime();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      return dueAt >= today.getTime() && dueAt < tomorrow.getTime();
    }).length;
    const followUpOverdue = analytics.followUps.filter((item) => item.overdue).length;
    const convertedCount = analytics.inquiries.filter((item) => item.converted || item.status === "CONVERTED" || item.memberId).length;
    const openInquiryCount = analytics.inquiries.filter((item) => !item.converted && item.status !== "NOT_INTERESTED" && item.status !== "LOST").length;
    const closedInquiryCount = analytics.inquiries.filter((item) => item.status === "NOT_INTERESTED" || item.status === "LOST").length;
    const totalInquiries = analytics.inquiries.length;
    const conversionRate = totalInquiries > 0 ? (convertedCount / totalInquiries) * 100 : 0;
    const inquiryStatusSeries = toBarSeries(Array.from(buildCountMap(analytics.inquiries.map((item) => item.status), "Unknown status").entries()));
    const subscriptionSeries = toBarSeries(Array.from(buildCountMap(analytics.subscriptions.map((item) => item.variantName || item.planName || item.subscriptionName), "Unmapped plan").entries()));
    const receiptModeSeries = toBarSeries(Array.from(buildCountMap(analytics.receipts.map((item) => item.paymentMode || item.mode), "Unknown mode").entries()));
    const renewalSeven = analytics.renewals.filter((item) => Number(item.daysRemaining ?? 0) >= 0 && Number(item.daysRemaining ?? 0) <= 7).length;
    const renewalFifteen = analytics.renewals.filter((item) => Number(item.daysRemaining ?? 0) >= 8 && Number(item.daysRemaining ?? 0) <= 15).length;
    const renewalThirty = analytics.renewals.filter((item) => Number(item.daysRemaining ?? 0) >= 16 && Number(item.daysRemaining ?? 0) <= 30).length;
    const activeSubscriptions = analytics.subscriptions.filter((item) => normalizeText(item.status).toUpperCase() === "ACTIVE").length;

    return [
      {
        title: "Traffic Analysis",
        value: String(totalInquiries),
        helper: "Source split from live enquiry records",
        series: inquirySourceSeries,
      },
      {
        title: "Member Analysis",
        value: String(analytics.membersSummary.activeMembers + analytics.membersSummary.expiredMembers),
        helper: `${analytics.membersSummary.activeMembers} active · ${analytics.membersSummary.expiredMembers} expired`,
        series: [
          { label: "Active", value: analytics.membersSummary.activeMembers },
          { label: "Expired", value: analytics.membersSummary.expiredMembers },
          { label: "Irregular", value: analytics.membersSummary.irregularMembers },
          { label: "PT", value: analytics.membersSummary.ptClients },
        ],
      },
      {
        title: "Collection Analysis",
        value: formatCurrency(
          analytics.receipts.reduce((sum, item) => sum + Number(item.amountPaid ?? item.amount ?? 0), 0),
        ),
        helper: `${analytics.receipts.length} receipts in current scope`,
        series: receiptModeSeries,
      },
      {
        title: "Renewal Analysis",
        value: String(analytics.renewals.length),
        helper: `${renewalSeven} renewals due in 7 days`,
        series: [
          { label: "0-7 days", value: renewalSeven },
          { label: "8-15 days", value: renewalFifteen },
          { label: "16-30 days", value: renewalThirty },
        ],
      },
      {
        title: "Subscription Analysis",
        value: String(activeSubscriptions),
        helper: "Current subscription mix by plan",
        series: subscriptionSeries,
      },
      {
        title: "Follow-up Analysis",
        value: String(analytics.followUps.length),
        helper: `${followUpDueToday} due today · ${followUpOverdue} overdue`,
        series: [
          { label: "Scheduled", value: analytics.followUps.filter((item) => item.status === "SCHEDULED").length },
          { label: "Completed", value: analytics.followUps.filter((item) => item.status === "COMPLETED").length },
          { label: "Overdue", value: followUpOverdue },
          { label: "Due Today", value: followUpDueToday },
        ],
      },
      {
        title: "Conversion Analysis",
        value: formatPercent(conversionRate),
        helper: `${convertedCount} converted out of ${totalInquiries}`,
        series: [
          { label: "Converted", value: convertedCount },
          { label: "Open", value: openInquiryCount },
          { label: "Closed", value: closedInquiryCount },
        ],
      },
      {
        title: "Inquiry Analysis",
        value: String(totalInquiries),
        helper: "Status distribution across CRM enquiries",
        series: inquiryStatusSeries,
      },
    ];
  }, [analytics]);

  const reportCards = useMemo<ReportDownloadCard[]>(() => {
    if (!token) return [];

    const fetchPtRows = async () => {
      const trainers = await usersService.searchUsers(token, { role: "COACH", active: true });
      const assignmentBatches = await Promise.all(
        trainers.map(async (trainer) => ({
          trainer,
          assignments: await trainingService.getCoachAssignments(token, trainer.id).catch(() => []),
        })),
      );
      return assignmentBatches.flatMap(({ trainer, assignments }) =>
        assignments
          .map(toRecord)
          .filter((record) => String(record.trainingType || record.type || "").toUpperCase().includes("PERSONAL"))
          .map((record) => ({
            assignmentId: record.id || record.assignmentId,
            trainerId: trainer.id,
            trainerName: trainer.name,
            memberId: record.memberId,
            memberName: record.memberName,
            mobile: record.memberMobile || record.mobile,
            packageName: record.packageName,
            startDate: record.startDate,
            endDate: record.endDate,
            totalSessions: record.totalSessions,
            completedSessions: record.importedCompletedSessions || record.completedSessions,
            pendingSessions: record.importedPendingSessions || record.pendingSessions,
            noShowSessions: record.importedNoShowSessions || record.noShowSessions,
            cancelledSessions: record.importedCancelledSessions || record.cancelledSessions,
            cancelAllowanceUsed: record.importedReschedulesUsed || record.reschedulesUsed,
            active: record.active,
          })),
      );
    };

    const fetchRecordedSessions = async () => {
      const ptRows = await fetchPtRows();
      const sessionBatches = await Promise.all(
        ptRows.map(async (row) => ({
          row,
          sessions: row.assignmentId
            ? await trainingService.getPtSessionsByAssignment(token, String(row.assignmentId)).catch(() => [])
            : [],
        })),
      );
      return sessionBatches.flatMap(({ row, sessions }) =>
        sessions.map((session) => {
          const record = toRecord(session);
          return {
            trainerId: row.trainerId,
            trainerName: row.trainerName,
            memberId: row.memberId,
            memberName: row.memberName,
            packageName: row.packageName,
            sessionDate: record.sessionDate,
            sessionTime: record.sessionTime || record.slotStartTime,
            status: record.status,
            exerciseType: record.exerciseType,
            startedBy: record.startedBy,
            actualStartTime: record.actualStartTime,
            durationMinutes: record.durationMinutes,
            notes: record.notes,
          };
        }),
      );
    };

    return [
      {
        key: "member-client-database",
        title: "Member Client Database",
        description: "All member records with mobile, gender, branch, and trainer reference.",
        loadRows: async () => usersService.searchUsers(token, { role: "MEMBER" }).then((rows) => rows.map((row) => ({ ...row }))),
      },
      {
        key: "pt-client-database",
        title: "PT Client Database",
        description: "Current PT assignment register by trainer, member, plan, counters, and status.",
        loadRows: fetchPtRows,
      },
      {
        key: "recorded-session-register",
        title: "Recorded Session Register",
        description: "PT session history exported from recorded session rows.",
        loadRows: fetchRecordedSessions,
      },
      {
        key: "subscription-register",
        title: "Subscription Register",
        description: "All subscription rows from the finance subscription register.",
        loadRows: async () => subscriptionService.getSubscriptionRegister(token).then((rows) => rows.map(toRecord)),
      },
      {
        key: "sales-register",
        title: "Sales / Invoice Register",
        description: "Invoice-side sales register with tax, totals, balances, and staff fields.",
        loadRows: async () => subscriptionService.getInvoiceRegister(token).then((rows) => rows.map(toRecord)),
      },
      {
        key: "collection-report",
        title: "Collection Report",
        description: "Receipt-side collection report with payment mode and transaction details.",
        loadRows: async () => subscriptionService.getReceiptRegister(token).then((rows) => rows.map(toRecord)),
      },
      {
        key: "balance-due-register",
        title: "Balance Due Register",
        description: "Invoices with outstanding balance as of today.",
        loadRows: async () => subscriptionService.getBalanceDue(token).then((rows) => rows.map(toRecord)),
      },
      {
        key: "transfer-register",
        title: "Transfer Register",
        description: "Download will be enabled after a transfer register endpoint is exposed.",
        disabled: true,
        disabledReason: "No register-level transfer API is available yet.",
        loadRows: async () => [],
      },
      {
        key: "freeze-register",
        title: "Freeze / Pause Register",
        description: "Download will be enabled after a branch-level freeze register endpoint is exposed.",
        disabled: true,
        disabledReason: "Freeze history is currently member-scoped only.",
        loadRows: async () => [],
      },
    ];
  }, [token]);

  const handleDownloadReport = async (card: ReportDownloadCard) => {
    if (card.disabled) return;
    setDownloadBusyKey(card.key);
    setError(null);
    try {
      const rows = await card.loadRows();
      downloadCsv(`fomo-${card.key}-${todayFileSuffix()}.csv`, rows.length > 0 ? rows : [{ message: "No records found" }]);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download report");
    } finally {
      setDownloadBusyKey(null);
    }
  };

  if (loading) return <PageLoader label="Loading reports..." />;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
          <p className="text-slate-400">Comprehensive insights into gym performance.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadReports()}
          className="inline-flex rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Refresh Report
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <SectionCard title="Analysis" subtitle="View-only operating analysis for the selected branch scope">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {analysisCards.map((card) => {
            const maxValue = Math.max(...card.series.map((item) => item.value), 1);
            return (
            <article key={card.title} className="rounded-2xl border border-white/10 bg-[#171d29] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{card.title}</p>
              <p className="mt-3 text-2xl font-bold text-white">{card.value}</p>
              <p className="mt-2 text-sm text-slate-400">{card.helper}</p>
              <div className="mt-5 flex h-24 items-end gap-2">
                {card.series.length > 0 ? (
                  card.series.map((item) => (
                    <div key={`${card.title}-${item.label}`} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-16 w-full items-end rounded-lg bg-white/[0.05] p-1">
                        <div
                          className="w-full rounded-md bg-[#C42429]"
                          style={{ height: `${Math.max(14, Math.round((item.value / maxValue) * 100))}%` }}
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-semibold text-white">{item.value}</p>
                        <p className="max-w-[68px] truncate text-[10px] text-slate-500" title={item.label}>
                          {item.label}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-slate-500">
                    No analysis data
                  </div>
                )}
              </div>
            </article>
          );})}
        </div>
      </SectionCard>

      {canDownloadReports ? (
        <SectionCard title="Download Registers" subtitle="Operational exports for migration validation and daily branch reporting">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reportCards.map((card) => (
              <article key={card.key} className="rounded-2xl border border-white/10 bg-[#171d29] p-4">
                <p className="text-sm font-semibold text-white">{card.title}</p>
                <p className="mt-2 min-h-10 text-sm leading-5 text-slate-400">{card.description}</p>
                {card.disabledReason ? <p className="mt-2 text-xs text-amber-200">{card.disabledReason}</p> : null}
                <button
                  type="button"
                  onClick={() => void handleDownloadReport(card)}
                  disabled={card.disabled || downloadBusyKey === card.key}
                  className="mt-4 rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a61e22] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {downloadBusyKey === card.key ? "Preparing..." : "Download CSV"}
                </button>
              </article>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Monthly Revenue",
            value: formatCurrency(Math.round(state.adminOverview.monthRevenue || state.metrics.revenueThisMonth)),
          },
          { label: "Total Memberships", value: String(state.adminOverview.totalMembers) },
          { label: "Lead Conversion", value: formatPercent(state.metrics.conversionRate) },
          { label: "Follow-ups Due", value: String(state.metrics.followUpsDue) },
        ].map((item) => (
          <article key={item.label} className="rounded-2xl border border-white/10 bg-[#121722] p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-400">{item.label}</p>
            <p className="mt-2 text-2xl font-bold text-white">{item.value}</p>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <SectionCard title="Revenue Growth">
          <div className="flex h-64 items-end gap-4 rounded-2xl bg-[#171d29] p-4">
            {monthlySeries.map((point) => {
              const height = Math.max(12, Math.round((point.value / maxSeries) * 100));
              return (
                <div key={point.month} className="flex flex-1 flex-col items-center justify-end gap-2">
                  <div className="relative flex h-48 w-full items-end rounded-lg bg-[#121722]">
                    <div className="w-full rounded-lg bg-red-600/90" style={{ height: `${height}%` }} />
                  </div>
                  <p className="text-xs font-medium text-slate-400">{point.month}</p>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Sales Performance">
          <div className="space-y-4">
            {state.leaderboard.slice(0, 6).map((entry, index) => (
              <div key={entry.userId} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#171d29] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">#{index + 1} {entry.userName}</p>
                  <p className="text-xs text-slate-400">{entry.conversions} conversions</p>
                </div>
                <p className="text-sm font-semibold text-slate-200">{formatCurrency(entry.revenue)}</p>
              </div>
            ))}
            {state.leaderboard.length === 0 && (
              <p className="text-sm text-slate-400">No leaderboard data available.</p>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Trainer Utilization */}
      <SectionCard title="Trainer Utilization" subtitle="Coach performance and session metrics">
        <DataTable<TrainerUtilizationRow>
          columns={[
            { key: "trainerName", header: "Trainer", render: (r) => r.trainerName || "-" },
            { key: "sessionsConducted", header: "Sessions", render: (r) => String(r.sessionsConducted) },
            { key: "programSessions", header: "Program Sessions", render: (r) => String(r.programSessions) },
            { key: "ptRevenue", header: "PT Revenue", render: (r) => formatCurrency(r.ptRevenue) },
            {
              key: "utilizationPercent",
              header: "Utilization",
              render: (r) => (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-20 rounded-full bg-[#1b2230]">
                    <div
                      className="h-2 rounded-full bg-red-600"
                      style={{ width: `${Math.min(r.utilizationPercent, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium">{Math.round(r.utilizationPercent)}%</span>
                </div>
              ),
            },
          ]}
          data={trainerRows}
          keyExtractor={(r) => r.trainerId}
          emptyMessage="No trainer utilization data available."
        />
      </SectionCard>
    </div>
  );
}
