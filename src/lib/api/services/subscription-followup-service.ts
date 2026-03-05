import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import {
  CompleteFollowUpRequest,
  CreateFollowUpRequest,
  FollowUpQueueQuery,
  FollowUpRecord,
  UpdateFollowUpRequest,
} from "@/types/follow-up";

function ensureFollowUpArray(payload: unknown): FollowUpRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as FollowUpRecord[];
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
