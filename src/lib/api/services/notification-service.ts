import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import {
  CampaignListQuery,
  CampaignStats,
  CreateCampaignRequest,
  InAppNotification,
  InAppNotificationListQuery,
  NotificationCampaign,
  SendInAppRequest,
  UnreadCountResponse,
} from "@/types/notification";

function ensureArray<T>(payload: unknown): T[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as T[];
}

export const notificationService = {
  async createCampaign(token: string, body: CreateCampaignRequest): Promise<NotificationCampaign> {
    const response = await apiRequest<ApiResponse<NotificationCampaign> | NotificationCampaign>({
      service: "notification",
      path: "/api/notifications/campaigns",
      method: "POST",
      token,
      body,
    });

    return unwrapData<NotificationCampaign>(response);
  },

  async listCampaigns(token: string, query: CampaignListQuery = {}): Promise<NotificationCampaign[]> {
    const response = await apiRequest<ApiResponse<NotificationCampaign[]> | NotificationCampaign[]>({
      service: "notification",
      path: "/api/notifications/campaigns",
      token,
      query,
    });

    return ensureArray<NotificationCampaign>(unwrapData<unknown>(response));
  },

  async getCampaign(token: string, campaignId: number): Promise<NotificationCampaign> {
    const response = await apiRequest<ApiResponse<NotificationCampaign> | NotificationCampaign>({
      service: "notification",
      path: `/api/notifications/campaigns/${campaignId}`,
      token,
    });

    return unwrapData<NotificationCampaign>(response);
  },

  async sendCampaign(token: string, campaignId: number): Promise<NotificationCampaign> {
    const response = await apiRequest<ApiResponse<NotificationCampaign> | NotificationCampaign>({
      service: "notification",
      path: `/api/notifications/campaigns/${campaignId}/send`,
      method: "POST",
      token,
      body: {},
    });

    return unwrapData<NotificationCampaign>(response);
  },

  async getCampaignStats(token: string, campaignId: number): Promise<CampaignStats> {
    const response = await apiRequest<ApiResponse<CampaignStats> | CampaignStats>({
      service: "notification",
      path: `/api/notifications/campaigns/${campaignId}/stats`,
      token,
    });

    return unwrapData<CampaignStats>(response);
  },

  async sendInApp(token: string, body: SendInAppRequest): Promise<InAppNotification[]> {
    const response = await apiRequest<ApiResponse<InAppNotification[]> | InAppNotification[]>({
      service: "notification",
      path: "/api/notifications/in-app",
      method: "POST",
      token,
      body,
    });

    return ensureArray<InAppNotification>(unwrapData<unknown>(response));
  },

  async getInAppByMember(
    token: string,
    memberId: number,
    query: InAppNotificationListQuery = {},
  ): Promise<InAppNotification[]> {
    const response = await apiRequest<ApiResponse<InAppNotification[]> | InAppNotification[]>({
      service: "notification",
      path: `/api/notifications/in-app/${memberId}`,
      token,
      query,
    });

    return ensureArray<InAppNotification>(unwrapData<unknown>(response));
  },

  async getUnreadCount(token: string, memberId: number): Promise<UnreadCountResponse> {
    const response = await apiRequest<ApiResponse<UnreadCountResponse> | UnreadCountResponse>({
      service: "notification",
      path: `/api/notifications/in-app/${memberId}/unread-count`,
      token,
    });

    return unwrapData<UnreadCountResponse>(response);
  },

  async markRead(token: string, notificationId: number): Promise<void> {
    await apiRequest<ApiResponse<unknown> | unknown>({
      service: "notification",
      path: `/api/notifications/in-app/${notificationId}/read`,
      method: "POST",
      token,
      body: {},
    });
  },

  async markAllRead(token: string, memberId: number): Promise<void> {
    await apiRequest<ApiResponse<unknown> | unknown>({
      service: "notification",
      path: `/api/notifications/in-app/read-all/${memberId}`,
      method: "POST",
      token,
      body: {},
    });
  },
};
