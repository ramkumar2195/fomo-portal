/**
 * Types mirroring the backend approval-request scaffold (DEC-019).
 *
 * Phase 1 covers five risky-op types. New types are added on the backend
 * first (enum + executor) and then surfaced here.
 */

export type ApprovalRequestType =
  | "DISCOUNT"
  | "EDIT_RECEIPT"
  | "DELETE_PAYMENT"
  | "GRANT_PAUSE_BENEFIT"
  | "BACKDATE_SUBSCRIPTION";

export type ApprovalRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export type ApprovalTargetEntityType =
  | "MEMBER"
  | "SUBSCRIPTION"
  | "INVOICE"
  | "RECEIPT"
  | "PAYMENT";

export interface ApprovalRequestRecord {
  id: number;
  requestType: ApprovalRequestType;
  status: ApprovalRequestStatus;

  requesterStaffId: number;
  requesterDesignation?: string | null;
  approverRoleRequired?: string | null;

  targetEntityType: ApprovalTargetEntityType | string;
  targetEntityId: number;
  branchCode?: string | null;

  payloadJson?: string | null;
  reason?: string | null;

  approverStaffId?: number | null;
  decisionNotes?: string | null;
  decidedAt?: string | null;

  expiresAt: string;
  createdAt: string;
  updatedAt: string;

  idempotencyKey: string;
  executedAuditLogId?: number | null;
}

export interface SubmitApprovalRequestBody {
  requestType: ApprovalRequestType;
  targetEntityType: ApprovalTargetEntityType | string;
  targetEntityId: number;
  branchCode?: string;
  /** JSON string; shape depends on requestType. See ApprovalRequestService doc. */
  payloadJson?: string;
  reason?: string;
  idempotencyKey?: string;
}

export interface ApprovalDecisionBody {
  decisionNotes?: string;
}

/** Human-readable label for tiles and tables. */
export const APPROVAL_TYPE_LABEL: Record<ApprovalRequestType, string> = {
  DISCOUNT: "Discount",
  EDIT_RECEIPT: "Edit Receipt",
  DELETE_PAYMENT: "Delete Payment",
  GRANT_PAUSE_BENEFIT: "Grant Pause Benefit",
  BACKDATE_SUBSCRIPTION: "Backdate Subscription",
};

/** Short caption explaining what each type authorises, shown under the title. */
export const APPROVAL_TYPE_DESCRIPTION: Record<ApprovalRequestType, string> = {
  DISCOUNT: "Apply a discount above the 5% courtesy tier.",
  EDIT_RECEIPT: "Modify a finalised receipt's amount or paid date.",
  DELETE_PAYMENT: "Soft-delete a payment or subscription.",
  GRANT_PAUSE_BENEFIT: "Manually grant additional pause-benefit days.",
  BACKDATE_SUBSCRIPTION: "Change a subscription's start/end date or backdate a freeze.",
};
