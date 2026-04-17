import type { InquiryResponseType } from "@/types/inquiry";

export type FollowUpChannel = "CALL" | "WHATSAPP" | "SMS" | "EMAIL" | "VISIT";

export type FollowUpStatus = "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";

export type FollowUpType =
  | "MEMBERSHIP_RENEWAL"
  | "MEMBERSHIP_ENQUIRY"
  | "ENQUIRY"
  | "IRREGULAR_MEMBER"
  | "BALANCE_DUE"
  | "FREEZE"
  | "ASSIGN_TRIAL"
  | "FEEDBACK"
  | "MEASUREMENT"
  | "PT_RENEWAL"
  | "PT_TRIAL"
  | "COMMITMENT"
  | "ANNIVERSARY"
  | "BIRTHDAY"
  | "REFERRAL"
  | "TRANSFER"
  | "UPGRADE"
  | "ONLINE_PROSPECT"
  | "ONLINE_TRAINING"
  | "TRIAL_ONLINE_PT"
  | "TRIAL_ONLINE_PT_FEEDBACK"
  | "NUTRITION"
  | "OTHER"
  | "EX_MEMBER"
  | "READY_TO_SIGN_UP"
  | "DEMO_SCHEDULED"
  | "DEMO_CONDUCTED"
  | "CONFIRMATION_CALLS"
  | "GYM_STUDIO_TRIAL";

export interface FollowUpRecord {
  followUpId: number;
  inquiryId: number;
  memberId: number | null;
  branchId?: number | null;
  branchCode?: string | null;
  assignedToStaffId: number | null;
  createdByStaffId: number | null;
  channel: FollowUpChannel;
  responseType?: InquiryResponseType;
  followUpType?: FollowUpType;
  dueAt: string;
  notes: string | null;
  status: FollowUpStatus;
  completedByStaffId: number | null;
  completedAt: string | null;
  outcomeNotes: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFollowUpRequest {
  dueAt: string;
  channel: FollowUpChannel;
  assignedToStaffId: number;
  createdByStaffId: number;
  notes?: string;
  responseType?: InquiryResponseType;
  followUpType?: FollowUpType;
}

export interface UpdateFollowUpRequest {
  dueAt?: string;
  channel?: FollowUpChannel;
  assignedToStaffId?: number;
  notes?: string;
  status?: FollowUpStatus;
  completedByStaffId?: number;
  outcomeNotes?: string;
  followUpType?: FollowUpType;
}

export interface CompleteFollowUpRequest {
  completedByStaffId: number;
  outcomeNotes?: string;
}

/**
 * Segmentation discriminator for the Follow-ups two-tab UI.
 * - LEADS: only open-lead follow-ups (inquiry not converted, no linked member)
 * - MEMBER_RENEWALS: only follow-ups with a linked member (renewals, balance-due, etc.)
 * - omitted: legacy union (kept for back-compat; used by dashboard tiles that want both)
 */
export type FollowUpSegment = "LEADS" | "MEMBER_RENEWALS";

export interface FollowUpQueueQuery {
  inquiryId?: number;
  memberId?: number;
  assignedToStaffId?: number;
  createdByStaffId?: number;
  followUpType?: FollowUpType;
  status?: FollowUpStatus;
  dueFrom?: string;
  dueTo?: string;
  overdueOnly?: boolean;
  branchId?: number;
  page?: number;
  size?: number;
  segment?: FollowUpSegment;
  [key: string]: string | number | boolean | undefined;
}
