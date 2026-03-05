export type InquiryStatus =
  | "NEW"
  | "FOLLOW_UP"
  | "TRIAL"
  | "NEGOTIATION"
  | "CONVERTED"
  | "LOST"
  | (string & {});

export interface InquiryRecord {
  inquiryId: number;
  fullName: string;
  mobileNumber: string;
  alternateMobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  inquiryAt?: string;
  clientRepStaffId?: number;
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
  branchCode?: string;
  notes?: string;
  remarks?: string;
  status: InquiryStatus;
  converted: boolean;
  memberId?: number;
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
  branchCode?: string;
  notes?: string;
  remarks?: string;
}

export interface UpdateInquiryRequest {
  fullName?: string;
  mobileNumber?: string;
  alternateMobileNumber?: string;
  email?: string;
  dateOfBirth?: string;
  inquiryAt?: string;
  clientRepStaffId?: number;
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
  branchCode?: string;
  notes?: string;
  remarks?: string;
  status?: InquiryStatus;
  converted?: boolean;
  memberId?: number;
}

export interface InquirySearchQuery {
  query?: string;
  status?: string;
  clientRepStaffId?: number;
  branchCode?: string;
  converted?: boolean;
  from?: string;
  to?: string;
  [key: string]: string | number | boolean | undefined;
}
