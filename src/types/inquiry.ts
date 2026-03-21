export type InquiryStatus =
  | "NEW"
  | "CONTACTED"
  | "FOLLOW_UP"
  | "TRIAL_BOOKED"
  | "CONVERTED"
  | "NOT_INTERESTED"
  | "LOST"
  | (string & {});

export type InquiryConvertibility = "HOT" | "WARM" | "COLD" | (string & {});

export type InquiryResponseType =
  | "READY_TO_PAY"
  | "ASKED_CALLBACK"
  | "NEEDS_DETAILS"
  | "REQUESTED_TRIAL"
  | "NOT_INTERESTED"
  | "OTHER"
  | (string & {});

export type InquiryCustomerStatus =
  | "NEW_LEAD"
  | "EXISTING_MEMBER"
  | "FORMER_MEMBER"
  | "CORPORATE"
  | "STUDENT"
  | "OTHER"
  | (string & {});

export type PreferredContactChannel = "CALL" | "WHATSAPP" | "SMS" | "EMAIL" | "VISIT" | (string & {});

export interface InquiryRecord {
  inquiryId: number;
  fullName: string;
  mobileNumber: string;
  alternateMobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  inquiryAt?: string;
  clientRepStaffId?: number;
  assignedToStaffId?: number;
  gender?: string;
  aadhaarNumber?: string;
  gstNumber?: string;
  defaultTrainerStaffId?: number;
  referredByType?: string;
  referredByName?: string;
  promotionSource?: string;
  employmentStatus?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  branchId?: number;
  branchCode?: string;
  notes?: string;
  remarks?: string;
  responseType?: InquiryResponseType;
  preferredContactChannel?: PreferredContactChannel;
  customerStatus?: InquiryCustomerStatus;
  interestedIn?: string;
  trialGiven?: boolean;
  trialDays?: number;
  trialAttempts?: number;
  trialExpiryAt?: string;
  followUpComment?: string;
  status: InquiryStatus;
  convertibility?: InquiryConvertibility;
  closeReason?: string;
  workflowStatus?: string;
  converted: boolean;
  memberId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateInquiryRequest {
  fullName: string;
  mobileNumber: string;
  alternateMobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  inquiryAt?: string;
  clientRepStaffId?: number;
  assignedToStaffId?: number;
  gender?: string;
  aadhaarNumber?: string;
  gstNumber?: string;
  defaultTrainerStaffId?: number;
  referredByType?: string;
  referredByName?: string;
  promotionSource?: string;
  employmentStatus?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  branchId?: number;
  branchCode?: string;
  notes?: string;
  remarks?: string;
  responseType?: InquiryResponseType;
  preferredContactChannel?: PreferredContactChannel;
  customerStatus?: InquiryCustomerStatus;
  interestedIn?: string;
  trialGiven?: boolean;
  trialDays?: number;
  trialDaysGiven?: number;
  trialAttempts?: number;
  trialExpiryAt?: string;
  followUpComment?: string;
  status?: InquiryStatus;
  convertibility?: InquiryConvertibility;
  closeReason?: string;
}

export interface UpdateInquiryRequest {
  fullName?: string;
  mobileNumber?: string;
  alternateMobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  inquiryAt?: string;
  clientRepStaffId?: number;
  assignedToStaffId?: number;
  gender?: string;
  aadhaarNumber?: string;
  gstNumber?: string;
  defaultTrainerStaffId?: number;
  referredByType?: string;
  referredByName?: string;
  promotionSource?: string;
  employmentStatus?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  branchId?: number;
  branchCode?: string;
  notes?: string;
  remarks?: string;
  responseType?: InquiryResponseType;
  preferredContactChannel?: PreferredContactChannel;
  customerStatus?: InquiryCustomerStatus;
  interestedIn?: string;
  trialGiven?: boolean;
  trialDays?: number;
  trialDaysGiven?: number;
  trialAttempts?: number;
  trialExpiryAt?: string;
  followUpComment?: string;
  status?: InquiryStatus;
  convertibility?: InquiryConvertibility;
  closeReason?: string;
  converted?: boolean;
  memberId?: number | null;
}

export interface InquirySearchQuery {
  query?: string;
  status?: string;
  convertibility?: string;
  closeReason?: string;
  clientRepStaffId?: number;
  assignedToStaffId?: number;
  branchId?: number;
  branchCode?: string;
  converted?: boolean;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface InquiryStatusHistoryEntry {
  fromStatus?: InquiryStatus;
  toStatus?: InquiryStatus;
  changedByStaffId?: number | null;
  changedAt?: string;
  remarks?: string;
}

export interface InquirySummary {
  latestFollowUp?: {
    dueAt?: string;
    channel?: PreferredContactChannel;
    status?: string;
    notes?: string | null;
  };
  enquiryContext?: {
    responseType?: InquiryResponseType;
    preferredContactChannel?: PreferredContactChannel;
    customerStatus?: InquiryCustomerStatus;
    interestedIn?: string;
    trialGiven?: boolean;
    trialDays?: number;
    trialAttempts?: number;
    trialExpiryAt?: string;
  };
}

export interface InquiryAnalyticsQuery {
  clientRepStaffId?: number;
  assignedToStaffId?: number;
  branchId?: number;
  branchCode?: string;
  from?: string;
  to?: string;
  [key: string]: string | number | undefined;
}

export interface InquiryAnalyticsResponse {
  [key: string]: unknown;
}

export interface AssignInquiryRequest {
  assignedToStaffId: number;
  changedByStaffId?: number;
  remarks?: string;
}

export interface BulkAssignInquiriesRequest {
  inquiryIds: number[];
  assignedToStaffId: number;
  changedByStaffId?: number;
  remarks?: string;
}

export interface BulkAssignInquiriesResponse {
  assignedToStaffId: number;
  requestedCount: number;
  updatedCount: number;
  inquiryIds: number[];
}

export interface CloseInquiryRequest {
  status: "NOT_INTERESTED" | "LOST";
  closeReason: string;
  changedByStaffId?: number;
  remarks?: string;
}
