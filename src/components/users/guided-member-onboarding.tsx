"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  Layers3,
  Phone,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import { BillingWorkflowTemplate } from "@/components/billing/billing-workflow-template";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasCapability } from "@/lib/access-policy";
import { ApiError } from "@/lib/api/http-client";
import { BillingSettings, CatalogProduct, CatalogVariant, MembershipPolicySettings, subscriptionService } from "@/lib/api/services/subscription-service";
import { formatDateTime } from "@/lib/formatters";
import { formatInquiryCode } from "@/lib/inquiry-code";
import { trainingService } from "@/lib/api/services/training-service";
import { engagementService } from "@/lib/api/services/engagement-service";
import { RegisterUserRequest, usersService } from "@/lib/api/services/users-service";
import { resolveStaffId } from "@/lib/staff-id";
import { EmploymentType } from "@/types/auth";
import { InquiryRecord } from "@/types/inquiry";
import { UserDirectoryItem } from "@/types/models";

interface GuidedMemberOnboardingProps {
  sourceInquiryId: number;
}

interface MemberFormState {
  fullName: string;
  mobileNumber: string;
  password: string;
  email: string;
  alternateMobileNumber: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  defaultBranchId: string;
}

interface SubscriptionFormState {
  productVariantId: string;
  includeAddOn: boolean;
  addOnVariantId: string;
  startDate: string;
  primarySellingPrice: string;
  primaryDiscountPercent: string;
  addOnSellingPrice: string;
  addOnDiscountPercent: string;
  paymentMode: string;
  receivedAmount: string;
  balanceDueDate: string;
  paymentCardSubtype: "DEBIT_CARD" | "CREDIT_CARD";
  paymentUpiVendor: "GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER";
}

type PtScheduleTemplate = "EVERYDAY" | "ALTERNATE_DAYS";

interface PtSetupFormState {
  coachId: string;
  startDate: string;
  endDate: string;
  totalSessions: string;
  scheduleTemplate: PtScheduleTemplate;
  scheduleDays: string[];
  slotStartTime: string;
}

interface ComplementaryFieldState {
  enabled: boolean;
  count: string;
  recurrence: string;
}

interface ComplementaryState {
  steam: ComplementaryFieldState;
  iceBath: ComplementaryFieldState;
  nutritionCounseling: ComplementaryFieldState;
  physiotherapyCounseling: ComplementaryFieldState;
  passBenefit: {
    enabled: boolean;
    days: string;
  };
}

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
}

interface CompletedOnboardingState {
  memberId: number;
  memberSubscriptionId: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  receiptId?: number;
  receiptNumber?: string;
  paymentStatus: string;
  paymentMode: string;
  paymentModeLabel: string;
  totalPaidAmount: number;
  balanceAmount: number;
  membershipActivated: boolean;
  balanceDueFollowUpCreated?: boolean;
  balanceDueFollowUpDueAt?: string;
}

const PT_ASSIGNABLE_DESIGNATIONS = new Set(["PT_COACH", "GENERAL_TRAINER", "HEAD_COACH"]);
const FUTURE_START_DATE_MAX_OFFSET_DAYS = 2;

function formatDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateInput(dateInput: string, days: number): string {
  const source = dateInput ? new Date(`${dateInput}T00:00:00`) : new Date();
  source.setDate(source.getDate() + days);
  return formatDateInputValue(source);
}

interface OnboardingDraftState {
  currentStep: OnboardingStep;
  memberForm: MemberFormState;
  subscriptionForm: SubscriptionFormState;
  ptSetupForm: PtSetupFormState;
  complementaries: ComplementaryState;
  membershipLineItems: MembershipLineItem[];
  showPtComposer: boolean;
  primaryCategoryFilter: string;
  primaryProductFilter: string;
  addOnCategoryFilter: string;
  addOnProductFilter: string;
}

interface StepItem {
  step: OnboardingStep;
  label: string;
  description: string;
}

interface MembershipLineItem {
  lineType: "PRIMARY" | "PT_ADD_ON";
  categoryCode: string;
  productCode: string;
  productName: string;
  variantId: string;
  variantName: string;
  basePrice: number;
  sellingPrice: number;
  discountPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
}

type OnboardingStep = 1 | 2 | 3;
interface CommercialBreakdown {
  baseAmount: number;
  sellingPrice: number;
  discountPercent: number;
  discountAmount: number;
}

const CREATE_MEMBER_CAPABILITIES = [
  "MEMBER_CREATE",
  "MEMBER_ONBOARDING",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

const INQUIRY_CONVERT_CAPABILITIES = ["INQUIRY_CONVERT", "MEMBER_ONBOARDING", "INQUIRY_MANAGE"] as const;

const FLAGSHIP_PRODUCT_CODES = new Set([
  "FOMO_CORE",
  "FOMO_CORE_PLUS",
  "FOMO_CORE_RHYTHM",
  "FOMO_BLACK",
]);

const RECURRENCE_OPTIONS = [
  { label: "Full term", value: "FULL_TERM" },
  { label: "Monthly", value: "MONTHLY" },
  { label: "Quarterly", value: "QUARTERLY" },
  { label: "Half yearly", value: "HALF_YEARLY" },
] as const;

const PAYMENT_MODE_OPTIONS = [
  { label: "UPI", value: "UPI" },
  { label: "Card", value: "CARD" },
  { label: "Cash", value: "CASH" },
] as const;

const PAYMENT_CARD_OPTIONS = [
  { label: "Debit Card", value: "DEBIT_CARD" },
  { label: "Credit Card", value: "CREDIT_CARD" },
] as const;

const PAYMENT_UPI_OPTIONS = [
  { label: "Google Pay", value: "GOOGLE_PAY" },
  { label: "PhonePe", value: "PHONEPE" },
  { label: "Paytm", value: "PAYTM" },
  { label: "Other UPI", value: "OTHER" },
] as const;

const PT_SLOT_DURATION_MINUTES = 60;
const PT_WEEKDAY_OPTIONS = [
  { code: "MONDAY", label: "Mon" },
  { code: "TUESDAY", label: "Tue" },
  { code: "WEDNESDAY", label: "Wed" },
  { code: "THURSDAY", label: "Thu" },
  { code: "FRIDAY", label: "Fri" },
  { code: "SATURDAY", label: "Sat" },
] as const;
const PT_EVERYDAY_DAY_CODES = PT_WEEKDAY_OPTIONS.map((day) => day.code);
const ONBOARDING_COMPLETION_STORAGE_PREFIX = "guided-member-onboarding-completed";
const ONBOARDING_DRAFT_STORAGE_PREFIX = "guided-member-onboarding-draft";

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatPaymentCollectionStatus(receivedAmount: number, balanceAmount: number): string {
  const roundedReceivedAmount = Math.round(receivedAmount || 0);
  const roundedBalanceAmount = Math.round(balanceAmount || 0);

  if (roundedReceivedAmount <= 0) {
    return "Pending";
  }
  if (roundedBalanceAmount > 0) {
    return "Pending";
  }
  return "Paid";
}

function formatInvoiceLifecycleStatus(invoiceStatus?: string, completed = false): string {
  if (!completed) {
    return "Will be issued on completion";
  }
  const normalized = String(invoiceStatus || "").toUpperCase();
  if (normalized === "PARTIALLY_PAID") {
    return "Partially Paid";
  }
  if (normalized === "PAID") {
    return "Paid";
  }
  if (normalized === "ISSUED") {
    return "Issued";
  }
  return normalized.replace(/_/g, " ") || "-";
}

function formatPlanDurationLabel(durationMonths = 0, validityDays = 0): string {
  if (durationMonths > 0) {
    return `${durationMonths} Month${durationMonths === 1 ? "" : "s"}`;
  }
  if (validityDays > 0) {
    return `${validityDays} Day${validityDays === 1 ? "" : "s"}`;
  }
  return "-";
}

function formatFlexUsageLabel(checkInLimit = 0, validityDays = 0): string {
  const normalizedCheckInLimit = Math.max(0, Number(checkInLimit || 0));
  if (normalizedCheckInLimit <= 0) {
    return validityDays > 0 ? `${validityDays} days validity` : "-";
  }
  const validityLabel = validityDays > 0 ? ` within ${validityDays} days` : "";
  return `Use on any ${normalizedCheckInLimit} days${validityLabel}`;
}

function sanitizeMembershipLabel(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "-";
  }

  return raw
    .replace(/\b\d+\s*(M|L)\b/gi, "")
    .replace(/\b\d+\s*months?\b/gi, "")
    .replace(/\b\d+\s*days?\b/gi, "")
    .replace(/[·,-]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveMemberId(createdUser: UserDirectoryItem): number | null {
  const directId = Number(String(createdUser.id || "").trim());
  if (!Number.isNaN(directId) && Number.isFinite(directId)) {
    return directId;
  }

  const idDigits = String(createdUser.id || "").replace(/[^0-9]/g, "");
  if (idDigits.length > 0) {
    const parsed = Number(idDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const mobileDigits = String(createdUser.mobile || "").replace(/[^0-9]/g, "");
  if (mobileDigits.length > 0) {
    const parsed = Number(mobileDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeNumericString(value: string): string {
  return value.replace(/[^0-9.]/g, "");
}

function sanitizeIntegerString(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function formatDecimalInput(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function resolveCommercialBreakdown(baseAmount: number, sellingPriceValue?: string, discountPercentValue?: string): CommercialBreakdown {
  const normalizedBaseAmount = Math.max(0, Number(baseAmount || 0));
  const parsedDiscountPercent = toNumber(discountPercentValue || "");
  const parsedSellingPrice = toNumber(sellingPriceValue || "");

  if (parsedDiscountPercent !== undefined) {
    const normalizedDiscountPercent = Math.min(100, Math.max(0, Number(parsedDiscountPercent.toFixed(2))));
    const sellingPrice = Number((normalizedBaseAmount * (1 - normalizedDiscountPercent / 100)).toFixed(2));
    const discountAmount = Number((normalizedBaseAmount - sellingPrice).toFixed(2));
    return {
      baseAmount: normalizedBaseAmount,
      sellingPrice,
      discountPercent: normalizedDiscountPercent,
      discountAmount,
    };
  }

  if (parsedSellingPrice !== undefined) {
    const sellingPrice = Math.min(normalizedBaseAmount, Math.max(0, Number(parsedSellingPrice.toFixed(2))));
    const discountAmount = Number((normalizedBaseAmount - sellingPrice).toFixed(2));
    const discountPercent =
      normalizedBaseAmount > 0 ? Number(((discountAmount / normalizedBaseAmount) * 100).toFixed(2)) : 0;
    return {
      baseAmount: normalizedBaseAmount,
      sellingPrice,
      discountPercent,
      discountAmount,
    };
  }

  return {
    baseAmount: normalizedBaseAmount,
    sellingPrice: normalizedBaseAmount,
    discountPercent: 0,
    discountAmount: 0,
  };
}

function normalizeBranchId(value?: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "default" || trimmed.toLowerCase() === "null") {
    return "";
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function featurePillLabel(feature: string): string {
  return feature
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeDisplayVariantName(value: string): string {
  return value
    .replace(/\b(1|3|6|12)M\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-/]\s*$/g, "")
    .trim();
}

function shouldShowVariantSubtitle(variantName: string, productName: string | undefined, productCode: string): boolean {
  const normalizedVariantName = normalizeDisplayVariantName(variantName).toUpperCase();
  const normalizedProductName = normalizeDisplayVariantName(productName || productCode).toUpperCase();
  return normalizedProductName.length > 0 && normalizedProductName !== normalizedVariantName;
}

function splitFeatures(features: string): string[] {
  return features
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
}

function shouldShowOnboardingFeatureChip(feature: string): boolean {
  const normalized = String(feature || "").trim().toUpperCase();
  return ![
    "PAUSE_BENEFIT",
    "PAUSE_BENEFITS",
    "PASS_BENEFIT",
    "PASS_BENEFITS",
    "STEAM_ACCESS",
    "ICE_BATH_ACCESS",
  ].includes(normalized);
}

function isFlagshipVariant(variant: CatalogVariant | undefined): boolean {
  return Boolean(variant && FLAGSHIP_PRODUCT_CODES.has(variant.productCode));
}

function isTransformationVariant(variant: CatalogVariant | undefined): boolean {
  return Boolean(variant && variant.categoryCode?.toUpperCase() === "TRANSFORMATION");
}

function needsTrainerAssignment(variant: CatalogVariant | undefined): boolean {
  return isFlagshipVariant(variant) || isTransformationVariant(variant);
}

function isFlexVariant(variant: CatalogVariant | undefined): boolean {
  return Boolean(variant && (variant.categoryCode?.toUpperCase() === "FLEX" || variant.productCode?.toUpperCase().includes("FLEX")));
}

function isGroupClassVariant(variant: CatalogVariant | undefined): boolean {
  return Boolean(variant && variant.categoryCode?.toUpperCase() === "GROUP_CLASS");
}

function deriveProgramKeywords(product: CatalogProduct | undefined, variant: CatalogVariant | undefined): string[] {
  if (!variant) {
    return [];
  }

  const keywords: string[] = [];
  const pushKeyword = (keyword: string) => {
    const normalized = keyword.trim().toLowerCase();
    if (normalized && !keywords.includes(normalized)) {
      keywords.push(normalized);
    }
  };
  const productCode = String(product?.productCode || variant.productCode || "").toUpperCase();
  const productName = String(product?.productName || "").toUpperCase();
  const variantName = String(variant.variantName || "").toUpperCase();
  const features = splitFeatures(variant.includedFeatures || "").map((feature) => feature.toUpperCase());

  const featureToKeyword: Array<[string, string]> = [
    ["YOGA_ACCESS", "yoga"],
    ["ZUMBA_ACCESS", "zumba"],
    ["HIIT_ACCESS", "hiit"],
    ["COREFLEX_ACCESS", "core flex"],
    ["CROSSFIT_ACCESS", "crossfit"],
    ["BOXING_ACCESS", "boxing"],
    ["KICKBOXING_ACCESS", "kickboxing"],
    ["CALISTHENICS_ACCESS", "calisthenics"],
  ];

  featureToKeyword.forEach(([feature, keyword]) => {
    if (features.includes(feature)) {
      pushKeyword(keyword);
    }
  });

  if (productCode.includes("CALISTHENICS") || variantName.includes("CALISTHENICS")) {
    if (variantName.includes("KIDS")) {
      pushKeyword("calisthenics kids");
    } else if (variantName.includes("ADULT")) {
      pushKeyword("calisthenics adults");
    } else if (variantName.includes("SELF")) {
      pushKeyword("calisthenics self");
    }
  }
  if (productCode.includes("BOXING") || variantName.includes("BOXING")) {
    pushKeyword("boxing");
  }
  if (productCode.includes("KICKBOXING") || variantName.includes("KICKBOXING")) {
    pushKeyword("kickboxing");
  }
  if (productCode.includes("FOMO_MOVE") || productCode.includes("RHYTHM") || productName.includes("YOGA") || variantName.includes("YOGA")) {
    if (variantName.includes("YOGA") || features.includes("YOGA_ACCESS")) {
      pushKeyword("yoga");
    }
    if (variantName.includes("ZUMBA") || features.includes("ZUMBA_ACCESS")) {
      pushKeyword("zumba");
    }
  }

  return keywords;
}

function initialComplementaryState(): ComplementaryState {
  return {
    steam: { enabled: false, count: "1", recurrence: "MONTHLY" },
    iceBath: { enabled: false, count: "1", recurrence: "QUARTERLY" },
    nutritionCounseling: { enabled: false, count: "1", recurrence: "FULL_TERM" },
    physiotherapyCounseling: { enabled: false, count: "1", recurrence: "FULL_TERM" },
    passBenefit: { enabled: false, days: "0" },
  };
}

function defaultBillingSettings(): BillingSettings {
  const year = new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  return {
    gstPercentage: 5,
    invoicePrefix: "INV",
    nextInvoiceNumber: 1,
    invoiceSequenceYear: year,
    receiptPrefix: "RCPT",
    nextReceiptNumber: 1,
    receiptSequenceYear: year,
  };
}

function defaultMembershipPolicySettings(): MembershipPolicySettings {
  return {
    freezeMinDays: 7,
    freezeMaxDays: 28,
    maxFreezesPerSubscription: 4,
    freezeCooldownDays: 0,
    upgradeWindowShortDays: 7,
    upgradeWindowMediumDays: 15,
    upgradeWindowLongDays: 28,
    gracePeriodDays: 7,
    autoRenewalEnabled: false,
    renewalReminderDaysBefore: 7,
    transferEnabled: true,
    minPartialPaymentPercent: 50,
  };
}

function meetsActivationThreshold(totalPayable: number, paidAmount: number, minimumPercent: number): boolean {
  const normalizedTotal = Math.max(0, Number(totalPayable || 0));
  const normalizedPaid = Math.max(0, Number(paidAmount || 0));
  const normalizedPercent = Math.min(100, Math.max(0, Number(minimumPercent || 0)));
  if (normalizedTotal <= 0) {
    return false;
  }
  return normalizedPaid >= Number(((normalizedTotal * normalizedPercent) / 100).toFixed(2));
}

function productFamilyLabel(categoryCode?: string): string {
  if (!categoryCode) {
    return "Membership";
  }

  const normalized = categoryCode.toUpperCase();
  if (normalized === "GROUP_CLASS") {
    return "Group Classes";
  }
  if (normalized === "PT") {
    return "Personal Training";
  }
  if (normalized === "FLAGSHIP") {
    return "Flagship";
  }
  if (normalized === "CREDIT_PACK") {
    return "Credits";
  }
  return featurePillLabel(normalized);
}

function statusBadgeClass(active: boolean): string {
  return active
    ? "border-[#c42924]/40 bg-[#c42924]/12 text-[#ffd7d6]"
    : "border-white/10 bg-white/[0.04] text-slate-300";
}

function derivePtRescheduleLimit(durationMonths: number, unlimited = false): number {
  if (unlimited) {
    return 0;
  }
  return durationMonths > 0 ? 3 : 0;
}

function addMinutesToTime(timeValue: string, minutesToAdd: number): string {
  if (!timeValue) {
    return "";
  }
  const [hours, minutes] = timeValue.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return "";
  }
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const nextHours = Math.floor(totalMinutes / 60) % 24;
  const nextMinutes = totalMinutes % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function formatClockTime(timeValue?: string): string {
  if (!timeValue) {
    return "-";
  }
  const [hoursValue, minutesValue] = String(timeValue).split(":");
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return timeValue;
  }
  const normalizedHours = ((hours % 24) + 24) % 24;
  const meridiem = normalizedHours >= 12 ? "PM" : "AM";
  const displayHours = normalizedHours % 12 || 12;
  return `${String(displayHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function buildPtTimeSlotOptions(): string[] {
  const windows = [
    { start: 5 * 60, end: 22 * 60 },
  ];
  const options: string[] = [];
  windows.forEach((window) => {
    for (let minute = window.start; minute + PT_SLOT_DURATION_MINUTES <= window.end; minute += 30) {
      const hours = Math.floor(minute / 60);
      const mins = minute % 60;
      options.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
    }
  });
  return options;
}

function formatPtDayLabel(dayCode: string): string {
  return PT_WEEKDAY_OPTIONS.find((day) => day.code === dayCode)?.label || featurePillLabel(dayCode);
}

function formatPtProductName(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Personal Training";
  }
  return raw
    .replace(/\bPT\b/gi, "Personal Training")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildSyntheticInternalEmail(seed?: string, domain = "members.fomotraining.internal"): string {
  const normalizedSeed = String(seed || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const safeSeed = normalizedSeed || `member${Date.now()}`;
  return `${safeSeed}@${domain}`;
}

function projectMembershipEndDate(startDate: string, durationMonths = 0, validityDays = 0): string {
  if (!startDate) {
    return "";
  }
  const parsedStart = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(parsedStart.getTime())) {
    return "";
  }

  if (durationMonths > 0) {
    const next = new Date(parsedStart);
    next.setMonth(next.getMonth() + durationMonths);
    next.setDate(next.getDate() - 1);
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, "0");
    const day = String(next.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (validityDays > 0) {
    const next = new Date(parsedStart);
    next.setDate(next.getDate() + Math.max(validityDays - 1, 0));
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, "0");
    const day = String(next.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return startDate;
}

function resolvePaymentModeLabel(
  paymentMode: string,
  cardSubtype: SubscriptionFormState["paymentCardSubtype"],
  upiVendor: SubscriptionFormState["paymentUpiVendor"],
): string {
  if (paymentMode === "CARD") {
    return cardSubtype === "CREDIT_CARD" ? "Credit Card" : "Debit Card";
  }
  if (paymentMode === "UPI") {
    return PAYMENT_UPI_OPTIONS.find((option) => option.value === upiVendor)?.label || "UPI";
  }
  return PAYMENT_MODE_OPTIONS.find((option) => option.value === paymentMode)?.label || paymentMode || "-";
}

export function GuidedMemberOnboarding({ sourceInquiryId }: GuidedMemberOnboardingProps) {
  const router = useRouter();
  const { token, user, accessMetadata } = useAuth();
  const { effectiveBranchId, selectedBranchId, selectedBranchName, selectedBranchCode } = useBranch();

  const canCreateMember = hasCapability(user, accessMetadata, CREATE_MEMBER_CAPABILITIES, true);
  const canConvertInquiry = hasCapability(user, accessMetadata, INQUIRY_CONVERT_CAPABILITIES, true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [inquiry, setInquiry] = useState<InquiryRecord | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [branchCoaches, setBranchCoaches] = useState<UserDirectoryItem[]>([]);
  const [branchMembers, setBranchMembers] = useState<UserDirectoryItem[]>([]);
  const [branchTeamUsers, setBranchTeamUsers] = useState<UserDirectoryItem[]>([]);
  const [assignedTrainer, setAssignedTrainer] = useState<UserDirectoryItem | null>(null);
  const [manualTrainerId, setManualTrainerId] = useState<string>("");
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(defaultBillingSettings);
  const [membershipPolicySettings, setMembershipPolicySettings] = useState<MembershipPolicySettings>(defaultMembershipPolicySettings);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [completedOnboarding, setCompletedOnboarding] = useState<CompletedOnboardingState | null>(null);
  const [documentBusyKey, setDocumentBusyKey] = useState<string | null>(null);
  const [membershipLineItems, setMembershipLineItems] = useState<MembershipLineItem[]>([]);
  const membershipTableRef = useRef<HTMLDivElement | null>(null);
  const previousActivePtSetupVariantIdRef = useRef<string>("");
  const previousAutoReceivedAmountRef = useRef<number>(0);
  const [showPtComposer, setShowPtComposer] = useState(false);
  const [primaryCategoryFilter, setPrimaryCategoryFilter] = useState("");
  const [primaryProductFilter, setPrimaryProductFilter] = useState("");
  const [addOnCategoryFilter, setAddOnCategoryFilter] = useState("");
  const [addOnProductFilter, setAddOnProductFilter] = useState("");

  const [memberForm, setMemberForm] = useState<MemberFormState>({
    fullName: "",
    mobileNumber: "",
    password: "",
    email: "",
    alternateMobileNumber: "",
    dateOfBirth: "",
    gender: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    defaultBranchId: normalizeBranchId(selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId)),
  });

  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionFormState>({
    productVariantId: "",
    includeAddOn: false,
    addOnVariantId: "",
    startDate: new Date().toISOString().slice(0, 10),
    primarySellingPrice: "",
    primaryDiscountPercent: "",
    addOnSellingPrice: "",
    addOnDiscountPercent: "",
    paymentMode: "UPI",
    receivedAmount: "",
    balanceDueDate: "",
    paymentCardSubtype: "DEBIT_CARD",
    paymentUpiVendor: "GOOGLE_PAY",
  });
  const [ptSetupForm, setPtSetupForm] = useState<PtSetupFormState>({
    coachId: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    totalSessions: "",
    scheduleTemplate: "ALTERNATE_DAYS",
    scheduleDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
    slotStartTime: "06:00",
  });

  const [complementaries, setComplementaries] = useState<ComplementaryState>(initialComplementaryState);
  const completionStorageKey = `${ONBOARDING_COMPLETION_STORAGE_PREFIX}:${sourceInquiryId}`;
  const draftStorageKey = `${ONBOARDING_DRAFT_STORAGE_PREFIX}:${sourceInquiryId}`;
  const pendingDraftRef = useRef<OnboardingDraftState | null>(null);
  const draftHydratedRef = useRef(false);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!completedOnboarding) {
      return;
    }

    try {
      window.sessionStorage.setItem(completionStorageKey, JSON.stringify(completedOnboarding));
    } catch {
      // Ignore storage failures and keep the in-memory completion state.
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    void router.prefetch("/portal/members");
    void router.prefetch(`/admin/members/${completedOnboarding.memberId}`);
  }, [completedOnboarding, completionStorageKey, router]);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(completionStorageKey);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored) as CompletedOnboardingState;
      if (parsed && typeof parsed.memberId === "number" && typeof parsed.invoiceId === "number") {
        setCompletedOnboarding(parsed);
        setCurrentStep(3);
      }
    } catch {
      // Ignore invalid persisted onboarding state.
    }
  }, [completionStorageKey]);

  useEffect(() => {
    draftHydratedRef.current = false;
    pendingDraftRef.current = null;
    try {
      const storedDraft = window.localStorage.getItem(draftStorageKey);
      if (!storedDraft) {
        return;
      }
      pendingDraftRef.current = JSON.parse(storedDraft) as OnboardingDraftState;
    } catch {
      pendingDraftRef.current = null;
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inquiryResult, productsResult, variantsResult, billingSettingsResult, membershipPolicyResult] = await Promise.allSettled([
          subscriptionService.getInquiryById(token, sourceInquiryId),
          subscriptionService.getCatalogProducts(token),
          subscriptionService.getCatalogVariants(token),
          subscriptionService.getBillingSettings(token),
          subscriptionService.getMembershipPolicySettings(token),
        ]);

        if (!active) {
          return;
        }

        if (inquiryResult.status === "fulfilled") {
          const inquiryResponse = inquiryResult.value;
          setInquiry(inquiryResponse);
          setMemberForm((current) => ({
            ...current,
            fullName: inquiryResponse.fullName || "",
            mobileNumber: (inquiryResponse.mobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            password: (inquiryResponse.mobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            email: "",
            alternateMobileNumber: (inquiryResponse.alternateMobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            dateOfBirth: inquiryResponse.dateOfBirth || "",
            gender: inquiryResponse.gender || "",
            address: inquiryResponse.address || "",
            emergencyContactName: inquiryResponse.emergencyContactName || "",
            emergencyContactPhone: (inquiryResponse.emergencyContactPhone || "").replace(/[^0-9]/g, "").slice(0, 10),
            emergencyContactRelation: inquiryResponse.emergencyContactRelation || "",
            defaultBranchId:
              current.defaultBranchId ||
              normalizeBranchId(selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId)),
          }));
        } else {
          throw inquiryResult.reason;
        }

        setProducts(productsResult.status === "fulfilled" ? productsResult.value : []);
        setVariants(variantsResult.status === "fulfilled" ? variantsResult.value : []);
        setBillingSettings(
          billingSettingsResult.status === "fulfilled"
            ? billingSettingsResult.value
            : defaultBillingSettings(),
        );
        setMembershipPolicySettings(
          membershipPolicyResult.status === "fulfilled"
            ? membershipPolicyResult.value
            : defaultMembershipPolicySettings(),
        );
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load inquiry onboarding data.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveBranchId, selectedBranchId, sourceInquiryId, token, user?.defaultBranchId]);

  useEffect(() => {
    const resolvedBranchId = normalizeBranchId(
      selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId),
    );
    if (!resolvedBranchId) {
      return;
    }

    setMemberForm((current) => (current.defaultBranchId === resolvedBranchId ? current : { ...current, defaultBranchId: resolvedBranchId }));
  }, [effectiveBranchId, selectedBranchId, user?.defaultBranchId]);

  useEffect(() => {
    if (loading || draftHydratedRef.current) {
      return;
    }
    draftHydratedRef.current = true;
    const draft = pendingDraftRef.current;
    if (!draft) {
      return;
    }

    setMemberForm(draft.memberForm);
    setSubscriptionForm(draft.subscriptionForm);
    setPtSetupForm(draft.ptSetupForm);
    setComplementaries(draft.complementaries);
    setMembershipLineItems(draft.membershipLineItems);
    setShowPtComposer(draft.showPtComposer);
    setPrimaryCategoryFilter(draft.primaryCategoryFilter);
    setPrimaryProductFilter(draft.primaryProductFilter);
    setAddOnCategoryFilter(draft.addOnCategoryFilter);
    setAddOnProductFilter(draft.addOnProductFilter);
    setCurrentStep(draft.currentStep);
  }, [loading]);

  const primaryVariants = useMemo(
    () =>
      variants
        .filter((variant) => variant.categoryCode !== "PT" && variant.categoryCode !== "CREDIT_PACK")
        .sort((left, right) => left.productCode.localeCompare(right.productCode) || left.durationMonths - right.durationMonths || left.variantName.localeCompare(right.variantName)),
    [variants],
  );

  const addOnVariants = useMemo(
    () =>
      variants
        .filter((variant) => variant.categoryCode === "PT")
        .sort((left, right) => left.variantName.localeCompare(right.variantName)),
    [variants],
  );

  const primaryCategoryOptions = useMemo(
    () =>
      Array.from(new Set(primaryVariants.map((variant) => variant.categoryCode)))
        .filter(Boolean)
        .sort(),
    [primaryVariants],
  );

  const filteredPrimaryProducts = useMemo(
    () =>
      !primaryCategoryFilter
        ? []
        :
      products
        .filter((product) => product.categoryCode === primaryCategoryFilter)
        .filter((product) => primaryVariants.some((variant) => variant.productCode === product.productCode))
        .sort((left, right) => left.productName.localeCompare(right.productName)),
    [primaryCategoryFilter, primaryVariants, products],
  );

  const filteredPrimaryVariants = useMemo(
    () =>
      !primaryCategoryFilter || !primaryProductFilter
        ? []
        :
      primaryVariants.filter((variant) => {
        if (primaryCategoryFilter && variant.categoryCode !== primaryCategoryFilter) {
          return false;
        }
        if (primaryProductFilter && variant.productCode !== primaryProductFilter) {
          return false;
        }
        return true;
      }),
    [primaryCategoryFilter, primaryProductFilter, primaryVariants],
  );

  const addOnCategoryOptions = useMemo(
    () =>
      Array.from(new Set(addOnVariants.map((variant) => variant.categoryCode)))
        .filter(Boolean)
        .sort(),
    [addOnVariants],
  );

  const filteredAddOnProducts = useMemo(
    () =>
      !addOnCategoryFilter
        ? []
        :
      products
        .filter((product) => product.categoryCode === addOnCategoryFilter)
        .filter((product) => addOnVariants.some((variant) => variant.productCode === product.productCode))
        .sort((left, right) => left.productName.localeCompare(right.productName)),
    [addOnCategoryFilter, addOnVariants, products],
  );

  const primaryLineItem = useMemo(
    () => membershipLineItems.find((item) => item.lineType === "PRIMARY") || null,
    [membershipLineItems],
  );

  const ptLineItem = useMemo(
    () => membershipLineItems.find((item) => item.lineType === "PT_ADD_ON") || null,
    [membershipLineItems],
  );

  const draftPrimaryVariant = useMemo(
    () => primaryVariants.find((variant) => variant.variantId === subscriptionForm.productVariantId),
    [primaryVariants, subscriptionForm.productVariantId],
  );

  const selectedPrimaryVariant = useMemo(
    () => primaryVariants.find((variant) => variant.variantId === (primaryLineItem?.variantId || draftPrimaryVariant?.variantId)),
    [draftPrimaryVariant?.variantId, primaryLineItem?.variantId, primaryVariants],
  );

  const selectedPrimaryProduct = useMemo(
    () => products.find((product) => product.productCode === selectedPrimaryVariant?.productCode),
    [products, selectedPrimaryVariant?.productCode],
  );

  const filteredAddOnVariants = useMemo(
    () =>
      !addOnCategoryFilter || !addOnProductFilter
        ? []
        :
      addOnVariants.filter((variant) => {
        if (addOnCategoryFilter && variant.categoryCode !== addOnCategoryFilter) {
          return false;
        }
        if (addOnProductFilter && variant.productCode !== addOnProductFilter) {
          return false;
        }
        return true;
      }),
    [addOnCategoryFilter, addOnProductFilter, addOnVariants],
  );

  const canAddPrimaryMembership = !primaryLineItem;
  const canAddPtMembership = Boolean(primaryLineItem && isFlagshipVariant(selectedPrimaryVariant) && !ptLineItem);

  useEffect(() => {
    if (draftPrimaryVariant) {
      if (primaryCategoryFilter !== draftPrimaryVariant.categoryCode) {
        setPrimaryCategoryFilter(draftPrimaryVariant.categoryCode);
      }
      if (primaryProductFilter !== draftPrimaryVariant.productCode) {
        setPrimaryProductFilter(draftPrimaryVariant.productCode);
      }
      return;
    }

  }, [draftPrimaryVariant, primaryCategoryFilter, primaryCategoryOptions, primaryProductFilter]);

  useEffect(() => {
    if (!primaryCategoryFilter) {
      if (primaryProductFilter) {
        setPrimaryProductFilter("");
      }
      return;
    }

    if (primaryProductFilter && !filteredPrimaryProducts.some((product) => product.productCode === primaryProductFilter)) {
      setPrimaryProductFilter("");
    }
  }, [filteredPrimaryProducts, primaryCategoryFilter, primaryProductFilter]);

  useEffect(() => {
    const selectedVariantStillVisible = filteredPrimaryVariants.some(
      (variant) => variant.variantId === subscriptionForm.productVariantId,
    );
    if (!selectedVariantStillVisible && subscriptionForm.productVariantId) {
      setSubscriptionForm((current) => ({
        ...current,
        productVariantId: "",
        primarySellingPrice: "",
        primaryDiscountPercent: "",
      }));
    }
  }, [filteredPrimaryVariants, subscriptionForm.productVariantId]);

  useEffect(() => {
    if (!canAddPtMembership) {
      if (showPtComposer) {
        setShowPtComposer(false);
      }
      if (addOnCategoryFilter || addOnProductFilter || subscriptionForm.addOnVariantId || subscriptionForm.addOnSellingPrice || subscriptionForm.addOnDiscountPercent) {
        setAddOnCategoryFilter("");
        setAddOnProductFilter("");
        setSubscriptionForm((current) => ({
          ...current,
          addOnVariantId: "",
          addOnSellingPrice: "",
          addOnDiscountPercent: "",
        }));
      }
      return;
    }

    if (subscriptionForm.addOnVariantId) {
      const selectedAddOn = addOnVariants.find((variant) => variant.variantId === subscriptionForm.addOnVariantId);
      if (selectedAddOn) {
        if (addOnCategoryFilter !== selectedAddOn.categoryCode) {
          setAddOnCategoryFilter(selectedAddOn.categoryCode);
        }
        if (addOnProductFilter !== selectedAddOn.productCode) {
          setAddOnProductFilter(selectedAddOn.productCode);
        }
        return;
      }
    }

  }, [addOnCategoryFilter, addOnCategoryOptions, addOnProductFilter, addOnVariants, canAddPtMembership, showPtComposer, subscriptionForm.addOnDiscountPercent, subscriptionForm.addOnSellingPrice, subscriptionForm.addOnVariantId]);

  useEffect(() => {
    if (!addOnCategoryFilter) {
      if (addOnProductFilter) {
        setAddOnProductFilter("");
      }
      return;
    }

    if (addOnProductFilter && !filteredAddOnProducts.some((product) => product.productCode === addOnProductFilter)) {
      setAddOnProductFilter("");
    }
  }, [addOnCategoryFilter, addOnProductFilter, filteredAddOnProducts]);

  useEffect(() => {
    if (!canAddPtMembership || !showPtComposer) {
      return;
    }
    if (!addOnCategoryFilter && addOnCategoryOptions.length > 0) {
      setAddOnCategoryFilter(addOnCategoryOptions[0]);
    }
  }, [addOnCategoryFilter, addOnCategoryOptions, canAddPtMembership, showPtComposer]);

  useEffect(() => {
    const selectedVariantStillVisible = filteredAddOnVariants.some(
      (variant) => variant.variantId === subscriptionForm.addOnVariantId,
    );
    if (!selectedVariantStillVisible && subscriptionForm.addOnVariantId) {
      setSubscriptionForm((current) => ({
        ...current,
        addOnVariantId: "",
        addOnSellingPrice: "",
        addOnDiscountPercent: "",
      }));
    }
  }, [filteredAddOnVariants, subscriptionForm.addOnVariantId]);

  useEffect(() => {
    if (ptSetupForm.scheduleTemplate !== "EVERYDAY") {
      return;
    }
    setPtSetupForm((current) =>
      current.scheduleDays.join(",") === PT_EVERYDAY_DAY_CODES.join(",")
        ? current
        : { ...current, scheduleDays: [...PT_EVERYDAY_DAY_CODES] },
    );
  }, [ptSetupForm.scheduleTemplate]);

  useEffect(() => {
    if (subscriptionForm.startDate && !ptLineItem) {
      setPtSetupForm((current) => (
        current.startDate === subscriptionForm.startDate
          ? current
          : {
              ...current,
              startDate: subscriptionForm.startDate,
            }
      ));
    }
  }, [ptLineItem, subscriptionForm.startDate]);

  const draftSelectedAddOnVariant = useMemo(
    () => addOnVariants.find((variant) => variant.variantId === subscriptionForm.addOnVariantId),
    [addOnVariants, subscriptionForm.addOnVariantId],
  );

  const selectedAddOnVariant = useMemo(
    () => addOnVariants.find((variant) => variant.variantId === (ptLineItem?.variantId || draftSelectedAddOnVariant?.variantId)),
    [addOnVariants, draftSelectedAddOnVariant?.variantId, ptLineItem?.variantId],
  );
  const requiresBundledPtSetup = Boolean(selectedPrimaryVariant && isTransformationVariant(selectedPrimaryVariant));
  const hasUnlimitedPtReschedules = Boolean(
    String(selectedPrimaryProduct?.productCode || "").toUpperCase().includes("BLACK")
      || String(selectedPrimaryVariant?.variantName || "").toUpperCase().includes("BLACK"),
  );
  const activePtSetupVariant = requiresBundledPtSetup ? selectedPrimaryVariant : selectedAddOnVariant;
  const shouldShowPtSetupSection = requiresBundledPtSetup || (canAddPtMembership && showPtComposer);
  const ptEligibleCoaches = useMemo(
    () =>
      branchCoaches.filter((coach) =>
        PT_ASSIGNABLE_DESIGNATIONS.has(String(coach.designation || "").toUpperCase()),
      ),
    [branchCoaches],
  );
  const selectedPtCoach = useMemo(
    () =>
      ptEligibleCoaches.find((coach) => String(coach.id) === String(ptSetupForm.coachId))
      || branchCoaches.find((coach) => String(coach.id) === String(ptSetupForm.coachId))
      || null,
    [branchCoaches, ptEligibleCoaches, ptSetupForm.coachId],
  );
  const ptTimeSlotOptions = useMemo(() => buildPtTimeSlotOptions(), []);
  const selectedPtDays = useMemo(
    () => (ptSetupForm.scheduleTemplate === "EVERYDAY" ? PT_EVERYDAY_DAY_CODES : ptSetupForm.scheduleDays),
    [ptSetupForm.scheduleDays, ptSetupForm.scheduleTemplate],
  );
  const ptSlotEndTime = useMemo(
    () => addMinutesToTime(ptSetupForm.slotStartTime, PT_SLOT_DURATION_MINUTES),
    [ptSetupForm.slotStartTime],
  );
  const projectedPtEndDate = useMemo(
    () =>
      projectMembershipEndDate(
        ptSetupForm.startDate,
        activePtSetupVariant?.durationMonths || 0,
        activePtSetupVariant?.validityDays || 0,
      ),
    [activePtSetupVariant, ptSetupForm.startDate],
  );
  const selectedPtSessionCount = useMemo(() => {
    const parsed = Number(ptSetupForm.totalSessions || 0);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
    return Number(activePtSetupVariant?.includedPtSessions || 0);
  }, [activePtSetupVariant?.includedPtSessions, ptSetupForm.totalSessions]);

  useEffect(() => {
    if (!activePtSetupVariant) {
      previousActivePtSetupVariantIdRef.current = "";
      return;
    }

    const activeVariantId = String(activePtSetupVariant.variantId || "");
    const nextEndDate = ptSetupForm.startDate
      ? projectMembershipEndDate(ptSetupForm.startDate, activePtSetupVariant.durationMonths, activePtSetupVariant.validityDays)
      : "";
    const variantChanged = previousActivePtSetupVariantIdRef.current !== activeVariantId;
    previousActivePtSetupVariantIdRef.current = activeVariantId;

    setPtSetupForm((current) => ({
      ...current,
      endDate: nextEndDate || current.endDate,
      totalSessions: variantChanged || !current.totalSessions
        ? String(activePtSetupVariant.includedPtSessions || 0)
        : current.totalSessions,
      startDate: current.startDate || subscriptionForm.startDate || new Date().toISOString().slice(0, 10),
    }));
  }, [activePtSetupVariant, ptSetupForm.startDate, subscriptionForm.startDate]);

  const primaryDraftCommercial = useMemo(
    () => resolveCommercialBreakdown(
      draftPrimaryVariant?.basePrice || 0,
      subscriptionForm.primarySellingPrice,
      subscriptionForm.primaryDiscountPercent,
    ),
    [draftPrimaryVariant?.basePrice, subscriptionForm.primaryDiscountPercent, subscriptionForm.primarySellingPrice],
  );

  const addOnDraftCommercial = useMemo(
    () => resolveCommercialBreakdown(
      draftSelectedAddOnVariant?.basePrice || 0,
      subscriptionForm.addOnSellingPrice,
      subscriptionForm.addOnDiscountPercent,
    ),
    [draftSelectedAddOnVariant?.basePrice, subscriptionForm.addOnDiscountPercent, subscriptionForm.addOnSellingPrice],
  );

  const primaryDraftCgst = useMemo(
    () => Number(((primaryDraftCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
    [billingSettings.gstPercentage, primaryDraftCommercial.sellingPrice],
  );

  const primaryDraftSgst = useMemo(
    () => Number(((primaryDraftCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
    [billingSettings.gstPercentage, primaryDraftCommercial.sellingPrice],
  );

  const addOnDraftCgst = useMemo(
    () => Number(((addOnDraftCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
    [addOnDraftCommercial.sellingPrice, billingSettings.gstPercentage],
  );

  const addOnDraftSgst = useMemo(
    () => Number(((addOnDraftCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
    [addOnDraftCommercial.sellingPrice, billingSettings.gstPercentage],
  );

  const pricingPreview = useMemo(() => {
    const lineItemCommercials = membershipLineItems.map((item) => ({
      lineType: item.lineType,
      baseAmount: item.basePrice,
      sellingPrice: item.sellingPrice,
      discountPercent: item.discountPercent,
      discountAmount: Number((item.basePrice - item.sellingPrice).toFixed(2)),
    }));
    const primaryCommercial = lineItemCommercials.find((item) => item.lineType === "PRIMARY") || resolveCommercialBreakdown(0);
    const addOnCommercial = lineItemCommercials.find((item) => item.lineType === "PT_ADD_ON") || resolveCommercialBreakdown(0);

    const baseAmount = Number(lineItemCommercials.reduce((sum, item) => sum + item.baseAmount, 0).toFixed(2));
    const discountAmount = Number(lineItemCommercials.reduce((sum, item) => sum + item.discountAmount, 0).toFixed(2));
    const netSaleAmount = Math.round(baseAmount - discountAmount);
    const effectiveDiscountPercent =
      baseAmount > 0 ? Number(((discountAmount / baseAmount) * 100).toFixed(2)) : 0;
    const gstRate = billingSettings.gstPercentage || 0;
    const cgstAmount = Math.round((netSaleAmount * gstRate) / 200);
    const sgstAmount = Math.round((netSaleAmount * gstRate) / 200);
    const gstAmount = cgstAmount + sgstAmount;
    const rawTotalPayable = netSaleAmount + gstAmount;
    const totalPayable = Math.round(rawTotalPayable);
    const enteredReceivedAmount = Math.max(0, Math.round(toNumber(subscriptionForm.receivedAmount) || 0));
    const receivedAmount = Math.max(0, Math.min(totalPayable, enteredReceivedAmount));
    const submittedReceivedAmount = receivedAmount;
    const balanceAmount = Math.max(0, totalPayable - receivedAmount);

    let paymentStatus = "UNPAID";
    if (receivedAmount > 0 && balanceAmount > 0) {
      paymentStatus = "PARTIALLY_PAID";
    } else if (receivedAmount > 0 && balanceAmount === 0) {
      paymentStatus = "PAID";
    }

    const startDate = subscriptionForm.startDate || new Date().toISOString().slice(0, 10);
    const endDate = selectedPrimaryVariant
      ? new Date(new Date(`${startDate}T00:00:00`).getTime() + selectedPrimaryVariant.validityDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : "";

    return {
      primaryCommercial,
      addOnCommercial,
      baseAmount,
      sellingPrice: netSaleAmount,
      discountPercent: effectiveDiscountPercent,
      discountAmount,
      netSaleAmount,
      gstPercentage: gstRate,
      cgstAmount,
      sgstAmount,
      gstAmount,
      rawTotalPayable,
      totalPayable,
      receivedAmount,
      submittedReceivedAmount,
      balanceAmount,
      paymentStatus,
      startDate,
      endDate,
    };
  }, [
    billingSettings.gstPercentage,
    membershipLineItems,
    selectedPrimaryVariant,
    subscriptionForm.receivedAmount,
    subscriptionForm.startDate,
  ]);

  useEffect(() => {
    if (completedOnboarding || pricingPreview.totalPayable <= 0) {
      return;
    }
    setSubscriptionForm((current) => {
      const roundedTotalPayable = Math.round(pricingPreview.totalPayable || 0);
      const currentAmount = Math.round(Number(current.receivedAmount || 0));
      const shouldAutofill =
        !current.receivedAmount.trim() ||
        currentAmount === Math.round(previousAutoReceivedAmountRef.current || 0);
      if (!shouldAutofill) {
        previousAutoReceivedAmountRef.current = roundedTotalPayable;
        return current;
      }
      previousAutoReceivedAmountRef.current = roundedTotalPayable;
      return { ...current, receivedAmount: String(roundedTotalPayable) };
    });
  }, [completedOnboarding, pricingPreview.totalPayable]);

  useEffect(() => {
    if (pricingPreview.balanceAmount > 0 || !subscriptionForm.balanceDueDate) {
      return;
    }
    setSubscriptionForm((current) => (
      current.balanceDueDate
        ? { ...current, balanceDueDate: "" }
        : current
    ));
  }, [pricingPreview.balanceAmount, subscriptionForm.balanceDueDate]);

  useEffect(() => {
    if (!draftHydratedRef.current) {
      return;
    }

    if (completedOnboarding) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Ignore draft cleanup failures once onboarding is complete.
      }
      return;
    }

    const draftState: OnboardingDraftState = {
      currentStep,
      memberForm,
      subscriptionForm,
      ptSetupForm,
      complementaries,
      membershipLineItems,
      showPtComposer,
      primaryCategoryFilter,
      primaryProductFilter,
      addOnCategoryFilter,
      addOnProductFilter,
    };

    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draftState));
    } catch {
      // Ignore local draft persistence failures and continue in memory.
    }
  }, [
    addOnCategoryFilter,
    addOnProductFilter,
    complementaries,
    completedOnboarding,
    currentStep,
    draftStorageKey,
    memberForm,
    membershipLineItems,
    primaryCategoryFilter,
    primaryProductFilter,
    ptSetupForm,
    showPtComposer,
    subscriptionForm,
  ]);

  useEffect(() => {
    if (!token || !memberForm.defaultBranchId) {
      setBranchCoaches([]);
      setBranchMembers([]);
      setBranchTeamUsers([]);
      return;
    }

    let active = true;
    (async () => {
      try {
        const [coaches, members, users] = await Promise.all([
          usersService.searchUsers(token, {
            role: "COACH",
            active: true,
            employmentType: "INTERNAL",
            defaultBranchId: memberForm.defaultBranchId,
          }),
          usersService.searchUsers(token, {
            role: "MEMBER",
            defaultBranchId: memberForm.defaultBranchId,
          }),
          usersService.searchUsers(token, {
            active: true,
            defaultBranchId: memberForm.defaultBranchId,
          }),
        ]);

        if (!active) {
          return;
        }

        setBranchCoaches(
          coaches
            .filter((coach) => coach.active !== false)
            .sort((left, right) => left.name.localeCompare(right.name)),
        );
        setBranchMembers(members);
        setBranchTeamUsers(users);
      } catch {
        if (!active) {
          return;
        }
        setBranchCoaches([]);
        setBranchMembers([]);
        setBranchTeamUsers([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [memberForm.defaultBranchId, token]);

  useEffect(() => {
    if (needsTrainerAssignment(selectedPrimaryVariant)) {
      if (branchCoaches.length === 0) {
        setAssignedTrainer(null);
        return;
      }

      const roundRobinPool = branchCoaches
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      const nextTrainerIndex = branchMembers.length % roundRobinPool.length;
      setAssignedTrainer(roundRobinPool[nextTrainerIndex] || roundRobinPool[0] || null);
      return;
    }

    // All other categories: no trainer needed
    setAssignedTrainer(null);
    setManualTrainerId("");
  }, [branchCoaches, branchMembers, selectedPrimaryVariant]);

  const customEntitlements = useMemo(() => {
    const items: Array<Record<string, unknown>> = [];

    if (complementaries.steam.enabled) {
      items.push({
        feature: "STEAM_ACCESS",
        includedCount: Number(complementaries.steam.count || 0),
        recurrence: complementaries.steam.recurrence,
        expiresIfUnused: true,
      });
    }
    if (complementaries.iceBath.enabled) {
      items.push({
        feature: "ICE_BATH_ACCESS",
        includedCount: Number(complementaries.iceBath.count || 0),
        recurrence: complementaries.iceBath.recurrence,
        expiresIfUnused: true,
      });
    }
    if (complementaries.nutritionCounseling.enabled) {
      items.push({
        feature: "NUTRITION_COUNSELING",
        includedCount: Number(complementaries.nutritionCounseling.count || 0),
        recurrence: complementaries.nutritionCounseling.recurrence,
        expiresIfUnused: false,
      });
    }
    if (complementaries.physiotherapyCounseling.enabled) {
      items.push({
        feature: "PHYSIOTHERAPY_COUNSELING",
        includedCount: Number(complementaries.physiotherapyCounseling.count || 0),
        recurrence: complementaries.physiotherapyCounseling.recurrence,
        expiresIfUnused: false,
      });
    }
    if (complementaries.passBenefit.enabled) {
      items.push({
        feature: "PAUSE_BENEFIT",
        includedCount: Number(complementaries.passBenefit.days || 0),
        recurrence: "FULL_TERM",
        expiresIfUnused: false,
      });
    }

    return items.filter((item) => Number(item.includedCount || 0) > 0);
  }, [complementaries]);

  const stepItems = useMemo<StepItem[]>(
    () => [
      { step: 1, label: "Member Info", description: "Capture identity, contact, and emergency details." },
      { step: 2, label: "Membership", description: "Choose memberships, pricing, and trainer assignment." },
      { step: 3, label: "Payment & Billing", description: "Issue invoice, collect payment, and finalize onboarding." },
    ],
    [],
  );

  const addMembershipLineItem = () => {
    const focusMembershipTable = () => {
      window.setTimeout(() => {
        membershipTableRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
    };

    if (!primaryLineItem) {
      if (!draftPrimaryVariant) {
        setToast({ kind: "error", message: "Select a primary membership variant before adding it." });
        return;
      }

      const primaryCommercial = resolveCommercialBreakdown(
        draftPrimaryVariant.basePrice || 0,
        subscriptionForm.primarySellingPrice,
        subscriptionForm.primaryDiscountPercent,
      );
      const product = products.find((item) => item.productCode === draftPrimaryVariant.productCode);

      setMembershipLineItems([
        {
          lineType: "PRIMARY",
          categoryCode: draftPrimaryVariant.categoryCode,
          productCode: draftPrimaryVariant.productCode,
          productName: product?.productName || draftPrimaryVariant.productCode,
          variantId: draftPrimaryVariant.variantId,
          variantName: draftPrimaryVariant.variantName,
          basePrice: draftPrimaryVariant.basePrice || 0,
          sellingPrice: primaryCommercial.sellingPrice,
          discountPercent: primaryCommercial.discountPercent,
          cgstAmount: Number(((primaryCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
          sgstAmount: Number(((primaryCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
          totalAmount: Number((primaryCommercial.sellingPrice + ((primaryCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 100)).toFixed(2)),
        },
      ]);
      setPrimaryCategoryFilter("");
      setPrimaryProductFilter("");
      setSubscriptionForm((current) => ({
        ...current,
        productVariantId: "",
        primarySellingPrice: "",
        primaryDiscountPercent: "",
      }));
      setToast({ kind: "success", message: "Primary membership added to the billing table." });
      focusMembershipTable();
      return;
    }

    if (!canAddPtMembership) {
      setToast({ kind: "error", message: "This membership flow cannot accept an additional PT line item." });
      return;
    }

    if (!draftSelectedAddOnVariant) {
      setToast({ kind: "error", message: "Select a PT add-on variant before adding it." });
      return;
    }
    if (!ptSetupForm.coachId) {
      setToast({ kind: "error", message: "Select the PT coach before adding the secondary subscription." });
      return;
    }
    if (!ptSetupForm.startDate) {
      setToast({ kind: "error", message: "Select the PT start date before adding the secondary subscription." });
      return;
    }
    if (selectedPtDays.length === 0) {
      setToast({ kind: "error", message: "Select the PT schedule days before adding the secondary subscription." });
      return;
    }
    if (!ptSetupForm.slotStartTime) {
      setToast({ kind: "error", message: "Select the PT slot before adding the secondary subscription." });
      return;
    }

    const addOnCommercial = resolveCommercialBreakdown(
      draftSelectedAddOnVariant.basePrice || 0,
      subscriptionForm.addOnSellingPrice,
      subscriptionForm.addOnDiscountPercent,
    );
    const product = products.find((item) => item.productCode === draftSelectedAddOnVariant.productCode);

    setMembershipLineItems((current) => [
      ...current.filter((item) => item.lineType !== "PT_ADD_ON"),
      {
        lineType: "PT_ADD_ON",
        categoryCode: draftSelectedAddOnVariant.categoryCode,
        productCode: draftSelectedAddOnVariant.productCode,
        productName: product?.productName || draftSelectedAddOnVariant.productCode,
        variantId: draftSelectedAddOnVariant.variantId,
        variantName: draftSelectedAddOnVariant.variantName,
        basePrice: draftSelectedAddOnVariant.basePrice || 0,
        sellingPrice: addOnCommercial.sellingPrice,
        discountPercent: addOnCommercial.discountPercent,
        cgstAmount: Number(((addOnCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
        sgstAmount: Number(((addOnCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 200).toFixed(2)),
        totalAmount: Number((addOnCommercial.sellingPrice + ((addOnCommercial.sellingPrice * (billingSettings.gstPercentage || 0)) / 100)).toFixed(2)),
      },
    ]);
    setAddOnCategoryFilter("");
    setAddOnProductFilter("");
      setSubscriptionForm((current) => ({
        ...current,
        addOnVariantId: "",
        addOnSellingPrice: "",
        addOnDiscountPercent: "",
      }));
      setShowPtComposer(false);
      setToast({ kind: "success", message: "PT add-on added to the billing table." });
      focusMembershipTable();
    };

  const removeMembershipLineItem = (lineType: MembershipLineItem["lineType"]) => {
    setMembershipLineItems((current) => current.filter((item) => item.lineType !== lineType));
    if (lineType === "PRIMARY") {
      setPrimaryCategoryFilter("");
      setPrimaryProductFilter("");
      setAddOnCategoryFilter("");
      setAddOnProductFilter("");
      setSubscriptionForm((current) => ({
        ...current,
        productVariantId: "",
        addOnVariantId: "",
        primarySellingPrice: "",
        primaryDiscountPercent: "",
        addOnSellingPrice: "",
        addOnDiscountPercent: "",
      }));
      setPtSetupForm({
        coachId: "",
        startDate: subscriptionForm.startDate || new Date().toISOString().slice(0, 10),
        endDate: "",
        totalSessions: "",
        scheduleTemplate: "ALTERNATE_DAYS",
        scheduleDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
        slotStartTime: "06:00",
      });
      setManualTrainerId("");
      setComplementaries(initialComplementaryState);
      setShowPtComposer(false);
      return;
    }

    setAddOnCategoryFilter("");
    setAddOnProductFilter("");
    setSubscriptionForm((current) => ({
      ...current,
      addOnVariantId: "",
      addOnSellingPrice: "",
      addOnDiscountPercent: "",
    }));
    setPtSetupForm({
      coachId: "",
      startDate: subscriptionForm.startDate || new Date().toISOString().slice(0, 10),
      endDate: "",
      totalSessions: "",
      scheduleTemplate: "ALTERNATE_DAYS",
      scheduleDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
      slotStartTime: "06:00",
    });
    setShowPtComposer(false);
  };

  const renderPtSetupSection = () => {
    if (!shouldShowPtSetupSection) {
      return null;
    }

    return (
      <div className="mt-5 space-y-4 rounded-[24px] border border-white/8 bg-[#161d28] p-5">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-[#ffb4b1]" />
          <div>
            <h4 className="text-sm font-semibold text-white">
              {requiresBundledPtSetup ? "Transformation PT Setup" : "Add Personal Training"}
            </h4>
            <p className="text-xs text-slate-400">
              {requiresBundledPtSetup
                ? "Transformation includes bundled PT. Capture the PT coach, schedule, and session setup here."
                : "Choose the PT package the member is purchasing along with the gym membership."}
            </p>
          </div>
        </div>
        {!requiresBundledPtSetup ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">PT Category</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                value={addOnCategoryFilter}
                onChange={(event) => {
                  setAddOnCategoryFilter(event.target.value);
                  setAddOnProductFilter("");
                  setSubscriptionForm((current) => ({
                    ...current,
                    addOnVariantId: "",
                    addOnSellingPrice: "",
                    addOnDiscountPercent: "",
                  }));
                }}
              >
                <option value="">Select category</option>
                {addOnCategoryOptions.map((categoryCode) => (
                  <option key={categoryCode} value={categoryCode}>
                    {productFamilyLabel(categoryCode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">PT Product</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                value={addOnProductFilter}
                disabled={!addOnCategoryFilter}
                onChange={(event) => {
                  setAddOnProductFilter(event.target.value);
                  setSubscriptionForm((current) => ({
                    ...current,
                    addOnVariantId: "",
                    addOnSellingPrice: "",
                    addOnDiscountPercent: "",
                  }));
                }}
              >
                <option value="">{addOnCategoryFilter ? "Select product" : "Choose category first"}</option>
                {filteredAddOnProducts.map((product) => (
                  <option key={product.productCode} value={product.productCode}>
                    {product.productName}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Summary</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {draftSelectedAddOnVariant ? formatPtProductName(normalizeDisplayVariantName(draftSelectedAddOnVariant.variantName)) : "Choose a PT plan"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {draftSelectedAddOnVariant
                  ? `${draftSelectedAddOnVariant.includedPtSessions} sessions · ${selectedPtCoach?.name || "Choose coach"}`
                  : "Select a PT category, product, and variant to add it below."}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Bundled PT Summary</p>
            <p className="mt-2 text-sm font-semibold text-white">
              {activePtSetupVariant ? formatPtProductName(normalizeDisplayVariantName(activePtSetupVariant.variantName)) : "Transformation PT"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {activePtSetupVariant
                ? `${selectedPtSessionCount} sessions · ${selectedPtCoach?.name || "Choose PT coach"}`
                : "Select the transformation plan to configure the bundled PT setup."}
            </p>
          </div>
        )}
        {!requiresBundledPtSetup ? (
          <div className="grid gap-4 lg:grid-cols-4">
            {filteredAddOnVariants.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-[#101722] p-5 text-sm text-slate-400 lg:col-span-4">
                No PT variants are configured for this product yet.
              </div>
            ) : null}
            {filteredAddOnVariants.map((variant) => {
              const active = subscriptionForm.addOnVariantId === variant.variantId;
              const variantProduct = products.find((product) => product.productCode === variant.productCode);
              const features = splitFeatures(variant.includedFeatures).filter(shouldShowOnboardingFeatureChip).slice(0, 3);
              return (
                <button
                  key={variant.variantId}
                  type="button"
                  onClick={() => {
                    setAddOnCategoryFilter(variant.categoryCode);
                    setAddOnProductFilter(variant.productCode);
                    setSubscriptionForm((current) => ({
                      ...current,
                      addOnVariantId: variant.variantId,
                      addOnSellingPrice: "",
                      addOnDiscountPercent: "",
                    }));
                    setPtSetupForm((current) => ({
                      ...current,
                      totalSessions: String(variant.includedPtSessions || 0),
                      endDate: projectMembershipEndDate(
                        current.startDate || subscriptionForm.startDate,
                        variant.durationMonths,
                        variant.validityDays,
                      ),
                    }));
                  }}
                  className={`rounded-[20px] border p-4 text-left transition ${active ? "border-[#c42924]/50 bg-[#1b1114] shadow-[0_20px_60px_rgba(196,36,41,0.12)]" : "border-white/10 bg-[#151b26] hover:border-white/20 hover:bg-[#18202c]"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{productFamilyLabel(variant.categoryCode)}</p>
                      <h5 className="mt-2 text-base font-semibold text-white">{normalizeDisplayVariantName(variant.variantName)}</h5>
                      {shouldShowVariantSubtitle(variant.variantName, variantProduct?.productName, variant.productCode) ? (
                        <p className="mt-1 text-xs text-slate-400">{variantProduct?.productName || variant.productCode}</p>
                      ) : null}
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusBadgeClass(active)}`}>
                      {active ? "Selected" : `${variant.durationMonths} months`}
                    </span>
                  </div>
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Base Price</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(variant.basePrice)}</p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <p>{variant.includedPtSessions} PT sessions</p>
                      <p>{variant.validityDays} days validity</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {features.map((feature) => (
                      <span key={feature} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                        {featurePillLabel(feature)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="rounded-[24px] border border-white/10 bg-[#0f141d] p-4">
          <div className="mb-4 flex items-center gap-3">
            <UserRound className="h-5 w-5 text-[#ffb4b1]" />
            <div>
              <h4 className="text-sm font-semibold text-white">{requiresBundledPtSetup ? "Bundled PT Setup" : "PT Setup"}</h4>
              <p className="text-xs text-slate-400">
                {requiresBundledPtSetup
                  ? "Capture the PT coach, recurring schedule, and sessions included in this transformation package."
                  : "Capture the same coach, schedule, and session details used in Add PT."}
              </p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Coach</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                value={ptSetupForm.coachId}
                onChange={(event) => setPtSetupForm((current) => ({ ...current, coachId: event.target.value }))}
              >
                <option value="">{ptEligibleCoaches.length > 0 ? "Select coach" : "No PT coach available"}</option>
                {ptEligibleCoaches.map((coach) => (
                  <option key={coach.id} value={coach.id}>
                    {coach.name} · {coach.mobile}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Start Date</span>
              <input
                type="date"
                className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                min={formatDateInputValue(new Date())}
                max={addDaysToDateInput(formatDateInputValue(new Date()), FUTURE_START_DATE_MAX_OFFSET_DAYS)}
                value={ptSetupForm.startDate}
                onChange={(event) => setPtSetupForm((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Total Sessions</span>
              <input
                className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                value={ptSetupForm.totalSessions}
                onChange={(event) => setPtSetupForm((current) => ({ ...current, totalSessions: sanitizeIntegerString(event.target.value) }))}
                placeholder={activePtSetupVariant ? String(activePtSetupVariant.includedPtSessions || 0) : "0"}
                inputMode="numeric"
              />
            </label>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Schedule Template</span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Everyday", value: "EVERYDAY" },
                  { label: "Alternate Days", value: "ALTERNATE_DAYS" },
                ].map((option) => {
                  const selected = ptSetupForm.scheduleTemplate === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPtSetupForm((current) => ({ ...current, scheduleTemplate: option.value as PtScheduleTemplate }))}
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                        selected
                          ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                          : "border-white/10 bg-[#111925] text-slate-300 hover:border-white/20"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Slot</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                value={ptSetupForm.slotStartTime}
                onChange={(event) => setPtSetupForm((current) => ({ ...current, slotStartTime: event.target.value }))}
              >
                {ptTimeSlotOptions.map((slot) => (
                  <option key={slot} value={slot}>
                    {formatClockTime(slot)} - {formatClockTime(addMinutesToTime(slot, PT_SLOT_DURATION_MINUTES))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Schedule Days</span>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {PT_WEEKDAY_OPTIONS.map((day) => {
                const locked = ptSetupForm.scheduleTemplate === "EVERYDAY";
                const selected = selectedPtDays.includes(day.code);
                return (
                  <button
                    key={day.code}
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setPtSetupForm((current) => ({
                        ...current,
                        scheduleDays: selected
                          ? current.scheduleDays.filter((code) => code !== day.code)
                          : [...current.scheduleDays, day.code],
                      }))
                    }
                    className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                      selected
                        ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                        : "border-white/10 bg-[#111925] text-slate-300 hover:border-white/20"
                    } ${locked ? "cursor-not-allowed opacity-70" : ""}`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Reschedules</p>
              <p className="mt-2 text-base font-semibold text-white">
                {activePtSetupVariant
                  ? hasUnlimitedPtReschedules
                    ? "Unlimited"
                    : String(derivePtRescheduleLimit(activePtSetupVariant.durationMonths, false))
                  : "-"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Projected End</p>
              <p className="mt-2 text-base font-semibold text-white">{projectedPtEndDate || "-"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Coach</p>
              <p className="mt-2 text-base font-semibold text-white">{selectedPtCoach?.name || "-"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Slot Window</p>
              <p className="mt-2 text-base font-semibold text-white">{formatClockTime(ptSetupForm.slotStartTime)} - {formatClockTime(ptSlotEndTime)}</p>
            </div>
          </div>
        </div>
        {!requiresBundledPtSetup ? (
          <div className="rounded-[24px] border border-white/10 bg-[#0f141d] p-4">
            <div className="mb-4 flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-[#ffb4b1]" />
              <div>
                <h4 className="text-sm font-semibold text-white">PT Commercials</h4>
                <p className="text-xs text-slate-400">Set PT selling price and discount before adding the secondary line item.</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Selling Price</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                  value={subscriptionForm.addOnSellingPrice}
                  onChange={(event) => {
                    const value = sanitizeIntegerString(event.target.value);
                    const baseAmount = draftSelectedAddOnVariant?.basePrice || 0;
                    const discountPercent =
                      value === "" || baseAmount <= 0
                        ? ""
                        : formatDecimalInput(((baseAmount - Math.min(baseAmount, Number(value))) / baseAmount) * 100);
                    setSubscriptionForm((current) => ({
                      ...current,
                      addOnSellingPrice: value,
                      addOnDiscountPercent: discountPercent,
                    }));
                  }}
                  placeholder={draftSelectedAddOnVariant ? `Default ${formatCurrency(draftSelectedAddOnVariant.basePrice)}` : "Select PT variant first"}
                  disabled={!draftSelectedAddOnVariant}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Discount Percent</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                  value={subscriptionForm.addOnDiscountPercent}
                  onChange={(event) => {
                    const value = sanitizeNumericString(event.target.value);
                    const baseAmount = draftSelectedAddOnVariant?.basePrice || 0;
                    const normalizedPercent =
                      value === "" ? undefined : Math.min(100, Math.max(0, Number(value)));
                    const sellingPrice =
                      normalizedPercent === undefined || baseAmount <= 0
                        ? ""
                        : formatDecimalInput(baseAmount * (1 - normalizedPercent / 100));
                    setSubscriptionForm((current) => ({
                      ...current,
                      addOnDiscountPercent: value,
                      addOnSellingPrice: sellingPrice,
                    }));
                  }}
                  placeholder="Leave blank for no discount"
                  disabled={!draftSelectedAddOnVariant}
                />
              </label>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Plan Price</p>
                <p className="mt-2 text-base font-semibold text-white">{formatCurrency(addOnDraftCommercial.baseAmount)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Discount</p>
                <p className="mt-2 text-base font-semibold text-white">{formatCurrency(addOnDraftCommercial.discountAmount)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">CGST / SGST</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {formatCurrency(addOnDraftCgst)} / {formatCurrency(addOnDraftSgst)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Total Price</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {formatCurrency(addOnDraftCommercial.sellingPrice + addOnDraftCgst + addOnDraftSgst)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => addMembershipLineItem()}
                className="rounded-2xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a81f1c]"
              >
                Add to Table
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const validateStep = (step: OnboardingStep): boolean => {
    if (step === 1) {
      if (!memberForm.fullName.trim()) {
        setToast({ kind: "error", message: "Member full name is required." });
        return false;
      }
      if (memberForm.mobileNumber.trim().length !== 10) {
        setToast({ kind: "error", message: "Enter a valid 10-digit mobile number." });
        return false;
      }
      if (!memberForm.password.trim()) {
        setToast({ kind: "error", message: "A login password is required." });
        return false;
      }
    }

    if (step === 2) {
      if (!primaryLineItem || !selectedPrimaryVariant) {
        setToast({ kind: "error", message: "Add the primary membership before continuing." });
        return false;
      }
      if (!subscriptionForm.startDate) {
        setToast({ kind: "error", message: "Membership start date is required." });
        return false;
      }
      if (ptLineItem || requiresBundledPtSetup) {
        if (!activePtSetupVariant) {
          setToast({ kind: "error", message: "The PT setup is incomplete for this membership." });
          return false;
        }
        if (!ptSetupForm.coachId) {
          setToast({ kind: "error", message: "Select the PT coach before continuing." });
          return false;
        }
        if (!ptSetupForm.startDate) {
          setToast({ kind: "error", message: "PT start date is required." });
          return false;
        }
        if (selectedPtDays.length === 0) {
          setToast({ kind: "error", message: "Select the PT schedule days before continuing." });
          return false;
        }
        if (!ptSetupForm.slotStartTime) {
          setToast({ kind: "error", message: "Select the PT slot before continuing." });
          return false;
        }
        if (
          selectedPrimaryVariant?.durationMonths &&
          activePtSetupVariant?.durationMonths &&
          activePtSetupVariant.durationMonths > selectedPrimaryVariant.durationMonths
        ) {
          setToast({ kind: "error", message: "PT duration cannot exceed the primary membership duration." });
          return false;
        }
      }
    }

    if (step === 3) {
      const receivedAmount = toNumber(subscriptionForm.receivedAmount);
      const allowedMax = pricingPreview.totalPayable;
      if (receivedAmount === undefined || receivedAmount <= 0) {
        setToast({ kind: "error", message: "Received amount is required to complete onboarding." });
        return false;
      }
      if (Math.round(receivedAmount) > allowedMax) {
        setToast({ kind: "error", message: "Received amount cannot exceed the total payable amount." });
        return false;
      }
      if (pricingPreview.balanceAmount > 0 && !subscriptionForm.balanceDueDate) {
        setToast({ kind: "error", message: "Balance due date is required for partial payment." });
        return false;
      }
      if (!subscriptionForm.paymentMode) {
        setToast({ kind: "error", message: "Payment mode is required." });
        return false;
      }
    }

    return true;
  };

  const moveToStep = (step: OnboardingStep) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onNextStep = () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < 3) {
      moveToStep((currentStep + 1) as OnboardingStep);
    }
  };

  const onPreviousStep = () => {
    if (currentStep > 1) {
      moveToStep((currentStep - 1) as OnboardingStep);
    }
  };

  const findRecoverableMember = async (): Promise<UserDirectoryItem | null> => {
    if (!token) {
      return null;
    }

    const matches = await usersService.searchUsers(token, {
      role: "MEMBER",
      query: memberForm.mobileNumber.trim(),
      ...(memberForm.defaultBranchId ? { defaultBranchId: memberForm.defaultBranchId } : {}),
    });

    const exactMobileMatches = matches.filter(
      (item) => item.mobile === memberForm.mobileNumber.trim(),
    );

    return (
      exactMobileMatches.find((item) => item.sourceInquiryId === String(sourceInquiryId)) ||
      exactMobileMatches.find((item) => item.name.trim().toLowerCase() === memberForm.fullName.trim().toLowerCase()) ||
      exactMobileMatches[0] ||
      null
    );
  };

  const completeOnboarding = async () => {
    if (completedOnboarding) {
      return;
    }

    if (!validateStep(3)) {
      return;
    }

    if (!token || !canCreateMember || !canConvertInquiry) {
      setToast({ kind: "error", message: "You do not have permission to complete inquiry onboarding." });
      return;
    }

    if (!selectedPrimaryVariant) {
      setToast({ kind: "error", message: "Select a primary subscription variant." });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const billedByStaffId = resolveStaffId(user);
      let memberRecord = await findRecoverableMember();
      const resumedExistingMember = Boolean(memberRecord);

      const registerPayload: RegisterUserRequest = {
        fullName: memberForm.fullName.trim(),
        mobileNumber: memberForm.mobileNumber.trim(),
        password: memberForm.password,
        role: "MEMBER",
        email: toOptionalString(memberForm.email),
        sourceInquiryId,
        defaultBranchId: toOptionalString(memberForm.defaultBranchId),
        employmentType: "INTERNAL" as EmploymentType,
        designation: "MEMBER",
        dataScope: "ASSIGNED_ONLY",
        active: true,
        alternateMobileNumber: toOptionalString(memberForm.alternateMobileNumber),
        dateOfBirth: toOptionalString(memberForm.dateOfBirth),
        gender: toOptionalString(memberForm.gender),
        address: toOptionalString(memberForm.address),
        emergencyContactName: toOptionalString(memberForm.emergencyContactName),
        emergencyContactPhone: toOptionalString(memberForm.emergencyContactPhone),
        emergencyContactRelation: toOptionalString(memberForm.emergencyContactRelation),
        defaultTrainerStaffId: needsTrainerAssignment(selectedPrimaryVariant) && assignedTrainer
          ? assignedTrainer.id
          : undefined,
      };

      if (!memberRecord) {
        try {
          memberRecord = await usersService.registerUser(token, registerPayload);
        } catch (registerError) {
          // Handle 409 Conflict (member already created, e.g. from a token-refresh race condition)
          if (registerError instanceof ApiError && registerError.status === 409) {
            memberRecord = await findRecoverableMember();
            if (!memberRecord) {
              throw new Error("Member registration returned 409 Conflict but the existing record could not be found. Please try again.");
            }
          } else {
            throw registerError;
          }
        }
      }

      const memberId = resolveMemberId(memberRecord);
      if (memberId === null) {
        throw new Error("Member created but numeric member ID is missing.");
      }

      const [existingInvoices, existingSubscriptions] = await Promise.all([
        subscriptionService.getInvoicesByMember(token, String(memberId)),
        subscriptionService.getSubscriptionRegister(token, { memberId: String(memberId) }),
      ]);

      if ((existingInvoices.length > 0 || existingSubscriptions.length > 0) && resumedExistingMember) {
        throw new Error(
          "A partial onboarding already exists for this member. Open the member profile or billing register to continue from the existing record.",
        );
      }

      // Prefer the branch selector's choice; fall back to the enquiry's branch
      // (for enquiry->member conversions). The backend falls back further to
      // the member's prior subscription if both are missing. Sending this here
      // prevents INV/GEN/... invoice numbers when no enquiry is attached.
      const resolvedBranchCode = selectedBranchCode || inquiry?.branchCode || undefined;
      const subscriptionResponse = await subscriptionService.createMemberSubscription(token, String(memberId), {
        productVariantId: Number(selectedPrimaryVariant.variantId),
        startDate: subscriptionForm.startDate,
        inquiryId: sourceInquiryId,
        branchCode: resolvedBranchCode,
        addOnVariantIds: selectedAddOnVariant ? [Number(selectedAddOnVariant.variantId)] : undefined,
        discountAmount: pricingPreview.discountAmount > 0 ? Number(pricingPreview.discountAmount.toFixed(2)) : undefined,
        discountedByStaffId: billedByStaffId ?? undefined,
        billedByStaffId: billedByStaffId ?? undefined,
        customEntitlements: customEntitlements.length > 0 ? customEntitlements : undefined,
      });

      const invoiceId = Number(subscriptionResponse.invoiceId);
      const memberSubscriptionId = Number(subscriptionResponse.memberSubscriptionId);
      const invoiceTotal = Number(subscriptionResponse.invoiceTotal);

      if (!Number.isFinite(invoiceId) || !Number.isFinite(memberSubscriptionId) || !Number.isFinite(invoiceTotal)) {
        throw new Error("Subscription created but invoice details are incomplete.");
      }

      let paymentReceipt: Awaited<ReturnType<typeof subscriptionService.recordPayment>> | null = null;
      let membershipActivated = false;
      const completionWarnings: string[] = [];
      const selectedPtAddOnSubscription = selectedAddOnVariant
        ? subscriptionResponse.createdSubscriptions.find((item) =>
            item.addOn === true || Number(item.productVariantId || 0) === Number(selectedAddOnVariant.variantId),
          ) || null
        : null;
      if (pricingPreview.receivedAmount > 0) {
        paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId,
          amount: pricingPreview.submittedReceivedAmount,
          paymentMode: subscriptionForm.paymentMode,
          inquiryId: sourceInquiryId,
        });

        const activationThresholdMet = meetsActivationThreshold(
          invoiceTotal,
          paymentReceipt?.totalPaidAmount || pricingPreview.submittedReceivedAmount,
          membershipPolicySettings.minPartialPaymentPercent,
        );
        if (activationThresholdMet) {
          await subscriptionService.activateMembership(token, memberSubscriptionId);
          membershipActivated = true;
        }
      }

      const settledBalanceAmount = Math.max(
        0,
        Math.round(
          Number(
            paymentReceipt?.balanceAmount
            ?? subscriptionResponse.balanceAmount
            ?? (invoiceTotal - Number(paymentReceipt?.totalPaidAmount || pricingPreview.submittedReceivedAmount || 0)),
          ) || 0,
        ),
      );

      const ptProvisionVariant = requiresBundledPtSetup ? selectedPrimaryVariant : selectedAddOnVariant;
      const ptProvisionSubscriptionId = requiresBundledPtSetup
        ? memberSubscriptionId
        : Number(selectedPtAddOnSubscription?.memberSubscriptionId || 0);

      if (membershipActivated && ptProvisionVariant && ptProvisionSubscriptionId > 0) {
        try {
          const memberEmailForAssignment =
            toOptionalString(memberForm.email) || buildSyntheticInternalEmail(memberForm.mobileNumber.trim(), "members.fomotraining.internal");
          const coachEmailForAssignment =
            selectedPtCoach?.email
            || buildSyntheticInternalEmail(selectedPtCoach?.mobile || selectedPtCoach?.id || ptSetupForm.coachId, "staff.fomotraining.internal");
          await subscriptionService.provisionPtOperationalSetup(token, ptProvisionSubscriptionId, {
            memberEmail: memberEmailForAssignment,
            coachId: Number(ptSetupForm.coachId),
            coachEmail: coachEmailForAssignment,
            startDate: ptSetupForm.startDate || subscriptionForm.startDate,
            endDate: projectedPtEndDate || undefined,
            productVariantId: Number(ptProvisionVariant.variantId),
            packageName: `${formatPtProductName(ptProvisionVariant.variantName || ptProvisionVariant.productCode)} · ${formatPlanDurationLabel(ptProvisionVariant.durationMonths, ptProvisionVariant.validityDays)}`,
            totalSessions: selectedPtSessionCount,
            rescheduleLimit: derivePtRescheduleLimit(Number(ptProvisionVariant.durationMonths || 0), hasUnlimitedPtReschedules),
            slotDurationMinutes: PT_SLOT_DURATION_MINUTES,
            slots: selectedPtDays.map((dayCode) => ({
              dayOfWeek: dayCode,
              slotStartTime: `${ptSetupForm.slotStartTime}:00`,
              slotEndTime: `${ptSlotEndTime}:00`,
            })),
          });
        } catch {
          completionWarnings.push("PT operational setup needs to be completed from the member profile.");
        }
      }

      let balanceDueFollowUpCreated = false;
      let balanceDueFollowUpDueAt: string | undefined;
      if (settledBalanceAmount > 0 && subscriptionForm.balanceDueDate) {
        try {
          await subscriptionService.createInquiryFollowUp(token, sourceInquiryId, {
            dueAt: `${subscriptionForm.balanceDueDate}T09:00:00`,
            assignedToStaffId: billedByStaffId || inquiry?.clientRepStaffId || undefined,
            createdByStaffId: billedByStaffId || undefined,
            followUpType: "BALANCE_DUE",
            notes: `Collect the remaining balance of ${formatCurrency(settledBalanceAmount)} for invoice ${subscriptionResponse.invoiceNumber}.`,
          });
          balanceDueFollowUpCreated = true;
          balanceDueFollowUpDueAt = `${subscriptionForm.balanceDueDate}T09:00:00`;
        } catch {
          completionWarnings.push("Balance follow-up could not be created automatically.");
        }
      }

      try {
        await subscriptionService.convertInquiry(token, String(sourceInquiryId), { memberId });
      } catch {
        completionWarnings.push("Inquiry conversion status could not be updated automatically.");
      }

      if (membershipActivated) {
        try {
          const biometricDevices = await engagementService.listBiometricDevices(token);
          const matchingBranchDevices = biometricDevices.filter((device) =>
            memberForm.defaultBranchId
              ? String(device.branchId || "").trim() === String(memberForm.defaultBranchId).trim()
              : false,
          );
          const devicesToEnroll = matchingBranchDevices.length > 0
            ? matchingBranchDevices
            : biometricDevices.length === 1
              ? biometricDevices
              : [];

          if (devicesToEnroll.length > 0) {
            const enrollmentResults = await Promise.allSettled(
              devicesToEnroll.map((device) =>
                engagementService.enrollBiometricUser(token, {
                  serialNumber: device.serialNumber,
                  pin: memberForm.mobileNumber.trim(),
                  name: memberForm.fullName.trim(),
                }),
              ),
            );

            if (enrollmentResults.every((result) => result.status === "rejected")) {
              completionWarnings.push("Biometric enrollment could not be queued automatically.");
            } else if (enrollmentResults.some((result) => result.status === "rejected")) {
              completionWarnings.push("Biometric enrollment was queued only on some branch devices.");
            }
          } else {
            completionWarnings.push("No biometric device was found for the selected branch.");
          }
        } catch {
          completionWarnings.push("Biometric enrollment needs to be completed from the member profile.");
        }
      }

      const completionPayload: CompletedOnboardingState = {
        memberId,
        memberSubscriptionId,
        invoiceId,
        invoiceNumber: subscriptionResponse.invoiceNumber,
        invoiceStatus: paymentReceipt?.paymentStatus || subscriptionResponse.invoiceStatus,
        receiptId: paymentReceipt?.receiptId,
        receiptNumber: paymentReceipt?.receiptNumber,
        paymentStatus: paymentReceipt?.paymentStatus || subscriptionResponse.invoiceStatus,
        paymentMode: paymentReceipt?.paymentMode || subscriptionForm.paymentMode,
        paymentModeLabel: resolvePaymentModeLabel(
          paymentReceipt?.paymentMode || subscriptionForm.paymentMode,
          subscriptionForm.paymentCardSubtype,
          subscriptionForm.paymentUpiVendor,
        ),
        totalPaidAmount: paymentReceipt?.totalPaidAmount || subscriptionResponse.totalPaidAmount || 0,
        balanceAmount: settledBalanceAmount,
        membershipActivated,
        balanceDueFollowUpCreated,
        balanceDueFollowUpDueAt,
      };
      try {
        window.sessionStorage.setItem(completionStorageKey, JSON.stringify(completionPayload));
      } catch {
        // Ignore storage failures and still show the in-memory completion state.
      }
      setCompletedOnboarding(completionPayload);

      const enrollmentNote = isGroupClassVariant(selectedPrimaryVariant)
        ? " Group-class program enrollment will sync automatically after activation."
        : "";
      const warningNote = completionWarnings.length > 0 ? ` ${completionWarnings.join(" ")}` : "";
      setToast({
        kind: "success",
        message:
          pricingPreview.receivedAmount > 0
            ? resumedExistingMember
              ? membershipActivated
                ? `Recovered the existing member record, invoiced it, recorded payment, and activated the membership.${enrollmentNote}${warningNote}`
                : `Recovered the existing member record and recorded payment. Membership activation is pending until ${membershipPolicySettings.minPartialPaymentPercent}% is collected.${enrollmentNote}${warningNote}`
              : membershipActivated
                ? `Member created, invoiced, payment recorded, and membership activated.${enrollmentNote}${warningNote}`
                : `Member created and invoiced. Payment was recorded, but activation is pending until ${membershipPolicySettings.minPartialPaymentPercent}% is collected.${enrollmentNote}${warningNote}`
            : resumedExistingMember
              ? `Recovered the existing member record and generated the invoice. No payment received yet, so access remains pending.${enrollmentNote}${warningNote}`
              : `Member created and invoiced. No payment received yet, so access remains pending.${enrollmentNote}${warningNote}`,
      });
      return;
    } catch (submitError) {
      moveToStep(3);
      if (submitError instanceof ApiError && submitError.message.toLowerCase().includes("mobile number already exists")) {
        try {
          const memberRecord = await findRecoverableMember();
          if (memberRecord) {
            setError(
              `A member record already exists for this enquiry (${memberRecord.name}). Please retry once more to resume the onboarding from that member record.`,
            );
            setToast({
              kind: "info",
              message: "We found an existing member record from the earlier attempt. Retry once to continue from that saved member.",
            });
            return;
          }
        } catch {
          // fall through to the generic message below if the recovery lookup fails
        }
      }
      const message = submitError instanceof ApiError ? submitError.message : submitError instanceof Error ? submitError.message : "Unable to complete guided onboarding.";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const generatedInvoiceNumber = completedOnboarding?.invoiceNumber || "Generated on completion";
  const generatedReceiptNumber =
    completedOnboarding?.receiptNumber || (completedOnboarding ? "No receipt generated" : "Generated after payment");
  const selectedPrimaryMembershipLabel = sanitizeMembershipLabel(selectedPrimaryVariant?.variantName || selectedPrimaryProduct?.productName || "Primary Membership");
  const selectedPrimaryMembershipDuration = formatPlanDurationLabel(selectedPrimaryVariant?.durationMonths || 0, selectedPrimaryVariant?.validityDays || 0);
  const enquiryCodeLabel = inquiry
    ? formatInquiryCode(inquiry.inquiryId, { branchCode: inquiry.branchCode, createdAt: inquiry.createdAt || inquiry.inquiryAt })
    : "Pending";
  const selectedFamilyLabel = productFamilyLabel(selectedPrimaryVariant?.categoryCode || selectedPrimaryProduct?.categoryCode);
  const selectedManualTrainer = branchCoaches.find((c) => c.id === manualTrainerId) || null;
  const branchTeamUserNameById = useMemo(() => {
    const lookup = new Map<string, string>();
    branchTeamUsers.forEach((entry) => {
      if (entry.id && entry.name) {
        lookup.set(String(entry.id), entry.name);
      }
    });
    return lookup;
  }, [branchTeamUsers]);
  const clientRepLabel =
    inquiry?.clientRepStaffId
      ? branchTeamUserNameById.get(String(inquiry.clientRepStaffId))
        || (inquiry.clientRepStaffId === resolveStaffId(user) ? user?.name : null)
        || `Staff #${inquiry.clientRepStaffId}`
      : user?.name || "-";
  const trainerAssistLabel = !selectedPrimaryVariant
    ? "Pick a plan to evaluate trainer assignment."
    : needsTrainerAssignment(selectedPrimaryVariant)
      ? assignedTrainer
        ? isTransformationVariant(selectedPrimaryVariant)
          ? `Default trainer auto-assigned to ${assignedTrainer.name}. Select the bundled PT coach below.`
          : `Auto-assigned to ${assignedTrainer.name} using branch round-robin.`
        : "No active internal coach available for this branch."
      : "Trainer assignment is not required for this plan family.";
  const onboardingContext = inquiry
    ? `Convert this enquiry into a member profile, attach memberships, and capture the first invoice against ${selectedBranchName || inquiry.branchCode || "the current branch"}.`
    : "Convert this enquiry into a member profile, attach memberships, and capture the first invoice.";

  const viewDocumentPdf = async (type: "invoice" | "receipt", id: number | string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-view-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (documentError) {
      setToast({
        kind: "error",
        message: documentError instanceof ApiError ? documentError.message : `Unable to open the ${type} PDF.`,
      });
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const downloadDocumentPdf = async (type: "invoice" | "receipt", id: number | string, filename: string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-download-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (documentError) {
      setToast({
        kind: "error",
        message: documentError instanceof ApiError ? documentError.message : `Unable to download the ${type} PDF.`,
      });
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const shareDocumentPdf = async (type: "invoice" | "receipt", id: number | string, filename: string, title: string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-share-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const safeFilename = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      const file = new File([blob], safeFilename, { type: "application/pdf" });

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title, files: [file] });
      } else {
        await downloadDocumentPdf(type, id, safeFilename);
      }
    } catch (documentError) {
      setToast({
        kind: "error",
        message: documentError instanceof ApiError ? documentError.message : `Unable to share the ${type} PDF.`,
      });
    } finally {
      setDocumentBusyKey(null);
    }
  };

  return (
    <div className="space-y-5">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <SectionCard
        title="Member Onboarding"
      >
        {!canCreateMember || !canConvertInquiry ? (
          <p className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Your designation does not have permission to complete this onboarding flow.
          </p>
        ) : loading ? (
          <p className="text-sm text-slate-300">Loading inquiry and catalog details...</p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(196,36,41,0.18),rgba(15,18,25,0.92))] p-6">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-2xl font-semibold text-white">
                      {inquiry ? inquiry.fullName || "Member onboarding" : "Member onboarding"}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm text-slate-300">{onboardingContext}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "Enquiry Code", value: enquiryCodeLabel, icon: <Layers3 className="h-4 w-4" /> },
                      { label: "Branch", value: selectedBranchName || inquiry?.branchCode || "Current branch", icon: <ShieldCheck className="h-4 w-4" /> },
                      { label: "Primary Contact", value: inquiry?.mobileNumber || memberForm.mobileNumber || "-", icon: <Phone className="h-4 w-4" /> },
                      { label: "Client Rep", value: clientRepLabel, icon: <UserRound className="h-4 w-4" /> },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center gap-2 text-[#ffd6d4]">{item.icon}</div>
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[480px]">
                  {stepItems.map((item) => {
                    const active = currentStep === item.step;
                    const completed = currentStep > item.step;
                    return (
                      <div
                        key={item.step}
                        className={`rounded-2xl border p-4 transition ${active ? "border-[#c42924]/50 bg-[#1c1114]" : completed ? "border-emerald-400/20 bg-emerald-400/10" : "border-white/10 bg-white/[0.04]"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${active ? "border-[#c42924]/50 bg-[#c42924]/15 text-[#ffd6d4]" : completed ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>
                            {completed ? <CheckCircle2 className="h-4 w-4" /> : item.step}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusBadgeClass(active)}`}>
                            {completed ? "Done" : active ? "Current" : "Pending"}
                          </span>
                        </div>
                        <p className="mt-4 text-sm font-semibold text-white">{item.label}</p>
	                        <p className="mt-1 text-xs text-slate-400">{item.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

	            <div className="space-y-6">
	                {currentStep === 1 ? (
	                  <SectionCard title="Step 1 · Member Info">
	                    <div className="space-y-5">
                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <UserRound className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Personal Identity</h4>
                              <p className="text-xs text-slate-400">Core member details carried from the enquiry.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Full Name</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.fullName}
                                onChange={(event) => setMemberForm((current) => ({ ...current, fullName: event.target.value }))}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Date of Birth</span>
                              <input
                                type="date"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.dateOfBirth}
                                onChange={(event) => setMemberForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Gender</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.gender}
                                onChange={(event) => setMemberForm((current) => ({ ...current, gender: event.target.value }))}
                                placeholder="Optional"
                              />
                            </label>
	                          </div>
	                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <Phone className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Contact & Access</h4>
                              <p className="text-xs text-slate-400">Primary login credentials and communication details.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Mobile Number</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.mobileNumber}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    mobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                    password: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                                minLength={10}
                                maxLength={10}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Password</span>
                              <input
                                type="password"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.password}
                                onChange={(event) => setMemberForm((current) => ({ ...current, password: event.target.value }))}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Email</span>
                              <input
                                type="email"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.email}
                                onChange={(event) => setMemberForm((current) => ({ ...current, email: event.target.value }))}
                                placeholder="Optional"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Alternate Mobile</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.alternateMobileNumber}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    alternateMobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                                placeholder="Optional"
                              />
                            </label>
                            <label className="space-y-2 md:col-span-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Address</span>
                              <textarea
                                className="min-h-[104px] w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.address}
                                onChange={(event) => setMemberForm((current) => ({ ...current, address: event.target.value }))}
                                placeholder="Home address or locality"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <ShieldCheck className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Emergency Contact</h4>
                              <p className="text-xs text-slate-400">Who we should reach in case of an urgent issue.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Name</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactName}
                                onChange={(event) => setMemberForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Phone</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactPhone}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    emergencyContactPhone: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Relation</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactRelation}
                                onChange={(event) => setMemberForm((current) => ({ ...current, emergencyContactRelation: event.target.value }))}
                              />
                            </label>
                          </div>
                        </div>
	                    </div>
	                  </SectionCard>
	                ) : null}

                {currentStep === 2 ? (
                  <div className="space-y-6">
	                    <SectionCard title="Step 2 · Membership Details">
                      <div className="space-y-6">
                        <div>
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
	                              <h4 className="text-sm font-semibold text-white">
                                  {canAddPrimaryMembership ? "Add Primary Membership" : showPtComposer ? "Add PT Membership" : "Membership Builder"}
                                </h4>
                                <p className="mt-1 text-xs text-slate-400">
                                  {canAddPrimaryMembership
                                    ? "Select the base gym, flex, group class, or transformation plan and add it to the table."
                                    : showPtComposer
                                      ? "Select the personal training package to add under this member."
                                      : "Membership lines are already added below. Review the table and continue to billing."}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                              {canAddPtMembership && !showPtComposer ? (
                                <button
                                  type="button"
                                  onClick={() => setShowPtComposer(true)}
                                  className="rounded-2xl border border-[#c42924]/40 bg-[#1b1114] px-4 py-2.5 text-sm font-semibold text-[#ffb4b1] hover:border-[#c42924]/60"
                                >
                                  Add PT
                                </button>
                              ) : null}
                              <label className="space-y-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Start Date</span>
                                <input
                                  type="date"
                                  className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                  min={formatDateInputValue(new Date())}
                                  max={addDaysToDateInput(formatDateInputValue(new Date()), FUTURE_START_DATE_MAX_OFFSET_DAYS)}
                                  value={subscriptionForm.startDate}
                                  onChange={(event) => setSubscriptionForm((current) => ({ ...current, startDate: event.target.value }))}
                                  required
                                />
                              </label>
                            </div>
                          </div>
                          {canAddPrimaryMembership ? (
                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="grid gap-4 lg:grid-cols-3">
                              <label className="space-y-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Product Category</span>
                                <select
                                  className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                  value={primaryCategoryFilter}
                                  onChange={(event) => {
                                    setPrimaryCategoryFilter(event.target.value);
                                    setPrimaryProductFilter("");
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: "",
                                      primarySellingPrice: "",
                                      primaryDiscountPercent: "",
                                      includeAddOn: false,
                                      addOnVariantId: "",
                                      addOnSellingPrice: "",
                                      addOnDiscountPercent: "",
                                    }));
                                  }}
                                >
                                  <option value="">Select category</option>
                                  {primaryCategoryOptions.map((categoryCode) => (
                                    <option key={categoryCode} value={categoryCode}>
                                      {productFamilyLabel(categoryCode)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Product</span>
                                <select
                                  className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                  value={primaryProductFilter}
                                  disabled={!primaryCategoryFilter}
                                  onChange={(event) => {
                                    setPrimaryProductFilter(event.target.value);
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: "",
                                      primarySellingPrice: "",
                                      primaryDiscountPercent: "",
                                      includeAddOn: false,
                                      addOnVariantId: "",
                                      addOnSellingPrice: "",
                                      addOnDiscountPercent: "",
                                    }));
                                  }}
                                >
                                  <option value="">{primaryCategoryFilter ? "Select product" : "Choose category first"}</option>
                                  {filteredPrimaryProducts.map((product) => (
                                    <option key={product.productCode} value={product.productCode}>
                                      {product.productName}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Selection</p>
                                <p className="mt-2 text-sm font-semibold text-white">
                                  {selectedPrimaryProduct?.productName || "Choose a product"}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {selectedPrimaryVariant
                                    ? `${normalizeDisplayVariantName(selectedPrimaryVariant.variantName)} · ${
                                        selectedPrimaryVariant.categoryCode === "FLEX"
                                          ? formatFlexUsageLabel(selectedPrimaryVariant.checkInLimit, selectedPrimaryVariant.validityDays)
                                          : `${selectedPrimaryVariant.validityDays} days validity`
                                      }`
                                    : "Pick a variant below to load pricing and benefits."}
                                </p>
                              </div>
                            </div>

                            <div className="mt-5 grid gap-4 lg:grid-cols-4">
                              {filteredPrimaryVariants.length === 0 ? (
                                <div className="rounded-[24px] border border-dashed border-white/12 bg-[#101722] p-5 text-sm text-slate-400 lg:col-span-4">
                                  No variants are configured for this product yet.
                                </div>
                              ) : null}
                              {filteredPrimaryVariants.map((variant) => {
                              const active = subscriptionForm.productVariantId === variant.variantId;
                              const variantProduct = products.find((product) => product.productCode === variant.productCode);
                              const features = splitFeatures(variant.includedFeatures).filter(shouldShowOnboardingFeatureChip).slice(0, 3);
                              return (
                                <button
                                  key={variant.variantId}
                                  type="button"
                                  onClick={() => {
                                    setPrimaryCategoryFilter(variant.categoryCode);
                                    setPrimaryProductFilter(variant.productCode);
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: variant.variantId,
                                      primarySellingPrice: "",
                                      primaryDiscountPercent: "",
                                    }));
                                  }}
                                  className={`rounded-[20px] border p-4 text-left transition ${active ? "border-[#c42924]/50 bg-[#1b1114] shadow-[0_20px_60px_rgba(196,36,41,0.12)]" : "border-white/10 bg-[#151b26] hover:border-white/20 hover:bg-[#18202c]"}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                                        {productFamilyLabel(variant.categoryCode)}
                                      </p>
                                      <h5 className="mt-2 text-base font-semibold text-white">{normalizeDisplayVariantName(variant.variantName)}</h5>
                                      {shouldShowVariantSubtitle(variant.variantName, variantProduct?.productName, variant.productCode) ? (
                                        <p className="mt-1 text-xs text-slate-400">{variantProduct?.productName || variant.productCode}</p>
                                      ) : null}
                                    </div>
                                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusBadgeClass(active)}`}>
                                      {active ? "Selected" : `${variant.durationMonths} months`}
                                    </span>
                                  </div>
                                    <div className="mt-5 flex items-end justify-between gap-3">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Base Price</p>
                                        <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(variant.basePrice)}</p>
                                      </div>
                                      <div className="text-right text-xs text-slate-400">
                                      <p>
                                        {variant.categoryCode === "FLEX"
                                          ? formatFlexUsageLabel(variant.checkInLimit, variant.validityDays)
                                          : `${variant.validityDays} days validity`}
                                      </p>
	                                      <p>{variant.passBenefitDays} pause benefit days</p>
                                      </div>
                                    </div>
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {features.map((feature) => (
                                      <span key={feature} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                                        {featurePillLabel(feature)}
                                      </span>
                                    ))}
                                  </div>
                                </button>
                              );
                            })}
                            </div>
                            {requiresBundledPtSetup ? renderPtSetupSection() : null}
                            <div className="mt-5 rounded-[24px] border border-white/10 bg-[#0f141d] p-4">
                              <div className="mb-4 flex items-center gap-3">
                                <Sparkles className="h-5 w-5 text-[#ffb4b1]" />
                                <div>
	                                  <h4 className="text-sm font-semibold text-white">Primary Membership Commercials</h4>
                                  <p className="text-xs text-slate-400">Set selling price and discount on the same membership tile before adding it to the table.</p>
                                </div>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                <label className="space-y-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Selling Price</span>
                                  <input
                                    className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                    value={subscriptionForm.primarySellingPrice}
                                    onChange={(event) => {
                                      const value = sanitizeIntegerString(event.target.value);
                                      const baseAmount = draftPrimaryVariant?.basePrice || 0;
                                      const discountPercent =
                                        value === "" || baseAmount <= 0
                                          ? ""
                                          : formatDecimalInput(((baseAmount - Math.min(baseAmount, Number(value))) / baseAmount) * 100);
                                      setSubscriptionForm((current) => ({
                                        ...current,
                                        primarySellingPrice: value,
                                        primaryDiscountPercent: discountPercent,
                                      }));
                                    }}
                                    placeholder={draftPrimaryVariant ? `Default ${formatCurrency(draftPrimaryVariant.basePrice)}` : "Select a primary plan first"}
                                    disabled={!draftPrimaryVariant}
                                  />
                                </label>
                                <label className="space-y-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Discount Percent</span>
                                  <input
                                    className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                    value={subscriptionForm.primaryDiscountPercent}
                                    onChange={(event) => {
                                      const value = sanitizeNumericString(event.target.value);
                                      const baseAmount = draftPrimaryVariant?.basePrice || 0;
                                      const normalizedPercent =
                                        value === "" ? undefined : Math.min(100, Math.max(0, Number(value)));
                                      const sellingPrice =
                                        normalizedPercent === undefined || baseAmount <= 0
                                          ? ""
                                          : formatDecimalInput(baseAmount * (1 - normalizedPercent / 100));
                                      setSubscriptionForm((current) => ({
                                        ...current,
                                        primaryDiscountPercent: value,
                                        primarySellingPrice: sellingPrice,
                                      }));
                                    }}
                                    placeholder="Leave blank for no discount"
                                    disabled={!draftPrimaryVariant}
                                  />
                                </label>
                              </div>
                              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Plan Price</p>
                                  <p className="mt-2 text-base font-semibold text-white">{formatCurrency(primaryDraftCommercial.baseAmount)}</p>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Discount</p>
                                  <p className="mt-2 text-base font-semibold text-white">{formatCurrency(primaryDraftCommercial.discountAmount)}</p>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">CGST / SGST</p>
                                  <p className="mt-2 text-base font-semibold text-white">
                                    {formatCurrency(primaryDraftCgst)} / {formatCurrency(primaryDraftSgst)}
                                  </p>
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Total Price</p>
                                  <p className="mt-2 text-base font-semibold text-white">
                                    {formatCurrency(primaryDraftCommercial.sellingPrice + primaryDraftCgst + primaryDraftSgst)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-4 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => addMembershipLineItem()}
                                  className="rounded-2xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a81f1c]"
                                >
                                  Add to Table
                                </button>
                              </div>
                            </div>
                          </div>
                          ) : null}
                        </div>

                        {!requiresBundledPtSetup ? renderPtSetupSection() : null}

                        <div ref={membershipTableRef} className="mt-5 rounded-[24px] border border-white/10 bg-[#0f141d] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Membership Table</p>
                                <p className="mt-1 text-sm text-slate-300">Review the membership lines that will be billed on the next step.</p>
                              </div>
                            </div>
                            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
                              <table className="min-w-full divide-y divide-white/10 text-sm text-slate-300">
                                <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.16em] text-slate-400">
                                  <tr>
                                    <th className="px-4 py-3 text-left font-semibold">Line</th>
                                    <th className="px-4 py-3 text-left font-semibold">Product</th>
                                    <th className="px-4 py-3 text-left font-semibold">Variant</th>
                                    <th className="px-4 py-3 text-right font-semibold">Plan Price</th>
                                    <th className="px-4 py-3 text-right font-semibold">Selling Price</th>
                                    <th className="px-4 py-3 text-right font-semibold">Discount</th>
                                    <th className="px-4 py-3 text-right font-semibold">Total Amount</th>
                                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/10 bg-[#101722]">
                                  {membershipLineItems.length === 0 ? (
                                    <tr>
                                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">
                                        No memberships added yet.
                                      </td>
                                    </tr>
                                  ) : (
                                    membershipLineItems.map((item) => (
                                      <tr key={item.lineType}>
                                        <td className="px-4 py-3 text-white">{item.lineType === "PRIMARY" ? "Primary" : "PT Add-on"}</td>
                                        <td className="px-4 py-3">{item.productName}</td>
                                        <td className="px-4 py-3">{normalizeDisplayVariantName(item.variantName)}</td>
                                        <td className="px-4 py-3 text-right">{formatCurrency(item.basePrice)}</td>
                                        <td className="px-4 py-3 text-right">{formatCurrency(item.sellingPrice)}</td>
                                        <td className="px-4 py-3 text-right">{Math.round(item.discountPercent)}%</td>
                                        <td className="px-4 py-3 text-right">{formatCurrency(item.totalAmount)}</td>
                                        <td className="px-4 py-3 text-right">
                                          <button
                                            type="button"
                                            onClick={() => removeMembershipLineItem(item.lineType)}
                                            className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.06]"
                                          >
                                            Remove
                                          </button>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>

                        <div className={`grid gap-4 ${selectedPrimaryVariant && needsTrainerAssignment(selectedPrimaryVariant) ? "xl:grid-cols-[1fr_320px]" : ""}`}>
                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="mb-4 flex items-center gap-3">
                              <Layers3 className="h-5 w-5 text-[#ffb4b1]" />
                              <div>
	                                <h4 className="text-sm font-semibold text-white">Complimentary Benefits</h4>
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {([
                                ["steam", "Steam Access"],
                                ["iceBath", "Ice Bath Access"],
                                ["nutritionCounseling", "Nutrition Counseling"],
                                ["physiotherapyCounseling", "Physiotherapy Counseling"],
                              ] as const).map(([key, label]) => {
                                const item = complementaries[key];
                                return (
                                  <div key={key} className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                                    <label className="flex items-center gap-3 text-sm font-semibold text-white">
                                      <input
                                        type="checkbox"
                                        checked={item.enabled}
                                        onChange={(event) =>
                                          setComplementaries((current) => ({
                                            ...current,
                                            [key]: { ...current[key], enabled: event.target.checked },
                                          }))
                                        }
                                      />
                                      {label}
                                    </label>
                                    {item.enabled ? (
                                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <input
                                          className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                          value={item.count}
                                          onChange={(event) =>
                                            setComplementaries((current) => ({
                                              ...current,
                                              [key]: { ...current[key], count: event.target.value.replace(/[^0-9]/g, "") },
                                            }))
                                          }
                                          placeholder="Count"
                                        />
                                        <select
                                          className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                          value={item.recurrence}
                                          onChange={(event) =>
                                            setComplementaries((current) => ({
                                              ...current,
                                              [key]: { ...current[key], recurrence: event.target.value },
                                            }))
                                          }
                                        >
                                          {RECURRENCE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                              <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                                <label className="flex items-center gap-3 text-sm font-semibold text-white">
                                  <input
                                    type="checkbox"
                                    checked={complementaries.passBenefit.enabled}
                                    onChange={(event) =>
                                      setComplementaries((current) => ({
                                        ...current,
                                        passBenefit: { ...current.passBenefit, enabled: event.target.checked },
                                      }))
                                    }
                                  />
	                                  Pause Benefit
                                </label>
                                {complementaries.passBenefit.enabled ? (
                                  <div className="mt-3">
                                    <input
                                      className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                      value={complementaries.passBenefit.days}
                                      onChange={(event) =>
                                        setComplementaries((current) => ({
                                          ...current,
                                          passBenefit: { ...current.passBenefit, days: event.target.value.replace(/[^0-9]/g, "") },
                                        }))
                                      }
                                      placeholder="Benefit days"
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {selectedPrimaryVariant && needsTrainerAssignment(selectedPrimaryVariant) ? (
                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="mb-4 flex items-center gap-3">
                              <ShieldCheck className="h-5 w-5 text-[#ffb4b1]" />
                              <div>
                                <h4 className="text-sm font-semibold text-white">Trainer Assignment</h4>
                                <p className="text-xs text-slate-400">Auto-assigned for Flagship. Manual selection for Transformation.</p>
                              </div>
                            </div>
                            {!needsTrainerAssignment(selectedPrimaryVariant) ? (
                              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                                <p className="text-sm font-semibold text-cyan-100">Trainer not required</p>
                                <p className="mt-2 text-sm text-cyan-50/80">
                                  {selectedFamilyLabel} plans do not need a default trainer assignment at onboarding.
                                </p>
                              </div>
                            ) : !assignedTrainer ? (
                              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                                <p className="text-sm font-semibold text-amber-100">Coach assignment pending</p>
                                <p className="mt-2 text-sm text-amber-50/80">No active internal coach is currently available in this branch.</p>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                                <p className="text-sm font-semibold text-emerald-100">{assignedTrainer.name}</p>
                                <p className="mt-1 text-sm text-emerald-50/80">{assignedTrainer.mobile}</p>
                                <p className="mt-3 text-xs text-emerald-100/70">
                                  Assigned automatically from the branch round-robin queue for onboarding trainers.
                                </p>
                              </div>
                            )}

                            <div className="mt-5 rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Assignment rule</p>
                              <p className="mt-2 text-sm text-slate-300">{trainerAssistLabel}</p>
                            </div>
                          </div>
                          ) : null}
                        </div>
                      </div>
                    </SectionCard>
                  </div>
                ) : null}

	                {currentStep === 3 ? (
	                  <SectionCard title="Step 3 · Payment & Billing">
                    <div className="space-y-5">
                      {completedOnboarding ? (
                        <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                          <p className="font-semibold">Onboarding completed</p>
                          <p className="mt-2">
                            Invoice <span className="font-semibold">{completedOnboarding.invoiceNumber}</span>
                            {completedOnboarding.receiptNumber ? (
                              <>
                                {" "}and receipt <span className="font-semibold">{completedOnboarding.receiptNumber}</span>
                              </>
                            ) : (
                              " created without a receipt because no payment was collected."
                            )}
                          </p>
                          <p className="mt-2 text-emerald-50/80">
                            {completedOnboarding.membershipActivated
                              ? "Access is active and the onboarding flow is complete."
                              : `Payment has been recorded, but activation will remain pending until ${membershipPolicySettings.minPartialPaymentPercent}% of the invoice is collected.`}
                          </p>
                        </div>
                      ) : null}

                      <BillingWorkflowTemplate
                        infoRows={[
                          { label: "Invoice Number", value: generatedInvoiceNumber },
                          { label: "Invoice Date", value: new Date().toLocaleDateString("en-IN") },
                          { label: "Start Date", value: pricingPreview.startDate || "-" },
                          { label: "End Date", value: pricingPreview.endDate || "-" },
                          { label: "Billing Representative", value: user?.name || "-" },
                          { label: "Invoice Status", value: completedOnboarding ? formatInvoiceLifecycleStatus(completedOnboarding.invoiceStatus, true) : "Issued on completion" },
                        ]}
                        lineItems={membershipLineItems.map((item) => {
                          const relatedVariant = [...primaryVariants, ...addOnVariants].find(
                            (variant) => String(variant.variantId) === String(item.variantId),
                          );
                          return {
                            label: item.lineType === "PRIMARY" ? "Primary Membership" : "PT Add-on",
                            subtitle:
                              item.lineType === "PRIMARY"
                                ? selectedPrimaryMembershipLabel
                                : sanitizeMembershipLabel(item.variantName || "PT Add-on"),
                            baseAmount: formatCurrency(item.basePrice),
                            sellingPrice: formatCurrency(item.sellingPrice),
                            discount: `${Math.round(item.discountPercent)}%`,
                          };
                        })}
                        totalLabel="Total Plan Price"
                        totalBaseAmount={formatCurrency(pricingPreview.baseAmount)}
                        totalSellingPrice={formatCurrency(pricingPreview.netSaleAmount)}
                        totalDiscount={formatCurrency(pricingPreview.discountAmount)}
                        finalPayable={formatCurrency(pricingPreview.totalPayable)}
                        taxRows={[
                          { label: `CGST @ ${pricingPreview.gstPercentage / 2}%`, value: formatCurrency(pricingPreview.cgstAmount) },
                          { label: `SGST @ ${pricingPreview.gstPercentage / 2}%`, value: formatCurrency(pricingPreview.sgstAmount) },
                        ]}
                        receivedAmount={subscriptionForm.receivedAmount}
                        onReceivedAmountChange={(value) =>
                          setSubscriptionForm((current) => ({
                            ...current,
                            receivedAmount: sanitizeIntegerString(value),
                          }))
                        }
                        paymentMode={subscriptionForm.paymentMode}
                        paymentModeOptions={String(billingSettings?.paymentModesEnabled || "UPI,CARD,CASH")
                          .split(",")
                          .map((mode) => mode.trim().toUpperCase())
                          .filter((mode) => ["UPI", "CARD", "CASH"].includes(mode))
                          .map((mode) => ({
                            value: mode,
                            label: mode === "UPI" ? "UPI" : mode === "CARD" ? "Card" : "Cash",
                          }))}
                        onPaymentModeChange={(value) => setSubscriptionForm((current) => ({ ...current, paymentMode: value }))}
                        secondaryModeLabel={subscriptionForm.paymentMode === "CARD" ? "Card Type" : subscriptionForm.paymentMode === "UPI" ? "UPI App" : undefined}
                        secondaryModeValue={subscriptionForm.paymentMode === "CARD" ? subscriptionForm.paymentCardSubtype : subscriptionForm.paymentUpiVendor}
                        secondaryModeOptions={
                          subscriptionForm.paymentMode === "CARD"
                            ? PAYMENT_CARD_OPTIONS
                            : subscriptionForm.paymentMode === "UPI"
                              ? PAYMENT_UPI_OPTIONS
                              : []
                        }
                        onSecondaryModeChange={(value) =>
                          setSubscriptionForm((current) => (
                            subscriptionForm.paymentMode === "CARD"
                              ? { ...current, paymentCardSubtype: value as "DEBIT_CARD" | "CREDIT_CARD" }
                              : { ...current, paymentUpiVendor: value as typeof current.paymentUpiVendor }
                          ))
                        }
                        showBalanceDueDate={pricingPreview.balanceAmount > 0}
                        balanceDueDate={subscriptionForm.balanceDueDate}
                        onBalanceDueDateChange={(value) => setSubscriptionForm((current) => ({ ...current, balanceDueDate: value }))}
                        receiptRows={[
                          { label: "Receipt Number", value: generatedReceiptNumber },
                          { label: "Receipt Date", value: new Date().toLocaleDateString("en-IN") },
                          { label: "Payment Method", value: completedOnboarding?.paymentModeLabel || resolvePaymentModeLabel(subscriptionForm.paymentMode, subscriptionForm.paymentCardSubtype, subscriptionForm.paymentUpiVendor) },
                          { label: "Payment Status", value: completedOnboarding ? formatPaymentCollectionStatus(completedOnboarding.totalPaidAmount, completedOnboarding.balanceAmount) : formatPaymentCollectionStatus(pricingPreview.receivedAmount, pricingPreview.balanceAmount) },
                          { label: "Total Paid", value: formatCurrency(completedOnboarding?.totalPaidAmount || pricingPreview.receivedAmount) },
                          { label: "Balance Due", value: formatCurrency(completedOnboarding?.balanceAmount ?? pricingPreview.balanceAmount), fullWidth: true },
                        ]}
                        disabled={Boolean(completedOnboarding)}
                      />
	                    </div>
	                  </SectionCard>
	                ) : null}
	              </div>

	            <div className="flex flex-wrap items-center justify-end gap-3">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={onPreviousStep}
                  disabled={Boolean(completedOnboarding)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                >
                  Back
                </button>
              ) : null}
              {completedOnboarding ? null : currentStep < 3 ? (
                <button
                  type="button"
                  onClick={onNextStep}
                  className="rounded-2xl border border-[#c42924]/40 bg-[#c42924] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(196,41,36,0.28)] hover:bg-[#a81f1c]"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeOnboarding}
                  disabled={submitting}
                  className="rounded-2xl border border-[#c42924]/40 bg-[#c42924] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(196,41,36,0.28)] hover:bg-[#a81f1c] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-500 disabled:shadow-none"
                >
                  {submitting ? "Completing Onboarding..." : "Complete Onboarding"}
                </button>
              )}
            </div>
          </div>
        )}

        {error ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      </SectionCard>

      {completedOnboarding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#111821] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">Onboarding Completed</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{memberForm.fullName || "Member created"}</h3>
                <p className="mt-2 text-sm text-slate-300">
                  {completedOnboarding.membershipActivated
                    ? "The member, invoice, and payment records are ready. You can open the profile directly or distribute the billing documents from here."
                    : `The member and billing records are ready, but access is still pending until ${membershipPolicySettings.minPartialPaymentPercent}% of the invoice is collected.`}
                </p>
              </div>
              <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-200">
                <CheckCircle2 className="h-6 w-6" />
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Membership</p>
                <dl className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between gap-3"><dt>Plan</dt><dd className="font-semibold text-white">{selectedPrimaryMembershipLabel}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Duration</dt><dd className="font-semibold text-white">{selectedPrimaryMembershipDuration}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Invoice Number</dt><dd className="font-semibold text-white">{completedOnboarding.invoiceNumber}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Receipt Number</dt><dd className="font-semibold text-white">{completedOnboarding.receiptNumber || "-"}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Payment Status</dt><dd>{formatPaymentCollectionStatus(completedOnboarding.totalPaidAmount, completedOnboarding.balanceAmount)}</dd></div>
                  {completedOnboarding.balanceDueFollowUpCreated ? (
                    <div className="flex items-center justify-between gap-3"><dt>Balance Follow-up</dt><dd className="font-semibold text-white">{formatDateTime(completedOnboarding.balanceDueFollowUpDueAt || "")}</dd></div>
                  ) : null}
                </dl>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Document Actions</p>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <span className="text-sm font-semibold text-white">Invoice</span>
                    <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void viewDocumentPdf("invoice", completedOnboarding.invoiceId)}
                      disabled={documentBusyKey === `invoice-view-${completedOnboarding.invoiceId}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                      title="View Invoice"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadDocumentPdf("invoice", completedOnboarding.invoiceId, completedOnboarding.invoiceNumber)}
                      disabled={documentBusyKey === `invoice-download-${completedOnboarding.invoiceId}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                      title="Download Invoice"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void shareDocumentPdf("invoice", completedOnboarding.invoiceId, completedOnboarding.invoiceNumber, "Invoice")}
                      disabled={documentBusyKey === `invoice-share-${completedOnboarding.invoiceId}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                      title="Share Invoice"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  </div>
                  </div>
                  {completedOnboarding.receiptId ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <span className="text-sm font-semibold text-white">Receipt</span>
                      <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void viewDocumentPdf("receipt", completedOnboarding.receiptId!)}
                        disabled={documentBusyKey === `receipt-view-${completedOnboarding.receiptId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="View Receipt"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadDocumentPdf("receipt", completedOnboarding.receiptId!, completedOnboarding.receiptNumber || `receipt-${completedOnboarding.receiptId}`)}
                        disabled={documentBusyKey === `receipt-download-${completedOnboarding.receiptId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="Download Receipt"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareDocumentPdf("receipt", completedOnboarding.receiptId!, completedOnboarding.receiptNumber || `receipt-${completedOnboarding.receiptId}`, "Receipt")}
                        disabled={documentBusyKey === `receipt-share-${completedOnboarding.receiptId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="Share Receipt"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No receipt was generated because no payment was collected.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {completedOnboarding.balanceDueFollowUpCreated ? (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.sessionStorage.removeItem(completionStorageKey);
                    } catch {
                      // ignore
                    }
                    router.replace(`/portal/follow-ups?inquiryId=${sourceInquiryId}&followUpType=BALANCE_DUE`);
                  }}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                >
                  Open Follow-ups
                </button>
              ) : null}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.sessionStorage.removeItem(completionStorageKey);
                  } catch {
                    // ignore
                  }
                  router.replace("/portal/members");
                }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
              >
                Back to Members
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(completionStorageKey);
                  } catch {
                    // ignore
                  }
                  router.replace(`/admin/members/${completedOnboarding.memberId}`);
                }}
                className="rounded-2xl border border-white/10 bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(15,23,42,0.28)] hover:bg-slate-700"
              >
                Open Member Profile
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
