import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";
import {
  BranchCapacityResponse,
  BranchCurrentCheckInRecord,
  BranchCurrentCheckInsResponse,
  BranchDirectoryMemberRow,
  BranchMembersDirectoryFilter,
  BranchMembersDirectoryResponse,
  BranchMembersDirectorySummary,
  BranchOverviewResponse,
  BranchPage,
  BranchProgramSummary,
  BranchResponse,
  BranchRevenuePoint,
  BranchRevenueResponse,
} from "@/types/admin";
import { UserDirectoryItem } from "@/types/models";
import { SpringPage } from "@/types/pagination";

interface JsonRecord {
  [key: string]: unknown;
}

export interface BranchWriteRequest {
  name?: string;
  address?: string;
  city?: string;
  managerId?: number | null;
  capacity?: number;
}

export interface BranchDateRangeQuery {
  from?: string;
  to?: string;
}

export interface BranchProgramsQuery {
  page?: number;
  size?: number;
  status?: string;
}

export interface BranchListQuery {
  query?: string;
  active?: boolean;
  city?: string;
  sort?: string;
  page?: number;
  size?: number;
}

export interface BranchEmployeeQuery {
  query?: string;
  active?: boolean;
  designation?: string;
  page?: number;
  size?: number;
}

export interface BranchMembersDirectoryQuery {
  branchId?: string | number;
  query?: string;
  filter?: BranchMembersDirectoryFilter;
  page?: number;
  size?: number;
}

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function toArray(payload: JsonRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function toStringArray(payload: JsonRecord, keys: string[]): string[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) {
      continue;
    }

    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
      .filter((item) => item.length > 0);
  }

  return [];
}

function toString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return "";
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

function toOptionalNumber(payload: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (value === null) {
      return null;
    }

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

  return null;
}

function toBoolean(payload: JsonRecord, keys: string[]): boolean {
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

function mapBranch(payload: unknown): BranchResponse {
  const record = toRecord(payload);

  return {
    id: toNumber(record, ["id", "branchId"]),
    name: toString(record, ["name"]),
    branchCode: toString(record, ["branchCode", "code"]) || undefined,
    address: toString(record, ["address"]),
    city: toString(record, ["city"]),
    managerId: toOptionalNumber(record, ["managerId"]),
    managerName: toString(record, ["managerName"]) || undefined,
    capacity: toNumber(record, ["capacity"]),
    activeMembers: toNumber(record, ["activeMembers"]),
    active: toBoolean(record, ["active"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
    updatedAt: toString(record, ["updatedAt"]) || undefined,
  };
}

function mapBranchCapacity(payload: unknown): BranchCapacityResponse {
  const record = toRecord(payload);
  return {
    ...record,
    capacity: toNumber(record, ["capacity"]),
    activeMembers: toNumber(record, ["activeMembers"]),
    utilizationPercent: toNumber(record, ["utilizationPercent", "capacityUtilization"]),
    availableSlots: toNumber(record, ["availableSlots"]),
  };
}

function mapBranchOverview(payload: unknown): BranchOverviewResponse {
  const record = toRecord(payload);
  return {
    ...record,
    branchId: toNumber(record, ["branchId", "id"]),
    branchName: toString(record, ["branchName", "name"]),
    branchCode: toString(record, ["branchCode", "code"]),
    city: toString(record, ["city"]),
    managerId: toOptionalNumber(record, ["managerId"]),
    capacity: toNumber(record, ["capacity"]),
    activeMembers: toNumber(record, ["activeMembers"]),
    availableSlots: toNumber(record, ["availableSlots"]),
    occupancyRate: toNumber(record, ["occupancyRate", "utilizationPercent", "capacityUtilization"]),
    totalMembers: toNumber(record, ["totalMembers"]),
    totalCoaches: toNumber(record, ["totalCoaches"]),
    totalStaff: toNumber(record, ["totalStaff"]),
    totalPrograms: toNumber(record, ["totalPrograms"]),
    activePrograms: toNumber(record, ["activePrograms"]),
    todayCheckIns: toNumber(record, ["todayCheckIns"]),
    currentlyCheckedIn: toNumber(record, ["currentlyCheckedIn"]),
    totalInquiries: toNumber(record, ["totalInquiries"]),
    convertedInquiries: toNumber(record, ["convertedInquiries"]),
    openInquiries: toNumber(record, ["openInquiries"]),
    followUpsDueToday: toNumber(record, ["followUpsDueToday"]),
    followUpsOverdue: toNumber(record, ["followUpsOverdue"]),
    invoicesIssued: toNumber(record, ["invoicesIssued"]),
    invoicesPaid: toNumber(record, ["invoicesPaid"]),
    totalInvoiced: toNumber(record, ["totalInvoiced"]),
    totalCollected: toNumber(record, ["totalCollected"]),
    totalOutstanding: toNumber(record, ["totalOutstanding"]),
    fromDate: toString(record, ["fromDate"]) || undefined,
    toDate: toString(record, ["toDate"]) || undefined,
    warnings: toStringArray(record, ["warnings"]),
  };
}

function mapBranchRevenuePoint(payload: unknown): BranchRevenuePoint {
  const record = toRecord(payload);
  return {
    ...record,
    label: toString(record, ["label", "name", "date", "day"]) || "Point",
    amount: toNumber(record, ["amount", "collected", "value", "revenue"]),
    collected: toNumber(record, ["collected", "amount"]),
    outstanding: toNumber(record, ["outstanding", "balance", "due"]),
  };
}

function mapBranchRevenue(payload: unknown): BranchRevenueResponse {
  const record = toRecord(payload);
  const series = toArray(record, ["points", "series", "trend", "timeline", "dailyBreakdown"]);

  return {
    ...record,
    from: toString(record, ["from", "fromDate"]) || undefined,
    to: toString(record, ["to", "toDate"]) || undefined,
    totalCollected: toNumber(record, ["totalCollected", "collectedTotal", "monthCollected", "revenueCollected"]),
    totalOutstanding: toNumber(record, ["totalOutstanding", "outstandingTotal", "balanceDue"]),
    averageInvoiceValue: toNumber(record, ["averageInvoiceValue", "avgInvoiceValue"]),
    points: series.map((entry) => mapBranchRevenuePoint(entry)),
  };
}

function mapCurrentCheckInRecord(payload: unknown): BranchCurrentCheckInRecord {
  const record = toRecord(payload);
  return {
    ...record,
    checkInId: toString(record, ["checkInId", "id"]),
    memberId: toString(record, ["memberId"]),
    memberName: toString(record, ["memberName", "fullName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile"]),
    gymId: toString(record, ["gymId", "branchId", "branchCode"]),
    status: toString(record, ["status"]),
    source: toString(record, ["source"]),
    checkedInAt: toString(record, ["checkedInAt"]) || undefined,
    checkedOutAt: toString(record, ["checkedOutAt"]) || undefined,
  };
}

function mapCurrentCheckIns(payload: unknown): BranchCurrentCheckInsResponse {
  const record = toRecord(payload);
  const records = toArray(record, ["records"]).map((entry) => mapCurrentCheckInRecord(entry));

  return {
    ...record,
    todayCheckIns: toNumber(record, ["todayCheckIns"]),
    currentlyCheckedIn: toNumber(record, ["currentlyCheckedIn"]),
    warnings: toStringArray(record, ["warnings"]),
    records,
  };
}

function mapDirectoryMemberRow(payload: unknown): BranchDirectoryMemberRow {
  const record = toRecord(payload);
  return {
    ...record,
    branchId: toString(record, ["branchId"]),
    branchName: toString(record, ["branchName"]),
    memberId: toString(record, ["memberId", "id"]),
    fullName: toString(record, ["fullName", "memberName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    gender: toString(record, ["gender"]) || undefined,
    activePlan: toString(record, ["activePlan", "planName"]),
    attendancePercent: toNumber(record, ["attendancePercent"]),
    memberStatus: toString(record, ["memberStatus", "status"]),
    paymentStatus: toString(record, ["paymentStatus"]),
    outstandingAmount: toNumber(record, ["outstandingAmount"]),
    ptClient: toBoolean(record, ["ptClient"]),
  };
}

function mapDirectorySummary(payload: unknown): BranchMembersDirectorySummary {
  const record = toRecord(payload);
  return {
    ...record,
    activeMembers: toNumber(record, ["activeMembers"]),
    expiredMembers: toNumber(record, ["expiredMembers"]),
    irregularMembers: toNumber(record, ["irregularMembers"]),
    ptClients: toNumber(record, ["ptClients"]),
  };
}

function mapMembersDirectory(payload: unknown): BranchMembersDirectoryResponse {
  const record = toRecord(payload);
  const summary = mapDirectorySummary(record.summary);
  const members = mapPage<BranchDirectoryMemberRow>(record.members, mapDirectoryMemberRow);
  return {
    ...record,
    summary,
    members,
  };
}

function mapBranchProgram(payload: unknown): BranchProgramSummary {
  const record = toRecord(payload);
  return {
    ...record,
    id: toString(record, ["id", "programId"]),
    name: toString(record, ["name", "programName"]),
    status: toString(record, ["status"]) || undefined,
    trainerName: toString(record, ["trainerName", "coachName"]) || undefined,
    membersEnrolled: toNumber(record, ["membersEnrolled", "memberCount", "enrolledMembers"]),
    maxCapacity: toNumber(record, ["maxCapacity", "capacity"]),
    completionRate: toNumber(record, ["completionRate"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
    updatedAt: toString(record, ["updatedAt"]) || undefined,
  };
}

function mapDirectoryItem(payload: unknown): UserDirectoryItem {
  const record = toRecord(payload);
  return {
    id: toString(record, ["id", "userId"]),
    name: toString(record, ["fullName", "name", "displayName"]),
    mobile: toString(record, ["mobileNumber", "mobile", "phone"]),
    role: toString(record, ["role"]),
    email: toString(record, ["email"]) || undefined,
    active: record.active === undefined ? undefined : toBoolean(record, ["active"]),
    employmentType: toString(record, ["employmentType"]) || undefined,
    designation: toString(record, ["designation"]) || undefined,
    dataScope: toString(record, ["dataScope"]) || undefined,
    defaultBranchId: toString(record, ["defaultBranchId", "branchId", "branchCode"]) || undefined,
  };
}

function mapPage<T>(payload: unknown, mapper: (item: unknown) => T): SpringPage<T> {
  const record = toRecord(payload);
  const rawContent = Array.isArray(record.content) ? record.content : [];

  return {
    content: rawContent.map((item) => mapper(item)),
    number: toNumber(record, ["number"]),
    size: toNumber(record, ["size"]),
    totalElements: toNumber(record, ["totalElements"]),
    totalPages: toNumber(record, ["totalPages"]),
    first: toBoolean(record, ["first"]),
    last: toBoolean(record, ["last"]),
    empty: toBoolean(record, ["empty"]),
    numberOfElements: toNumber(record, ["numberOfElements"]),
  };
}

export const branchService = {
  async createBranch(token: string, payload: BranchWriteRequest): Promise<BranchResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: "/api/branches",
      method: "POST",
      token,
      body: payload,
    });

    return mapBranch(unwrapData<unknown>(response));
  },

  async listBranches(token: string, query: BranchListQuery = {}): Promise<BranchPage> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: "/api/branches",
      token,
      query: {
        query: query.query,
        active: query.active,
        city: query.city,
        sort: query.sort,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapPage<BranchResponse>(unwrapData<unknown>(response), mapBranch);
  },

  async getBranch(token: string, branchId: number | string): Promise<BranchResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}`,
      token,
    });

    return mapBranch(unwrapData<unknown>(response));
  },

  async updateBranch(token: string, branchId: number | string, payload: BranchWriteRequest): Promise<BranchResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}`,
      method: "PUT",
      token,
      body: payload,
    });

    return mapBranch(unwrapData<unknown>(response));
  },

  async patchBranchStatus(token: string, branchId: number | string, active: boolean): Promise<BranchResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/status`,
      method: "PATCH",
      token,
      body: {
        active,
      },
    });

    return mapBranch(unwrapData<unknown>(response));
  },

  async getBranchMembers(token: string, branchId: number | string, page = 0, size = 20): Promise<SpringPage<UserDirectoryItem>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/members`,
      token,
      query: {
        page,
        size,
      },
    });

    return mapPage<UserDirectoryItem>(unwrapData<unknown>(response), mapDirectoryItem);
  },

  async getBranchCoaches(
    token: string,
    branchId: number | string,
    query: BranchEmployeeQuery = {},
  ): Promise<SpringPage<UserDirectoryItem>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/coaches`,
      token,
      query: {
        query: query.query,
        active: query.active,
        designation: query.designation,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapPage<UserDirectoryItem>(unwrapData<unknown>(response), mapDirectoryItem);
  },

  async getBranchStaff(
    token: string,
    branchId: number | string,
    query: BranchEmployeeQuery = {},
  ): Promise<SpringPage<UserDirectoryItem>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/staff`,
      token,
      query: {
        query: query.query,
        active: query.active,
        designation: query.designation,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapPage<UserDirectoryItem>(unwrapData<unknown>(response), mapDirectoryItem);
  },

  async getBranchCapacity(token: string, branchId: number | string): Promise<BranchCapacityResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/capacity`,
      token,
    });

    return mapBranchCapacity(unwrapData<unknown>(response));
  },

  async getBranchOverview(
    token: string,
    branchId: number | string,
    query: BranchDateRangeQuery = {},
  ): Promise<BranchOverviewResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/overview`,
      token,
      query: {
        from: query.from,
        to: query.to,
      },
    });

    return mapBranchOverview(unwrapData<unknown>(response));
  },

  async getBranchRevenue(
    token: string,
    branchId: number | string,
    query: BranchDateRangeQuery = {},
  ): Promise<BranchRevenueResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/revenue`,
      token,
      query: {
        from: query.from,
        to: query.to,
      },
    });

    return mapBranchRevenue(unwrapData<unknown>(response));
  },

  async getBranchProgramsPaged(
    token: string,
    branchId: number | string,
    query: BranchProgramsQuery = {},
  ): Promise<SpringPage<BranchProgramSummary>> {
    const page = query.page ?? 0;
    const size = query.size ?? 10;
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/programs/paged`,
      token,
      query: {
        page,
        size,
        status: query.status,
      },
    });

    return mapPage<BranchProgramSummary>(unwrapData<unknown>(response), mapBranchProgram);
  },

  async getBranchCurrentCheckIns(token: string, branchId: number | string): Promise<BranchCurrentCheckInsResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/check-ins/current`,
      token,
    });

    return mapCurrentCheckIns(unwrapData<unknown>(response));
  },

  async getBranchMembersDirectory(
    token: string,
    branchId: number | string,
    query: BranchMembersDirectoryQuery = {},
  ): Promise<BranchMembersDirectoryResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `/api/branches/${branchId}/members/directory`,
      token,
      query: {
        query: query.query,
        filter: query.filter || "ALL",
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapMembersDirectory(unwrapData<unknown>(response));
  },

  async getGlobalMembersDirectory(token: string, query: BranchMembersDirectoryQuery = {}): Promise<BranchMembersDirectoryResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: "/api/branches/members/directory",
      token,
      query: {
        branchId: query.branchId,
        query: query.query,
        filter: query.filter || "ALL",
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapMembersDirectory(unwrapData<unknown>(response));
  },

  async getBranchManagersPaged(
    token: string,
    query: {
      query?: string;
      active?: boolean;
      page?: number;
      size?: number;
    } = {},
  ): Promise<SpringPage<UserDirectoryItem>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: "/api/branches/managers/paged",
      token,
      query: {
        query: query.query,
        active: query.active,
        page: query.page ?? 0,
        size: query.size ?? 20,
      },
    });

    return mapPage<UserDirectoryItem>(unwrapData<unknown>(response), mapDirectoryItem);
  },
};
