import type {
  CreateInquiryRequest,
  InquiryConvertibility,
  InquiryCustomerStatus,
  InquiryStatus,
} from "@/types/inquiry";
import { toDateTimeLocalInput } from "@/lib/formatters";
import { CLOSEABLE_STATUSES, NUMERIC_FIELDS } from "./inquiry-form-constants";
import type { InquiryCoreFormValues, InquiryCreateFormValues, FollowUpPlanValues } from "./inquiry-form-types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createEmptyInquiryForm(initialStaffId?: number | null): InquiryCreateFormValues {
  return {
    firstName: "",
    lastName: "",
    fullName: "",
    mobileNumber: "",
    alternateMobileNumber: "",
    email: "",
    dateOfBirth: "",
    inquiryAt: toDateTimeLocalInput(new Date().toISOString()),
    clientRepStaffId: initialStaffId ? String(initialStaffId) : "",
    gender: "",
    aadhaarNumber: "",
    gstNumber: "",
    defaultTrainerStaffId: "",
    referredByType: "",
    referredByName: "",
    promotionSource: "",
    employmentStatus: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    branchCode: "",
    notes: "",
    remarks: "",
    responseType: "NEEDS_DETAILS",
    preferredContactChannel: "CALL",
    customerStatus: "",
    interestedIn: "",
    trialGiven: false,
    trialDays: "",
    trialExpiryAt: "",
    followUpComment: "",
    status: "NEW",
    convertibility: "WARM",
    closeReason: "",
  };
}

export function createEmptyFollowUpPlan(initialStaffId?: number | null): FollowUpPlanValues {
  return {
    responseType: "NEEDS_DETAILS",
    assignedToStaffId: initialStaffId ? String(initialStaffId) : "",
    followUpAt: "",
    followUpComment: "",
    contactType: "CALL",
    trialGiven: false,
    trialDays: "",
    trialExpiryAt: "",
    closeReason: "",
  };
}

// ---------------------------------------------------------------------------
// Sanitisation / parsing
// ---------------------------------------------------------------------------

export function sanitizeFormValue(key: keyof InquiryCoreFormValues, value: string): string {
  if (!NUMERIC_FIELDS.has(key)) {
    return value;
  }
  return value.replace(/[^0-9]/g, "").slice(0, 10);
}

export function parseNumeric(value: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toIsoDatetime(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

export function buildFullName(values: InquiryCreateFormValues): string {
  const joined = `${values.firstName} ${values.lastName}`.trim();
  return joined || values.fullName.trim();
}

export function toCreateInquiryPayload(values: InquiryCoreFormValues): CreateInquiryRequest {
  const status = toOptionalString(values.status) as InquiryStatus | undefined;
  const convertibility = toOptionalString(values.convertibility) as InquiryConvertibility | undefined;
  const closeReason = toOptionalString(values.closeReason);
  const trialDays = parseNumeric(values.trialDays);
  const customerStatus = toOptionalString(values.customerStatus) as InquiryCustomerStatus | undefined;

  return {
    fullName: values.fullName.trim(),
    mobileNumber: values.mobileNumber.trim(),
    alternateMobileNumber: toOptionalString(values.alternateMobileNumber),
    email: toOptionalString(values.email),
    dateOfBirth: toOptionalString(values.dateOfBirth),
    inquiryAt: toIsoDatetime(values.inquiryAt),
    clientRepStaffId: parseNumeric(values.clientRepStaffId),
    gender: toOptionalString(values.gender),
    aadhaarNumber: toOptionalString(values.aadhaarNumber),
    gstNumber: toOptionalString(values.gstNumber),
    defaultTrainerStaffId: parseNumeric(values.defaultTrainerStaffId),
    referredByType: toOptionalString(values.referredByType),
    referredByName: toOptionalString(values.referredByName),
    promotionSource: toOptionalString(values.promotionSource),
    employmentStatus: toOptionalString(values.employmentStatus),
    address: toOptionalString(values.address),
    emergencyContactName: toOptionalString(values.emergencyContactName),
    emergencyContactPhone: toOptionalString(values.emergencyContactPhone),
    emergencyContactRelation: toOptionalString(values.emergencyContactRelation),
    branchCode: toOptionalString(values.branchCode),
    notes: toOptionalString(values.notes),
    remarks: toOptionalString(values.remarks),
    responseType: values.responseType,
    preferredContactChannel: values.preferredContactChannel,
    customerStatus,
    interestedIn: toOptionalString(values.interestedIn),
    trialGiven: values.trialGiven,
    trialDays,
    trialDaysGiven: trialDays,
    trialExpiryAt: toIsoDatetime(values.trialExpiryAt),
    followUpComment: toOptionalString(values.followUpComment),
    status,
    convertibility,
    closeReason: status && CLOSEABLE_STATUSES.has(status) ? closeReason : undefined,
  };
}

// ---------------------------------------------------------------------------
// Follow-up date quick-pick helpers
// ---------------------------------------------------------------------------

export function getQuickPickDate(offset: "tomorrow" | "3days" | "1week"): string {
  const date = new Date();

  switch (offset) {
    case "tomorrow":
      date.setDate(date.getDate() + 1);
      date.setHours(9, 0, 0, 0);
      break;
    case "3days":
      date.setDate(date.getDate() + 3);
      date.setHours(9, 0, 0, 0);
      break;
    case "1week":
      date.setDate(date.getDate() + 7);
      date.setHours(9, 0, 0, 0);
      break;
  }

  return toDateTimeLocalInput(date.toISOString());
}
