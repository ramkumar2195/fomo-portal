import type { InquiryResponseType } from "@/types/inquiry";

export type FollowUpChannel = "CALL" | "WHATSAPP" | "SMS" | "EMAIL" | "VISIT";

export type FollowUpStatus = "SCHEDULED" | "COMPLETED" | "MISSED" | "CANCELLED";

export interface FollowUpRecord {
  followUpId: number;
  inquiryId: number;
  memberId: number | null;
  assignedToStaffId: number | null;
  createdByStaffId: number | null;
  channel: FollowUpChannel;
  responseType?: InquiryResponseType;
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
}

export interface UpdateFollowUpRequest {
  dueAt?: string;
  channel?: FollowUpChannel;
  assignedToStaffId?: number;
  notes?: string;
  status?: FollowUpStatus;
  completedByStaffId?: number;
  outcomeNotes?: string;
}

export interface CompleteFollowUpRequest {
  completedByStaffId: number;
  outcomeNotes?: string;
}

export interface FollowUpQueueQuery {
  inquiryId?: number;
  memberId?: number;
  assignedToStaffId?: number;
  status?: FollowUpStatus;
  dueFrom?: string;
  dueTo?: string;
  overdueOnly?: boolean;
  branchId?: number;
  page?: number;
  size?: number;
  [key: string]: string | number | boolean | undefined;
}
