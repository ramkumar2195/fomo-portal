import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";
import { UserRole } from "@/types/auth";
import {
  AdminMetricsResponse,
  DashboardDrilldownMetricType,
  DashboardDrilldownPeriod,
  DashboardDrilldownResponse,
  DashboardSearchInquiry,
  DashboardSearchMember,
  DashboardSearchResponse,
  DashboardSearchStaffLike,
  TrainerUtilizationResponse,
  TrainerUtilizationRow,
} from "@/types/admin";
import { AdminOverviewMetrics, DashboardMetrics, FreezeHistoryEntry, LeaderboardEntry } from "@/types/models";

interface SalesDashboardPayload {
  metrics: DashboardMetrics;
  adminOverview: AdminOverviewMetrics;
  leaderboard: LeaderboardEntry[];
}

export interface AttendanceReportSnapshot {
  fromDate?: string;
  toDate?: string;
  totalCheckIns: number;
  totalCheckOuts: number;
  currentlyInside: number;
  uniqueMembers: number;
  records: Record<string, unknown>[];
}

export interface BiometricDeviceRecord {
  id?: string;
  serialNumber: string;
  deviceName?: string;
  branchId?: string;
  branchCode?: string;
  status?: string;
  ipAddress?: string;
  lastPingAt?: string;
}

export interface BiometricAttendanceLogRecord {
  id?: string;
  deviceSerialNumber?: string;
  deviceUserId?: string;
  memberId?: string;
  punchTimestamp?: string;
  punchStatus?: string;
  verifyMode?: string;
  direction?: string;
  processed?: boolean;
}

export interface MemberBiometricEnrollmentRecord {
  enrollmentId?: string;
  memberId?: string;
  deviceSerialNumber?: string;
  pin?: string;
  memberName?: string;
  status?: string;
  lastAction?: string;
  lastCommandId?: string;
  lastActionAt?: string;
  lastSyncedAt?: string;
  lastResult?: string;
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

function mapBiometricDevice(payload: unknown): BiometricDeviceRecord {
  const data = toRecord(payload);
  return {
    id: toString(data, ["id"]) || undefined,
    serialNumber: toString(data, ["serialNumber", "deviceSerialNumber"]),
    deviceName: toString(data, ["deviceName"]) || undefined,
    branchId: toString(data, ["branchId"]) || undefined,
    branchCode: toString(data, ["branchCode"]) || undefined,
    status: toString(data, ["status"]) || undefined,
    ipAddress: toString(data, ["ipAddress"]) || undefined,
    lastPingAt: toString(data, ["lastPingAt"]) || undefined,
  };
}

function mapBiometricLog(payload: unknown): BiometricAttendanceLogRecord {
  const data = toRecord(payload);
  return {
    id: toString(data, ["id"]) || undefined,
    deviceSerialNumber: toString(data, ["deviceSerialNumber"]) || undefined,
    deviceUserId: toString(data, ["deviceUserId"]) || undefined,
    memberId: toString(data, ["memberId"]) || undefined,
    punchTimestamp: toString(data, ["punchTimestamp"]) || undefined,
    punchStatus: toString(data, ["punchStatus"]) || undefined,
    verifyMode: toString(data, ["verifyMode"]) || undefined,
    direction: toString(data, ["direction"]) || undefined,
    processed: Boolean(data.processed),
  };
}

function mapMemberBiometricEnrollment(payload: unknown): MemberBiometricEnrollmentRecord {
  const data = toRecord(payload);
  return {
    enrollmentId: toString(data, ["enrollmentId", "id"]) || undefined,
    memberId: toString(data, ["memberId"]) || undefined,
    deviceSerialNumber: toString(data, ["deviceSerialNumber"]) || undefined,
    pin: toString(data, ["pin"]) || undefined,
    memberName: toString(data, ["memberName"]) || undefined,
    status: toString(data, ["status"]) || undefined,
    lastAction: toString(data, ["lastAction"]) || undefined,
    lastCommandId: toString(data, ["lastCommandId"]) || undefined,
    lastActionAt: toString(data, ["lastActionAt"]) || undefined,
    lastSyncedAt: toString(data, ["lastSyncedAt"]) || undefined,
    lastResult: toString(data, ["lastResult"]) || undefined,
  };
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
      freezeFrom: toString(entry, ["freezeFrom", "startDate", "fromDate", "startAt", "freezeStartAt"]) || undefined,
      freezeTo: toString(entry, ["freezeTo", "endDate", "toDate", "endAt", "freezeEndAt"]) || undefined,
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

function mapAdminMetrics(payload: unknown): AdminMetricsResponse {
  const data = toRecord(payload);

  return {
    generatedAt: toString(data, ["generatedAt"]) || undefined,
    totalMembers: toNumber(data, ["totalMembers"]),
    activeMembers: toNumber(data, ["activeMembers"]),
    newMembersToday: toNumber(data, ["newMembersToday", "membersJoinedToday"]),
    totalLeadsToday: toNumber(data, ["totalLeadsToday", "leadsToday", "todaysLeads"]),
    conversionRate: toNumber(data, ["conversionRate", "leadConversionRate"]),
    revenueToday: toNumber(data, ["revenueToday", "todaysRevenue", "todayRevenue"]),
    monthlyRevenue: toNumber(data, ["monthlyRevenue"]),
    ptRevenue: toNumber(data, ["ptRevenue"]),
    programRevenue: toNumber(data, ["programRevenue"]),
    retentionRate: toNumber(data, ["retentionRate"]),
    trainerUtilization: toNumber(data, ["trainerUtilization"]),
    leadConversionRate: toNumber(data, ["leadConversionRate"]),
    activeSubscriptions: toNumber(data, ["activeSubscriptions"]),
    ptSessionsScheduledToday: toNumber(data, ["ptSessionsScheduledToday", "todayPtSessions"]),
    classesRunningToday: toNumber(data, ["classesRunningToday", "todayClasses"]),
    creditsExpiringSoon: toNumber(data, ["creditsExpiringSoon", "expiringCredits"]),
    trainerScheduleConflicts: toNumber(data, ["trainerScheduleConflicts", "scheduleConflicts"]),
    expiredMembers: toNumber(data, ["expiredMembers", "inactiveMembers"]),
    irregularMembers: toNumber(data, ["irregularMembers", "atRiskMembers", "inactiveMembers3To5Days"]),
    ptClients: toNumber(data, ["ptClients", "totalPtClients"]),
    todaysRevenue: toNumber(data, ["todaysRevenue", "todayRevenue", "revenueToday"]),
    todaysBirthdays: toNumber(data, ["todaysBirthdays", "todayBirthdays"]),
    upcomingRenewals7Days: toNumber(data, ["upcomingRenewals7Days", "renewalsNext7Days"]),
  };
}

function mapDashboardSearchMember(payload: unknown): DashboardSearchMember {
  const data = toRecord(payload);
  return {
    memberId: toString(data, ["memberId", "id"]),
    fullName: toString(data, ["fullName", "name"]),
    mobileNumber: toString(data, ["mobileNumber", "mobile"]),
    branchId: toString(data, ["branchId"]),
    branchName: toString(data, ["branchName"]),
  };
}

function mapDashboardSearchInquiry(payload: unknown): DashboardSearchInquiry {
  const data = toRecord(payload);
  return {
    inquiryId: toString(data, ["inquiryId", "id"]),
    fullName: toString(data, ["fullName", "name"]),
    mobileNumber: toString(data, ["mobileNumber", "mobile"]),
    status: toString(data, ["status"]),
    convertibility: toString(data, ["convertibility"]),
    branchCode: toString(data, ["branchCode"]),
  };
}

function mapDashboardSearchStaffLike(payload: unknown): DashboardSearchStaffLike {
  const data = toRecord(payload);
  return {
    id: toString(data, ["id", "staffId", "coachId"]),
    fullName: toString(data, ["fullName", "name"]),
    designation: toString(data, ["designation"]),
    mobileNumber: toString(data, ["mobileNumber", "mobile"]),
    branchId: toString(data, ["branchId"]),
    branchName: toString(data, ["branchName"]),
  };
}

function mapDashboardSearch(payload: unknown): DashboardSearchResponse {
  const data = toRecord(payload);
  const members = Array.isArray(data.members) ? data.members.map((item) => mapDashboardSearchMember(item)) : [];
  const inquiries = Array.isArray(data.inquiries) ? data.inquiries.map((item) => mapDashboardSearchInquiry(item)) : [];
  const staff = Array.isArray(data.staff) ? data.staff.map((item) => mapDashboardSearchStaffLike(item)) : [];
  const coaches = Array.isArray(data.coaches) ? data.coaches.map((item) => mapDashboardSearchStaffLike(item)) : [];
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim())).filter(Boolean)
    : [];

  return {
    members,
    inquiries,
    staff,
    coaches,
    warnings,
  };
}

function mapDashboardDrilldown(payload: unknown): DashboardDrilldownResponse {
  const data = toRecord(payload);
  const content = Array.isArray(data.content)
    ? data.content.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim())).filter(Boolean)
    : [];

  return {
    metricType: (toString(data, ["metricType"]) as DashboardDrilldownMetricType) || "ACTIVE_MEMBERS",
    status: toString(data, ["status"]) || null,
    period: toString(data, ["period"]) || undefined,
    fromDate: toString(data, ["fromDate"]) || undefined,
    toDate: toString(data, ["toDate"]) || undefined,
    page: toNumber(data, ["page", "number"]),
    size: toNumber(data, ["size"]),
    totalElements: toNumber(data, ["totalElements"]),
    totalPages: toNumber(data, ["totalPages"]),
    content,
    warnings,
  };
}

function mapTrainerUtilizationRow(payload: unknown): TrainerUtilizationRow {
  const data = toRecord(payload);
  return {
    trainerId: toString(data, ["trainerId", "id", "coachId", "staffId"]),
    trainerName: toString(data, ["trainerName", "name", "fullName"]),
    sessionsConducted: toNumber(data, ["sessionsConducted", "sessionCount", "sessions", "totalSessions"]),
    ptRevenue: toNumber(data, ["ptRevenue", "revenue", "totalRevenue", "monthlyRevenue"]),
    programSessions: toNumber(data, ["programSessions", "programSessionCount", "groupSessions", "classes"]),
    utilizationPercent: toNumber(data, ["utilizationPercent", "utilization", "utilizationRate"]),
    branchId: toString(data, ["branchId"]) || undefined,
    branchName: toString(data, ["branchName"]) || undefined,
    fromDate: toString(data, ["fromDate"]) || undefined,
    toDate: toString(data, ["toDate"]) || undefined,
  };
}

function mapTrainerUtilization(payload: unknown): TrainerUtilizationResponse {
  const data = toRecord(payload);
  const rawContent = Array.isArray(data.content)
    ? data.content
    : Array.isArray(data.rows)
      ? data.rows
      : Array.isArray(data.items)
        ? data.items
        : [];
  const content = rawContent.map((item) => mapTrainerUtilizationRow(item));
  return {
    branchId: toString(data, ["branchId"]) || undefined,
    fromDate: toString(data, ["fromDate"]) || undefined,
    toDate: toString(data, ["toDate"]) || undefined,
    page: toNumber(data, ["page", "number", "pageNumber"]),
    size: toNumber(data, ["size", "pageSize"]),
    totalElements: toNumber(data, ["totalElements"]),
    totalPages: toNumber(data, ["totalPages"]),
    content,
  };
}

function mapDashboardMetrics(payload: unknown): DashboardMetrics {
  const data = toRecord(payload);

  return {
    todaysInquiries: toNumber(data, ["todaysInquiries", "todayInquiries", "inquiriesToday", "inquiries"]),
    followUpsDue: toNumber(data, ["followUpsDue", "dueFollowUps", "pendingFollowUps"]),
    conversionRate: toNumber(data, ["conversionRate", "conversion", "conversionPercentage", "leadConversionRate"]),
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
  async getAdminMetrics(token: string): Promise<AdminMetricsResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/dashboard/admin/metrics",
      token,
    });

    return mapAdminMetrics(unwrapData<unknown>(response));
  },

  async getAdminDashboardSearch(
    token: string,
    query: {
      query?: string;
      branchId?: string | number;
      limit?: number;
    } = {},
  ): Promise<DashboardSearchResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/dashboard/admin/search",
      token,
      query: {
        query: query.query,
        branchId: query.branchId,
        limit: query.limit,
      },
    });

    return mapDashboardSearch(unwrapData<unknown>(response));
  },

  async getAdminDashboardDrilldown(
    token: string,
    query: {
      metricType: DashboardDrilldownMetricType;
      branchId?: string | number;
      status?: string;
      period?: DashboardDrilldownPeriod;
      from?: string;
      to?: string;
      page?: number;
      size?: number;
    },
  ): Promise<DashboardDrilldownResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/dashboard/admin/drilldown",
      token,
      query: {
        metricType: query.metricType,
        branchId: query.branchId,
        status: query.status,
        period: query.period,
        from: query.from,
        to: query.to,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapDashboardDrilldown(unwrapData<unknown>(response));
  },

  async getTrainerUtilization(
    token: string,
    query: {
      branchId?: string | number;
      from?: string;
      to?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<TrainerUtilizationResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/dashboard/admin/trainer-utilization",
      token,
      query: {
        branchId: query.branchId,
        from: query.from,
        to: query.to,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapTrainerUtilization(unwrapData<unknown>(response));
  },

  async getSalesDashboard(token: string, staffId: string, role: UserRole): Promise<SalesDashboardPayload> {
    const dashboardPath = role === "ADMIN" ? "/api/dashboard/admin/metrics" : `/api/dashboard/staff/${staffId}`;

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

  async getStaffDashboard(token: string, staffId: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/dashboard/staff/${staffId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getAttendanceByMember(
    token: string,
    memberId: string,
    query: {
      from?: string;
      to?: string;
    } = {},
  ): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/attendance/member/${memberId}`,
      token,
      query,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getCreditsWallet(token: string, memberId: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/credits/wallet/${memberId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getCreditsLedger(token: string, memberId: string, page = 0, size = 20): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/credits/ledger/${memberId}`,
      token,
      query: {
        page,
        size,
      },
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getCreditsExpiring(token: string, memberId: string, withinDays: number): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/credits/expiring/${memberId}`,
      token,
      query: {
        withinDays,
      },
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getCreditRules(token: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/credits/rules",
      token,
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getCommunityFeed(token: string, page = 0, size = 10): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/community/feed",
      token,
      query: {
        page,
        size,
      },
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getMemberProgressSummary(token: string, memberId: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/progress/summary/member/${memberId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getMemberProgressMeasurements(token: string, memberId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/progress/measurements/member/${memberId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getMemberProgressPhotos(token: string, memberId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/progress/photos/member/${memberId}`,
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

  async activateFreeze(
    token: string,
    memberId: string | number,
    payload: { subscriptionId?: number; freezeDays: number; creditsCost?: number; reason?: string },
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/retention/member/${memberId}/freeze`,
      token,
      method: "POST",
      body: payload,
    });

    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  // ── Credits CRUD ──────────────────────────────────────────────────

  async awardCredits(token: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/credits/award",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async adjustCredits(token: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/credits/adjust",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async createCreditRule(token: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/credits/rules",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async patchCreditRuleActive(token: string, ruleId: number, active: boolean): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/credits/rules/${ruleId}/active`,
      token,
      method: "PATCH",
      body: { active },
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async bootstrapDefaultRules(token: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/credits/rules/bootstrap-defaults",
      token,
      method: "POST",
      body: {},
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  // ── Community CRUD ────────────────────────────────────────────────

  async createPost(token: string, payload: { content: string; title?: string }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/community/posts",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async updatePost(token: string, postId: number, payload: { content?: string; title?: string }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}`,
      token,
      method: "PATCH",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async deletePost(token: string, postId: number): Promise<void> {
    await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}`,
      token,
      method: "DELETE",
    });
  },

  async getPostComments(token: string, postId: number): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}/comments`,
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async createComment(token: string, postId: number, payload: { content: string }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}/comments`,
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async likePost(token: string, postId: number): Promise<void> {
    await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}/likes`,
      token,
      method: "POST",
      body: {},
    });
  },

  async unlikePost(token: string, postId: number): Promise<void> {
    await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/community/posts/${postId}/likes`,
      token,
      method: "DELETE",
    });
  },

  // ── Attendance CRUD ───────────────────────────────────────────────

  async scanQrAttendance(token: string, payload: { token: string; gymId: number; staffId: number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/attendance/scan",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async checkoutAttendance(
    token: string,
    checkInId: number,
    payload: { staffId: number; notes?: string },
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/attendance/${checkInId}/checkout`,
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async getAttendanceReport(
    token: string,
    query: { from?: string; to?: string; gymId?: string | number; memberId?: string | number } = {},
  ): Promise<AttendanceReportSnapshot> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/attendance/report",
      token,
      query,
    });
    const payload = toRecord(unwrapData<unknown>(response));
    const records = Array.isArray(payload.records)
      ? payload.records.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : [];
    return {
      fromDate: toString(payload, ["fromDate"]) || undefined,
      toDate: toString(payload, ["toDate"]) || undefined,
      totalCheckIns: toNumber(payload, ["totalCheckIns"]),
      totalCheckOuts: toNumber(payload, ["totalCheckOuts"]),
      currentlyInside: toNumber(payload, ["currentlyInside"]),
      uniqueMembers: toNumber(payload, ["uniqueMembers"]),
      records,
    };
  },

  async listBiometricDevices(token: string): Promise<BiometricDeviceRecord[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/devices",
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload.map((item) => mapBiometricDevice(item)).filter((item) => item.serialNumber) : [];
  },

  async getBiometricLogs(token: string, hours = 168): Promise<BiometricAttendanceLogRecord[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/logs",
      token,
      query: { hours },
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload.map((item) => mapBiometricLog(item)) : [];
  },

  async getMemberBiometricEnrollments(token: string, memberId: string | number): Promise<MemberBiometricEnrollmentRecord[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/member-enrollments",
      token,
      query: { memberId },
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload.map((item) => mapMemberBiometricEnrollment(item)) : [];
  },

  async enrollBiometricUser(token: string, payload: { serialNumber: string; pin: string; name: string; memberId?: string | number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/enroll-user",
      token,
      method: "POST",
      query: {
        SN: payload.serialNumber,
        pin: payload.pin,
        name: payload.name,
        memberId: payload.memberId,
      },
    });
    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  async reAddBiometricUser(token: string, payload: { serialNumber: string; pin: string; name: string; memberId?: string | number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/readd-user",
      token,
      method: "POST",
      query: {
        SN: payload.serialNumber,
        pin: payload.pin,
        name: payload.name,
        memberId: payload.memberId,
      },
    });
    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  async blockBiometricUser(token: string, payload: { serialNumber: string; pin: string; name: string; memberId?: string | number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/block-user",
      token,
      method: "POST",
      query: {
        SN: payload.serialNumber,
        pin: payload.pin,
        name: payload.name,
        memberId: payload.memberId,
      },
    });
    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  async unblockBiometricUser(token: string, payload: { serialNumber: string; pin: string; name: string; memberId?: string | number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/unblock-user",
      token,
      method: "POST",
      query: {
        SN: payload.serialNumber,
        pin: payload.pin,
        name: payload.name,
        memberId: payload.memberId,
      },
    });
    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  async deleteBiometricUser(token: string, payload: { serialNumber: string; pin: string; memberId?: string | number }): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/iclock/admin/delete-user",
      token,
      method: "POST",
      query: {
        SN: payload.serialNumber,
        pin: payload.pin,
        memberId: payload.memberId,
      },
    });
    const data = unwrapData<unknown>(response);
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  },

  // ── Automation & Gamification ─────────────────────────────────────

  async listAutomationRules(token: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/automation/rules",
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async createAutomationRule(token: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/automation/rules",
      token,
      method: "POST",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async updateAutomationRule(token: string, ruleId: number, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/automation/rules/${ruleId}`,
      token,
      method: "PATCH",
      body: payload,
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async deleteAutomationRule(token: string, ruleId: number): Promise<void> {
    await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/automation/rules/${ruleId}`,
      token,
      method: "DELETE",
    });
  },

  async triggerDailyRun(token: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/automation/jobs/daily-run",
      token,
      method: "POST",
      body: {},
    });
    const p = unwrapData<unknown>(response);
    return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : {};
  },

  async getGamificationLeaderboard(token: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/automation/leaderboard/monthly",
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getAtRiskMembers(token: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: "/api/automation/risk/at-risk",
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },
};
