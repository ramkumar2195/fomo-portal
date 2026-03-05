import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";
import { UserRole } from "@/types/auth";
import { AdminOverviewMetrics, DashboardMetrics, FreezeHistoryEntry, LeaderboardEntry } from "@/types/models";

interface SalesDashboardPayload {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
}

type JsonRecord = Record<string, unknown>;

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function toNumber(payload: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function toString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

function mapFreezeHistory(payload: unknown): FreezeHistoryEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((entry, index) => ({
      freezeId:
        toString(entry, ["freezeId", "id", "requestId", "memberFreezeId"]) || `freeze-${index}`,
      freezeFrom: toString(entry, ["freezeFrom", "startDate", "fromDate"]) || undefined,
      freezeTo: toString(entry, ["freezeTo", "endDate", "toDate"]) || undefined,
      status: toString(entry, ["status"]) || undefined,
      reason: toString(entry, ["reason", "notes"]) || undefined,
      days: toNumber(entry, ["days", "freezeDays", "durationDays"]) || undefined,
      requestedAt: toString(entry, ["requestedAt", "createdAt"]) || undefined,
      approvedAt: toString(entry, ["approvedAt", "updatedAt"]) || undefined,
      createdAt: toString(entry, ["createdAt"]) || undefined,
    }));
}

function mapAdminOverviewMetrics(payload: unknown): AdminOverviewMetrics {
  const data = toRecord(payload);

  return {
    totalActiveMembers: toNumber(data, ["totalActiveMembers", "activeMembers"]),
    expiredMembers: toNumber(data, ["expiredMembers", "totalExpiredMembers"]),
    irregularMembers: toNumber(data, ["irregularMembers", "totalIrregularMembers"]),
    totalPtClients: toNumber(data, ["totalPtClients", "ptClients", "totalPTClients"]),
    todaysRevenue: toNumber(data, ["todaysRevenue", "todayRevenue", "revenueToday"]),
    monthRevenue: toNumber(data, ["monthRevenue", "monthlyRevenue", "revenueThisMonth"]),
    todaysBirthdays: toNumber(data, ["todaysBirthdays", "todayBirthdays"]),
    upcomingRenewals7Days: toNumber(data, ["upcomingRenewals7Days", "renewalsNext7Days"]),
    upcomingRenewals15Days: toNumber(data, ["upcomingRenewals15Days", "renewalsNext15Days"]),
    upcomingRenewals30Days: toNumber(data, ["upcomingRenewals30Days", "renewalsNext30Days"]),
    totalMembers: toNumber(data, ["totalMembers"]),
    totalStaff: toNumber(data, ["totalStaff", "totalStaffs"]),
  };
}

function mapDashboardMetrics(payload: unknown): DashboardMetrics {
  const data = toRecord(payload);

  return {
    todaysInquiries: toNumber(data, ["todaysInquiries", "todayInquiries", "inquiriesToday", "inquiries"]),
    followUpsDue: toNumber(data, ["followUpsDue", "dueFollowUps", "pendingFollowUps"]),
    conversionRate: toNumber(data, ["conversionRate", "conversion", "conversionPercentage"]),
    revenueToday: toNumber(data, ["revenueToday", "todayRevenue", "dailyRevenue"]),
    revenueThisMonth: toNumber(data, ["revenueThisMonth", "monthRevenue", "monthlyRevenue"]),
  };
}

function mapLeaderboard(payload: unknown): LeaderboardEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((entry, index) => ({
      userId: toString(entry, ["userId", "staffId", "id"]) || `entry-${index}`,
      userName: toString(entry, ["userName", "staffName", "name"]) || "Unknown",
      conversions: toNumber(entry, ["conversions", "converted", "totalConversions"]),
      revenue: toNumber(entry, ["revenue", "totalRevenue", "amount"]),
    }));
}

export const engagementService = {
  async getSalesDashboard(token: string, staffId: string, role: UserRole): Promise<SalesDashboardPayload> {
    const dashboardPath =
      role === "ADMIN" ? "/api/dashboard/admin/overview" : `/api/dashboard/staff/${staffId}`;

    const [dashboardResponse, leaderboardResponse] = await Promise.all([
      apiRequest<unknown | { data: unknown }>({
        service: "engagement",
        path: dashboardPath,
        token,
      }),
      apiRequest<unknown | { data: unknown }>({
        service: "engagement",
        path: "/api/retention/leaderboard",
        token,
      }),
    ]);

    return {
      metrics: mapDashboardMetrics(unwrapData<unknown>(dashboardResponse)),
      adminOverview: mapAdminOverviewMetrics(unwrapData<unknown>(dashboardResponse)),
      leaderboard: mapLeaderboard(unwrapData<unknown>(leaderboardResponse)),
    };
  },

  async getAttendanceByMember(token: string, memberId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/attendance/member/${memberId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getTodayAttendance(token: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/attendance/today",
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getFreezeHistory(token: string, memberId: string): Promise<FreezeHistoryEntry[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/retention/member/${memberId}/freeze/history`,
      token,
    });

    return mapFreezeHistory(unwrapData<unknown>(response));
  },
};
