import type { InquiryStatus, InquiryResponseType } from "@/types/inquiry";
import type { InquiryCoreFormValues, SelectOption } from "./inquiry-form-types";

// ---------------------------------------------------------------------------
// Existing constants (moved from page.tsx)
// ---------------------------------------------------------------------------

export const PROMOTION_SOURCE_OPTIONS: SelectOption[] = [
  { label: "Walk-in", value: "WALK_IN" },
  { label: "Instagram", value: "INSTAGRAM" },
  { label: "Facebook", value: "FACEBOOK" },
  { label: "Google", value: "GOOGLE" },
  { label: "Referral", value: "REFERRAL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "SMS", value: "SMS" },
  { label: "Call", value: "CALL" },
  { label: "Other", value: "OTHER" },
];

// Legacy fallback used by the enquiry edit side panel. The add-enquiry flow now
// loads sellable options dynamically from catalog variants.
export const INTERESTED_SERVICE_OPTIONS: SelectOption[] = [
  { label: "FOMO Core", value: "FOMO Core" },
  { label: "FOMO Core Plus", value: "FOMO Core Plus" },
  { label: "FOMO Core Rhythm", value: "FOMO Core Rhythm" },
  { label: "FOMO Move", value: "FOMO Move" },
  { label: "FOMO Move Plus", value: "FOMO Move Plus" },
  { label: "FOMO Black", value: "FOMO Black" },
  { label: "Calisthenics", value: "Calisthenics" },
  { label: "Boxing", value: "Boxing" },
  { label: "Kickboxing", value: "Kickboxing" },
  { label: "Yoga", value: "Yoga" },
  { label: "Zumba", value: "Zumba" },
  { label: "HIIT", value: "HIIT" },
];

export const INQUIRY_STATUS_OPTIONS: SelectOption[] = [
  { label: "NEW", value: "NEW" },
  { label: "CONTACTED", value: "CONTACTED" },
  { label: "FOLLOW UP", value: "FOLLOW_UP" },
  { label: "TRIAL BOOKED", value: "TRIAL_BOOKED" },
  { label: "CONVERTED", value: "CONVERTED" },
  { label: "NOT INTERESTED", value: "NOT_INTERESTED" },
  { label: "LOST", value: "LOST" },
];

export const CONVERTIBILITY_OPTIONS: SelectOption[] = [
  { label: "HOT", value: "HOT" },
  { label: "WARM", value: "WARM" },
  { label: "COLD", value: "COLD" },
];

export const RESPONSE_TYPE_OPTIONS: SelectOption[] = [
  { label: "New Follow-up", value: "NEEDS_DETAILS" },
  { label: "Follow-up Again", value: "ASKED_CALLBACK" },
  { label: "Trial Booked", value: "REQUESTED_TRIAL" },
  { label: "Ready to Convert", value: "READY_TO_PAY" },
  { label: "Not Interested (Price/Joined Another Gym)", value: "NOT_INTERESTED" },
];

export function deriveInquiryStatusFromResponseType(responseType?: InquiryResponseType): InquiryStatus {
  switch (responseType) {
    case "ASKED_CALLBACK":
      return "FOLLOW_UP";
    case "REQUESTED_TRIAL":
      return "TRIAL_BOOKED";
    case "READY_TO_PAY":
      return "CONTACTED";
    case "NOT_INTERESTED":
      return "NOT_INTERESTED";
    case "NEEDS_DETAILS":
    default:
      return "CONTACTED";
  }
}

export function followUpResponseRequiresSchedule(responseType?: InquiryResponseType): boolean {
  return responseType === "ASKED_CALLBACK" || responseType === "NEEDS_DETAILS" || responseType === "REQUESTED_TRIAL";
}

export function followUpResponseRequiresTrialDetails(responseType?: InquiryResponseType): boolean {
  return responseType === "REQUESTED_TRIAL";
}

export function followUpResponseRequiresComment(responseType?: InquiryResponseType): boolean {
  return responseType === "ASKED_CALLBACK" || responseType === "NEEDS_DETAILS" || responseType === "REQUESTED_TRIAL";
}

export function followUpResponseRequiresCloseReason(responseType?: InquiryResponseType): boolean {
  return responseType === "NOT_INTERESTED";
}

export function followUpResponseRequiresAssignment(responseType?: InquiryResponseType): boolean {
  return followUpResponseRequiresSchedule(responseType);
}

export function followUpResponseOpensOnboarding(responseType?: InquiryResponseType): boolean {
  return responseType === "READY_TO_PAY";
}

export const OTHER_REFERRAL_OPTIONS: SelectOption[] = [
  { label: "Friend", value: "Friend" },
  { label: "Family", value: "Family" },
  { label: "External Reference", value: "External Reference" },
];

export const CLOSEABLE_STATUSES = new Set<InquiryStatus>(["NOT_INTERESTED", "LOST"]);

export const NUMERIC_FIELDS = new Set<keyof InquiryCoreFormValues>([
  "mobileNumber",
  "alternateMobileNumber",
  "clientRepStaffId",
  "defaultTrainerStaffId",
  "emergencyContactPhone",
  "trialDays",
]);

// ---------------------------------------------------------------------------
// New constants (fields that exist in the API but were missing from the UI)
// ---------------------------------------------------------------------------

export const CUSTOMER_STATUS_OPTIONS: SelectOption[] = [
  { label: "New Lead", value: "NEW_LEAD" },
  { label: "Existing Member", value: "EXISTING_MEMBER" },
  { label: "Former Member", value: "FORMER_MEMBER" },
  { label: "Corporate", value: "CORPORATE" },
  { label: "Student", value: "STUDENT" },
  { label: "Other", value: "OTHER" },
];

export const PREFERRED_CONTACT_CHANNEL_OPTIONS: SelectOption[] = [
  { label: "Call", value: "CALL" },
  { label: "WhatsApp", value: "WHATSAPP" },
  { label: "SMS", value: "SMS" },
  { label: "Email", value: "EMAIL" },
];

export const GENDER_OPTIONS: SelectOption[] = [
  { label: "Male", value: "MALE" },
  { label: "Female", value: "FEMALE" },
  { label: "Other", value: "OTHER" },
];

export const EMPLOYMENT_STATUS_OPTIONS: SelectOption[] = [
  { label: "Employed", value: "EMPLOYED" },
  { label: "Self-Employed", value: "SELF_EMPLOYED" },
  { label: "Student", value: "STUDENT" },
  { label: "Homemaker", value: "HOMEMAKER" },
  { label: "Retired", value: "RETIRED" },
  { label: "Other", value: "OTHER" },
];

export const REFERRED_BY_TYPE_OPTIONS: SelectOption[] = [
  { label: "Member", value: "MEMBER" },
  { label: "Trainer", value: "TRAINER" },
  { label: "Staff", value: "STAFF" },
  { label: "Other", value: "OTHER" },
];
