export type NotificationChannel = "IN_APP" | "SMS" | "EMAIL" | "WHATSAPP";

export type InAppNotificationType = "INFO" | "REMINDER" | "ACTION";

export interface NotificationCampaign {
  campaignId: number;
  name: string;
  title: string;
  message: string;
  channel: NotificationChannel;
  audienceType: string;
  targetMemberIds: number[];
  branchId: number | null;
  createdBy: number;
  scheduledAt: string | null;
  metadataJson: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCampaignRequest {
  name: string;
  title: string;
  message: string;
  channel: NotificationChannel;
  audienceType: string;
  targetMemberIds: number[];
  branchId: number | null;
  createdBy: number;
  scheduledAt: string | null;
  metadataJson: string;
}

export interface CampaignListQuery {
  status?: string;
  channel?: NotificationChannel;
  [key: string]: string | undefined;
}

export interface CampaignStats {
  campaignId: number;
  sentCount?: number;
  deliveredCount?: number;
  readCount?: number;
  failedCount?: number;
  [key: string]: unknown;
}

export interface SendInAppRequest {
  memberIds: number[];
  title: string;
  message: string;
  type: InAppNotificationType;
  campaignId: number | null;
  branchId: number | null;
  deepLink: string;
  metadataJson: string;
  expiresAt: string | null;
}

export interface InAppNotification {
  notificationId: number;
  memberId: number;
  title: string;
  message: string;
  type: InAppNotificationType;
  read: boolean;
  createdAt?: string;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export interface InAppNotificationListQuery {
  unreadOnly?: boolean;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface UnreadCountResponse {
  memberId: number;
  unreadCount: number;
}
