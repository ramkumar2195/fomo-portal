import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import {
  CompleteFollowUpRequest,
  CreateFollowUpRequest,
  FollowUpQueueQuery,
  FollowUpRecord,
  UpdateFollowUpRequest,
} from "@/types/follow-up";
import { SpringPage } from "@/types/pagination";

function ensureFollowUpArray(payload: unknown): FollowUpRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as FollowUpRecord[];
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

function mapFollowUpPage(payload: unknown): SpringPage<FollowUpRecord> {
  const record = toRecord(payload);
  const content = Array.isArray(record.content) ? (record.content as FollowUpRecord[]) : [];

  return {
    content,
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

export const subscriptionFollowUpService = {
  async createFollowUp(
    token: string,
    inquiryId: number,
    body: CreateFollowUpRequest,
  ): Promise<FollowUpRecord> {
    const response = await apiRequest<ApiResponse<FollowUpRecord> | FollowUpRecord>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/follow-ups`,
      method: "POST",
      token,
      body,
    });

    return unwrapData<FollowUpRecord>(response);
  },

  async listInquiryFollowUps(token: string, inquiryId: number): Promise<FollowUpRecord[]> {
    const response = await apiRequest<ApiResponse<FollowUpRecord[]> | FollowUpRecord[]>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/follow-ups`,
      token,
    });

    return ensureFollowUpArray(unwrapData<unknown>(response));
  },

  async searchFollowUpQueue(token: string, query: FollowUpQueueQuery): Promise<FollowUpRecord[]> {
    const response = await apiRequest<ApiResponse<FollowUpRecord[]> | FollowUpRecord[]>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries/follow-ups",
      token,
      query,
    });

    return ensureFollowUpArray(unwrapData<unknown>(response));
  },

  async searchFollowUpQueuePaged(
    token: string,
    query: FollowUpQueueQuery = {},
    page = 0,
    size = 10,
  ): Promise<SpringPage<FollowUpRecord>> {
    const response = await apiRequest<ApiResponse<unknown> | unknown>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries/follow-ups/paged",
      token,
      query: {
        ...query,
        page,
        size,
      },
    });

    return mapFollowUpPage(unwrapData<unknown>(response));
  },

  async updateFollowUp(
    token: string,
    followUpId: number,
    body: UpdateFollowUpRequest,
  ): Promise<FollowUpRecord> {
    const response = await apiRequest<ApiResponse<FollowUpRecord> | FollowUpRecord>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/follow-ups/${followUpId}`,
      method: "PATCH",
      token,
      body,
    });

    return unwrapData<FollowUpRecord>(response);
  },

  async completeFollowUp(
    token: string,
    followUpId: number,
    body: CompleteFollowUpRequest,
  ): Promise<FollowUpRecord> {
    const response = await apiRequest<ApiResponse<FollowUpRecord> | FollowUpRecord>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/follow-ups/${followUpId}/complete`,
      method: "POST",
      token,
      body,
    });

    return unwrapData<FollowUpRecord>(response);
  },
};
