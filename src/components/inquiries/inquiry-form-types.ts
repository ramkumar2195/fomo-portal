import {
  InquiryConvertibility,
  InquiryCustomerStatus,
  InquiryResponseType,
  InquiryStatus,
  PreferredContactChannel,
} from "@/types/inquiry";
import { FollowUpChannel } from "@/types/follow-up";

export interface InquiryCoreFormValues {
  fullName: string;
  mobileNumber: string;
  alternateMobileNumber: string;
  email: string;
  dateOfBirth: string;
  inquiryAt: string;
  clientRepStaffId: string;
  gender: string;
  aadhaarNumber: string;
  gstNumber: string;
  defaultTrainerStaffId: string;
  referredByType: string;
  referredByName: string;
  promotionSource: string;
  employmentStatus: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  branchCode: string;
  notes: string;
  remarks: string;
  responseType: InquiryResponseType;
  preferredContactChannel: PreferredContactChannel;
  customerStatus: InquiryCustomerStatus | "";
  interestedIn: string;
  trialGiven: boolean;
  trialDays: string;
  trialExpiryAt: string;
  followUpComment: string;
  status: InquiryStatus;
  convertibility: InquiryConvertibility;
  closeReason: string;
}

export interface InquiryCreateFormValues extends InquiryCoreFormValues {
  firstName: string;
  lastName: string;
}

export interface FollowUpPlanValues {
  responseType: InquiryResponseType;
  assignedToStaffId: string;
  followUpAt: string;
  followUpComment: string;
  contactType: FollowUpChannel;
  trialGiven: boolean;
  trialDays: string;
  trialExpiryAt: string;
}

export interface StaffOption {
  id: number;
  label: string;
}

export interface SelectOption {
  label: string;
  value: string;
}
