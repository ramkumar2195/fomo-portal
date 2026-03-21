import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import { maskMobile, pushAuthDebug, tokenPreview } from "@/lib/debug/auth-debug";
import {
  AccessMetadata,
  AuthUser,
  DataScope,
  EmploymentType,
  LoginRequest,
  LoginResponse,
  UserDesignation,
  UserRole,
} from "@/types/auth";
import {
  DashboardDrilldownEntityType,
  DashboardDrilldownMetricKey,
  DashboardDrilldownMemberRow,
  DashboardDrilldownRevenueRow,
  DashboardDrilldownStaffLikeRow,
  DashboardDrilldownSubscriptionRow,
  SuperAdminDashboardDrilldownResponse,
  SuperAdminDashboardResponse,
  UserDirectoryItem,
} from "@/types/models";
import {
  MemberContextResponse,
  MemberFitnessFormPayload,
  MemberFitnessFormStatusResponse,
  MemberNotesResponse,
  MemberProfileShellResponse,
  MemberProfileShellTab,
} from "@/types/member-profile";

const USERS_API_PREFIX = process.env.NEXT_PUBLIC_USERS_API_PREFIX || "/api/users";

interface LoginTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType?: string;
}

interface RefreshTokenRequest {
  refreshToken: string;
}

interface JwtClaims {
  sub?: string;
  name?: string;
  given_name?: string;
  preferred_username?: string;
  realm_access?: {
    roles?: string[];
  };
}

interface BackendUserPayload {
  id?: string;
  userId?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  mobile?: string;
  mobileNumber?: string;
  phone?: string;
  role?: string;
  roles?: string[];
  employmentType?: string;
  designation?: string;
  dataScope?: string;
  active?: boolean;
  email?: string;
  defaultBranchId?: string | number;
  defaultTrainerStaffId?: string | number;
  sourceInquiryId?: string | number;
  branchId?: string | number;
  branchCode?: string | number;
}

export interface UserSearchQuery {
  role?: UserRole;
  active?: boolean;
  query?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  defaultBranchId?: string;
  [key: string]: string | boolean | undefined;
}

export interface RegisterUserRequest {
  fullName: string;
  mobileNumber: string;
  password: string;
  role: UserRole;
  email?: string;
  sourceInquiryId?: number;
  defaultBranchId?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  active?: boolean;
  alternateMobileNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  defaultTrainerStaffId?: string;
}

export interface UpdateUserRequest {
  name?: string;
  mobileNumber?: string;
  password?: string;
  role?: UserRole;
  email?: string;
  defaultBranchId?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  active?: boolean;
  alternateMobileNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  defaultTrainerStaffId?: string;
}

export interface StaffAttendanceReportQuery {
  staffId?: string | number;
  from?: string;
  to?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface StaffLeaveRequestsQuery {
  staffId?: string | number;
  status?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface TrainerAttendanceReportQuery {
  trainerId?: string | number;
  from?: string;
  to?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface TrainerLeaveRequestsQuery {
  trainerId?: string | number;
  status?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface CreateLeaveRequestPayload {
  staffId?: number;
  trainerId?: number;
  requestedByStaffId?: number;
  leaveType: string;
  fromDate: string;
  toDate: string;
  branchCode?: string;
  reason?: string;
}

export interface ClockInPayload {
  staffId?: number;
  trainerId?: number;
  branchCode?: string;
  notes?: string;
}

export interface ClockOutPayload {
  sessionsCompleted?: number;
  notes?: string;
}

export interface SuperAdminDashboardDrilldownQuery {
  metricKey: DashboardDrilldownMetricKey;
  branchId?: number;
  query?: string;
  page?: number;
  size?: number;
}

const VALID_ROLES: UserRole[] = ["ADMIN", "STAFF", "COACH", "MEMBER"];
const VALID_EMPLOYMENT_TYPES: EmploymentType[] = ["INTERNAL", "VENDOR"];
const VALID_DATA_SCOPES: DataScope[] = ["GLOBAL", "BRANCH", "ASSIGNED_ONLY"];
const VALID_DESIGNATIONS: UserDesignation[] = [
  "SUPER_ADMIN",
  "GYM_MANAGER",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "FRONT_DESK_EXECUTIVE",
  "FITNESS_MANAGER",
  "HEAD_COACH",
  "PT_COACH",
  "YOGA_INSTRUCTOR",
  "ZUMBA_INSTRUCTOR",
  "BOXING_INSTRUCTOR",
  "FREELANCE_TRAINER",
  "MEMBER",
];

const STAFF_DESIGNATIONS = new Set<UserDesignation>([
  "GYM_MANAGER",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "FRONT_DESK_EXECUTIVE",
  "FITNESS_MANAGER",
]);

const COACH_DESIGNATIONS = new Set<UserDesignation>([
  "HEAD_COACH",
  "PT_COACH",
  "YOGA_INSTRUCTOR",
  "ZUMBA_INSTRUCTOR",
  "BOXING_INSTRUCTOR",
  "FREELANCE_TRAINER",
]);

function decodeJwtClaims(accessToken: string): JwtClaims {
  const segments = accessToken.split(".");
  if (segments.length < 2) {
    return {};
  }

  try {
    const base64Url = segments[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    if (typeof globalThis.atob !== "function") {
      return {};
    }

    return JSON.parse(globalThis.atob(padded)) as JwtClaims;
  } catch {
    return {};
  }
}

function normalizeRole(role?: string): UserRole | undefined {
  if (!role) {
    return undefined;
  }

  const normalized = role.toUpperCase() as UserRole;
  return VALID_ROLES.includes(normalized) ? normalized : undefined;
}

function normalizeEmploymentType(value?: string): EmploymentType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as EmploymentType;
  return VALID_EMPLOYMENT_TYPES.includes(normalized) ? normalized : undefined;
}

function normalizeDesignation(value?: string): UserDesignation | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as UserDesignation;
  return VALID_DESIGNATIONS.includes(normalized) ? normalized : undefined;
}

function normalizeDataScope(value?: string): DataScope | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as DataScope;
  return VALID_DATA_SCOPES.includes(normalized) ? normalized : undefined;
}

function roleFromClaims(claims: JwtClaims): UserRole {
  const roles = (claims.realm_access?.roles || []).map((role) => role.toUpperCase());
  if (roles.includes("ADMIN")) {
    return "ADMIN";
  }

  if (roles.includes("STAFF")) {
    return "STAFF";
  }

  if (roles.includes("COACH")) {
    return "COACH";
  }

  if (roles.includes("MEMBER")) {
    return "MEMBER";
  }

  return "STAFF";
}

function roleFromDesignation(value?: string): UserRole | undefined {
  const designation = normalizeDesignation(value);
  if (!designation) {
    return undefined;
  }

  if (designation === "SUPER_ADMIN") {
    return "ADMIN";
  }

  if (designation === "MEMBER") {
    return "MEMBER";
  }

  if (STAFF_DESIGNATIONS.has(designation)) {
    return "STAFF";
  }

  if (COACH_DESIGNATIONS.has(designation)) {
    return "COACH";
  }

  return undefined;
}

function getUserRole(
  payload: BackendUserPayload,
  fallbackRole?: UserRole,
  fallbackDesignation?: UserDesignation,
): UserRole {
  const roleFromPayload = normalizeRole(payload.role);
  if (roleFromPayload) {
    return roleFromPayload;
  }

  const firstRole = payload.roles
    ?.filter((role): role is string => typeof role === "string")
    .map((role) => normalizeRole(role))
    .find((role): role is UserRole => Boolean(role));

  if (firstRole) {
    return firstRole;
  }

  const roleFromPayloadDesignation = roleFromDesignation(payload.designation);
  if (roleFromPayloadDesignation) {
    return roleFromPayloadDesignation;
  }

  const roleFromFallbackDesignation = roleFromDesignation(fallbackDesignation);
  if (roleFromFallbackDesignation) {
    return roleFromFallbackDesignation;
  }

  return fallbackRole || "STAFF";
}

function mapAuthUser(payload: BackendUserPayload, fallback: Partial<AuthUser> = {}): AuthUser {
  const mobile = payload.mobile || payload.mobileNumber || payload.phone || fallback.mobile || "";
  const name = payload.name || payload.fullName || payload.displayName || fallback.name || "Staff";
  const id = payload.id || payload.userId || fallback.id || mobile || "unknown";
  const role = getUserRole(payload, fallback.role, fallback.designation);
  const designation =
    normalizeDesignation(payload.designation) ||
    fallback.designation ||
    (role === "ADMIN" ? "SUPER_ADMIN" : role === "MEMBER" ? "MEMBER" : undefined);

  return {
    id,
    name,
    mobile,
    role,
    employmentType: normalizeEmploymentType(payload.employmentType) || fallback.employmentType,
    designation,
    dataScope: normalizeDataScope(payload.dataScope) || fallback.dataScope,
    defaultBranchId:
      (payload.defaultBranchId !== undefined
        ? String(payload.defaultBranchId)
        : payload.branchId !== undefined
          ? String(payload.branchId)
          : payload.branchCode !== undefined
            ? String(payload.branchCode)
            : fallback.defaultBranchId) || undefined,
  };
}

function mapDirectoryUser(payload: BackendUserPayload): UserDirectoryItem {
  const defaultBranchId =
    payload.defaultBranchId !== undefined
      ? String(payload.defaultBranchId)
      : payload.branchId !== undefined
        ? String(payload.branchId)
        : payload.branchCode !== undefined
          ? String(payload.branchCode)
          : undefined;

  return {
    id: payload.id || payload.userId || "",
    name: payload.fullName || payload.name || payload.displayName || "Unknown",
    mobile: payload.mobile || payload.mobileNumber || payload.phone || "-",
    role: payload.role || payload.roles?.[0] || "UNKNOWN",
    email: payload.email,
    active: payload.active,
    employmentType: payload.employmentType,
    designation: payload.designation,
    dataScope: payload.dataScope,
    defaultBranchId,
    defaultTrainerStaffId:
      payload.defaultTrainerStaffId !== undefined ? String(payload.defaultTrainerStaffId) : undefined,
    sourceInquiryId:
      payload.sourceInquiryId !== undefined ? String(payload.sourceInquiryId) : undefined,
  };
}

function mapDirectoryUsers(payload: unknown): UserDirectoryItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((item): item is BackendUserPayload => typeof item === "object" && item !== null)
    .map((item) => mapDirectoryUser(item));
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function toNumber(payload: Record<string, unknown>, keys: string[]): number {
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

function toString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

function toStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function toOptionalString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  const value = toString(payload, keys);
  return value || undefined;
}

function toBoolean(payload: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
  }

  return false;
}

function normalizeDashboardDrilldownEntityType(value: unknown): DashboardDrilldownEntityType {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  switch (normalized) {
    case "MEMBER":
    case "SUBSCRIPTION":
    case "REVENUE":
    case "STAFF":
    case "COACH":
      return normalized;
    default:
      return "MEMBER";
  }
}

function mapDashboardDrilldownMemberRow(payload: unknown): DashboardDrilldownMemberRow {
  const record = toRecord(payload);
  return {
    memberId: toString(record, ["memberId", "id"]),
    fullName: toString(record, ["fullName", "memberName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    branchId: toString(record, ["branchId"]) || undefined,
    branchName: toString(record, ["branchName"]) || undefined,
    activePlan: toString(record, ["activePlan", "planName"]) || undefined,
    memberStatus: toString(record, ["memberStatus", "status"]) || undefined,
    paymentStatus: toString(record, ["paymentStatus"]) || undefined,
    attendancePercent: toNumber(record, ["attendancePercent"]),
    ptClient: toBoolean(record, ["ptClient"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
  };
}

function mapDashboardDrilldownSubscriptionRow(payload: unknown): DashboardDrilldownSubscriptionRow {
  const record = toRecord(payload);
  return {
    subscriptionId: toString(record, ["subscriptionId", "id"]),
    memberId: toString(record, ["memberId"]) || undefined,
    memberName: toString(record, ["memberName", "fullName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    branchId: toString(record, ["branchId"]) || undefined,
    branchName: toString(record, ["branchName"]) || undefined,
    planName: toString(record, ["planName", "activePlan"]) || undefined,
    status: toString(record, ["status"]) || undefined,
    startDate: toString(record, ["startDate"]) || undefined,
    endDate: toString(record, ["endDate"]) || undefined,
    amount: toNumber(record, ["amount"]),
  };
}

function mapDashboardDrilldownRevenueRow(payload: unknown): DashboardDrilldownRevenueRow {
  const record = toRecord(payload);
  return {
    invoiceId: toString(record, ["invoiceId"]) || undefined,
    receiptId: toString(record, ["receiptId"]) || undefined,
    memberId: toString(record, ["memberId"]) || undefined,
    memberName: toString(record, ["memberName", "fullName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    branchId: toString(record, ["branchId"]) || undefined,
    branchName: toString(record, ["branchName"]) || undefined,
    amount: toNumber(record, ["amount"]),
    collectedAt: toString(record, ["collectedAt", "createdAt"]) || undefined,
    paymentStatus: toString(record, ["paymentStatus", "status"]) || undefined,
    paymentMode: toString(record, ["paymentMode"]) || undefined,
    referenceType: toString(record, ["referenceType"]) || undefined,
    referenceId: toString(record, ["referenceId"]) || undefined,
  };
}

function mapDashboardDrilldownStaffLikeRow(payload: unknown): DashboardDrilldownStaffLikeRow {
  const record = toRecord(payload);
  return {
    id: toString(record, ["id", "userId"]),
    fullName: toString(record, ["fullName", "name", "displayName"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    designation: toString(record, ["designation"]) || undefined,
    role: toString(record, ["role"]) || undefined,
    active: toBoolean(record, ["active"]),
    branchId: toString(record, ["branchId", "defaultBranchId"]) || undefined,
    branchName: toString(record, ["branchName"]) || undefined,
    employmentType: toString(record, ["employmentType"]) || undefined,
    dataScope: toString(record, ["dataScope"]) || undefined,
  };
}

function mapSuperAdminDashboardDrilldown(payload: unknown): SuperAdminDashboardDrilldownResponse {
  const record = toRecord(payload);
  const entityType = normalizeDashboardDrilldownEntityType(record.entityType);
  const rawContent = Array.isArray(record.content) ? record.content : [];
  const content =
    entityType === "MEMBER"
      ? rawContent.map((item) => mapDashboardDrilldownMemberRow(item))
      : entityType === "SUBSCRIPTION"
        ? rawContent.map((item) => mapDashboardDrilldownSubscriptionRow(item))
        : entityType === "REVENUE"
          ? rawContent.map((item) => mapDashboardDrilldownRevenueRow(item))
          : rawContent.map((item) => mapDashboardDrilldownStaffLikeRow(item));

  return {
    metricKey: toString(record, ["metricKey"]) as DashboardDrilldownMetricKey,
    entityType,
    generatedAt: toString(record, ["generatedAt"]) || undefined,
    number: toNumber(record, ["number"]),
    size: toNumber(record, ["size"]),
    totalElements: toNumber(record, ["totalElements"]),
    totalPages: toNumber(record, ["totalPages"]),
    first: toBoolean(record, ["first"]),
    last: toBoolean(record, ["last"]),
    content,
    warnings: toStringArray(record, "warnings"),
  };
}

function mapSuperAdminDashboard(payload: unknown): SuperAdminDashboardResponse {
  const record = toRecord(payload);
  const summary = toRecord(record.summary);
  const summaryMembers = toRecord(summary.members);
  const summaryPt = toRecord(summary.pt);
  const summaryRevenue = toRecord(summary.revenue);
  const summarySubscriptions = toRecord(summary.subscriptions);
  const summaryNewMembers = toRecord(summary.newMembers);
  const summaryStaff = toRecord(summary.staff);
  const summaryCoaches = toRecord(summary.coaches);
  const metrics = toRecord(record.metrics);
  const inquiryAnalytics = toRecord(record.inquiryAnalytics);
  const alerts = toRecord(record.alerts);
  const users = toRecord(record.users);
  const inquiries = toRecord(record.inquiries);
  const revenue = toRecord(record.revenue);
  const subscriptions = toRecord(record.subscriptions);
  const engagement = toRecord(record.engagement);
  const rawMultiBranchInsights = Array.isArray(record.multiBranchInsights) ? record.multiBranchInsights : [];
  const multiBranchInsights = rawMultiBranchInsights
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      branchId: toNumber(item, ["branchId", "id"]),
      branchName: toString(item, ["branchName", "name"]) || "Branch",
      branchCode: toString(item, ["branchCode", "code"]) || undefined,
      revenue: toNumber(item, ["revenue", "totalCollected", "amount"]),
      members: toNumber(item, ["members", "totalMembers", "activeMembers"]),
      leads: toNumber(item, ["leads", "totalInquiries"]),
      converted: toNumber(item, ["converted", "convertedInquiries"]),
      conversionRate: toNumber(item, ["conversionRate"]),
      followUpsDueToday: toNumber(item, ["followUpsDueToday"]),
      followUpsOverdue: toNumber(item, ["followUpsOverdue"]),
    }));

  const statusDistributionValue = inquiryAnalytics.statusDistribution;
  const sourceDistributionValue = inquiryAnalytics.sourceDistribution;
  const totalInquiries = toNumber(inquiryAnalytics, ["totalInquiries"]);
  const convertedInquiries = toNumber(inquiryAnalytics, ["convertedInquiries"]);
  const activeSubscriptions = toNumber(subscriptions, ["activeSubscriptions"]) || toNumber(summarySubscriptions, ["activeSubscriptions"]);
  const expiringSoon = toNumber(alerts, ["membershipsExpiringSoon"]) || toNumber(subscriptions, ["expiringIn7Days"]);
  const revenueToday = toNumber(revenue, ["todayCollected"]) || toNumber(summaryRevenue, ["revenueToday"]);
  const revenueThisMonth = toNumber(revenue, ["monthCollected"]) || toNumber(summaryRevenue, ["revenueThisMonth"]);
  const revenueThisYear = toNumber(revenue, ["yearCollected"]) || toNumber(summaryRevenue, ["revenueThisYear"]);
  const revenueLifetime = toNumber(revenue, ["lifetimeCollected"]) || toNumber(summaryRevenue, ["revenueLifetime"]);

  return {
    generatedAt: toString(record, ["generatedAt"]) || undefined,
    summary: {
      members: {
        totalMembers: toNumber(summaryMembers, ["totalMembers"]),
        activeMembers: toNumber(summaryMembers, ["activeMembers"]),
        inactiveMembers: toNumber(summaryMembers, ["inactiveMembers"]),
        expiredMembers: toNumber(summaryMembers, ["expiredMembers"]),
        irregularMembers: toNumber(summaryMembers, ["irregularMembers"]),
      },
      pt: {
        ptClients: toNumber(summaryPt, ["ptClients"]),
        ptActiveClients: toNumber(summaryPt, ["ptActiveClients"]),
        ptInactiveClients: toNumber(summaryPt, ["ptInactiveClients"]),
      },
      revenue: {
        revenueToday: toNumber(summaryRevenue, ["revenueToday"]),
        revenueThisMonth: toNumber(summaryRevenue, ["revenueThisMonth"]),
        revenueThisYear: toNumber(summaryRevenue, ["revenueThisYear"]),
        revenueLifetime: toNumber(summaryRevenue, ["revenueLifetime"]),
      },
      subscriptions: {
        activeSubscriptions: toNumber(summarySubscriptions, ["activeSubscriptions"]),
      },
      newMembers: {
        today: toNumber(summaryNewMembers, ["today"]),
        month: toNumber(summaryNewMembers, ["month"]),
      },
      staff: {
        totalStaff: toNumber(summaryStaff, ["totalStaff"]),
        activeStaff: toNumber(summaryStaff, ["activeStaff"]),
      },
      coaches: {
        totalCoaches: toNumber(summaryCoaches, ["totalCoaches"]),
        activeCoaches: toNumber(summaryCoaches, ["activeCoaches"]),
      },
    },
    metrics: {
      totalMembers: toNumber(metrics, ["totalMembers"]),
      activeMembers: toNumber(metrics, ["activeMembers"]),
      expiredMembers: toNumber(metrics, ["expiredMembers"]),
      irregularMembers: toNumber(metrics, ["irregularMembers"]),
      ptClients: toNumber(metrics, ["ptClients"]),
      ptActiveClients: toNumber(metrics, ["ptActiveClients"]),
      ptInactiveClients: toNumber(metrics, ["ptInactiveClients"]),
      newMembersToday: toNumber(metrics, ["newMembersToday"]),
      totalLeadsToday: toNumber(metrics, ["totalLeadsToday"]),
      conversionRate: toNumber(metrics, ["conversionRate"]),
      revenueToday: toNumber(metrics, ["revenueToday"]),
      revenueThisMonth: toNumber(metrics, ["revenueThisMonth", "monthlyRevenue"]),
      revenueThisYear: toNumber(metrics, ["revenueThisYear", "yearRevenue"]),
      revenueLifetime: toNumber(metrics, ["revenueLifetime", "lifetimeRevenue"]),
      activeSubscriptions: toNumber(metrics, ["activeSubscriptions"]),
      ptSessionsScheduledToday: toNumber(metrics, ["ptSessionsScheduledToday"]),
      classesRunningToday: toNumber(metrics, ["classesRunningToday"]),
    },
    inquiryAnalytics: {
      totalInquiries,
      convertedInquiries,
      statusDistribution:
        Array.isArray(statusDistributionValue) || (typeof statusDistributionValue === "object" && statusDistributionValue !== null)
          ? (statusDistributionValue as unknown[] | Record<string, unknown>)
          : [],
      sourceDistribution:
        Array.isArray(sourceDistributionValue) || (typeof sourceDistributionValue === "object" && sourceDistributionValue !== null)
          ? (sourceDistributionValue as unknown[] | Record<string, unknown>)
          : [],
    },
    multiBranchInsights,
    alerts: {
      membershipsExpiringSoon: toNumber(alerts, ["membershipsExpiringSoon"]),
      followUpsDueToday: toNumber(alerts, ["followUpsDueToday"]),
      followUpsOverdue: toNumber(alerts, ["followUpsOverdue"]),
      creditsExpiringSoon: toNumber(alerts, ["creditsExpiringSoon"]),
      trainerScheduleConflicts: toNumber(alerts, ["trainerScheduleConflicts"]),
    },
    users: {
      totalUsers: toNumber(users, ["totalUsers"]),
      totalMembers: toNumber(users, ["totalMembers"]),
      totalStaff: toNumber(users, ["totalStaff"]),
      totalCoaches: toNumber(users, ["totalCoaches"]),
      activeMembers: toNumber(users, ["activeMembers"]),
      inactiveMembers: toNumber(users, ["inactiveMembers"]),
      activeStaff: toNumber(users, ["activeStaff"]),
      activeCoaches: toNumber(users, ["activeCoaches"]),
    },
    inquiries: {
      total: toNumber(inquiries, ["total"]) || totalInquiries,
      open: toNumber(inquiries, ["open"]),
      converted: toNumber(inquiries, ["converted"]) || convertedInquiries,
      closed: toNumber(inquiries, ["closed"]),
      followUpsDueToday: toNumber(inquiries, ["followUpsDueToday"]) || toNumber(alerts, ["followUpsDueToday"]),
      followUpsOverdue: toNumber(inquiries, ["followUpsOverdue"]) || toNumber(alerts, ["followUpsOverdue"]),
    },
    revenue: {
      todayCollected: revenueToday,
      monthCollected: revenueThisMonth,
      yearCollected: revenueThisYear,
      lifetimeCollected: revenueLifetime,
      monthOutstanding: toNumber(revenue, ["monthOutstanding"]),
      yearOutstanding: toNumber(revenue, ["yearOutstanding"]),
      lifetimeOutstanding: toNumber(revenue, ["lifetimeOutstanding"]),
      monthAverageInvoiceValue: toNumber(revenue, ["monthAverageInvoiceValue"]),
    },
    subscriptions: {
      activeSubscriptions,
      ptClients: toNumber(subscriptions, ["ptClients"]),
      expiringIn7Days: expiringSoon,
      expiringIn30Days: toNumber(subscriptions, ["expiringIn30Days"]),
      expiredSubscriptions: toNumber(subscriptions, ["expiredSubscriptions"]),
      balanceDueInvoices: toNumber(subscriptions, ["balanceDueInvoices"]),
      balanceDueAmount: toNumber(subscriptions, ["balanceDueAmount"]),
    },
    engagement: {
      todayCheckIns: toNumber(engagement, ["todayCheckIns"]),
      currentlyInside: toNumber(engagement, ["currentlyInside"]),
      onlineUsers: toNumber(engagement, ["onlineUsers"]),
      atRiskMembers: toNumber(engagement, ["atRiskMembers"]),
      inactiveMembers3To5Days: toNumber(engagement, ["inactiveMembers3To5Days"]),
      inactiveMembers5PlusDays: toNumber(engagement, ["inactiveMembers5PlusDays"]),
    },
    warnings: toStringArray(record, "warnings"),
  };
}

function normalizeMemberProfileTabKey(value: string): MemberProfileShellTab["key"] | null {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  switch (normalized) {
    case "overview":
      return "overview";
    case "subscriptions":
      return "subscriptions";
    case "billing":
      return "billing";
    case "attendance":
      return "attendance";
    case "credits-wallet":
    case "credits":
    case "wallet":
      return "credits-wallet";
    case "recovery-services":
    case "recovery":
      return "recovery-services";
    case "personal-training":
    case "pt":
      return "personal-training";
    case "progress":
      return "progress";
    case "freeze-history":
    case "freeze":
      return "freeze-history";
    case "notes":
      return "notes";
    case "fitness-assessment":
    case "fitness":
    case "assessment":
      return "fitness-assessment";
    default:
      return null;
  }
}

function mapMemberProfileTabs(payload: unknown): MemberProfileShellTab[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record) => {
      const rawKey = toString(record, ["key", "tabKey", "id", "name", "label"]);
      const key = rawKey ? normalizeMemberProfileTabKey(rawKey) : null;
      if (!key) {
        return null;
      }

      return {
        key,
        label: toString(record, ["label", "name", "title"]) || rawKey,
        endpoint:
          toOptionalString(record, ["endpoint", "path", "url"]) ||
          (Array.isArray(record.endpoints) && typeof record.endpoints[0] === "string" ? record.endpoints[0] : undefined),
        enabled: record.enabled === undefined ? true : toBoolean(record, ["enabled", "available"]),
      } as MemberProfileShellTab;
    })
    .filter((item) => item !== null);
}

function mapMemberProfileShell(payload: unknown): MemberProfileShellResponse {
  const record = toRecord(payload);
  const summary = toRecord(record.memberSummary ?? record.member ?? record.summary ?? record);
  const overview = toRecord(record.overview);
  const tabs = mapMemberProfileTabs(record.tabs);
  const memberId = toString(record, ["memberId", "id"]) || toString(summary, ["memberId", "id", "userId"]);

  return {
    memberId,
    fullName:
      toString(record, ["fullName", "name", "displayName"]) ||
      toString(summary, ["fullName", "name", "displayName"]) ||
      toString(overview, ["fullName", "name"]) ||
      `Member #${memberId}`,
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]) || toString(summary, ["mobileNumber", "mobile", "phone"]),
    email: toOptionalString(record, ["email"]) || toOptionalString(summary, ["email"]),
    status: toOptionalString(record, ["membershipStatus", "status", "memberStatus"]) || toOptionalString(summary, ["membershipStatus", "status", "memberStatus"]),
    branchId:
      toOptionalString(record, ["defaultBranchId", "branchId"]) || toOptionalString(summary, ["defaultBranchId", "branchId"]),
    branchName: toOptionalString(record, ["branchName"]) || toOptionalString(summary, ["branchName"]),
    summary,
    overview,
    tabs,
    raw: record,
  };
}

function mapMemberFitnessForm(payload: unknown): MemberFitnessFormPayload {
  return toRecord(payload) as MemberFitnessFormPayload;
}

function mapMemberFitnessFormStatus(payload: unknown): MemberFitnessFormStatusResponse {
  const record = toRecord(payload);
  return {
    ...record,
    required: record.required === undefined ? undefined : toBoolean(record, ["required"]),
    completed: record.completed === undefined ? undefined : toBoolean(record, ["completed"]),
    completedAt: toOptionalString(record, ["completedAt"]),
    lastUpdatedAt: toOptionalString(record, ["lastUpdatedAt", "updatedAt"]),
  };
}

function mapMemberNotes(payload: unknown): MemberNotesResponse {
  if (Array.isArray(payload)) {
    return {
      items: payload.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null),
      raw: payload,
    };
  }

  const record = toRecord(payload);
  const rawItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.notes)
      ? record.notes
      : [];

  return {
    items: rawItems.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null),
    raw: payload,
  };
}

function mapMemberContext(payload: unknown): MemberContextResponse {
  const record = toRecord(payload);
  return {
    onboarding: typeof record.onboarding === "object" && record.onboarding !== null ? toRecord(record.onboarding) : undefined,
    fitnessForm:
      typeof record.fitnessForm === "object" && record.fitnessForm !== null
        ? mapMemberFitnessFormStatus(record.fitnessForm)
        : undefined,
    fitnessAssessment:
      typeof record.fitnessAssessment === "object" && record.fitnessAssessment !== null
        ? (record.fitnessAssessment as MemberContextResponse["fitnessAssessment"])
        : undefined,
    raw: record,
  };
}

export const usersService = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    pushAuthDebug("users-service", "login:request", {
      mobileNumber: maskMobile(payload.mobileNumber),
      hasPassword: Boolean(payload.password),
      path: `${USERS_API_PREFIX}/login`,
    });

    const response = await apiRequest<ApiResponse<LoginTokenPayload> | LoginTokenPayload>({
      service: "users",
      path: `${USERS_API_PREFIX}/login`,
      method: "POST",
      body: payload,
    });

    const tokenPayload = unwrapData<LoginTokenPayload>(response);
    if (!tokenPayload.accessToken) {
      pushAuthDebug("users-service", "login:invalid-response", {
        hasAccessToken: false,
        raw: tokenPayload,
      });
      throw new Error("Invalid login response: accessToken is missing");
    }

    const claims = decodeJwtClaims(tokenPayload.accessToken);
    pushAuthDebug("users-service", "login:success", {
      hasAccessToken: true,
      tokenLength: tokenPayload.accessToken.length,
      tokenPreview: tokenPreview(tokenPayload.accessToken),
      tokenType: tokenPayload.tokenType || "Bearer",
      expiresIn: tokenPayload.expiresIn,
      claimSub: claims.sub,
      claimPreferredUsername: claims.preferred_username,
    });

    if (!tokenPayload.refreshToken) {
      throw new Error("Invalid login response: refreshToken is missing");
    }

    return {
      token: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresIn: tokenPayload.expiresIn,
      refreshExpiresIn: tokenPayload.refreshExpiresIn,
      tokenType: tokenPayload.tokenType || "Bearer",
      user: {
        id: claims.sub || payload.mobileNumber,
        name: claims.name || claims.given_name || "Staff",
        mobile: claims.preferred_username || payload.mobileNumber,
        role: roleFromClaims(claims),
      },
    };
  },

  async refreshToken(refreshToken: string): Promise<Pick<LoginResponse, "token" | "refreshToken" | "expiresIn" | "refreshExpiresIn" | "tokenType">> {
    const response = await apiRequest<ApiResponse<LoginTokenPayload> | LoginTokenPayload>({
      service: "users",
      path: `${USERS_API_PREFIX}/refresh`,
      method: "POST",
      body: {
        refreshToken,
      } satisfies RefreshTokenRequest,
    });

    const tokenPayload = unwrapData<LoginTokenPayload>(response);
    if (!tokenPayload.accessToken || !tokenPayload.refreshToken) {
      throw new Error("Invalid refresh response: accessToken or refreshToken is missing");
    }

    return {
      token: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresIn: tokenPayload.expiresIn,
      refreshExpiresIn: tokenPayload.refreshExpiresIn,
      tokenType: tokenPayload.tokenType || "Bearer",
    };
  },

  async getMe(token: string, fallback?: Partial<AuthUser>): Promise<AuthUser> {
    const response = await apiRequest<ApiResponse<BackendUserPayload> | BackendUserPayload>({
      service: "users",
      path: `${USERS_API_PREFIX}/me`,
      token,
    });

    return mapAuthUser(unwrapData<BackendUserPayload>(response), fallback);
  },

  async getAccessMetadata(token: string): Promise<AccessMetadata> {
    const response = await apiRequest<ApiResponse<AccessMetadata> | AccessMetadata>({
      service: "users",
      path: `${USERS_API_PREFIX}/metadata/access`,
      token,
    });

    return unwrapData<AccessMetadata>(response);
  },

  async searchMembers(token: string, query: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token, {
      role: "MEMBER",
      query,
    });
  },

  async searchUsers(token: string, query: UserSearchQuery = {}): Promise<UserDirectoryItem[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/search`,
      token,
      query,
    });

    return mapDirectoryUsers(unwrapData<unknown>(response));
  },

  async getAllUsers(token: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token);
  },

  async getUsersByRole(token: string, role: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token, {
      role: normalizeRole(role) || undefined,
    });
  },

  async getUserById(token: string, id: string): Promise<UserDirectoryItem | null> {
    const list = await this.searchUsers(token, { query: id });
    return list.find((item) => item.id === id) || null;
  },

  async getMemberProfileShell(token: string, memberId: string | number): Promise<MemberProfileShellResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/members/${memberId}/profile`,
      token,
    });

    return mapMemberProfileShell(unwrapData<unknown>(response));
  },

  async getMemberNotes(token: string, memberId: string | number): Promise<MemberNotesResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/members/${memberId}/notes`,
      token,
    });

    return mapMemberNotes(unwrapData<unknown>(response));
  },

  async getMemberFitnessForm(token: string, memberId: string | number): Promise<MemberFitnessFormPayload> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/members/${memberId}/fitness-form`,
      token,
    });

    return mapMemberFitnessForm(unwrapData<unknown>(response));
  },

  async getCurrentUserFitnessForm(token: string): Promise<MemberFitnessFormPayload> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/fitness-form`,
      token,
    });

    return mapMemberFitnessForm(unwrapData<unknown>(response));
  },

  async getCurrentUserFitnessFormStatus(token: string): Promise<MemberFitnessFormStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/fitness-form/status`,
      token,
    });

    return mapMemberFitnessFormStatus(unwrapData<unknown>(response));
  },

  async submitCurrentUserFitnessForm(
    token: string,
    payload: MemberFitnessFormPayload,
  ): Promise<MemberFitnessFormPayload> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/fitness-form`,
      token,
      method: "POST",
      body: payload,
    });

    return mapMemberFitnessForm(unwrapData<unknown>(response));
  },

  async getMemberContext(token: string): Promise<MemberContextResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/member-context`,
      token,
    });

    return mapMemberContext(unwrapData<unknown>(response));
  },

  async registerUser(token: string, payload: RegisterUserRequest): Promise<UserDirectoryItem> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/register`,
      token,
      method: "POST",
      body: payload,
    });

    return mapDirectoryUser(unwrapData<BackendUserPayload>(response));
  },

  async updateUser(token: string, id: string, payload: UpdateUserRequest): Promise<UserDirectoryItem> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/update/${id}`,
      token,
      method: "PUT",
      body: payload,
    });

    return mapDirectoryUser(unwrapData<BackendUserPayload>(response));
  },

  async getSuperAdminDashboard(token: string, branchId?: string | number): Promise<SuperAdminDashboardResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/dashboard/super-admin`,
      token,
      query: {
        branchId,
      },
    });

    return mapSuperAdminDashboard(unwrapData<unknown>(response));
  },

  async getSuperAdminDashboardDrilldown(
    token: string,
    params: SuperAdminDashboardDrilldownQuery,
  ): Promise<SuperAdminDashboardDrilldownResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/dashboard/super-admin/drilldown`,
      token,
      query: {
        metricKey: params.metricKey,
        branchId: params.branchId,
        query: params.query,
        page: params.page ?? 0,
        size: params.size ?? 20,
      },
    });

    return mapSuperAdminDashboardDrilldown(unwrapData<unknown>(response));
  },

  async getStaffAttendanceReport(
    token: string,
    query: StaffAttendanceReportQuery = {},
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/attendance/report`,
      token,
      query,
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async getStaffLeaveRequests(token: string, query: StaffLeaveRequestsQuery = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/leave-requests`,
      token,
      query,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async updateStaffLeaveRequestStatus(
    token: string,
    leaveRequestId: string | number,
    status: string,
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/leave-requests/${leaveRequestId}/status`,
      token,
      method: "PATCH",
      body: {
        status,
      },
    });

    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  // --- Staff clock-in / clock-out ---

  async staffClockIn(token: string, body: ClockInPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/attendance/clock-in`,
      token,
      method: "POST",
      body,
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async staffClockOut(token: string, staffId: number, body: ClockOutPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/attendance/clock-out`,
      token,
      method: "POST",
      body: { staffId, ...body },
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  // --- Staff leave request creation ---

  async createStaffLeaveRequest(token: string, body: CreateLeaveRequestPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/staff/leave-requests`,
      token,
      method: "POST",
      body,
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  // --- Trainer attendance report ---

  async getTrainerAttendanceReport(
    token: string,
    query: TrainerAttendanceReportQuery = {},
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/attendance/report`,
      token,
      query,
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  // --- Trainer clock-in / clock-out ---

  async trainerClockIn(token: string, body: ClockInPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/attendance/clock-in`,
      token,
      method: "POST",
      body,
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async trainerClockOut(token: string, trainerId: number, body: ClockOutPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/attendance/clock-out`,
      token,
      method: "POST",
      body: { trainerId, ...body },
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  // --- Trainer leave requests ---

  async getTrainerLeaveRequests(token: string, query: TrainerLeaveRequestsQuery = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/leave-requests`,
      token,
      query,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async createTrainerLeaveRequest(token: string, body: CreateLeaveRequestPayload): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/leave-requests`,
      token,
      method: "POST",
      body,
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },

  async updateTrainerLeaveRequestStatus(
    token: string,
    leaveRequestId: string | number,
    status: string,
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/trainers/leave-requests/${leaveRequestId}/status`,
      token,
      method: "PATCH",
      body: { status },
    });
    const payload = unwrapData<unknown>(response);
    return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  },
};
