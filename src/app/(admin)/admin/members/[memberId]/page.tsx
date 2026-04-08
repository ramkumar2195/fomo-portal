"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  Download,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pencil,
  Printer,
  RotateCcw,
  Share2,
  Snowflake,
  UserRound,
  Wallet,
} from "lucide-react";
import { BillingWorkflowTemplate } from "@/components/billing/billing-workflow-template";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatMemberCode } from "@/lib/inquiry-code";
import { UserDirectoryItem, FreezeHistoryEntry, InvoiceSummary, BillingReceiptSummary } from "@/types/models";
import { InquiryRecord } from "@/types/inquiry";
import {
  MemberAccessStateResponse,
  MemberAssessmentHistoryEntry,
  MemberAssessmentStatusResponse,
  MemberFitnessFormPayload,
  MemberNotesResponse,
  MemberProfileAuditEntry,
  MemberProfileShellResponse,
  MemberProfileTabKey,
} from "@/types/member-profile";
import { BranchResponse } from "@/types/admin";
import { BillingSettings, CatalogProduct, CatalogVariant, MembershipPolicySettings } from "@/lib/api/services/subscription-service";

type TabPayloadMap = {
  overview: MemberProfileShellResponse;
  subscriptions: {
    dashboard: Record<string, unknown>;
    entitlements: unknown[];
    history: unknown[];
    programEnrollments?: unknown[];
  };
  billing: {
    invoices: InvoiceSummary[];
    receipts: BillingReceiptSummary[];
  };
  attendance: {
    records: unknown[];
    biometricDevices: unknown[];
    biometricLogs: unknown[];
    enrollments?: unknown[];
  };
  "credits-wallet": {
    wallet: Record<string, unknown>;
    ledger: Record<string, unknown>;
  };
  "recovery-services": MemberAccessStateResponse;
  "personal-training": { assignments: unknown[]; sessions: unknown[]; slots?: unknown[] };
  progress: {
    summary: Record<string, unknown>;
    measurements: unknown[];
    photos: unknown[];
  };
  "freeze-history": FreezeHistoryEntry[];
  notes: MemberNotesResponse;
  "audit-trail": MemberProfileAuditEntry[];
  "fitness-assessment": {
    fitnessForm: MemberFitnessFormPayload;
    assessmentStatus: MemberAssessmentStatusResponse;
    assessmentHistory: MemberAssessmentHistoryEntry[];
  };
};

const TAB_ORDER: Array<{ key: MemberProfileTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "subscriptions", label: "Membership" },
  { key: "billing", label: "Billing" },
  { key: "attendance", label: "Attendance & Access" },
  { key: "credits-wallet", label: "Credits & Balance" },
  { key: "personal-training", label: "Personal Training" },
  { key: "freeze-history", label: "Freeze History" },
  { key: "notes", label: "Follow-ups & Comments" },
  { key: "audit-trail", label: "Audit Trail" },
  { key: "fitness-assessment", label: "Fitness & Medical" },
  { key: "progress", label: "Training" },
];

type ActionModalKey =
  | "edit-profile"
  | "freeze"
  | "unfreeze"
  | "unfreeze-billing"
  | "renew"
  | "renew-billing"
  | "upgrade"
  | "upgrade-billing"
  | "pt-billing"
  | "pt-session-count"
  | "pt-reschedule"
  | "pt-cancel"
  | "downgrade"
  | "transfer"
  | "pt"
  | "visit"
  | "biometric"
  | null;

type RecordLike = Record<string, unknown>;
type MembershipFamily =
  | "FLAGSHIP"
  | "FLEX"
  | "PT"
  | "TRANSFORMATION"
  | "GROUP_CLASS"
  | "CREDIT_PACK"
  | "UNKNOWN";
type MembershipActionKey = "renew" | "upgrade" | "downgrade" | "freeze" | "unfreeze" | "transfer" | "pt" | "visit";

interface MembershipActionState {
  key: MembershipActionKey;
  label: string;
  enabled: boolean;
  adminApprovalRequired?: boolean;
  note?: string;
}

interface MembershipPortfolioItem {
  subscriptionId: string;
  productVariantId: string;
  family: MembershipFamily;
  categoryCode: string;
  productCode: string;
  productName: string;
  variantName: string;
  status: string;
  startDate: string;
  expiryDate: string;
  durationMonths: number;
  validityDays: number;
  branchCode: string;
  invoiceNumber: string;
  receiptNumber: string;
  paymentConfirmed: boolean;
  includedCheckIns: number;
  usedCheckIns: number;
  checkInsRemaining: number;
  extraVisitPrice: number;
  includedPtSessions: number;
  entitlements: string[];
}

interface MemberEntitlementRecord {
  entitlementId: number;
  feature: string;
  source: string;
  validFrom?: string;
  validUntil?: string;
  includedCount?: number;
  remainingCount?: number;
  recurrence?: string;
  usedCount?: number;
  expiredUnusedCount?: number;
  manualTopUpCount?: number;
  expiresIfUnused?: boolean;
  currentCycleStart?: string;
  currentCycleEnd?: string;
  lastUtilizedAt?: string;
  lastExpiredAt?: string;
}

interface CommercialBreakdown {
  baseAmount: number;
  sellingPrice: number;
  discountPercent: number;
  discountAmount: number;
}

interface CompletedBillingState {
  context: "renewal" | "upgrade" | "pt" | "balance";
  title: string;
  message: string;
  invoiceId: number;
  invoiceNumber: string;
  receiptId?: number;
  receiptNumber?: string;
  paymentStatus: string;
  totalPaidAmount: number;
  balanceAmount: number;
}

type PtScheduleTemplate = "EVERYDAY" | "ALTERNATE_DAYS";

const PT_SLOT_DURATION_MINUTES = 60;
const PT_CANCEL_CUTOFF_HOURS = 8;
const PT_RESCHEDULE_CUTOFF_HOURS = 3;
const PT_WEEKDAY_OPTIONS = [
  { code: "MONDAY", label: "Mon" },
  { code: "TUESDAY", label: "Tue" },
  { code: "WEDNESDAY", label: "Wed" },
  { code: "THURSDAY", label: "Thu" },
  { code: "FRIDAY", label: "Fri" },
  { code: "SATURDAY", label: "Sat" },
] as const;
const PT_EVERYDAY_DAY_CODES = PT_WEEKDAY_OPTIONS.map((day) => day.code);
const PAYMENT_CARD_OPTIONS = [
  { value: "DEBIT_CARD", label: "Debit Card" },
  { value: "CREDIT_CARD", label: "Credit Card" },
] as const;
const PAYMENT_UPI_OPTIONS = [
  { value: "GOOGLE_PAY", label: "Google Pay" },
  { value: "PHONEPE", label: "PhonePe" },
  { value: "PAYTM", label: "Paytm" },
  { value: "OTHER", label: "Other UPI" },
] as const;

interface LifecycleBillingTabState {
  invoices: InvoiceSummary[];
  receipts: BillingReceiptSummary[];
}

function toRecord(payload: unknown): RecordLike {
  return typeof payload === "object" && payload !== null ? (payload as RecordLike) : {};
}

function titleize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveBillingPaymentModeLabel(
  paymentMode: string,
  paymentCardSubtype: "DEBIT_CARD" | "CREDIT_CARD",
  paymentUpiVendor: "GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER",
): string {
  const normalizedMode = String(paymentMode || "").trim().toUpperCase();
  if (normalizedMode === "CARD") {
    return PAYMENT_CARD_OPTIONS.find((option) => option.value === paymentCardSubtype)?.label || "Card";
  }
  if (normalizedMode === "UPI") {
    return PAYMENT_UPI_OPTIONS.find((option) => option.value === paymentUpiVendor)?.label || "UPI";
  }
  return normalizedMode ? humanizeLabel(normalizedMode) : "-";
}

function normalizeDisplayPlanName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return "No active membership";
  }

  return trimmed
    .replace(/\b(1|3|6|12)M\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-/]\s*$/g, "")
    .trim();
}

function formatVariantDisplayLabel(variant?: CatalogVariant | null, fallback?: string): string {
  if (!variant) {
    return fallback || "-";
  }

  const variantName = String(variant.variantName || "").replace(/\bTransform\b/gi, "Transformation").trim();
  const durationLabel = formatPlanDuration(variant.durationMonths, variant.validityDays);
  if (!variantName) {
    return durationLabel;
  }
  if (variantName.toLowerCase().includes(durationLabel.toLowerCase())) {
    return variantName;
  }
  return `${variantName} · ${durationLabel}`;
}

function sanitizeMembershipVariantTitle(value?: string): string {
  const raw = String(value || "").replace(/\bTransform\b/gi, "Transformation").trim();
  if (!raw) {
    return "-";
  }

  return normalizeDisplayPlanName(
    raw
      .replace(/\b\d+\s*(M|L)\b/gi, "")
      .replace(/\b\d+\s*months?\b/gi, "")
      .replace(/\b\d+\s*days?\b/gi, "")
      .replace(/[·,-]\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
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

function parseClockToMinutes(timeValue?: string): number | null {
  if (!timeValue) {
    return null;
  }
  const [hoursValue, minutesValue] = String(timeValue).split(":");
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function parseLocalDateTime(dateValue?: string, timeValue?: string): Date | null {
  if (!dateValue || !timeValue) {
    return null;
  }
  const [year, month, day] = String(dateValue).split("-").map((part) => Number(part));
  const [hours, minutes] = String(timeValue).split(":").map((part) => Number(part));
  if (![year, month, day, hours, minutes].every(Number.isFinite)) {
    return null;
  }
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function getPtSessionStartDateTime(session: RecordLike): Date | null {
  return parseLocalDateTime(
    pickString(session, ["sessionDate"]),
    pickString(session, ["slotStartTime", "sessionTime"]),
  );
}

function getPtSessionEndDateTime(session: RecordLike): Date | null {
  const endTime =
    pickString(session, ["slotEndTime"])
    || addMinutesToTime(pickString(session, ["slotStartTime", "sessionTime"]) || "", PT_SLOT_DURATION_MINUTES);
  return parseLocalDateTime(pickString(session, ["sessionDate"]), endTime);
}

function hoursUntilPtSession(session: RecordLike, now = new Date()): number | null {
  const startAt = getPtSessionStartDateTime(session);
  if (!startAt) {
    return null;
  }
  return (startAt.getTime() - now.getTime()) / (60 * 60 * 1000);
}

function canCancelPtSessionInTime(session: RecordLike, now = new Date()): boolean {
  const hoursRemaining = hoursUntilPtSession(session, now);
  return hoursRemaining !== null && hoursRemaining >= PT_CANCEL_CUTOFF_HOURS;
}

function canReschedulePtSessionInTime(session: RecordLike, now = new Date()): boolean {
  const hoursRemaining = hoursUntilPtSession(session, now);
  return hoursRemaining !== null && hoursRemaining >= PT_RESCHEDULE_CUTOFF_HOURS;
}

function describePtHoursRemaining(session: RecordLike, now = new Date()): string {
  const hoursRemaining = hoursUntilPtSession(session, now);
  if (hoursRemaining === null) {
    return "Timing unavailable";
  }
  if (hoursRemaining <= 0) {
    return "Slot time is already live or passed";
  }
  if (hoursRemaining < 1) {
    return `${Math.max(1, Math.round(hoursRemaining * 60))} min left`;
  }
  return `${hoursRemaining.toFixed(1).replace(/\.0$/, "")} hrs left`;
}

function getPtRescheduleAvailabilityMessage(params: {
  session: RecordLike;
  hasUnlimitedReschedules: boolean;
  remainingReschedules: number;
  hasSameDayRescheduleOptions: boolean;
  now?: Date;
}): string {
  const {
    session,
    hasUnlimitedReschedules,
    remainingReschedules,
    hasSameDayRescheduleOptions,
    now = new Date(),
  } = params;

  if (!(hasUnlimitedReschedules || remainingReschedules > 0)) {
    return "Reschedule limit reached";
  }
  if (!hasSameDayRescheduleOptions) {
    return "No same-day free slot for this coach";
  }
  if (!canReschedulePtSessionInTime(session, now)) {
    return `Reschedule closes ${PT_RESCHEDULE_CUTOFF_HOURS}h before slot`;
  }
  return "Same-day reschedule available";
}

function getPtCancelAvailabilityMessage(session: RecordLike, now = new Date()): string {
  if (canCancelPtSessionInTime(session, now)) {
    return `Cancel allowed until ${PT_CANCEL_CUTOFF_HOURS}h before slot`;
  }
  if (canReschedulePtSessionInTime(session, now)) {
    return `Cancel closed. Only same-day reschedule is allowed until ${PT_RESCHEDULE_CUTOFF_HOURS}h before slot`;
  }
  return "Late cancellation will consume the session";
}

function parseAuditDetails(details?: string): Record<string, string> {
  if (!details) {
    return {};
  }
  return details.split(";").reduce<Record<string, string>>((accumulator, segment) => {
    const [key, ...rest] = segment.split("=");
    if (!key || rest.length === 0) {
      return accumulator;
    }
    accumulator[key.trim()] = rest.join("=").trim();
    return accumulator;
  }, {});
}

function formatAuditDetailsSummary(entry: MemberProfileAuditEntry): string {
  const details = parseAuditDetails(entry.changesJson);
  const parts: string[] = [];
  if (details.freezeStartDate || details.freezeEndDate) {
    parts.push(`Freeze ${formatDateOnly(details.freezeStartDate || undefined)} to ${formatDateOnly(details.freezeEndDate || undefined)}`);
  }
  if (details.freezeDays) {
    parts.push(`${details.freezeDays} days`);
  }
  if (details.reason && details.reason !== "-") {
    parts.push(`Reason: ${details.reason}`);
  }
  if (details.status) {
    parts.push(`Status: ${humanizeLabel(details.status)}`);
  }
  if (details.resumedOn) {
    parts.push(`Resumed: ${formatDateOnly(details.resumedOn)}`);
  }
  if (details.restoredPauseBenefitDays && Number(details.restoredPauseBenefitDays) > 0) {
    parts.push(`Restored pause days: ${details.restoredPauseBenefitDays}`);
  }
  if (details.invoiceNumber) {
    parts.push(`Invoice: ${details.invoiceNumber}`);
  }
  if (details.variantName) {
    parts.push(details.variantName);
  }
  return parts.join(" · ");
}

function isPtCalendarEntryOccupyingSlot(entry: RecordLike): boolean {
  const status = (pickString(entry, ["status"]) || "SCHEDULED").toUpperCase();
  return !["CANCELLED", "CANCELED", "RESCHEDULED", "NO_SHOW"].includes(status);
}

function buildAvailablePtSlotsForDate(params: {
  dateIso: string;
  availability: unknown[];
  calendarEntries: unknown[];
  excludeSessionId?: string;
  now?: Date;
}): string[] {
  const { dateIso, availability, calendarEntries, excludeSessionId, now = new Date() } = params;
  if (!dateIso) {
    return [];
  }
  const parsedDate = parseLocalDateTime(dateIso, "00:00");
  if (!parsedDate) {
    return [];
  }
  const weekday = parsedDate.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const occupiedTimes = new Set(
    calendarEntries
      .map((entry) => toRecord(entry))
      .filter((entry) => pickString(entry, ["sessionDate"]) === dateIso)
      .filter((entry) => {
        const entryId = pickString(entry, ["id"]);
        return (!excludeSessionId || entryId !== excludeSessionId) && isPtCalendarEntryOccupyingSlot(entry);
      })
      .map((entry) => pickString(entry, ["sessionTime", "slotStartTime"]))
      .filter((value): value is string => Boolean(value)),
  );

  return availability
    .map((slot) => toRecord(slot))
    .filter((slot) => (pickString(slot, ["dayOfWeek"]) || "").toUpperCase() === weekday)
    .flatMap((slot) => {
      const startMinutes = parseClockToMinutes(pickString(slot, ["startTime"]));
      const endMinutes = parseClockToMinutes(pickString(slot, ["endTime"]));
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        return [] as string[];
      }
      const slots: string[] = [];
      for (let minute = startMinutes; minute + PT_SLOT_DURATION_MINUTES <= endMinutes; minute += PT_SLOT_DURATION_MINUTES) {
        slots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
      }
      return slots;
    })
    .filter((slot, index, array) => array.indexOf(slot) === index)
    .filter((slot) => !occupiedTimes.has(slot))
    .filter((slot) => {
      if (dateIso !== toLocalIsoDate(now)) {
        return true;
      }
      const slotAt = parseLocalDateTime(dateIso, slot);
      return slotAt ? slotAt.getTime() > now.getTime() : false;
    })
    .sort((left, right) => (parseClockToMinutes(left) || 0) - (parseClockToMinutes(right) || 0));
}

function getPtSessionSortTimestamp(session: RecordLike): number {
  return getPtSessionStartDateTime(session)?.getTime() || Number.MAX_SAFE_INTEGER;
}

function canStartPtSessionNow(session: RecordLike, now = new Date()): boolean {
  const startAt = getPtSessionStartDateTime(session);
  const endAt = getPtSessionEndDateTime(session);
  if (!startAt || !endAt) {
    return false;
  }
  return now >= startAt && now <= endAt;
}

function buildPtTimeSlotOptions(): string[] {
  const windows = [
    { start: 6 * 60, end: 10 * 60 },
    { start: 17 * 60, end: 21 * 60 },
  ];
  const options: string[] = [];
  windows.forEach((window) => {
    for (let minute = window.start; minute + PT_SLOT_DURATION_MINUTES <= window.end; minute += PT_SLOT_DURATION_MINUTES) {
      const hours = Math.floor(minute / 60);
      const mins = minute % 60;
      options.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
    }
  });
  return options;
}

function formatPtDayLabel(dayCode: string): string {
  return PT_WEEKDAY_OPTIONS.find((day) => day.code === dayCode)?.label || humanizeLabel(dayCode);
}

function buildSyntheticInternalEmail(seed?: string, domain = "members.fomotraining.internal"): string {
  const normalizedSeed = String(seed || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  const safeSeed = normalizedSeed || `member${Date.now()}`;
  return `${safeSeed}@${domain}`;
}

function humanizeLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "PAUSED") {
    return "Frozen";
  }
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanEntitlementFeatureLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  const normalized = value
    .replace(/PASS_BENEFITS?/gi, "PAUSE_BENEFIT")
    .replace(/PASS BENEFITS?/gi, "PAUSE BENEFIT")
    .replace(/_ACCESS$/i, "")
    .replace(/ ACCESS$/i, "")
    .replace(/_BENEFIT$/i, "_BENEFIT")
    .trim()
    .toUpperCase();

  const aliasMap: Record<string, string> = {
    GYM: "Gym",
    PT: "PT",
    HIIT: "HIIT",
    COREFLEX: "CoreFlex",
    CROSSFIT: "CrossFit",
    ZUMBA: "Zumba",
    YOGA: "Yoga",
    BOXING: "Boxing",
    KICKBOXING: "Kickboxing",
    CALISTHENICS: "Calisthenics",
    PAUSE_BENEFIT: "Pause Benefit",
    NUTRITION_COUNSELING: "Nutrition Counseling",
    PHYSIOTHERAPY_COUNSELING: "Physiotherapy Counseling",
    STEAM: "Steam",
    STEAM_ACCESS: "Steam",
    ICE_BATH: "Ice Bath",
    ICE_BATH_ACCESS: "Ice Bath",
  };

  return aliasMap[normalized] || humanizeLabel(normalized);
}

function shouldTrackUsageEntitlement(value?: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/PASS_BENEFITS?/g, "PAUSE_BENEFIT")
    .replace(/PASS_BENEFIT/g, "PAUSE_BENEFIT");
  return [
    "PAUSE_BENEFIT",
    "STEAM_ACCESS",
    "STEAM",
    "ICE_BATH_ACCESS",
    "ICE_BATH",
    "NUTRITION_COUNSELING",
    "PHYSIOTHERAPY_COUNSELING",
  ].includes(normalized);
}

function extractSubscriptionIdFromEntitlementSource(source?: string): string {
  if (!source) {
    return "";
  }
  const [, subscriptionId = ""] = String(source).split(":");
  return subscriptionId.trim();
}

function entitlementUsageLabel(entitlement: MemberEntitlementRecord): string {
  const feature = String(entitlement.feature || "").toUpperCase();
  const included = Number(entitlement.includedCount || 0);
  const remaining = Number(entitlement.remainingCount || 0);
  const used = Number(entitlement.usedCount || 0);

  if (feature === "PAUSE_BENEFIT") {
    return `${remaining} / ${included} days`;
  }

  if (included <= 0) {
    return `${used} used`;
  }

  return `${used} / ${included}`;
}

function entitlementRuleLabel(entitlement: MemberEntitlementRecord): string {
  const recurrence = String(entitlement.recurrence || "FULL_TERM").toUpperCase();
  const included = Number(entitlement.includedCount || 0);

  if (recurrence === "MONTHLY") {
    return `${included} per month`;
  }
  if (recurrence === "QUARTERLY") {
    return `${included} per quarter`;
  }
  if (recurrence === "HALF_YEARLY") {
    return `${included} per half year`;
  }
  if (String(entitlement.feature || "").toUpperCase() === "PAUSE_BENEFIT") {
    return "Per membership";
  }
  return `${included} total`;
}

function shouldShowPackageFeatureChip(value?: string): boolean {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "PAUSE_BENEFIT" ||
    normalized === "TRANSFORMATION" ||
    normalized === "TRANSFORMATION_ACCESS" ||
    normalized === "GROUP_CLASS_ACCESS" ||
    normalized === "PT_INCLUDED" ||
    normalized === "TWO_SESSIONS_PER_WEEK" ||
    normalized === "TWO_SESSIONS_EACH_PER_WEEK"
  ) {
    return false;
  }
  return true;
}

function normalizeIndianMobile(value: string): string {
  return value.replace(/^\+91/, "").replace(/\D/g, "");
}

function pickString(payload: unknown, keys: string[]): string {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function pickBoolean(payload: unknown, keys: string[]): boolean | undefined {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
  }
  return undefined;
}

function pickNumber(payload: unknown, keys: string[]): number {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function pickFromSourcesString(sources: unknown[], keys: string[]): string {
  for (const source of sources) {
    const value = pickString(source, keys);
    if (value) {
      return value;
    }
  }
  return "";
}

function pickFromSourcesNumber(sources: unknown[], keys: string[]): number {
  for (const source of sources) {
    const value = pickNumber(source, keys);
    if (value !== 0) {
      return value;
    }
  }
  return 0;
}

function toArray<T = unknown>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
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
  const normalizedBaseAmount = roundAmount(Math.max(0, Number(baseAmount || 0)));
  const parsedDiscountPercent = toNumber(discountPercentValue || "");
  const parsedSellingPrice = toNumber(sellingPriceValue || "");

  if (parsedDiscountPercent !== undefined) {
    const normalizedDiscountPercent = Math.min(100, Math.max(0, Number(parsedDiscountPercent.toFixed(2))));
    const sellingPrice = roundAmount(normalizedBaseAmount * (1 - normalizedDiscountPercent / 100));
    const discountAmount = roundAmount(normalizedBaseAmount - sellingPrice);
    return {
      baseAmount: normalizedBaseAmount,
      sellingPrice,
      discountPercent: normalizedDiscountPercent,
      discountAmount,
    };
  }

  if (parsedSellingPrice !== undefined) {
    const sellingPrice = Math.min(normalizedBaseAmount, Math.max(0, roundAmount(parsedSellingPrice)));
    const discountAmount = roundAmount(normalizedBaseAmount - sellingPrice);
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

function defaultMembershipPolicySettings(): MembershipPolicySettings {
  return {
    freezeMinDays: 5,
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

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToLocalIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const parsed = new Date(year, (month || 1) - 1, day || 1);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  parsed.setDate(parsed.getDate() + days);
  return toLocalIsoDate(parsed);
}

function formatTimeOnly(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function compactEntries(payload: unknown): Array<[string, string]> {
  return Object.entries(toRecord(payload))
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    .slice(0, 12)
    .map(([key, value]) => [titleize(key), String(value)]);
}

function buildTableRows(items: unknown[]): { columns: string[]; rows: Array<Record<string, string>> } {
  const records = items.map((item) => toRecord(item));
  const columnSet = new Set<string>();

  records.slice(0, 6).forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      if (value !== null && value !== undefined && typeof value !== "object") {
        columnSet.add(key);
      }
    });
  });

  const columns = Array.from(columnSet).slice(0, 8);
  const rows = records.map((record) => {
    const next: Record<string, string> = {};
    columns.forEach((column) => {
      const value = record[column];
      next[column] = value === null || value === undefined ? "-" : String(value);
    });
    return next;
  });

  return { columns, rows };
}

function statusTone(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized.includes("ACTIVE") || normalized.includes("VALID")) {
    return "border-emerald-400/40 bg-emerald-500/12 text-emerald-200";
  }
  if (normalized.includes("IRREGULAR") || normalized.includes("AT_RISK") || normalized.includes("PENDING")) {
    return "border-amber-300 bg-amber-100/10 text-amber-200";
  }
  if (normalized.includes("PAUSED") || normalized.includes("FROZEN")) {
    return "border-sky-400/40 bg-sky-500/12 text-sky-100";
  }
  if (normalized.includes("EXPIRED") || normalized.includes("INACTIVE") || normalized.includes("LAPSED")) {
    return "border-rose-300 bg-rose-100/10 text-rose-200";
  }
  return "border-slate-500 bg-white/5 text-slate-200";
}

function normalizeMemberAccessStatus(value?: string): "ACTIVE" | "BLOCKED" | "DELETED" | "NOT_ADDED" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "BLOCKED" || normalized === "DELETED") {
    return normalized;
  }
  return "NOT_ADDED";
}

function normalizeEnrollmentStatus(value?: string): "NOT_ADDED" | "PENDING" | "ENROLLED" | "BLOCKED" | "DELETED" | "FAILED" {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === "PENDING" ||
    normalized === "ENROLLED" ||
    normalized === "BLOCKED" ||
    normalized === "DELETED" ||
    normalized === "FAILED"
  ) {
    return normalized;
  }
  return "NOT_ADDED";
}

function accessEnrollmentLabel(value?: string): string {
  const normalized = normalizeEnrollmentStatus(value);
  if (normalized === "ENROLLED") {
    return "Enrolled";
  }
  if (normalized === "BLOCKED") {
    return "Blocked";
  }
  if (normalized === "PENDING") {
    return "Pending";
  }
  if (normalized === "FAILED") {
    return "Failed";
  }
  return "Not Enrolled";
}

function accessEnrollmentTone(value?: string): string {
  const normalized = normalizeEnrollmentStatus(value);
  if (normalized === "ENROLLED") {
    return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  }
  if (normalized === "BLOCKED") {
    return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  }
  if (normalized === "PENDING") {
    return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  }
  if (normalized === "FAILED") {
    return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  }
  return "border-white/10 bg-white/[0.06] text-slate-300";
}

function deriveOverallDeviceAccessStatus(statuses: string[]): string {
  const normalized = statuses.map((value) => normalizeEnrollmentStatus(value));
  const enrolledCount = normalized.filter((value) => value === "ENROLLED").length;
  const blockedCount = normalized.filter((value) => value === "BLOCKED").length;
  const pendingCount = normalized.filter((value) => value === "PENDING").length;
  const failedCount = normalized.filter((value) => value === "FAILED").length;
  const totalTracked = normalized.filter((value) => value !== "NOT_ADDED" && value !== "DELETED").length;

  if (failedCount > 0) {
    return "Failed";
  }
  if (pendingCount > 0) {
    return "Pending";
  }
  if (normalized.length > 0 && blockedCount === normalized.length) {
    return "Blocked";
  }
  if (enrolledCount === 0 && totalTracked === 0) {
    return "Not Added";
  }
  if (enrolledCount === normalized.length && normalized.length > 0) {
    return "Added";
  }
  return "Partially Added";
}

function isBiometricDeviceOnline(payload: unknown): boolean {
  const status = pickString(payload, ["status"]).trim().toUpperCase();
  return status.includes("ONLINE") || status.includes("CONNECTED") || status.includes("ACTIVE");
}

function biometricDeviceStatusLabel(payload: unknown): string {
  return isBiometricDeviceOnline(payload) ? "Online" : "Offline";
}

function biometricDeviceStatusTone(payload: unknown): string {
  return isBiometricDeviceOnline(payload) ? "text-emerald-300" : "text-slate-500";
}

function isRealBiometricDevice(payload: unknown): boolean {
  const serial = pickString(payload, ["serialNumber"]).trim().toUpperCase();
  if (!serial) {
    return false;
  }
  return !serial.startsWith("TEST");
}

function friendlyBiometricDeviceName(payload: unknown, index: number): string {
  const configuredName = pickString(payload, ["deviceName"]).trim();
  if (configuredName) {
    return configuredName;
  }
  const serial = pickString(payload, ["serialNumber"]).trim();
  const fallbackNames = ["Main Entrance One - ESSL", "Main Entrance Two - ESSL"];
  if (index < fallbackNames.length) {
    return fallbackNames[index];
  }
  return serial ? `ESSL Device ${index + 1}` : `ESSL Device ${index + 1}`;
}

function attendanceEventLabel(payload: unknown): string {
  const direction = pickString(payload, ["direction", "eventType", "type"]).trim().toUpperCase();
  const punchStatus = pickString(payload, ["punchStatus", "status"]).trim().toUpperCase();
  const combined = `${direction} ${punchStatus}`.trim();
  if (combined.includes("CHECK") && combined.includes("OUT")) {
    return "Check-out";
  }
  if (combined.includes("OUT")) {
    return "Check-out";
  }
  if (combined.includes("IN")) {
    return "Check-in";
  }
  return humanizeLabel(direction || punchStatus || "ACCESS");
}

function attendanceEventTone(label: string): string {
  const normalized = label.toUpperCase();
  if (normalized.includes("OUT")) {
    return "text-amber-200";
  }
  if (normalized.includes("IN")) {
    return "text-rose-300";
  }
  return "text-slate-200";
}

function attendanceRecordStatusLabel(payload: unknown): string {
  const processed = pickBoolean(payload, ["processed"]);
  if (processed === true) {
    return "Success";
  }
  const rawStatus = pickString(payload, ["status", "punchStatus", "result"]).trim();
  if (!rawStatus) {
    return "Success";
  }
  const normalized = rawStatus.toUpperCase();
  if (normalized === "0" || normalized === "SUCCESS" || normalized === "PROCESSED") {
    return "Success";
  }
  if (normalized.includes("FAIL")) {
    return "Failed";
  }
  return humanizeLabel(rawStatus);
}

function attendanceRecordStatusTone(label: string): string {
  const normalized = label.toUpperCase();
  if (normalized.includes("SUCCESS")) {
    return "text-sky-300";
  }
  if (normalized.includes("FAIL")) {
    return "text-rose-300";
  }
  return "text-slate-300";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function daysUntil(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const now = new Date();
  const diff = parsed.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatExpiryWindow(days: number | null): string {
  if (days === null) {
    return "-";
  }
  if (days < 0) {
    const overdueDays = Math.abs(days);
    return `Expired ${overdueDays} day${overdueDays === 1 ? "" : "s"} ago`;
  }
  if (days === 0) {
    return "Expires today";
  }
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function ProfilePanel({
  title,
  subtitle,
  children,
  accent = "slate",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: "slate" | "lime" | "cyan" | "amber" | "rose";
}) {
  const accentClasses = {
    slate: "border-white/8 bg-[#15181f]",
    lime: "border-[#c42924]/30 bg-[#1a1213]",
    cyan: "border-cyan-400/20 bg-[#12191d]",
    amber: "border-amber-400/20 bg-[#1b1711]",
    rose: "border-rose-400/20 bg-[#1c1415]",
  } as const;

  return (
    <section className={`rounded-[28px] border p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)] ${accentClasses[accent]}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StatPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function KeyValueGrid({ payload }: { payload: unknown }) {
  const entries = compactEntries(payload);
  if (entries.length === 0) {
    return <div className="text-sm text-slate-400">No data available.</div>;
  }

  return (
    <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</dt>
          <dd className="mt-2 text-sm font-medium text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GenericTable({ items, emptyLabel }: { items: unknown[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  const { columns, rows } = buildTableRows(items);

  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">{titleize(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {rows.map((row, index) => (
            <tr key={`row-${index}`} className="hover:bg-white/[0.02]">
              {columns.map((column) => (
                <td key={`${index}-${column}`} className="px-4 py-3 text-slate-200">{row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractInvoiceStats(invoices: InvoiceSummary[]) {
  return invoices.reduce(
    (accumulator, invoice) => {
      accumulator.total += invoice.amount || 0;
      accumulator.paid += invoice.paidAmount || 0;
      accumulator.balance += invoice.balanceAmount || 0;
      if (!accumulator.latestIssuedAt || (invoice.issuedAt && new Date(invoice.issuedAt) > new Date(accumulator.latestIssuedAt))) {
        accumulator.latestIssuedAt = invoice.issuedAt;
        accumulator.latestInvoice = invoice.invoiceNumber;
        accumulator.latestReceipt = invoice.receiptNumber || "";
      }
      return accumulator;
    },
    {
      total: 0,
      paid: 0,
      balance: 0,
      latestInvoice: "",
      latestReceipt: "",
      latestIssuedAt: "",
    },
  );
}

function pickOutstandingInvoice(invoices: InvoiceSummary[]): InvoiceSummary | null {
  return [...invoices]
    .filter((invoice) => roundAmount(invoice.balanceAmount || 0) > 0)
    .sort((left, right) => {
      const leftTime = left.issuedAt ? new Date(left.issuedAt).getTime() : 0;
      const rightTime = right.issuedAt ? new Date(right.issuedAt).getTime() : 0;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return Number(left.id || 0) - Number(right.id || 0);
    })[0] || null;
}

function derivePaymentStatus(currentStatus: string, paidAmount: number, balanceAmount: number): string {
  if (paidAmount > 0 && Math.round(balanceAmount) === 0) {
    return "PAID";
  }
  if (currentStatus && currentStatus !== "-") {
    return currentStatus;
  }
  if (paidAmount > 0 && Math.round(balanceAmount) > 0) {
    return "PARTIALLY_PAID";
  }
  return currentStatus || "-";
}

function formatRoundedInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

function formatPlanDuration(durationMonths: number, validityDays: number): string {
  if (durationMonths > 0) {
    return `${durationMonths} ${durationMonths === 1 ? "month" : "months"}`;
  }
  if (validityDays > 0) {
    return `${validityDays} ${validityDays === 1 ? "day" : "days"}`;
  }
  return "-";
}

function formatFlexDayLabel(count: number): string {
  const normalized = Math.max(0, Number(count || 0));
  return `${normalized} ${normalized === 1 ? "day" : "days"}`;
}

function roundAmount(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function projectMembershipEndDate(startDate: string, durationMonths: number, validityDays: number): string | undefined {
  if (!startDate) {
    return undefined;
  }
  const parsed = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  if (durationMonths > 0) {
    const projected = new Date(parsed);
    projected.setMonth(projected.getMonth() + durationMonths);
    projected.setDate(projected.getDate() - 1);
    return projected.toISOString().slice(0, 10);
  }
  if (validityDays > 0) {
    const projected = new Date(parsed);
    projected.setDate(projected.getDate() + validityDays - 1);
    return projected.toISOString().slice(0, 10);
  }
  return undefined;
}

function deriveMembershipFamily(categoryCode?: string, productCode?: string): MembershipFamily {
  const normalizedCategory = String(categoryCode || "").toUpperCase();
  const normalizedProduct = String(productCode || "").toUpperCase();

  if (normalizedCategory === "FLAGSHIP") return "FLAGSHIP";
  if (normalizedCategory === "FLEX" || normalizedProduct.includes("FLEX")) return "FLEX";
  if (normalizedCategory === "PT" || normalizedProduct.includes("PT")) return "PT";
  if (normalizedCategory === "TRANSFORMATION") return "TRANSFORMATION";
  if (normalizedCategory === "GROUP_CLASS") return "GROUP_CLASS";
  if (normalizedCategory === "CREDIT_PACK") return "CREDIT_PACK";
  return "UNKNOWN";
}

function parseFeatureList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => cleanEntitlementFeatureLabel(entry.trim()))
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}

function normalizePaymentStatus(currentStatus: string, totalAmount: number, paidAmount: number, balanceAmount: number): string {
  const roundedTotal = roundAmount(totalAmount);
  const roundedPaid = roundAmount(paidAmount);
  const roundedBalance = roundAmount(balanceAmount);
  const normalizedStatus = String(currentStatus || "").trim().toUpperCase();

  if (roundedTotal > 0 && roundedBalance <= 0) {
    return "PAID";
  }
  if (roundedPaid > 0 && roundedBalance > 0) {
    return "PARTIALLY_PAID";
  }
  if (roundedTotal > 0 && roundedPaid <= 0) {
    if (normalizedStatus && normalizedStatus !== "-") {
      return normalizedStatus;
    }
    return "UNPAID";
  }
  if (normalizedStatus && normalizedStatus !== "-") {
    return normalizedStatus;
  }
  return "-";
}

function membershipPanelTitle(family: MembershipFamily): string {
  switch (family) {
    case "TRANSFORMATION":
      return "Transformation";
    case "PT":
      return "Personal Training";
    case "GROUP_CLASS":
      return "Group Class";
    case "FLEX":
      return "Flex";
    case "CREDIT_PACK":
      return "Credits";
    default:
      return "Gym";
  }
}

function membershipPanelSubtitle(family: MembershipFamily): string {
  switch (family) {
    case "TRANSFORMATION":
      return "Bundled gym access, PT sessions, and entitlements managed as one membership.";
    case "PT":
      return "";
    case "GROUP_CLASS":
      return "Class-only membership with class-specific access and schedule entitlements.";
    case "FLEX":
      return "Check-in based membership with controlled upgrade paths.";
    case "CREDIT_PACK":
      return "Credits are treated as an add-on ledger and are not managed as a standalone membership.";
    default:
      return "Active membership details, access scope, and operational eligibility.";
  }
}

function trimMembershipCardTitle(title: string): string {
  return title
    .replace(/^personal training\s+/i, "")
    .replace(/^pt\s+/i, "")
    .replace(/\bTransform\b/gi, "Transformation")
    .replace(/\s*-\s*\d+\s*M(?:ONTHS?)?$/i, "")
    .trim();
}

function productTierRank(family: MembershipFamily, productCode: string): number {
  const normalized = String(productCode || "").trim().toUpperCase();

  switch (family) {
    case "FLAGSHIP": {
      const order = ["FOMO_MOVE", "FOMO_MOVE_PLUS", "FOMO_CORE", "FOMO_CORE_PLUS", "FOMO_CORE_RHYTHM", "FOMO_BLACK"];
      const index = order.indexOf(normalized);
      return index >= 0 ? index + 1 : 0;
    }
    case "FLEX": {
      const order = ["FLEX_LITE", "FLEX_PRO", "FLEX_ELITE"];
      const index = order.indexOf(normalized);
      return index >= 0 ? index + 1 : 0;
    }
    case "PT": {
      if (normalized.includes("LEVEL_1")) return 1;
      if (normalized.includes("LEVEL_2")) return 2;
      return 0;
    }
    case "TRANSFORMATION": {
      if (normalized.includes("LEVEL_1")) return 1;
      if (normalized.includes("LEVEL_2")) return 2;
      return 0;
    }
    default:
      return 0;
  }
}

function isSamePtTrack(currentProductCode: string, candidateProductCode: string): boolean {
  const current = String(currentProductCode || "").toUpperCase();
  const candidate = String(candidateProductCode || "").toUpperCase();
  const currentCouple = current.includes("COUPLE");
  const candidateCouple = candidate.includes("COUPLE");
  return currentCouple === candidateCouple;
}

function deriveAccentForMembershipFamily(family: MembershipFamily): "slate" | "lime" | "rose" | "amber" | "cyan" {
  switch (family) {
    case "TRANSFORMATION":
      return "amber";
    case "PT":
      return "rose";
    case "GROUP_CLASS":
      return "cyan";
    case "FLEX":
      return "slate";
    default:
      return "lime";
  }
}

function extractMembershipPortfolioItem(payload: unknown): MembershipPortfolioItem | null {
  const record = toRecord(payload);
  const subscriptionId = pickString(record, ["subscriptionId", "id"]);
  if (!subscriptionId) {
    return null;
  }
  const familyRaw = pickString(record, ["family", "categoryCode"]);
  const family = (familyRaw.toUpperCase() || "UNKNOWN") as MembershipFamily;
  return {
    subscriptionId,
    productVariantId: pickString(record, ["productVariantId"]),
    family,
    categoryCode: pickString(record, ["categoryCode"]),
    productCode: pickString(record, ["productCode"]),
    productName: pickString(record, ["productName"]),
    variantName: pickString(record, ["variantName", "activePlan", "name"]),
    status: pickString(record, ["subscriptionStatus", "status"]),
    startDate: pickString(record, ["startDate"]),
    expiryDate: pickString(record, ["expiryDate", "endDate"]),
    durationMonths: pickNumber(record, ["durationMonths"]),
    validityDays: pickNumber(record, ["validityDays"]),
    branchCode: pickString(record, ["branchCode"]),
    invoiceNumber: pickString(record, ["invoiceNumber"]),
    receiptNumber: pickString(record, ["receiptNumber"]),
    paymentConfirmed: pickBoolean(record, ["paymentConfirmed"]) === true,
    includedCheckIns: pickNumber(record, ["includedCheckIns"]),
    usedCheckIns: pickNumber(record, ["usedCheckIns"]),
    checkInsRemaining: pickNumber(record, ["checkInsRemaining"]),
    extraVisitPrice: pickNumber(record, ["extraVisitPrice"]),
    includedPtSessions: pickNumber(record, ["includedPtSessions"]),
    entitlements: toArray(record.entitlements)
      .map((item) => cleanEntitlementFeatureLabel(String(item || "")))
      .filter((item, index, array) => item !== "-" && array.indexOf(item) === index),
  };
}

function pickPortfolioPrimaryMembership(
  candidate: MembershipPortfolioItem | null,
  items: MembershipPortfolioItem[],
): MembershipPortfolioItem | null {
  const current = items.filter((entry) => entry.family !== "CREDIT_PACK");
  const preferredCurrent = current.filter((entry) => entry.family !== "PT");
  if (candidate && candidate.family !== "CREDIT_PACK" && candidate.family !== "PT") {
    return candidate;
  }
  return preferredCurrent[0] || current[0] || candidate || null;
}

function buildDisplayedMembershipCards(
  items: MembershipPortfolioItem[],
  primary: MembershipPortfolioItem | null,
): MembershipPortfolioItem[] {
  const current = items.filter((entry) => entry.family !== "CREDIT_PACK");
  if (!current.length) {
    return [];
  }
  if (!primary) {
    return current;
  }
  return [
    primary,
    ...current.filter((entry) => entry.subscriptionId !== primary.subscriptionId),
  ];
}

async function withTabTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`Loading ${label} timed out.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
  }
}

export default function MemberProfilePage() {
  const params = useParams<{ memberId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const memberId = params.memberId;
  const { token, user } = useAuth();

  const [shell, setShell] = useState<MemberProfileShellResponse | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemberProfileTabKey>("overview");
  const [tabData, setTabData] = useState<Partial<TabPayloadMap>>({});
  const [loadingTabs, setLoadingTabs] = useState<Partial<Record<MemberProfileTabKey, boolean>>>({});
  const [tabErrors, setTabErrors] = useState<Partial<Record<MemberProfileTabKey, string>>>({});
  const [lifecycleAuditEntries, setLifecycleAuditEntries] = useState<MemberProfileAuditEntry[]>([]);
  // Refs mirror loadingTabs/tabData for use in effect guards without causing re-runs
  const loadingTabsRef = useRef(loadingTabs);
  loadingTabsRef.current = loadingTabs;
  const tabDataRef = useRef(tabData);
  tabDataRef.current = tabData;
  const sessionRegisterRef = useRef<HTMLDivElement | null>(null);
  const [assessmentActionBusy, setAssessmentActionBusy] = useState(false);
  const [documentBusyKey, setDocumentBusyKey] = useState<string | null>(null);
  const [memberRecord, setMemberRecord] = useState<UserDirectoryItem | null>(null);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string>("");
  const [openMembershipMenuId, setOpenMembershipMenuId] = useState<string | null>(null);
  const [ptFocusSection, setPtFocusSection] = useState<"session-register" | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [coaches, setCoaches] = useState<UserDirectoryItem[]>([]);
  const [staffMembers, setStaffMembers] = useState<UserDirectoryItem[]>([]);
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [transferInquiries, setTransferInquiries] = useState<InquiryRecord[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogVariants, setCatalogVariants] = useState<CatalogVariant[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [membershipPolicySettings, setMembershipPolicySettings] = useState<MembershipPolicySettings>(defaultMembershipPolicySettings);
  const [hasPtAssignment, setHasPtAssignment] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalKey>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [completedBilling, setCompletedBilling] = useState<CompletedBillingState | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    mobileCountryCode: "+91",
    mobileNumber: "",
    alternateMobileNumber: "",
    dateOfBirth: "",
    inquiryDate: "",
    clientRepStaffId: "",
    gender: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    defaultBranchId: "",
    defaultTrainerStaffId: "",
  });
  const [lifecycleForm, setLifecycleForm] = useState({
    categoryCode: "",
    productCode: "",
    productVariantId: "",
    startDate: "",
    sellingPrice: "",
    discountPercent: "",
    notes: "",
  });
  const [lifecycleBillingForm, setLifecycleBillingForm] = useState({
    paymentMode: "UPI",
    receivedAmount: "",
    balanceDueDate: "",
  });
  const [renewCardSubtype, setRenewCardSubtype] = useState<"DEBIT_CARD" | "CREDIT_CARD">("DEBIT_CARD");
  const [lifecycleUpiVendor, setLifecycleUpiVendor] = useState<"GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER">("GOOGLE_PAY");
  const [freezeForm, setFreezeForm] = useState({
    freezeDays: "7",
    reason: "",
  });
  const [transferForm, setTransferForm] = useState({
    targetMemberId: "",
    startDate: "",
    deactivateSource: true,
    copyUsage: false,
    notes: "",
  });
  const [ptForm, setPtForm] = useState({
    productCode: "",
    productVariantId: "",
    coachId: "",
    startDate: "",
    endDate: "",
    totalSessions: "",
    sellingPrice: "",
    discountPercent: "",
    scheduleTemplate: "ALTERNATE_DAYS" as PtScheduleTemplate,
    scheduleDays: ["MONDAY", "WEDNESDAY", "FRIDAY"] as string[],
    slotStartTime: "06:00",
  });
  const [ptBillingForm, setPtBillingForm] = useState({
    paymentMode: "UPI",
    receivedAmount: "",
    balanceDueDate: "",
  });
  const [ptCardSubtype, setPtCardSubtype] = useState<"DEBIT_CARD" | "CREDIT_CARD">("DEBIT_CARD");
  const [ptUpiVendor, setPtUpiVendor] = useState<"GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER">("GOOGLE_PAY");
  const [ptSessionCountForm, setPtSessionCountForm] = useState({
    assignmentId: "",
    totalSessions: "",
  });
  const [resumeBillingForm, setResumeBillingForm] = useState({
    paymentMode: "UPI",
    invoiceId: "",
  });
  const [ptRescheduleForm, setPtRescheduleForm] = useState({
    sessionId: "",
    currentDate: "",
    currentTime: "",
    newDate: "",
    newTime: "",
    reason: "",
  });
  const [ptCancelForm, setPtCancelForm] = useState({
    sessionId: "",
    currentDate: "",
    currentTime: "",
    newDate: "",
    newTime: "",
    maxDate: "",
    reason: "",
  });
  const [ptAvailabilityOptions, setPtAvailabilityOptions] = useState<unknown[]>([]);
  const [ptCalendarEntries, setPtCalendarEntries] = useState<unknown[]>([]);
  const [visitForm, setVisitForm] = useState({
    paymentMode: "UPI",
  });
  const [accessNotes, setAccessNotes] = useState("");
  const [selectedBiometricDeviceSerial, setSelectedBiometricDeviceSerial] = useState("");

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) {
      return;
    }
    const matched = TAB_ORDER.find((tab) => tab.key === requestedTab);
    if (matched) {
      setActiveTab(matched.key);
    }
  }, [searchParams]);

  // Reset stale loading flags when token refreshes so stuck tabs can retry
  useEffect(() => {
    setLoadingTabs({});
  }, [token]);

  const loadMembershipTab = useCallback(async () => {
    if (!token || !memberId) {
      return;
    }

    setLoadingTabs((current) => ({ ...current, subscriptions: true }));
    setTabErrors((current) => ({ ...current, subscriptions: undefined }));

    try {
      const [dashboard, entitlements, programEnrollments] = await withTabTimeout(
        Promise.all([
          subscriptionService.getMemberDashboard(token, memberId),
          subscriptionService.getMemberEntitlements(token, memberId),
          trainingService.getMemberProgramEnrollments(token, memberId),
        ]),
        "subscriptions",
      );

      setTabData((current) => ({
        ...current,
        subscriptions: {
          dashboard: toRecord(dashboard),
          entitlements: toArray(entitlements),
          history: [],
          programEnrollments: toArray(programEnrollments),
        },
      }));
    } catch (loadError) {
      setTabErrors((current) => ({
        ...current,
        subscriptions:
          loadError instanceof ApiError
            ? loadError.message
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load membership details.",
      }));
    } finally {
      setLoadingTabs((current) => ({ ...current, subscriptions: false }));
    }
  }, [memberId, token]);

  const reloadShell = async () => {
    if (!token || !memberId) {
      return;
    }

    const [profile, user] = await Promise.all([
      usersService.getMemberProfileShell(token, memberId),
      usersService.getUserById(token, memberId),
    ]);

    setShell(profile);
    setMemberRecord(user);
    setTabData({ overview: profile });
    setLoadingTabs({});
    setTabErrors({});
  };

  useEffect(() => {
    if (!token || !memberId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingShell(true);
      setShellError(null);

      try {
        const [profile, user] = await Promise.all([
          usersService.getMemberProfileShell(token, memberId),
          usersService.getUserById(token, memberId),
        ]);
        if (!active) {
          return;
        }
        setShell(profile);
        setMemberRecord(user);
        setTabData((current) => ({ ...current, overview: profile }));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setShellError(loadError instanceof ApiError ? loadError.message : "Unable to load member profile.");
      } finally {
        if (active) {
          setLoadingShell(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [memberId, token]);

  const visibleTabs = useMemo(() => {
    const serverKeys = new Set((shell?.tabs || []).map((tab) => tab.key));
    const hasServerTabs = serverKeys.size > 0;
    const subscriptionDashboard = toRecord(tabData.subscriptions?.dashboard);
    const subscriptionMemberships = toArray(subscriptionDashboard.memberships)
      .map(extractMembershipPortfolioItem)
      .filter((entry): entry is MembershipPortfolioItem => entry !== null);
    const hasPtSubscription = subscriptionMemberships.some((entry) => entry.family === "PT");

    // Derive category from shell to filter PT tab (productCategoryCode lives in overview, not summary)
    const shellCategory = String(
      (shell?.overview as Record<string, unknown>)?.productCategoryCode ||
      (shell?.overview as Record<string, unknown>)?.categoryCode ||
      (shell?.summary as Record<string, unknown>)?.productCategoryCode ||
      (shell?.summary as Record<string, unknown>)?.categoryCode || ""
    ).toUpperCase();
    const memberHasPt = hasPtAssignment || hasPtSubscription || shellCategory === "PT" || shellCategory === "TRANSFORMATION";

    return TAB_ORDER
      .filter((tab) => !hasServerTabs || serverKeys.has(tab.key))
      .filter((tab) => {
        // Show PT tab if member has PT subscription, active PT assignment, or Transformation package (PT bundled)
        if (tab.key === "personal-training") return memberHasPt;
        if (tab.key === "progress" && memberHasPt) return false;
        return true;
      })
      .map((tab) => ({
        key: tab.key,
        label:
          tab.key === "progress"
            ? "Training"
            : shell?.tabs?.find((item) => item.key === tab.key)?.label || tab.label,
      }));
  }, [hasPtAssignment, shell, tabData.subscriptions?.dashboard]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setSupportLoading(true);
      try {
        const [branchPage, coachRows, staffRows, memberRows, products, variants, billing, membershipPolicy, inquiryPage, lifecycleAudit] = await Promise.all([
          branchService.listBranches(token, { page: 0, size: 100 }),
          usersService.searchUsers(token, { role: "COACH", active: true }),
          usersService.searchUsers(token, { role: "STAFF", active: true }),
          usersService.searchUsers(token, { role: "MEMBER", active: true }),
          subscriptionService.getCatalogProducts(token),
          subscriptionService.getCatalogVariants(token),
          subscriptionService.getBillingSettings(token),
          subscriptionService.getMembershipPolicySettings(token),
          subscriptionService.searchInquiriesPaged(token, {}, 0, 200),
          subscriptionService.getMemberLifecycleAudit(token, memberId).catch(() => []),
        ]);

        if (!active) {
          return;
        }

        setBranches(branchPage.content || []);
        setCoaches(coachRows);
        setStaffMembers(staffRows);
        setMembers(memberRows);
        setCatalogProducts(products);
        setCatalogVariants(variants);
        setBillingSettings(billing);
        setMembershipPolicySettings(membershipPolicy);
        setLifecycleAuditEntries(lifecycleAudit);
        setTransferInquiries(
          (inquiryPage.content || []).filter((item) => {
            const status = String(item.status || "").toUpperCase();
            return status !== "LOST" && status !== "NOT_INTERESTED" && Boolean(item.memberId) && String(item.memberId) !== String(memberId);
          }),
        );

        // Eagerly check if member has any PT assignments (for tab visibility)
        try {
          const ptData = await trainingService.getMemberAssignments(token, memberId);
          const ptArr = Array.isArray(ptData) ? ptData : [];
          if (active) {
            setHasPtAssignment(ptArr.length > 0);
          }
        } catch {
          // Training service may 404 — means no PT assignments
          if (active) {
            setHasPtAssignment(false);
          }
        }
      } catch {
        if (!active) {
          return;
        }
      } finally {
        if (active) {
          setSupportLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  // Reset loading states when token changes (e.g., after auth refresh) so tabs can retry
  useEffect(() => {
    setLoadingTabs({});
  }, [token]);

  useEffect(() => {
    if (!token || !memberId || !shell) {
      return;
    }

    if (activeTab === "overview") {
      if (tabDataRef.current.subscriptions === undefined && !loadingTabsRef.current.subscriptions) {
        void loadMembershipTab();
      }
    }

    if (activeTab === "subscriptions") {
      if (tabDataRef.current.subscriptions === undefined && !loadingTabsRef.current.subscriptions) {
        void loadMembershipTab();
      }
      return;
    }

    if (tabDataRef.current[activeTab] !== undefined || loadingTabsRef.current[activeTab]) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingTabs((current) => ({ ...current, [activeTab]: true }));
      setTabErrors((current) => ({ ...current, [activeTab]: undefined }));

      try {
        let payload: TabPayloadMap[MemberProfileTabKey];

        switch (activeTab) {
          case "overview":
            payload = shell;
            break;
          case "billing":
            payload = (await withTabTimeout(
              Promise.all([
                subscriptionService.getMemberBillingInvoices(token, memberId),
                subscriptionService.getMemberBillingReceipts(token, memberId),
              ]).then(([invoices, receipts]) => ({ invoices, receipts })),
              "billing",
            )) as LifecycleBillingTabState;
            break;
          case "attendance":
          {
            const [attendance, accessState, biometricDevices, biometricLogs, enrollments] = await withTabTimeout(
              Promise.all([
                engagementService.getAttendanceByMember(token, memberId),
                usersService.getMemberAccessState(token, memberId),
                engagementService.listBiometricDevices(token).catch(() => []),
                engagementService.getBiometricLogs(token).catch(() => []),
                engagementService.getMemberBiometricEnrollments(token, memberId).catch(() => []),
              ]),
              "attendance",
            );
            if (active) {
              setTabData((current) => ({ ...current, "recovery-services": accessState }));
            }
            payload = {
              records: attendance,
              biometricDevices,
              biometricLogs,
              enrollments,
            };
            break;
          }
          case "credits-wallet": {
            const [wallet, ledger] = await withTabTimeout(Promise.all([
              engagementService.getCreditsWallet(token, memberId),
              engagementService.getCreditsLedger(token, memberId),
            ]), "credits wallet");
            payload = { wallet: toRecord(wallet), ledger: toRecord(ledger) };
            break;
          }
          case "recovery-services":
            payload = await withTabTimeout(usersService.getMemberAccessState(token, memberId), "access and biometrics");
            break;
          case "personal-training":
            try {
              const ptAssignmentsData = await withTabTimeout(trainingService.getMemberAssignments(token, memberId), "personal training");
              const ptArr = Array.isArray(ptAssignmentsData) ? ptAssignmentsData : [];
              // For each active assignment, try to fetch sessions and slots
              let ptSessions: unknown[] = [];
              let ptSlots: unknown[] = [];
              const activeAssign = ptArr.find((a) => {
                const rec = toRecord(a);
                return pickBoolean(rec, ["active"]) === true;
              });
              if (activeAssign) {
                const assignId = pickString(toRecord(activeAssign), ["id", "assignmentId"]);
                if (assignId) {
                  const [sessionsResult, slotsResult] = await Promise.all([
                    trainingService.getPtSessionsByAssignment(token, assignId).catch(() => []),
                    trainingService.getSlotsByAssignment(token, assignId).catch(() => []),
                  ]);
                  ptSessions = Array.isArray(sessionsResult) ? sessionsResult : [];
                  ptSlots = Array.isArray(slotsResult) ? slotsResult : [];
                }
              }
              payload = { assignments: ptArr, sessions: ptSessions, slots: ptSlots } as unknown as TabPayloadMap["personal-training"];
            } catch {
              // Training service may return 404 when no assignments exist
              payload = { assignments: [], sessions: [] };
            }
            break;
          case "progress": {
            const [summary, measurements, photos] = await withTabTimeout(Promise.all([
              engagementService.getMemberProgressSummary(token, memberId),
              engagementService.getMemberProgressMeasurements(token, memberId),
              engagementService.getMemberProgressPhotos(token, memberId),
            ]), "progress");
            payload = { summary: toRecord(summary), measurements, photos };
            break;
          }
          case "freeze-history":
            payload = await withTabTimeout(engagementService.getFreezeHistory(token, memberId), "freeze history");
            break;
          case "notes":
            payload = await withTabTimeout(usersService.getMemberNotes(token, memberId), "notes");
            break;
          case "audit-trail":
            payload = await withTabTimeout(usersService.getMemberProfileAuditTrail(token, memberId), "audit trail");
            break;
          case "fitness-assessment": {
            const [fitnessForm, assessmentStatus, assessmentHistory] = await withTabTimeout(Promise.all([
              usersService.getMemberFitnessForm(token, memberId),
              trainingService.getMemberAssessmentStatus(token, memberId),
              trainingService.getMemberAssessments(token, memberId),
            ]), "fitness assessment");
            payload = { fitnessForm, assessmentStatus, assessmentHistory };
            break;
          }
          default:
            payload = shell;
        }

        if (!active) {
          return;
        }

        setTabData((current) => ({ ...current, [activeTab]: payload }));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTabErrors((current) => ({
          ...current,
          [activeTab]:
            loadError instanceof ApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
              : `Unable to load ${activeTab.replace(/-/g, " ")} tab.`,
        }));
      } finally {
        if (active) {
          setLoadingTabs((current) => ({ ...current, [activeTab]: false }));
        }
      }
    })();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadingTabs/tabData accessed via refs to avoid re-run race conditions
  }, [activeTab, loadMembershipTab, memberId, shell, token]);

  useEffect(() => {
    if (activeTab !== "personal-training" || ptFocusSection !== "session-register") {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      sessionRegisterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPtFocusSection(null);
    }, 120);

    return () => globalThis.clearTimeout(timer);
  }, [activeTab, ptFocusSection, tabData]);

  useEffect(() => {
    if (!openMembershipMenuId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-membership-menu-root='true']")) {
        return;
      }
      setOpenMembershipMenuId(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openMembershipMenuId]);

  useEffect(() => {
    if (!shell) {
      return;
    }

    const summary = toRecord(shell.summary);
    const overview = toRecord(shell.overview);
    setEditForm({
      fullName: shell.fullName || "",
      email: shell.email || "",
      mobileCountryCode: "+91",
      mobileNumber: normalizeIndianMobile(shell.mobileNumber || ""),
      alternateMobileNumber: pickString(summary, ["alternateMobileNumber"]) || "",
      dateOfBirth: pickString(summary, ["dateOfBirth"]) || "",
      inquiryDate: pickString(summary, ["inquiryAt", "dateOfInquiry", "enquiryDate"]).slice(0, 10) || "",
      clientRepStaffId: pickString(summary, ["clientRepStaffId"]) || "",
      gender: pickString(summary, ["gender"]) || "",
      address: pickString(summary, ["address"]) || "",
      emergencyContactName: pickString(summary, ["emergencyContactName"]) || "",
      emergencyContactPhone: pickString(summary, ["emergencyContactPhone"]) || "",
      emergencyContactRelation: pickString(summary, ["emergencyContactRelation"]) || "",
      defaultBranchId: shell.branchId || pickString(summary, ["defaultBranchId"]) || "",
      defaultTrainerStaffId: pickString(summary, ["defaultTrainerStaffId"]) || "",
    });
    setLifecycleForm((current) => ({
      ...current,
      categoryCode: pickString(overview, ["productCategoryCode"]) || current.categoryCode,
      productCode: pickString(overview, ["productCode"]) || current.productCode,
      productVariantId: pickString(overview, ["productVariantId"]) || current.productVariantId,
      startDate: pickString(overview, ["membershipEndDate", "expiryDate"]) || current.startDate,
    }));
  }, [shell]);

  const reloadBillingTab = useCallback(async (): Promise<LifecycleBillingTabState | null> => {
    if (!token || !memberId) {
      return null;
    }
    setLoadingTabs((current) => ({ ...current, billing: true }));
    setTabErrors((current) => ({ ...current, billing: undefined }));
    try {
      const [invoices, receipts] = await Promise.all([
        subscriptionService.getMemberBillingInvoices(token, memberId),
        subscriptionService.getMemberBillingReceipts(token, memberId),
      ]);
      const payload = { invoices, receipts };
      setTabData((current) => ({ ...current, billing: payload }));
      return payload;
    } catch (error) {
      setTabErrors((current) => ({
        ...current,
        billing: error instanceof ApiError ? error.message : "Unable to refresh billing.",
      }));
      return null;
    } finally {
      setLoadingTabs((current) => ({ ...current, billing: false }));
    }
  }, [memberId, token]);

  const reloadPtTab = useCallback(async () => {
    if (!token || !memberId) {
      return;
    }
    setLoadingTabs((current) => ({ ...current, "personal-training": true }));
    setTabErrors((current) => ({ ...current, "personal-training": undefined }));
    try {
      const ptAssignmentsData = await withTabTimeout(trainingService.getMemberAssignments(token, memberId), "personal training");
      const ptArr = Array.isArray(ptAssignmentsData) ? ptAssignmentsData : [];
      let ptSessions: unknown[] = [];
      let ptSlots: unknown[] = [];
      const activeAssign = ptArr.find((assignment) => pickBoolean(toRecord(assignment), ["active"]) === true);
      if (activeAssign) {
        const assignId = pickString(toRecord(activeAssign), ["id", "assignmentId"]);
        if (assignId) {
          const [sessionsResult, slotsResult] = await Promise.all([
            trainingService.getPtSessionsByAssignment(token, assignId).catch(() => []),
            trainingService.getSlotsByAssignment(token, assignId).catch(() => []),
          ]);
          ptSessions = Array.isArray(sessionsResult) ? sessionsResult : [];
          ptSlots = Array.isArray(slotsResult) ? slotsResult : [];
        }
      }
      setTabData((current) => ({
        ...current,
        "personal-training": { assignments: ptArr, sessions: ptSessions, slots: ptSlots },
      }));
    } catch (error) {
      setTabErrors((current) => ({
        ...current,
        "personal-training": error instanceof ApiError ? error.message : "Unable to refresh personal training.",
      }));
    } finally {
      setLoadingTabs((current) => ({ ...current, "personal-training": false }));
    }
  }, [memberId, token]);

  const reloadFitnessAssessment = async () => {
    if (!token || !memberId) {
      return;
    }

    setLoadingTabs((current) => ({ ...current, "fitness-assessment": true }));
    setTabErrors((current) => ({ ...current, "fitness-assessment": undefined }));
    try {
      const [fitnessForm, assessmentStatus, assessmentHistory] = await Promise.all([
        usersService.getMemberFitnessForm(token, memberId),
        trainingService.getMemberAssessmentStatus(token, memberId),
        trainingService.getMemberAssessments(token, memberId),
      ]);

      setTabData((current) => ({
        ...current,
        "fitness-assessment": { fitnessForm, assessmentStatus, assessmentHistory },
      }));
    } catch (loadError) {
      setTabErrors((current) => ({
        ...current,
        "fitness-assessment":
          loadError instanceof ApiError ? loadError.message : "Unable to refresh fitness assessment.",
      }));
    } finally {
      setLoadingTabs((current) => ({ ...current, "fitness-assessment": false }));
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
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to download ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

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
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to open ${type} document.`);
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
      const pdfFilename = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      const file = new File([blob], pdfFilename, {
        type: "application/pdf",
      });

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title,
          files: [file],
        });
      } else {
        // Fallback: download if share not supported
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = pdfFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setActionSuccess(`${title} PDF downloaded.`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to share ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const printDocumentPdf = async (type: "invoice" | "receipt", id: number | string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-print-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const printWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to print ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const runAssessmentAction = async (action: "request" | "skip") => {
    if (!token || !memberId) {
      return;
    }

    setAssessmentActionBusy(true);
    setTabErrors((current) => ({ ...current, "fitness-assessment": undefined }));
    try {
      if (action === "request") {
        await trainingService.requestMemberAssessment(token, memberId);
      } else {
        await trainingService.skipMemberAssessment(token, memberId);
      }
      await reloadFitnessAssessment();
    } catch (actionError) {
      setTabErrors((current) => ({
        ...current,
        "fitness-assessment":
          actionError instanceof ApiError ? actionError.message : `Unable to ${action} assessment.`,
      }));
    } finally {
      setAssessmentActionBusy(false);
    }
  };

  const shellSources = useMemo(() => {
    if (!shell) {
      return [] as unknown[];
    }
    return [shell, shell.summary, shell.overview, shell.raw];
  }, [shell]);

  const memberName = shell?.fullName || `Member #${memberId}`;
  const membershipStatus = pickFromSourcesString([shell?.status, ...shellSources], [
    "status",
    "membershipStatus",
    "subscriptionStatus",
  ]) || "Unknown";
  const rawPlanName = pickFromSourcesString(shellSources, [
    "activePlan",
    "planName",
    "currentPlan",
    "variantName",
    "subscriptionName",
  ]) || "-";
  const planName = normalizeDisplayPlanName(rawPlanName);
  const joinDate = pickFromSourcesString(shellSources, ["joinDate", "createdAt", "onboardedAt", "memberSince", "joinedAt"]);
  const dateOfBirth = pickFromSourcesString(shellSources, ["dateOfBirth", "dob"]);
  const inquiryDate = pickFromSourcesString(shellSources, ["inquiryAt", "dateOfInquiry", "enquiryDate"]);
  const lastAttendance = pickFromSourcesString(shellSources, [
    "lastAttendance",
    "lastCheckIn",
    "lastVisitAt",
    "lastAttendanceAt",
  ]);
  const totalVisits = pickFromSourcesNumber(shellSources, ["totalVisits", "checkIns", "totalCheckIns", "visitCount"]);
  const assignedTrainer = pickFromSourcesString(shellSources, [
    "assignedTrainerName",
    "groupClassTrainerName",
    "trainerName",
    "defaultTrainerName",
  ]) || "-";
  const expiryDate = pickFromSourcesString(shellSources, ["expiryDate", "endDate", "subscriptionEnd", "activeTill", "membershipEndDate"]);
  const startDate = pickFromSourcesString(shellSources, ["startDate", "subscriptionStart", "activeFrom", "membershipStartDate"]);
  const renewalWindowDays = daysUntil(expiryDate);
  const creditsBalance = pickFromSourcesNumber(shellSources, ["credits", "creditBalance", "availableCredits", "walletBalance", "creditsRemaining"]);
  const shellPaymentStatus = pickFromSourcesString(shellSources, ["paymentStatus", "invoicePaymentStatus"]) || "-";
  const branchCode = pickFromSourcesString(shellSources, ["branchCode"]);
  const branchLabel = shell?.branchName || pickFromSourcesString(shellSources, ["branchName"]) || branchCode || shell?.branchId || "-";
  const productCategoryCode = pickFromSourcesString(shellSources, ["productCategoryCode", "categoryCode"]) || "";
  const currentProductCode = pickFromSourcesString(shellSources, ["productCode"]) || "";
  const activeSubscriptionId = pickFromSourcesString(shellSources, ["activeSubscriptionId", "subscriptionId"]);
  const activeProductVariantId = pickFromSourcesString(shellSources, ["productVariantId", "activeVariantId"]);
  const trainerContext = pickFromSourcesString(shellSources, ["trainerContext"]) || "";
  const durationMonths = pickFromSourcesNumber(shellSources, ["durationMonths"]);
  const validityDays = pickFromSourcesNumber(shellSources, ["validityDays"]);
  const planDuration = formatPlanDuration(durationMonths, validityDays);
  const trainerLabel =
    trainerContext === "GROUP_CLASS" || productCategoryCode.toUpperCase() === "GROUP_CLASS"
      ? "Group Class Trainer"
      : "Assigned Trainer";
  const clientRepName = pickFromSourcesString(shellSources, ["clientRepName", "clientRepresentativeName", "clientRep"]) || "-";
  const interestedIn = pickFromSourcesString(shellSources, ["interestedIn"]) || "-";
  const billingRepName =
    pickFromSourcesString(shellSources, ["billedByStaffName", "billingRepName", "billingRepresentativeName"]) ||
    (clientRepName !== "-" ? clientRepName : "-");
  const sourceInquiryId = pickFromSourcesNumber(shellSources, ["sourceInquiryId", "inquiryId", "leadId"]);
  const memberCode =
    pickFromSourcesString(shellSources, ["memberCode", "code", "externalCode"]) ||
    (sourceInquiryId
      ? formatMemberCode(sourceInquiryId, {
          branchCode,
          createdAt: joinDate,
        })
      : String(shell?.memberId || memberId));
  const email = shell?.email || pickFromSourcesString(shellSources, ["email"]);
  const phone = shell?.mobileNumber || pickFromSourcesString(shellSources, ["mobileNumber", "phoneNumber", "mobile"]);
  const normalizedPhonePin = normalizeIndianMobile(phone || "");
  const memberDisplayName =
    shell?.fullName ||
    pickFromSourcesString(shellSources, ["fullName", "name"]) ||
    `Member ${memberCode}`;
  const emergencyContactName = pickFromSourcesString(shellSources, [
    "emergencyContactName",
    "emergencyName",
    "emergencyContact",
  ]) || "";
  const emergencyContactPhone = pickFromSourcesString(shellSources, [
    "emergencyContactPhone",
    "emergencyPhone",
    "emergencyMobileNumber",
  ]) || "";
  const emergencyContact = [emergencyContactName, emergencyContactPhone].filter(Boolean).join(" · ") || "-";
  const referredBy = pickFromSourcesString(shellSources, ["referralSource", "source", "leadSource", "sourceName"]) || "-";
  const shellPaidAmount = pickFromSourcesNumber(shellSources, ["totalPaidAmount", "paidAmount"]);
  const shellBalanceAmount = pickFromSourcesNumber(shellSources, ["balanceAmount", "outstandingAmount"]);
  const shellLatestInvoiceNumber = pickFromSourcesString(shellSources, ["latestInvoiceNumber"]);
  const shellLatestReceiptNumber = pickFromSourcesString(shellSources, ["latestReceiptNumber"]);
  const attendancePayload = toRecord(tabData.attendance);
  const attendanceRecords = Array.isArray(attendancePayload.records) ? attendancePayload.records : [];
  const biometricDeviceRecords = toArray<RecordLike>(attendancePayload.biometricDevices).filter((device) => isRealBiometricDevice(device));
  const biometricLogRecords = toArray<RecordLike>(attendancePayload.biometricLogs).filter((entry) => {
    const logMemberId = pickString(entry, ["memberId"]);
    const logPin = pickString(entry, ["deviceUserId"]);
    return logMemberId === String(memberId) || (!!normalizedPhonePin && logPin === normalizedPhonePin);
  });
  const enrollmentRecords = toArray<RecordLike>(attendancePayload.enrollments);
  const visibleBiometricSerials = new Set(
    [
      ...enrollmentRecords.map((entry) => pickString(entry, ["deviceSerialNumber"])),
      ...biometricLogRecords.map((entry) => pickString(entry, ["deviceSerialNumber"])),
    ].filter(Boolean),
  );
  const normalizedBranchCode = String(branchCode || "").trim().toUpperCase();
  const availableBiometricDevices = biometricDeviceRecords
    .filter((device) => {
      const serial = pickString(device, ["serialNumber"]);
      if (serial && visibleBiometricSerials.has(serial)) {
        return true;
      }
      const deviceBranchCode = String(pickString(device, ["branchCode"]) || "").trim().toUpperCase();
      if (!normalizedBranchCode || !deviceBranchCode) {
        return true;
      }
      if (deviceBranchCode === normalizedBranchCode) {
        return true;
      }
      return biometricDeviceRecords.length <= 2;
    })
    .sort((left, right) => {
      const leftSerial = pickString(left, ["serialNumber"]);
      const rightSerial = pickString(right, ["serialNumber"]);
      const leftBranch = String(pickString(left, ["branchCode"]) || "").trim().toUpperCase();
      const rightBranch = String(pickString(right, ["branchCode"]) || "").trim().toUpperCase();
      const leftPriority =
        (leftSerial && visibleBiometricSerials.has(leftSerial) ? 0 : 1) +
        (leftBranch === normalizedBranchCode ? 0 : 2);
      const rightPriority =
        (rightSerial && visibleBiometricSerials.has(rightSerial) ? 0 : 1) +
        (rightBranch === normalizedBranchCode ? 0 : 2);
      return leftPriority - rightPriority;
    });
  const enrollmentByDeviceSerial = new Map(
    enrollmentRecords.map((entry) => [
      pickString(entry, ["deviceSerialNumber"]),
      entry,
    ]),
  );
  const onlineBiometricDevices = availableBiometricDevices.filter((device) => isBiometricDeviceOnline(device));
  const overallDeviceEnrollmentStatuses = availableBiometricDevices.map((device) =>
    pickString(enrollmentByDeviceSerial.get(pickString(device, ["serialNumber"])), ["status"]),
  );
  const displayAccessStatus = deriveOverallDeviceAccessStatus(overallDeviceEnrollmentStatuses);
  const biometricDeviceNameBySerial = new Map(
    availableBiometricDevices.map((device, index) => [
      pickString(device, ["serialNumber"]),
      friendlyBiometricDeviceName(device, index),
    ]),
  );
  const attendanceSourceRecords = biometricLogRecords.length > 0 ? biometricLogRecords : toArray<RecordLike>(attendanceRecords);
  const attendanceLogRows = attendanceSourceRecords
    .map((entry, index) => {
      const timestamp =
        pickString(entry, ["punchTimestamp", "timestamp", "checkInTime", "recordedAt", "createdAt"]) ||
        pickString(entry, ["checkOutTime"]);
      const deviceSerial = pickString(entry, ["deviceSerialNumber", "deviceSerial", "serialNumber"]);
      return {
        id: pickString(entry, ["id"]) || `${deviceSerial || "attendance"}-${timestamp || index}`,
        timestamp,
        dateLabel: formatDateOnly(timestamp),
        timeLabel: formatTimeOnly(timestamp),
        deviceLabel:
          biometricDeviceNameBySerial.get(deviceSerial) ||
          pickString(entry, ["deviceName", "device", "gateName"]) ||
          deviceSerial ||
          "-",
        eventLabel: attendanceEventLabel(entry),
        statusLabel: attendanceRecordStatusLabel(entry),
      };
    })
    .sort((left, right) => {
      const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
      return rightTime - leftTime;
    });
  const checkInRows = attendanceLogRows.filter((entry) => entry.eventLabel.toUpperCase().includes("CHECK-IN"));

  const overviewBilling = (tabData.billing as LifecycleBillingTabState | undefined)?.invoices || [];
  const outstandingBillingInvoices = useMemo(
    () =>
      [...overviewBilling]
        .filter((invoice) => roundAmount(invoice.balanceAmount || 0) > 0)
        .sort((left, right) => {
          const leftTime = left.issuedAt ? new Date(left.issuedAt).getTime() : 0;
          const rightTime = right.issuedAt ? new Date(right.issuedAt).getTime() : 0;
          if (leftTime !== rightTime) {
            return leftTime - rightTime;
          }
          return Number(left.id || 0) - Number(right.id || 0);
        }),
    [overviewBilling],
  );
  const selectedOutstandingInvoice = useMemo(
    () => pickOutstandingInvoice(outstandingBillingInvoices),
    [outstandingBillingInvoices],
  );
  const invoiceStats = extractInvoiceStats(overviewBilling);
  const displayInvoiceStats = overviewBilling.length
    ? invoiceStats
    : {
        total: shellPaidAmount + shellBalanceAmount,
        paid: shellPaidAmount,
        balance: shellBalanceAmount,
        latestInvoice: shellLatestInvoiceNumber,
        latestReceipt: shellLatestReceiptNumber,
        latestIssuedAt: "",
      };
  const roundedInvoiceStats = {
    total: roundAmount(displayInvoiceStats.total),
    paid: roundAmount(displayInvoiceStats.paid),
    balance: roundAmount(displayInvoiceStats.balance),
    latestInvoice: displayInvoiceStats.latestInvoice,
    latestReceipt: displayInvoiceStats.latestReceipt,
    latestIssuedAt: displayInvoiceStats.latestIssuedAt,
  };
  const paymentStatus = normalizePaymentStatus(
    shellPaymentStatus,
    displayInvoiceStats.total,
    displayInvoiceStats.paid,
    displayInvoiceStats.balance,
  );
  const balanceDue = roundedInvoiceStats.balance;
  const roundedBalanceDue = roundedInvoiceStats.balance;
  const selectedOutstandingInvoiceNumber = selectedOutstandingInvoice?.invoiceNumber || roundedInvoiceStats.latestInvoice;
  const selectedOutstandingInvoiceBalance = selectedOutstandingInvoice
    ? roundAmount(selectedOutstandingInvoice.balanceAmount || 0)
    : roundedBalanceDue;
  const normalizedPaymentStatus = String(paymentStatus || "").trim().toUpperCase();
  useEffect(() => {
    if (actionModal !== "unfreeze-billing") {
      return;
    }

    if (overviewBilling.length > 0 || loadingTabs.billing) {
      return;
    }

    void reloadBillingTab();
  }, [actionModal, loadingTabs.billing, overviewBilling.length, reloadBillingTab]);

  useEffect(() => {
    if (actionModal !== "unfreeze-billing" || !selectedOutstandingInvoice || resumeBillingForm.invoiceId) {
      return;
    }
    setResumeBillingForm((current) => ({
      ...current,
      invoiceId: String(selectedOutstandingInvoice.id || ""),
    }));
  }, [actionModal, resumeBillingForm.invoiceId, selectedOutstandingInvoice]);
  const normalizedMembershipStatus = String(membershipStatus || "").trim().toUpperCase();
  const hasOutstandingBalance = roundedBalanceDue > 0;
  const isAccountPausedForPayment =
    normalizedMembershipStatus === "PAUSED" &&
    hasOutstandingBalance &&
    normalizedPaymentStatus !== "PAID";
  const ptTabData = tabData["personal-training"] as { assignments?: unknown[]; sessions?: unknown[] } | undefined;
  const ptAssignments = Array.isArray(ptTabData?.assignments) ? ptTabData.assignments : (Array.isArray(tabData["personal-training"]) ? tabData["personal-training"] as unknown[] : []);
  const ptSessions = Array.isArray(ptTabData?.sessions) ? ptTabData.sessions : [];
  const activePtAssignment = ptAssignments.find((item) => {
    const record = toRecord(item);
    return pickBoolean(record, ["active"]) === true;
  });
  const activePtAssignmentRecord = activePtAssignment ? toRecord(activePtAssignment) : null;
  const activePtCoachId = pickString(activePtAssignmentRecord, ["coachId"]);
  const activePtCoachName =
    pickString(activePtAssignmentRecord, ["coachName", "coachDisplayName"])
    || coaches.find((coach) => String(coach.id) === String(activePtCoachId || ""))?.name
    || pickString(activePtAssignmentRecord, ["coachEmail", "coachId"])
    || "-";
  const ptAssignmentRescheduleLimit = pickNumber(activePtAssignmentRecord, ["rescheduleLimit"]);
  const ptUsedReschedules = ptSessions.filter((session) => {
    const status = pickString(toRecord(session), ["status"])?.toUpperCase();
    return status === "RESCHEDULED";
  }).length;
  const ptHasUnlimitedReschedules = ptAssignmentRescheduleLimit <= 0;
  const ptRemainingReschedules = ptHasUnlimitedReschedules ? null : Math.max(ptAssignmentRescheduleLimit - ptUsedReschedules, 0);
  const ptRescheduleSlotOptions = buildAvailablePtSlotsForDate({
    dateIso: ptRescheduleForm.newDate,
    availability: ptAvailabilityOptions,
    calendarEntries: ptCalendarEntries,
    excludeSessionId: ptRescheduleForm.sessionId,
  }).filter((slot) => slot !== ptRescheduleForm.currentTime);
  const ptCancelSlotOptions = buildAvailablePtSlotsForDate({
    dateIso: ptCancelForm.newDate,
    availability: ptAvailabilityOptions,
    calendarEntries: ptCalendarEntries,
  });
  const ptCancelDateSummaries = (() => {
    const summaries: Array<{ date: string; slots: string[] }> = [];
    if (!ptCancelForm.newDate || !ptCancelForm.maxDate) {
      return summaries;
    }
    let cursor = ptCancelForm.newDate;
    for (let index = 0; index < 7 && cursor <= ptCancelForm.maxDate; index += 1) {
      summaries.push({
        date: cursor,
        slots: buildAvailablePtSlotsForDate({
          dateIso: cursor,
          availability: ptAvailabilityOptions,
          calendarEntries: ptCalendarEntries,
        }),
      });
      cursor = addDaysToLocalIsoDate(cursor, 1);
    }
    return summaries;
  })();
  const subscriptionsDashboardRecord = toRecord(tabData.subscriptions?.dashboard);
  const entitlementRecords = toArray<RecordLike>(tabData.subscriptions?.entitlements);
  const dashboardMembershipSummaries = toArray(subscriptionsDashboardRecord.memberships)
    .map(extractMembershipPortfolioItem)
    .filter((entry): entry is MembershipPortfolioItem => entry !== null);
  const membershipVariantLookup = new Map(
    dashboardMembershipSummaries.map((entry) => {
      const catalogVariant =
        catalogVariants.find((variant) => String(variant.variantId) === String(entry.productVariantId)) ||
        catalogVariants.find((variant) => variant.productCode === entry.productCode && variant.variantName === entry.variantName);
      return [entry.subscriptionId, catalogVariant];
    }),
  );
  const normalizedEntitlementRecords = entitlementRecords
    .map((entry) => ({
      entitlementId: Number(pickString(entry, ["entitlementId", "id"]) || 0),
      feature: pickString(entry, ["feature"]),
      source: pickString(entry, ["source"]),
      validFrom: pickString(entry, ["validFrom"]) || undefined,
      validUntil: pickString(entry, ["validUntil"]) || undefined,
      includedCount: pickNumber(entry, ["includedCount"]),
      remainingCount: pickNumber(entry, ["remainingCount"]),
      recurrence: pickString(entry, ["recurrence"]) || undefined,
      usedCount: pickNumber(entry, ["usedCount"]),
      expiredUnusedCount: pickNumber(entry, ["expiredUnusedCount"]),
      manualTopUpCount: pickNumber(entry, ["manualTopUpCount"]),
      expiresIfUnused: pickBoolean(entry, ["expiresIfUnused"]),
      currentCycleStart: pickString(entry, ["currentCycleStart"]) || undefined,
      currentCycleEnd: pickString(entry, ["currentCycleEnd"]) || undefined,
      lastUtilizedAt: pickString(entry, ["lastUtilizedAt"]) || undefined,
      lastExpiredAt: pickString(entry, ["lastExpiredAt"]) || undefined,
    }))
    .filter((entry) => entry.entitlementId > 0)
    .filter((entry) => shouldTrackUsageEntitlement(entry.feature))
    .map((entry) => {
      if (String(entry.feature || "").toUpperCase() !== "PAUSE_BENEFIT") {
        return entry;
      }
      const linkedSubscriptionId = extractSubscriptionIdFromEntitlementSource(entry.source);
      const linkedVariant = membershipVariantLookup.get(linkedSubscriptionId);
      const allowedDays = Math.max(linkedVariant?.passBenefitDays || 0, Number(entry.includedCount || 0));
      if (allowedDays <= 0) {
        return entry;
      }
      const usedDays = Number(entry.usedCount || 0);
      return {
        ...entry,
        includedCount: allowedDays,
        remainingCount: Math.max(allowedDays - usedDays, 0),
      };
    });
  const portfolioMembershipItems = toArray(subscriptionsDashboardRecord.memberships)
    .map(extractMembershipPortfolioItem)
    .filter((entry): entry is MembershipPortfolioItem => entry !== null);
  const todayIsoDate = toLocalIsoDate(new Date());
  const isUpcomingMembershipRecord = (entry: MembershipPortfolioItem | null | undefined) => {
    if (!entry) {
      return false;
    }
    const normalizedStatus = String(entry.status || "").toUpperCase();
    return (Boolean(entry.startDate) && entry.startDate > todayIsoDate) || normalizedStatus === "PENDING" || normalizedStatus === "ISSUED";
  };
  const currentPortfolioMembershipItems = portfolioMembershipItems.filter((entry) => !isUpcomingMembershipRecord(entry));
  const portfolioPrimaryCandidate = extractMembershipPortfolioItem(subscriptionsDashboardRecord.primaryMembership);
  const portfolioPrimaryMembership = pickPortfolioPrimaryMembership(
    !isUpcomingMembershipRecord(portfolioPrimaryCandidate) ? portfolioPrimaryCandidate : null,
    currentPortfolioMembershipItems,
  );
  const portfolioTransformationCandidate = extractMembershipPortfolioItem(subscriptionsDashboardRecord.transformationMembership);
  const portfolioTransformationMembership = !isUpcomingMembershipRecord(portfolioTransformationCandidate)
    ? portfolioTransformationCandidate
    : currentPortfolioMembershipItems.find((entry) => entry.family === "TRANSFORMATION") || null;
  const hasActivePtMembership = portfolioMembershipItems.some((entry) => {
    const normalizedStatus = String(entry.status || "").toUpperCase();
    return entry.family === "PT" && !["EXPIRED", "LAPSED", "INACTIVE", "CANCELLED", "CANCELED"].includes(normalizedStatus);
  });
  const overviewDisplayedMemberships = buildDisplayedMembershipCards(
    currentPortfolioMembershipItems,
    portfolioTransformationMembership || portfolioPrimaryMembership,
  );
  const fallbackOverviewMemberships: MembershipPortfolioItem[] = [
    ...(planName && planName !== "-" && planName !== "No active membership"
      ? [
          {
            subscriptionId: activeSubscriptionId || "overview-primary",
            productVariantId: activeProductVariantId || "",
            family: deriveMembershipFamily(productCategoryCode.toUpperCase(), currentProductCode || planName),
            categoryCode: productCategoryCode,
            productCode: currentProductCode,
            productName: planName,
            variantName: planName,
            status: membershipStatus,
            startDate,
            expiryDate,
            durationMonths,
            validityDays,
            branchCode,
            invoiceNumber: shellLatestInvoiceNumber,
            receiptNumber: shellLatestReceiptNumber,
            paymentConfirmed: paymentStatus.toUpperCase() === "PAID",
            includedCheckIns: 0,
            usedCheckIns: 0,
            checkInsRemaining: 0,
            extraVisitPrice: 0,
            includedPtSessions: 0,
            entitlements: [],
          },
        ]
      : []),
    ...(activePtAssignment
      ? [
          {
            subscriptionId: pickString(activePtAssignmentRecord, ["id", "assignmentId"]) || "overview-pt",
            productVariantId: "",
            family: "PT" as MembershipFamily,
            categoryCode: "PT",
            productCode: "PT",
            productName: "Personal Training",
            variantName:
              pickString(activePtAssignmentRecord, ["packageName", "variantName", "productName", "assignmentName"]) || "Personal Training",
            status: pickBoolean(activePtAssignmentRecord, ["active"]) ? "ACTIVE" : "INACTIVE",
            startDate: pickString(activePtAssignmentRecord, ["startDate"]),
            expiryDate: pickString(activePtAssignmentRecord, ["endDate"]),
            durationMonths: 0,
            validityDays: 0,
            branchCode,
            invoiceNumber: "",
            receiptNumber: "",
            paymentConfirmed: true,
            includedCheckIns: 0,
            usedCheckIns: 0,
            checkInsRemaining: 0,
            extraVisitPrice: 0,
            includedPtSessions: pickNumber(activePtAssignmentRecord, ["sessionCount", "includedSessions", "totalSessions"]),
            entitlements: [],
          },
        ]
      : []),
  ].filter((entry, index, array) => array.findIndex((item) => item.subscriptionId === entry.subscriptionId) === index);
  const overviewMembershipCards = overviewDisplayedMemberships.length ? overviewDisplayedMemberships : fallbackOverviewMemberships;
  const selectedMembershipRecord = currentPortfolioMembershipItems.find((entry) => entry.subscriptionId === selectedMembershipId)
    || portfolioPrimaryMembership
    || null;
  const selectedProductCategoryCode = selectedMembershipRecord?.categoryCode || productCategoryCode;
  const selectedProductCode = selectedMembershipRecord?.productCode || currentProductCode;
  const selectedSubscriptionId = selectedMembershipRecord?.subscriptionId || activeSubscriptionId;
  const selectedProductVariantId = selectedMembershipRecord?.productVariantId
    || (selectedMembershipRecord?.subscriptionId
    ? pickString(
        toRecord(
          toArray(subscriptionsDashboardRecord.memberships).find(
            (entry) => pickString(toRecord(entry), ["subscriptionId"]) === selectedMembershipRecord.subscriptionId,
          ),
        ),
        ["productVariantId"],
      ) || activeProductVariantId
    : activeProductVariantId);
  const selectedDurationMonths = selectedMembershipRecord?.durationMonths || durationMonths;
  const selectedValidityDays = selectedMembershipRecord?.validityDays || validityDays;
  const selectedStartDate = selectedMembershipRecord?.startDate || startDate;
  const selectedExpiryDate = selectedMembershipRecord?.expiryDate || expiryDate;
  const selectedPlanLabel = normalizeDisplayPlanName(selectedMembershipRecord?.variantName || planName);
  const currentCatalogProduct = useMemo(
    () => catalogProducts.find((product) => product.productCode === selectedProductCode),
    [catalogProducts, selectedProductCode],
  );
  const currentCatalogVariant = useMemo(
    () =>
      catalogVariants.find((variant) => String(variant.variantId) === String(selectedProductVariantId)) ||
      catalogVariants.find((variant) => variant.variantCode === selectedPlanLabel || variant.variantName === selectedPlanLabel),
    [selectedProductVariantId, catalogVariants, selectedPlanLabel],
  );
  useEffect(() => {
    if (!portfolioPrimaryMembership?.subscriptionId) {
      return;
    }
    setSelectedMembershipId((current) => {
      if (current && currentPortfolioMembershipItems.some((entry) => entry.subscriptionId === current)) {
        return current;
      }
      return portfolioPrimaryMembership.subscriptionId;
    });
  }, [currentPortfolioMembershipItems, portfolioPrimaryMembership]);
  const visibleCurrentMembershipLabel = normalizeDisplayPlanName(
    portfolioPrimaryMembership?.variantName || portfolioPrimaryMembership?.productName || planName,
  );
  const visibleCurrentMembershipDuration = formatPlanDuration(
    portfolioPrimaryMembership?.durationMonths || durationMonths,
    portfolioPrimaryMembership?.validityDays || validityDays,
  );
  const normalizedVisibleCurrentMembershipStatus = String(
    portfolioPrimaryMembership?.status || membershipStatus || "",
  ).trim().toUpperCase();
  const isVisibleCurrentMembershipPaymentPending =
    normalizedVisibleCurrentMembershipStatus === "PAUSED" &&
    hasOutstandingBalance &&
    normalizedPaymentStatus !== "PAID";
  const visibleCurrentMembershipStatus = isVisibleCurrentMembershipPaymentPending
    ? "Paused"
    : humanizeLabel(portfolioPrimaryMembership?.status || membershipStatus);
  const selectedEntitlementRecords = normalizedEntitlementRecords.filter((entry) => {
    const linkedSubscriptionId = extractSubscriptionIdFromEntitlementSource(entry.source);
    if (!linkedSubscriptionId) {
      return true;
    }
    return linkedSubscriptionId === selectedSubscriptionId;
  });
  const entitlementFeatures = selectedEntitlementRecords.map((entry) => String(entry.feature || "").toUpperCase());
  const hasFreezeEntitlement = entitlementFeatures.some((feature) =>
    feature === "PAUSE_BENEFIT" ||
    feature === "PAUSE_BENEFITS" ||
    feature === "PASS_BENEFIT" ||
    feature === "PASS_BENEFITS",
  ) || (currentCatalogVariant?.passBenefitDays || 0) > 0;
  const normalizedProductCode = selectedProductCode.toUpperCase();
  const hasUnlimitedPtReschedules = Boolean(
    normalizedProductCode.includes("BLACK")
      || String(portfolioPrimaryMembership?.productCode || "").toUpperCase().includes("BLACK"),
  );
  const normalizedCategoryCode = selectedProductCategoryCode.toUpperCase();
  const selectedMembershipStatusRaw = String(selectedMembershipRecord?.status || membershipStatus || "").trim().toUpperCase();
  const isSelectedMembershipPaymentPendingPause =
    selectedMembershipStatusRaw === "PAUSED" &&
    hasOutstandingBalance &&
    normalizedPaymentStatus !== "PAID";
  const isSelectedMembershipOperationalFreeze =
    selectedMembershipStatusRaw === "PAUSED" &&
    !isSelectedMembershipPaymentPendingPause;
  const membershipFamily = deriveMembershipFamily(normalizedCategoryCode, normalizedProductCode || selectedPlanLabel || rawPlanName);
  const isGroupClassPlan = membershipFamily === "GROUP_CLASS";
  const isFlagshipPlan = membershipFamily === "FLAGSHIP";
  const isTransformationPlan = membershipFamily === "TRANSFORMATION";
  const isFlexPlan = membershipFamily === "FLEX";
  const isPtPlan = membershipFamily === "PT";
  const hasPrimaryMembership = Boolean(selectedSubscriptionId) && membershipFamily !== "CREDIT_PACK";
  const hasOverviewMembership =
    overviewMembershipCards.length > 0 &&
    !["EXPIRED", "LAPSED", "INACTIVE"].some((status) => membershipStatus.toUpperCase().includes(status));
  const currentProductRank = productTierRank(membershipFamily, selectedProductCode);
  const eligibleUpgradeVariants = useMemo(
    () =>
      catalogVariants.filter((variant) => {
        if (variant.categoryCode === "CREDIT_PACK") {
          return false;
        }
        if (variant.categoryCode === "PT" && !isPtPlan) {
          return false;
        }

        const currentVariant = catalogVariants.find((item) => String(item.variantId) === String(selectedProductVariantId));
        const currentDuration = currentVariant?.durationMonths || selectedDurationMonths;
        const currentValidity = currentVariant?.validityDays || selectedValidityDays;
        const currentRank = currentProductRank;
        const candidateRank = productTierRank(membershipFamily, variant.productCode);
        const sameProduct = variant.productCode === selectedProductCode;

        if (isFlagshipPlan && variant.categoryCode !== "FLAGSHIP") {
          return false;
        }
        if (isFlexPlan && !((variant.categoryCode === "FLEX" && variant.productCode === selectedProductCode) || variant.categoryCode === "FLAGSHIP")) {
          return false;
        }
        if (isPtPlan && !(variant.categoryCode === "PT" && isSamePtTrack(selectedProductCode, variant.productCode))) {
          return false;
        }
        if (isGroupClassPlan && variant.productCode !== selectedProductCode) {
          return false;
        }
        if (isTransformationPlan && variant.categoryCode !== "TRANSFORMATION") {
          return false;
        }

        if (sameProduct) {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return variant.durationMonths > currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return variant.validityDays > currentValidity;
          }
        }

        if (candidateRank > currentRank) {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return variant.durationMonths >= currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return variant.validityDays >= currentValidity;
          }
          return true;
        }

        return false;
      }),
    [
      catalogVariants,
      currentProductRank,
      isFlagshipPlan,
      isFlexPlan,
      isGroupClassPlan,
      isPtPlan,
      isTransformationPlan,
      membershipFamily,
      selectedDurationMonths,
      selectedProductCode,
      selectedProductVariantId,
      selectedValidityDays,
    ],
  );
  const isAdminOperator = user?.role === "ADMIN";
  const isStaffOperator = user?.role === "STAFF";
  const canOperateMemberships = isAdminOperator || isStaffOperator;
  const canManageTransfers = isAdminOperator || (user?.role === "STAFF" && user?.designation === "GYM_MANAGER");
  const pauseBenefitDays = Math.max(
    currentCatalogVariant?.passBenefitDays || 0,
    selectedEntitlementRecords
      .filter((entry) => String(entry.feature || "").toUpperCase() === "PAUSE_BENEFIT")
      .reduce((max, entry) => Math.max(max, Number(entry.includedCount || 0)), 0),
  );
  const currentUpgradeWindowDays =
    selectedDurationMonths >= 6 || selectedValidityDays >= 180
      ? membershipPolicySettings.upgradeWindowLongDays
      : selectedDurationMonths >= 3 || selectedValidityDays >= 90
        ? membershipPolicySettings.upgradeWindowMediumDays
        : membershipPolicySettings.upgradeWindowShortDays;
  const elapsedUpgradeDays = selectedStartDate
    ? Math.max(0, Math.floor((Date.parse(todayIsoDate) - Date.parse(selectedStartDate)) / (24 * 60 * 60 * 1000)))
    : 0;
  const upgradeWindowExceeded = Boolean(selectedStartDate) && elapsedUpgradeDays > currentUpgradeWindowDays;
  const freezeMinDays = 5;
  const freezeMaxDays = pauseBenefitDays;
  const freezeDaysInput = Number(freezeForm.freezeDays || 0);
  const freezePreviewDays = Number.isFinite(freezeDaysInput) ? Math.max(0, freezeDaysInput) : 0;
  const freezePreviewStartDate = todayIsoDate;
  const freezePreviewEndDate = freezePreviewDays > 0
    ? addDaysToLocalIsoDate(todayIsoDate, freezePreviewDays - 1)
    : "";
  const freezePreviewExpiryDate = selectedExpiryDate && freezePreviewDays > 0
    ? addDaysToLocalIsoDate(selectedExpiryDate, freezePreviewDays)
    : selectedExpiryDate;
  const freezePreviewRemainingDays = Math.max(freezeMaxDays - freezePreviewDays, 0);
  const canShowFreezeAction = hasPrimaryMembership && canOperateMemberships && hasFreezeEntitlement && !isFlexPlan && !isGroupClassPlan && !isPtPlan;
  const canCollectOutstandingBalance =
    canOperateMemberships &&
    hasOutstandingBalance;
  const canShowBalanceCollectionAction =
    hasPrimaryMembership &&
    canCollectOutstandingBalance &&
    isSelectedMembershipPaymentPendingPause;
  const canShowManualUnfreezeAction =
    canShowFreezeAction &&
    isSelectedMembershipOperationalFreeze &&
    Boolean(selectedStartDate) &&
    selectedStartDate <= todayIsoDate;
  const canRenewMembership = hasPrimaryMembership;
  const canShowUpgradeMembershipAction =
    hasPrimaryMembership &&
    (isFlagshipPlan || isGroupClassPlan || isFlexPlan || isTransformationPlan || isPtPlan) &&
    canOperateMemberships &&
    eligibleUpgradeVariants.length > 0 &&
    !upgradeWindowExceeded;
  const canUpgradeMembership = canShowUpgradeMembershipAction && !upgradeWindowExceeded;
  const canShowPtActions = Boolean(activePtAssignment) || isFlagshipPlan || isTransformationPlan || isPtPlan;
  const canTransferMembership =
    hasPrimaryMembership &&
    canManageTransfers &&
    (
      isFlagshipPlan ||
      normalizedProductCode.includes("CORE") ||
      normalizedProductCode.includes("BLACK") ||
      normalizedProductCode.includes("RHYTHM")
    );
  const canAddPtMembershipAction =
    hasPrimaryMembership &&
    isFlagshipPlan &&
    !hasActivePtMembership &&
    !Boolean(activePtAssignment);
  const selectedCheckInsRemaining = selectedMembershipRecord?.checkInsRemaining || 0;
  const selectedIncludedCheckIns = selectedMembershipRecord?.includedCheckIns || 0;
  const selectedUsedCheckIns = selectedMembershipRecord?.usedCheckIns || 0;
  const selectedExtraVisitPrice = Number(currentCatalogVariant?.extraVisitPrice || selectedMembershipRecord?.extraVisitPrice || 0);
  const canAddFlexVisit =
    hasPrimaryMembership &&
    isFlexPlan &&
    canOperateMemberships &&
    selectedCheckInsRemaining <= 0 &&
    selectedExtraVisitPrice > 0;
  const membershipActions: MembershipActionState[] = useMemo(() => {
    if (canShowBalanceCollectionAction) {
      return [{ key: "unfreeze", label: "Unfreeze", enabled: true }];
    }
    if (isSelectedMembershipOperationalFreeze) {
      return canShowManualUnfreezeAction ? [{ key: "unfreeze", label: "Unfreeze", enabled: true }] : [];
    }
    const actions: MembershipActionState[] = [];
    if (canRenewMembership) {
      actions.push({ key: "renew", label: "Renew", enabled: true });
    }
    if (canShowUpgradeMembershipAction) {
      actions.push({ key: "upgrade", label: "Upgrade", enabled: true });
    }
    if (canShowManualUnfreezeAction) {
      actions.push({ key: "unfreeze", label: "Unfreeze", enabled: true });
    } else if (canShowFreezeAction) {
      actions.push({ key: "freeze", label: "Freeze", enabled: true });
    }
    if (canTransferMembership) {
      const adminApprovalRequired = !isAdminOperator;
      actions.push({
        key: "transfer",
        label: adminApprovalRequired ? "Raise Transfer Request" : "Transfer",
        enabled: isAdminOperator,
        adminApprovalRequired,
        note: adminApprovalRequired ? "Transfer requires admin approval. The request workflow will be introduced separately." : undefined,
      });
    }
    if (canAddPtMembershipAction) {
      actions.push({
        key: "pt",
        label: "Add PT",
        enabled: true,
      });
    }
    if (canAddFlexVisit) {
      actions.push({
        key: "visit",
        label: "Add Visit",
        enabled: true,
      });
    }
    return actions;
  }, [
    canShowBalanceCollectionAction,
    canAddFlexVisit,
    canAddPtMembershipAction,
    canRenewMembership,
    canShowFreezeAction,
    canShowManualUnfreezeAction,
    canTransferMembership,
    canShowUpgradeMembershipAction,
    isSelectedMembershipOperationalFreeze,
    isAdminOperator,
  ]);
  const filteredLifecycleProducts = useMemo(
    () =>
      catalogProducts.filter((product) => {
        if (product.categoryCode === "CREDIT_PACK") {
          return false;
        }
        if (product.categoryCode === "PT" && !isPtPlan) {
          return false;
        }

        const selectedCategory = lifecycleForm.categoryCode || selectedProductCategoryCode;
        if (selectedCategory && product.categoryCode !== selectedCategory) {
          return false;
        }

        const candidateRank = productTierRank(membershipFamily, product.productCode);

        if (actionModal === "upgrade") {
          if (isFlagshipPlan) {
            return product.categoryCode === "FLAGSHIP"
              && candidateRank >= currentProductRank
              && eligibleUpgradeVariants.some((variant) => variant.productCode === product.productCode);
          }
          if (isFlexPlan) {
            return (
              ((product.categoryCode === "FLEX" && product.productCode === selectedProductCode)
                || product.categoryCode === "FLAGSHIP")
              && eligibleUpgradeVariants.some((variant) => variant.productCode === product.productCode)
            );
          }
          if (isPtPlan) {
            return product.categoryCode === "PT"
              && isSamePtTrack(selectedProductCode, product.productCode)
              && candidateRank >= currentProductRank
              && eligibleUpgradeVariants.some((variant) => variant.productCode === product.productCode);
          }
          if (isGroupClassPlan) {
            return product.productCode === selectedProductCode
              && eligibleUpgradeVariants.some((variant) => variant.productCode === product.productCode);
          }
          if (isTransformationPlan) {
            return product.categoryCode === "TRANSFORMATION"
              && candidateRank >= currentProductRank
              && eligibleUpgradeVariants.some((variant) => variant.productCode === product.productCode);
          }
        }

        if (actionModal === "renew") {
          return product.productCode === selectedProductCode;
        }

        return selectedCategory ? product.categoryCode === selectedCategory : true;
      }),
    [
      actionModal,
      catalogProducts,
      currentProductRank,
      membershipFamily,
      selectedProductCode,
      isFlagshipPlan,
      isFlexPlan,
      isGroupClassPlan,
      isPtPlan,
      isTransformationPlan,
      eligibleUpgradeVariants,
      lifecycleForm.categoryCode,
      selectedProductCategoryCode,
    ],
  );
  const filteredLifecycleVariants = useMemo(
    () =>
      catalogVariants.filter((variant) => {
        if (variant.categoryCode === "CREDIT_PACK") {
          return false;
        }
        if (variant.categoryCode === "PT" && !isPtPlan) {
          return false;
        }
        const selectedCategory = lifecycleForm.categoryCode || selectedProductCategoryCode;
        const selectedProduct = lifecycleForm.productCode || selectedProductCode;

        if (selectedCategory && variant.categoryCode !== selectedCategory) {
          return false;
        }
        if (selectedProduct && variant.productCode !== selectedProduct) {
          return false;
        }

        const currentVariant = catalogVariants.find((item) => String(item.variantId) === String(selectedProductVariantId));
        const currentDuration = currentVariant?.durationMonths || selectedDurationMonths;
        const currentValidity = currentVariant?.validityDays || selectedValidityDays;
        const currentRank = currentCatalogProduct ? productTierRank(membershipFamily, currentCatalogProduct.productCode) : currentProductRank;
        const candidateRank = productTierRank(membershipFamily, variant.productCode);
        const sameProduct = variant.productCode === selectedProductCode;

        if (actionModal === "upgrade") {
          if (sameProduct) {
            if (currentDuration > 0 && variant.durationMonths > 0) {
              return variant.durationMonths > currentDuration;
            }
            if (currentValidity > 0 && variant.validityDays > 0) {
              return variant.validityDays > currentValidity;
            }
          }
          if (candidateRank > currentRank) {
            if (currentDuration > 0 && variant.durationMonths > 0) {
              return variant.durationMonths >= currentDuration;
            }
            if (currentValidity > 0 && variant.validityDays > 0) {
              return variant.validityDays >= currentValidity;
            }
            return true;
          }
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return false;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return false;
          }
          return false;
        }

        if (actionModal === "renew") {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return sameProduct && variant.durationMonths === currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return sameProduct && variant.validityDays === currentValidity;
          }
          return sameProduct;
        }

        return true;
      }),
    [
      actionModal,
      selectedProductVariantId,
      catalogVariants,
      currentCatalogProduct,
      currentProductRank,
      membershipFamily,
      selectedProductCode,
      selectedDurationMonths,
      isPtPlan,
      lifecycleForm.categoryCode,
      lifecycleForm.productCode,
      selectedProductCategoryCode,
      selectedValidityDays,
    ],
  );
  const lifecycleCategoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogProducts
            .filter((product) => {
              if (product.categoryCode === "CREDIT_PACK") {
                return false;
              }
              if (product.categoryCode === "PT" && !isPtPlan) {
                return false;
              }
              if (actionModal === "upgrade") {
                if (isFlagshipPlan) return product.categoryCode === "FLAGSHIP";
                if (isFlexPlan) return product.categoryCode === "FLAGSHIP" || product.categoryCode === "FLEX";
                if (isPtPlan) return product.categoryCode === "PT" && isSamePtTrack(selectedProductCode, product.productCode);
                if (isGroupClassPlan) return product.categoryCode === "GROUP_CLASS";
                if (isTransformationPlan) return product.categoryCode === "TRANSFORMATION";
              }
              if (actionModal === "renew") {
                return product.productCode === selectedProductCode;
              }
              return product.categoryCode === selectedProductCategoryCode;
            })
            .map((product) => product.categoryCode),
        ),
      ),
    [actionModal, catalogProducts, isFlagshipPlan, isFlexPlan, isGroupClassPlan, isPtPlan, isTransformationPlan, selectedProductCategoryCode],
  );
  const ptProducts = useMemo(
    () =>
      catalogProducts.filter(
        (product) => product.categoryCode === "PT" && ["PT_LEVEL_1", "PT_LEVEL_2"].includes(product.productCode),
      ),
    [catalogProducts],
  );
  const ptVariants = useMemo(
    () =>
      catalogVariants.filter(
        (variant) => variant.categoryCode === "PT" && ["PT_LEVEL_1", "PT_LEVEL_2"].includes(variant.productCode),
      ),
    [catalogVariants],
  );
  const selectedLifecycleVariant = useMemo(
    () => catalogVariants.find((variant) => String(variant.variantId) === String(lifecycleForm.productVariantId)),
    [catalogVariants, lifecycleForm.productVariantId],
  );
  const legacyUpgradeFallbackBySubscription = useMemo(() => {
    const statusIsHistorical = (status: string) =>
      ["CANCELLED", "CANCELED", "INACTIVE", "EXPIRED", "LAPSED"].includes(status.toUpperCase());

    const lookup = new Map<
      string,
      { fromLabel: string; previousStartDate?: string; previousSubscriptionId: string; previousStatus: string }
    >();

    portfolioMembershipItems.forEach((entry) => {
      const previous = portfolioMembershipItems.find((candidate) => {
        if (candidate.subscriptionId === entry.subscriptionId) {
          return false;
        }
        if (candidate.productCode !== entry.productCode || candidate.family !== entry.family) {
          return false;
        }
        if (!statusIsHistorical(String(candidate.status || ""))) {
          return false;
        }
        const candidateDuration = Number(candidate.durationMonths || 0);
        const entryDuration = Number(entry.durationMonths || 0);
        const candidateValidity = Number(candidate.validityDays || 0);
        const entryValidity = Number(entry.validityDays || 0);
        return (
          (candidateDuration > 0 && entryDuration > 0 && candidateDuration < entryDuration) ||
          (candidateValidity > 0 && entryValidity > 0 && candidateValidity < entryValidity)
        );
      });

      if (!previous) {
        return;
      }

      lookup.set(entry.subscriptionId, {
        fromLabel: trimMembershipCardTitle(previous.variantName || previous.productName || previous.productCode),
        previousStartDate: previous.startDate,
        previousSubscriptionId: previous.subscriptionId,
        previousStatus: previous.status,
      });
    });

    return lookup;
  }, [portfolioMembershipItems]);
  const auditActorDirectory = useMemo(() => {
    const entries = [...staffMembers, ...coaches, ...members];
    const lookup = new Map<string, string>();
    entries.forEach((entry) => {
      if (entry.id && entry.name) {
        lookup.set(String(entry.id), entry.name);
      }
    });
    if (memberRecord?.id && memberRecord.name) {
      lookup.set(String(memberRecord.id), memberRecord.name);
    }
    if (user?.id && user.name) {
      lookup.set(String(user.id), user.name);
    }
    return lookup;
  }, [coaches, memberRecord, members, staffMembers, user]);
  const resolveAuditActorLabel = useCallback(
    (entry: MemberProfileAuditEntry) => entry.actorName || (entry.actorId ? auditActorDirectory.get(String(entry.actorId)) : undefined) || entry.actorId || "System",
    [auditActorDirectory],
  );
  const isRenewLifecycleModal = actionModal === "renew";
  const isUpgradeLifecycleModal = actionModal === "upgrade";
  const isRenewBillingModal = actionModal === "renew-billing";
  const isUpgradeBillingModal = actionModal === "upgrade-billing";
  const isPtBillingModal = actionModal === "pt-billing";
  const isLifecycleBillingModal = isRenewBillingModal || isUpgradeBillingModal;
  const projectedRenewalEndDate = useMemo(
    () =>
      projectMembershipEndDate(
        lifecycleForm.startDate,
        selectedLifecycleVariant?.durationMonths || 0,
        selectedLifecycleVariant?.validityDays || 0,
      ),
    [lifecycleForm.startDate, selectedLifecycleVariant],
  );
  const transferInquiryOptions = useMemo(
    () => transferInquiries.filter((inquiry) => inquiry.memberId && String(inquiry.memberId) !== String(memberId)),
    [memberId, transferInquiries],
  );
  const currentLifecycleBasePrice = Number(currentCatalogVariant?.basePrice || 0);
  const targetLifecycleBasePrice = Number(selectedLifecycleVariant?.basePrice || 0);
  const commercialTaxRate = Number(billingSettings?.gstPercentage || 0);
  const renewCommercial = useMemo(
    () =>
      resolveCommercialBreakdown(
        targetLifecycleBasePrice,
        lifecycleForm.sellingPrice,
        lifecycleForm.discountPercent,
      ),
    [lifecycleForm.discountPercent, lifecycleForm.sellingPrice, targetLifecycleBasePrice],
  );
  const renewTaxableAmount = roundAmount(renewCommercial.sellingPrice);
  const renewHalfTaxAmount = roundAmount((renewTaxableAmount * commercialTaxRate) / 200);
  const renewTaxAmount = renewHalfTaxAmount * 2;
  const renewInvoiceTotal = renewTaxableAmount + renewTaxAmount;
  const renewReceivedAmount = Number(lifecycleBillingForm.receivedAmount || 0);
  const renewBalanceAmount = Math.max(renewInvoiceTotal - renewReceivedAmount, 0);
  const renewPreviewStatus = "Pending";
  const currentPreviewDate = new Date().toLocaleDateString("en-IN");
  const selectedLifecycleFeatureList = useMemo(
    () =>
      parseFeatureList(selectedLifecycleVariant?.includedFeatures)
        .filter((feature) => shouldShowPackageFeatureChip(feature))
        .filter((feature, index, array) => array.indexOf(feature) === index),
    [selectedLifecycleVariant?.includedFeatures],
  );
  const selectedLifecycleVariantLabel = formatVariantDisplayLabel(selectedLifecycleVariant, planName);
  const currentLifecycleVariantLabel = formatVariantDisplayLabel(currentCatalogVariant, planName);
  const currentLifecycleVariantTitle = sanitizeMembershipVariantTitle(currentCatalogVariant?.variantName || currentLifecycleVariantLabel);
  const selectedLifecycleVariantTitle = sanitizeMembershipVariantTitle(selectedLifecycleVariant?.variantName || selectedLifecycleVariantLabel);
  const currentLifecycleDurationLabel = formatPlanDuration(currentCatalogVariant?.durationMonths || selectedDurationMonths, currentCatalogVariant?.validityDays || selectedValidityDays);
  const selectedLifecycleDurationLabel = formatPlanDuration(selectedLifecycleVariant?.durationMonths || 0, selectedLifecycleVariant?.validityDays || 0);
  const upgradeBaseDifference = Math.max(targetLifecycleBasePrice - currentLifecycleBasePrice, 0);
  const upgradeCommercial = useMemo(
    () =>
      resolveCommercialBreakdown(
        upgradeBaseDifference,
        lifecycleForm.sellingPrice,
        lifecycleForm.discountPercent,
      ),
    [lifecycleForm.discountPercent, lifecycleForm.sellingPrice, upgradeBaseDifference],
  );
  const upgradeTaxableAmount = roundAmount(upgradeCommercial.sellingPrice);
  const upgradeHalfTaxAmount = roundAmount((upgradeTaxableAmount * commercialTaxRate) / 200);
  const upgradeTaxAmount = upgradeHalfTaxAmount * 2;
  const upgradeInvoiceTotal = upgradeTaxableAmount + upgradeTaxAmount;
  const upgradeReceivedAmount = Number(lifecycleBillingForm.receivedAmount || 0);
  const upgradeBalanceAmount = Math.max(upgradeInvoiceTotal - upgradeReceivedAmount, 0);
  const upgradePreviewStatus = "Pending";
  const lifecycleBillingBaseAmount = isUpgradeBillingModal ? upgradeCommercial.baseAmount : renewCommercial.baseAmount;
  const lifecycleBillingSellingPrice = isUpgradeBillingModal ? upgradeCommercial.sellingPrice : renewCommercial.sellingPrice;
  const lifecycleBillingDiscountAmount = isUpgradeBillingModal ? upgradeCommercial.discountAmount : renewCommercial.discountAmount;
  const lifecycleBillingHalfTaxAmount = isUpgradeBillingModal ? upgradeHalfTaxAmount : renewHalfTaxAmount;
  const lifecycleBillingInvoiceTotal = isUpgradeBillingModal ? upgradeInvoiceTotal : renewInvoiceTotal;
  const lifecycleBillingReceivedAmount = isUpgradeBillingModal ? upgradeReceivedAmount : renewReceivedAmount;
  const lifecycleBillingBalanceAmount = isUpgradeBillingModal ? upgradeBalanceAmount : renewBalanceAmount;
  const lifecycleBillingPreviewStatus = isUpgradeBillingModal ? upgradePreviewStatus : renewPreviewStatus;
  const singleUpgradeVariant = useMemo(
    () => (isUpgradeLifecycleModal && filteredLifecycleVariants.length === 1 ? filteredLifecycleVariants[0] : null),
    [filteredLifecycleVariants, isUpgradeLifecycleModal],
  );
  const latestUpgradeAuditBySubscription = useMemo(() => {
    const lookup = new Map<string, MemberProfileAuditEntry>();
    lifecycleAuditEntries
      .filter((entry) => String(entry.action || "").toUpperCase() === "UPGRADE_MEMBERSHIP")
      .forEach((entry) => {
        const targetSubscriptionId = pickString(entry.raw, ["newSubscriptionId"]);
        if (targetSubscriptionId && !lookup.has(targetSubscriptionId)) {
          lookup.set(targetSubscriptionId, entry);
        }
      });
    return lookup;
  }, [lifecycleAuditEntries]);
  const latestMembershipUpgradeEntry = useMemo(
    () =>
      lifecycleAuditEntries
        .filter((entry) => String(entry.action || "").toUpperCase() === "UPGRADE_MEMBERSHIP")
        .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))[0],
    [lifecycleAuditEntries],
  );
  const selectedPtVariant = useMemo(
    () => ptVariants.find((variant) => String(variant.variantId) === String(ptForm.productVariantId)),
    [ptForm.productVariantId, ptVariants],
  );
  const selectedPtProduct = useMemo(
    () => ptProducts.find((product) => String(product.productCode) === String(ptForm.productCode || selectedPtVariant?.productCode || "")),
    [ptForm.productCode, ptProducts, selectedPtVariant?.productCode],
  );
  const ptEligibleCoaches = useMemo(
    () =>
      coaches.filter((coach) => {
        if (String(coach.designation || "").toUpperCase() !== "PT_COACH") {
          return false;
        }
        return true;
      }),
    [coaches],
  );
  const selectablePtVariants = useMemo(
    () =>
      ptVariants.filter((variant) => {
        if (ptForm.productCode && variant.productCode !== ptForm.productCode) {
          return false;
        }
        return true;
      }),
    [ptForm.productCode, ptVariants],
  );
  const ptTimeSlotOptions = useMemo(() => buildPtTimeSlotOptions(), []);
  const selectedPtCoach = useMemo(
    () =>
      ptEligibleCoaches.find((coach) => String(coach.id) === String(ptForm.coachId))
      || coaches.find((coach) => String(coach.id) === String(ptForm.coachId))
      || null,
    [coaches, ptEligibleCoaches, ptForm.coachId],
  );
  const selectedPtDays = useMemo(
    () => (ptForm.scheduleTemplate === "EVERYDAY" ? PT_EVERYDAY_DAY_CODES : ptForm.scheduleDays),
    [ptForm.scheduleDays, ptForm.scheduleTemplate],
  );
  const ptSlotEndTime = useMemo(
    () => addMinutesToTime(ptForm.slotStartTime, PT_SLOT_DURATION_MINUTES),
    [ptForm.slotStartTime],
  );
  const projectedPtEndDate = useMemo(
    () =>
      projectMembershipEndDate(
        ptForm.startDate,
        selectedPtVariant?.durationMonths || 0,
        selectedPtVariant?.validityDays || 0,
      ),
    [ptForm.startDate, selectedPtVariant],
  );
  const selectedPtSessionCount = useMemo(() => {
    const parsed = Number(ptForm.totalSessions || 0);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
    return Number(selectedPtVariant?.includedPtSessions || 0);
  }, [ptForm.totalSessions, selectedPtVariant?.includedPtSessions]);
  const ptCommercial = useMemo(
    () =>
      resolveCommercialBreakdown(
        Number(selectedPtVariant?.basePrice || 0),
        ptForm.sellingPrice,
        ptForm.discountPercent,
      ),
    [ptForm.discountPercent, ptForm.sellingPrice, selectedPtVariant?.basePrice],
  );
  const ptTaxableAmount = roundAmount(ptCommercial.sellingPrice);
  const ptHalfTaxAmount = roundAmount((ptTaxableAmount * commercialTaxRate) / 200);
  const ptTaxAmount = ptHalfTaxAmount * 2;
  const ptInvoiceTotal = ptTaxableAmount + ptTaxAmount;
  const ptReceivedAmount = Number(ptBillingForm.receivedAmount || 0);
  const ptBalanceAmount = Math.max(ptInvoiceTotal - ptReceivedAmount, 0);
  const ptPreviewStatus = "Pending";

  useEffect(() => {
    if (!isUpgradeLifecycleModal || !singleUpgradeVariant) {
      return;
    }

    const nextSellingPrice = String(roundAmount(Math.max(Number(singleUpgradeVariant.basePrice || 0) - currentLifecycleBasePrice, 0)));
    setLifecycleForm((current) => {
      if (
        current.categoryCode === singleUpgradeVariant.categoryCode &&
        current.productCode === singleUpgradeVariant.productCode &&
        current.productVariantId === String(singleUpgradeVariant.variantId) &&
        current.sellingPrice === nextSellingPrice &&
        current.discountPercent === ""
      ) {
        return current;
      }
      return {
        ...current,
        categoryCode: singleUpgradeVariant.categoryCode,
        productCode: singleUpgradeVariant.productCode,
        productVariantId: String(singleUpgradeVariant.variantId),
        sellingPrice: nextSellingPrice,
        discountPercent: "",
      };
    });
  }, [currentLifecycleBasePrice, isUpgradeLifecycleModal, singleUpgradeVariant]);

  useEffect(() => {
    if (!selectedPtVariant) {
      return;
    }

    const nextSellingPrice = String(roundAmount(Number(selectedPtVariant.basePrice || 0)));
    const nextEndDate = ptForm.startDate
      ? projectMembershipEndDate(ptForm.startDate, selectedPtVariant.durationMonths, selectedPtVariant.validityDays)
      : "";

    setPtForm((current) => ({
      ...current,
      endDate: nextEndDate || current.endDate,
      totalSessions: current.totalSessions || String(selectedPtVariant.includedPtSessions || 0),
      sellingPrice: current.sellingPrice || nextSellingPrice,
    }));
  }, [ptForm.startDate, selectedPtVariant]);

  useEffect(() => {
    if (ptForm.scheduleTemplate !== "EVERYDAY") {
      return;
    }
    setPtForm((current) =>
      current.scheduleDays.join(",") === PT_EVERYDAY_DAY_CODES.join(",")
        ? current
        : { ...current, scheduleDays: [...PT_EVERYDAY_DAY_CODES] },
    );
  }, [ptForm.scheduleTemplate]);

  const alerts = useMemo(() => {
    const next: string[] = [];
    if (membershipStatus.toUpperCase().includes("IRREGULAR")) {
      next.push("Attendance is below threshold and needs follow-up.");
    }
    if (membershipStatus.toUpperCase().includes("EXPIRED")) {
      next.push("Membership is expired and requires renewal.");
    }
    if (renewalWindowDays !== null && renewalWindowDays >= 0 && renewalWindowDays <= 7) {
      next.push(`Membership expires in ${renewalWindowDays} day${renewalWindowDays === 1 ? "" : "s"}.`);
    }
    if (roundedBalanceDue > 0) {
      next.push(`Outstanding billing balance of ${formatRoundedInr(balanceDue)} requires collection.`);
    }
    if (assignedTrainer === "-") {
      next.push(
        trainerLabel === "Group Class Trainer"
          ? "Group class trainer is not configured yet."
          : "Trainer is not assigned yet.",
      );
    }
    return next;
  }, [assignedTrainer, balanceDue, membershipStatus, renewalWindowDays, roundedBalanceDue, trainerLabel]);
  const displayMembershipStatus = isAccountPausedForPayment ? "Paused" : humanizeLabel(membershipStatus);

  const resetActionFeedback = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  const openActionModal = (modal: ActionModalKey) => {
    resetActionFeedback();
    if (modal === "unfreeze" && canShowBalanceCollectionAction) {
      setResumeBillingForm({
        paymentMode: "UPI",
        invoiceId: selectedOutstandingInvoice ? String(selectedOutstandingInvoice.id || "") : "",
      });
      setRenewCardSubtype("DEBIT_CARD");
      setActionModal("unfreeze-billing");
      return;
    }
    if (modal === "renew" || modal === "upgrade") {
      const defaultVariantId = modal === "upgrade" ? "" : selectedProductVariantId || "";
      const defaultVariant =
        catalogVariants.find((variant) => String(variant.variantId) === String(defaultVariantId)) ||
        currentCatalogVariant;
      const defaultLifecycleCategory =
        modal === "upgrade" && isFlexPlan
          ? ""
          : selectedProductCategoryCode || "";
      setLifecycleForm({
        categoryCode: defaultLifecycleCategory,
        productCode: modal === "upgrade" ? "" : selectedProductCode || "",
        productVariantId: defaultVariantId,
        startDate:
          modal === "renew"
            ? (selectedExpiryDate ? new Date(new Date(selectedExpiryDate).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
            : (selectedStartDate || new Date().toISOString().slice(0, 10)),
        sellingPrice:
          modal === "renew" && defaultVariant?.basePrice
            ? formatDecimalInput(Number(defaultVariant.basePrice))
            : "",
        discountPercent: "",
        notes: "",
      });
      setLifecycleBillingForm({
        paymentMode: "UPI",
        receivedAmount: "",
        balanceDueDate: "",
      });
    }
    if (modal === "transfer") {
      setTransferForm({
        targetMemberId: "",
        startDate: new Date().toISOString().slice(0, 10),
        deactivateSource: true,
        copyUsage: false,
        notes: "",
      });
    }
    if (modal === "freeze") {
      setFreezeForm({
        freezeDays: String(Math.max(freezeMinDays, Math.min(freezeMaxDays || freezeMinDays, freezeMinDays))),
        reason: "",
      });
    }
    if (modal === "pt") {
      setPtForm({
        productCode: ptProducts[0]?.productCode || "",
        productVariantId: "",
        coachId: "",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
        totalSessions: "",
        sellingPrice: "",
        discountPercent: "",
        scheduleTemplate: "ALTERNATE_DAYS",
        scheduleDays: ["MONDAY", "WEDNESDAY", "FRIDAY"],
        slotStartTime: "06:00",
      });
      setPtBillingForm({
        paymentMode: "UPI",
        receivedAmount: "",
        balanceDueDate: "",
      });
    }
    if (modal === "visit") {
      setVisitForm({
        paymentMode: "UPI",
      });
    }
    if (modal === "biometric") {
      setAccessNotes("");
      const attendancePayload = toRecord(tabData.attendance);
      const devices = toArray<RecordLike>(attendancePayload.biometricDevices);
      const preferredDevice = devices.find((device) => pickString(device, ["branchCode"]) === branchCode)
        || devices[0];
      setSelectedBiometricDeviceSerial(pickString(preferredDevice, ["serialNumber"]));
    }
    setActionModal(modal);
  };

  const handleEditProfile = async () => {
    if (!token || !memberId) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const normalizedMobile = normalizeIndianMobile(editForm.mobileNumber);
      await usersService.updateUser(token, memberId, {
        fullName: editForm.fullName,
        name: editForm.fullName,
        email: editForm.email,
        mobileNumber: normalizedMobile,
        active: memberRecord?.active ?? true,
        defaultBranchId: editForm.defaultBranchId || undefined,
        alternateMobileNumber: editForm.alternateMobileNumber || undefined,
        dateOfBirth: editForm.dateOfBirth || undefined,
        gender: editForm.gender || undefined,
        address: editForm.address || undefined,
        emergencyContactName: editForm.emergencyContactName || undefined,
        emergencyContactPhone: editForm.emergencyContactPhone || undefined,
        emergencyContactRelation: editForm.emergencyContactRelation || undefined,
        defaultTrainerStaffId: editForm.defaultTrainerStaffId || undefined,
      });
      if (sourceInquiryId) {
        await subscriptionService.updateInquiry(token, sourceInquiryId, {
          fullName: editForm.fullName,
          email: editForm.email,
          mobileNumber: normalizedMobile,
          dateOfBirth: editForm.dateOfBirth || undefined,
          inquiryAt: editForm.inquiryDate ? `${editForm.inquiryDate}T00:00:00` : undefined,
          clientRepStaffId: editForm.clientRepStaffId ? Number(editForm.clientRepStaffId) : undefined,
          gender: editForm.gender || undefined,
          address: editForm.address || undefined,
          emergencyContactName: editForm.emergencyContactName || undefined,
          emergencyContactPhone: editForm.emergencyContactPhone || undefined,
          emergencyContactRelation: editForm.emergencyContactRelation || undefined,
          branchId: editForm.defaultBranchId ? Number(editForm.defaultBranchId) : undefined,
          defaultTrainerStaffId: editForm.defaultTrainerStaffId ? Number(editForm.defaultTrainerStaffId) : undefined,
        });
      }
      await reloadShell();
      setActionSuccess("Member profile updated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to update member profile.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleRenewBillingContinue = () => {
    if (!token || !memberId || !lifecycleForm.productVariantId) {
      setActionError("Renewal plan details are incomplete.");
      return;
    }
    if (!canRenewMembership) {
      setActionError("Renewal is not available for this membership.");
      return;
    }
    const sellingPrice = renewCommercial.sellingPrice;
    if (sellingPrice <= 0) {
      setActionError("Enter a valid selling price before continuing.");
      return;
    }
    setActionError(null);
    setLifecycleBillingForm((current) => ({
      ...current,
      receivedAmount: current.receivedAmount || String(renewInvoiceTotal),
    }));
    setRenewCardSubtype("DEBIT_CARD");
    setActionModal("renew-billing");
  };

  const handleUpgradeBillingContinue = () => {
    if (!token || !memberId || !lifecycleForm.productVariantId) {
      setActionError("Choose the upgrade target before continuing.");
      return;
    }
    if (!canUpgradeMembership) {
      setActionError(
        upgradeWindowExceeded
          ? `Upgrade is allowed only within ${currentUpgradeWindowDays} days of subscription start.`
          : "Upgrade is not available for this membership.",
      );
      return;
    }
    if (upgradeCommercial.sellingPrice <= 0) {
      setActionError("Enter a valid upgrade selling price before continuing.");
      return;
    }
    setActionError(null);
    setLifecycleBillingForm((current) => ({
      ...current,
      receivedAmount: current.receivedAmount || String(upgradeInvoiceTotal),
    }));
    setRenewCardSubtype("DEBIT_CARD");
    setActionModal("upgrade-billing");
  };

  const handleSubscriptionAction = async (action: "renew" | "upgrade") => {
    if (action === "renew") {
      handleRenewBillingContinue();
      return;
    }
    handleUpgradeBillingContinue();
  };

  const handleRenewPayment = async () => {
    if (!token || !memberId || !selectedSubscriptionId || !lifecycleForm.productVariantId) {
      setActionError("Renewal details are incomplete.");
      return;
    }

    const receivedAmount = roundAmount(Math.max(0, Number(lifecycleBillingForm.receivedAmount || 0)));
    if (!Number.isFinite(receivedAmount)) {
      setActionError("Enter a valid received amount.");
      return;
    }
    if (receivedAmount > renewInvoiceTotal) {
      setActionError("Received amount cannot exceed the invoice total.");
      return;
    }
    if (receivedAmount < renewInvoiceTotal && !lifecycleBillingForm.balanceDueDate) {
      setActionError("Choose the balance due date for partial payments.");
      return;
    }

    const operatorId = Number((user as { id?: string | number } | null)?.id || 0);
    const assignedToStaffId = operatorId > 0 ? operatorId : Number(editForm.clientRepStaffId || 0) || undefined;

    setActionBusy(true);
    setActionError(null);
    try {
      const response = (await subscriptionService.renewSubscription(token, memberId, {
        subscriptionId: Number(selectedSubscriptionId),
        productVariantId: Number(lifecycleForm.productVariantId),
        startDate: lifecycleForm.startDate || undefined,
        inquiryId: sourceInquiryId || undefined,
        notes: lifecycleForm.notes || undefined,
        discountAmount: renewCommercial.discountAmount > 0 ? roundAmount(renewCommercial.discountAmount) : undefined,
        discountedByStaffId: operatorId > 0 ? operatorId : undefined,
      })) as {
        invoiceId?: number;
        invoiceNumber?: string;
        newSubscriptionId?: number;
        variantName?: string;
        startDate?: string;
        endDate?: string;
        invoiceTotal?: number;
      };

      const invoiceId = Number(response.invoiceId || 0);
      const newSubscriptionId = Number(response.newSubscriptionId || 0);
      const invoiceNumber = String(response.invoiceNumber || "").trim();
      const invoiceTotal = roundAmount(Number(response.invoiceTotal || renewInvoiceTotal));

      if (!Number.isFinite(invoiceId) || invoiceId <= 0 || !Number.isFinite(newSubscriptionId) || newSubscriptionId <= 0) {
        throw new Error("Renewal invoice was created without valid payment references.");
      }

      let paymentReceipt: Awaited<ReturnType<typeof subscriptionService.recordPayment>> | null = null;
      let membershipActivated = false;
      const payFullInvoice = !lifecycleBillingForm.balanceDueDate && receivedAmount > 0;
      const paymentAmount = payFullInvoice ? invoiceTotal : receivedAmount;
      if (receivedAmount > 0) {
        paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId: Number(memberId),
          amount: paymentAmount,
          paymentMode: lifecycleBillingForm.paymentMode,
          inquiryId: sourceInquiryId || undefined,
        });

        const activationThresholdMet = meetsActivationThreshold(
          invoiceTotal,
          paymentReceipt?.totalPaidAmount || paymentAmount,
          membershipPolicySettings.minPartialPaymentPercent,
        );
        if (activationThresholdMet) {
          await subscriptionService.activateMembership(token, newSubscriptionId);
          membershipActivated = true;
        }
      }

      const balanceAmount = Math.max(
        0,
        roundAmount(Number((paymentReceipt?.balanceAmount ?? invoiceTotal - paymentAmount) || 0)),
      );

      if (balanceAmount > 0 && lifecycleBillingForm.balanceDueDate && sourceInquiryId) {
        await subscriptionService.createInquiryFollowUp(token, sourceInquiryId, {
          dueAt: `${lifecycleBillingForm.balanceDueDate}T09:00:00`,
          assignedToStaffId,
          createdByStaffId: operatorId > 0 ? operatorId : undefined,
          followUpType: "BALANCE_DUE",
          notes: `Collect the remaining renewal balance of ${formatRoundedInr(balanceAmount)} for invoice ${invoiceNumber || invoiceId}.`,
        });
      }

      await reloadShell();
      setLifecycleAuditEntries(await subscriptionService.getMemberLifecycleAudit(token, memberId).catch(() => lifecycleAuditEntries));
      setTabData((current) => ({ ...current, billing: undefined, subscriptions: undefined }));
      if (paymentReceipt) {
        setCompletedBilling({
          context: "renewal",
          title: "Renewal Payment Recorded",
          message: invoiceNumber
            ? `Invoice ${invoiceNumber} was created and the payment was recorded successfully.`
            : "Renewal invoice and payment were recorded successfully.",
          invoiceId,
          invoiceNumber: invoiceNumber || `invoice-${invoiceId}`,
          receiptId: paymentReceipt.receiptId,
          receiptNumber: paymentReceipt.receiptNumber || undefined,
          paymentStatus: paymentReceipt.paymentStatus || (balanceAmount > 0 ? "PARTIALLY_PAID" : "PAID"),
          totalPaidAmount: Number(paymentReceipt.totalPaidAmount || receivedAmount),
          balanceAmount,
        });
      }
      setActionSuccess(
        membershipActivated
          ? `Renewal invoiced${invoiceNumber ? ` as ${invoiceNumber}` : ""} and activated.`
          : `Renewal invoiced${invoiceNumber ? ` as ${invoiceNumber}` : ""}. Activation will happen after ${membershipPolicySettings.minPartialPaymentPercent}% payment collection.`,
      );
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Unable to renew membership.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpgradePayment = async () => {
    if (!token || !memberId || !selectedSubscriptionId || !lifecycleForm.productVariantId) {
      setActionError("Upgrade details are incomplete.");
      return;
    }

    const receivedAmount = roundAmount(Math.max(0, Number(lifecycleBillingForm.receivedAmount || 0)));
    if (!Number.isFinite(receivedAmount)) {
      setActionError("Enter a valid received amount.");
      return;
    }
    if (receivedAmount > upgradeInvoiceTotal) {
      setActionError("Received amount cannot exceed the invoice total.");
      return;
    }
    if (receivedAmount < upgradeInvoiceTotal && !lifecycleBillingForm.balanceDueDate) {
      setActionError("Choose the balance due date for partial payments.");
      return;
    }

    const operatorId = Number((user as { id?: string | number } | null)?.id || 0);
    const assignedToStaffId = operatorId > 0 ? operatorId : Number(editForm.clientRepStaffId || 0) || undefined;

    setActionBusy(true);
    setActionError(null);
    try {
      const response = (await subscriptionService.upgradeSubscription(token, memberId, {
        subscriptionId: Number(selectedSubscriptionId),
        productVariantId: Number(lifecycleForm.productVariantId),
        startDate: lifecycleForm.startDate || undefined,
        inquiryId: sourceInquiryId || undefined,
        notes: lifecycleForm.notes || undefined,
        discountAmount: upgradeCommercial.discountAmount > 0 ? roundAmount(upgradeCommercial.discountAmount) : undefined,
        discountedByStaffId: operatorId > 0 ? operatorId : undefined,
      })) as {
        invoiceId?: number;
        invoiceNumber?: string;
        newSubscriptionId?: number;
        variantName?: string;
        startDate?: string;
        endDate?: string;
        invoiceTotal?: number;
      };

      const invoiceId = Number(response.invoiceId || 0);
      const newSubscriptionId = Number(response.newSubscriptionId || 0);
      const invoiceNumber = String(response.invoiceNumber || "").trim();
      const invoiceTotal = roundAmount(Number(response.invoiceTotal || upgradeInvoiceTotal));

      if (!Number.isFinite(invoiceId) || invoiceId <= 0 || !Number.isFinite(newSubscriptionId) || newSubscriptionId <= 0) {
        throw new Error("Upgrade invoice was created without valid payment references.");
      }

      let paymentReceipt: Awaited<ReturnType<typeof subscriptionService.recordPayment>> | null = null;
      let membershipActivated = false;
      const payFullInvoice = !lifecycleBillingForm.balanceDueDate && receivedAmount > 0;
      const paymentAmount = payFullInvoice ? invoiceTotal : receivedAmount;

      if (receivedAmount > 0) {
        paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId: Number(memberId),
          amount: paymentAmount,
          paymentMode: lifecycleBillingForm.paymentMode,
          inquiryId: sourceInquiryId || undefined,
        });

        const activationThresholdMet = meetsActivationThreshold(
          invoiceTotal,
          paymentReceipt?.totalPaidAmount || paymentAmount,
          membershipPolicySettings.minPartialPaymentPercent,
        );
        if (activationThresholdMet) {
          await subscriptionService.activateMembership(token, newSubscriptionId);
          membershipActivated = true;
        }
      }

      const balanceAmount = Math.max(
        0,
        roundAmount(Number((paymentReceipt?.balanceAmount ?? invoiceTotal - paymentAmount) || 0)),
      );

      if (balanceAmount > 0 && lifecycleBillingForm.balanceDueDate && sourceInquiryId) {
        await subscriptionService.createInquiryFollowUp(token, sourceInquiryId, {
          dueAt: `${lifecycleBillingForm.balanceDueDate}T09:00:00`,
          assignedToStaffId,
          createdByStaffId: operatorId > 0 ? operatorId : undefined,
          followUpType: "BALANCE_DUE",
          notes: `Collect the remaining upgrade balance of ${formatRoundedInr(balanceAmount)} for invoice ${invoiceNumber || invoiceId}.`,
        });
      }

      await reloadShell();
      setLifecycleAuditEntries(await subscriptionService.getMemberLifecycleAudit(token, memberId).catch(() => lifecycleAuditEntries));
      setTabData((current) => ({ ...current, billing: undefined, subscriptions: undefined }));
      if (paymentReceipt) {
        setCompletedBilling({
          context: "upgrade",
          title: "Upgrade Payment Recorded",
          message: invoiceNumber
            ? `Invoice ${invoiceNumber} was created and the payment was recorded successfully.`
            : "Upgrade invoice and payment were recorded successfully.",
          invoiceId,
          invoiceNumber: invoiceNumber || `invoice-${invoiceId}`,
          receiptId: paymentReceipt.receiptId,
          receiptNumber: paymentReceipt.receiptNumber || undefined,
          paymentStatus: paymentReceipt.paymentStatus || (balanceAmount > 0 ? "PARTIALLY_PAID" : "PAID"),
          totalPaidAmount: Number(paymentReceipt.totalPaidAmount || receivedAmount),
          balanceAmount,
        });
      }
      setActionSuccess(
        membershipActivated
          ? `Upgrade invoiced${invoiceNumber ? ` as ${invoiceNumber}` : ""} and activated.`
          : `Upgrade invoiced${invoiceNumber ? ` as ${invoiceNumber}` : ""}. Activation will happen after ${membershipPolicySettings.minPartialPaymentPercent}% payment collection.`,
      );
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Unable to upgrade membership.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (!token || !selectedSubscriptionId || !transferForm.targetMemberId) {
      setActionError("Choose the target member before transferring.");
      return;
    }
    if (!canTransferMembership) {
      setActionError("Transfer is allowed only for eligible memberships and authorized users.");
      return;
    }
    if (!isAdminOperator) {
      setActionError("Transfer needs admin approval. Workflow submission will be added separately.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await subscriptionService.transferSubscription(token, selectedSubscriptionId, {
        targetMemberId: Number(transferForm.targetMemberId),
        startDate: transferForm.startDate || undefined,
        deactivateSource: transferForm.deactivateSource,
        copyUsage: transferForm.copyUsage,
        notes: transferForm.notes || undefined,
      });
      await reloadShell();
      setActionSuccess("Membership transferred.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to transfer membership.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFreeze = async () => {
    if (!token || !memberId) {
      return;
    }
    if (!canShowFreezeAction) {
      setActionError("Freeze is not available for this membership.");
      return;
    }

    const freezeDays = Number(freezeForm.freezeDays);
    if (!Number.isFinite(freezeDays) || freezeDays < freezeMinDays || freezeDays > freezeMaxDays) {
      setActionError(`Freeze days must be between ${freezeMinDays} and ${freezeMaxDays}.`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await engagementService.activateFreeze(token, memberId, {
        subscriptionId: Number(selectedSubscriptionId),
        freezeDays,
        reason: freezeForm.reason || undefined,
      });
      await reloadShell();
      setActionSuccess("Freeze activated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to activate freeze.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleUnfreeze = async () => {
    if (!token || !memberId) {
      return;
    }
    if (canCollectOutstandingBalance) {
      setActionBusy(true);
      setActionError(null);
      try {
        let billingPayload = tabData.billing as LifecycleBillingTabState | undefined;
        if (!billingPayload?.invoices?.length) {
          billingPayload = await reloadBillingTab() || undefined;
        }

        const invoices = billingPayload?.invoices || [];
        const selectedInvoiceId = Number(resumeBillingForm.invoiceId || 0);
        const outstandingInvoice =
          invoices.find((invoice) => Number(invoice.id || 0) === selectedInvoiceId && roundAmount(invoice.balanceAmount || 0) > 0)
          || pickOutstandingInvoice(invoices);

        if (!outstandingInvoice) {
          throw new Error("No outstanding invoice was found for this member.");
        }

        const invoiceId = Number(outstandingInvoice.id || 0);
        if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
          throw new Error("The outstanding invoice reference is invalid.");
        }

        const outstandingBalance = roundAmount(outstandingInvoice.balanceAmount || roundedBalanceDue);
        if (outstandingBalance <= 0) {
          throw new Error("This membership no longer has an outstanding balance.");
        }

        const paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId: Number(memberId),
          amount: outstandingBalance,
          paymentMode: resumeBillingForm.paymentMode,
          inquiryId: sourceInquiryId || undefined,
        });

        const pausedSubscriptionIds = Array.from(
          new Set(
            currentPortfolioMembershipItems
              .filter((membership) => String(membership.status || "").trim().toUpperCase() === "PAUSED")
              .map((membership) => Number(membership.subscriptionId))
              .filter((subscriptionId) => Number.isFinite(subscriptionId) && subscriptionId > 0),
          ),
        );

        const remainingBalance = roundAmount(Number(paymentReceipt.balanceAmount || 0));
        let activationWarning = "";

        if (remainingBalance === 0 && pausedSubscriptionIds.length > 0) {
          try {
            await Promise.all(
              pausedSubscriptionIds.map((subscriptionId) =>
                subscriptionService.activateMembership(token, subscriptionId),
              ),
            );
          } catch {
            activationWarning = " Payment was collected, but membership activation needs a manual retry.";
          }
        }

        await reloadShell();
        setTabData((current) => ({
          ...current,
          billing: undefined,
          subscriptions: undefined,
          "freeze-history": undefined,
        }));

        setCompletedBilling({
          context: "balance",
          title: remainingBalance === 0 ? "Balance Collected" : "Balance Payment Recorded",
          message:
            remainingBalance === 0
              ? `Outstanding balance for invoice ${outstandingInvoice.invoiceNumber} was collected successfully.${activationWarning}`
              : `Payment was recorded for invoice ${outstandingInvoice.invoiceNumber}. ${formatRoundedInr(remainingBalance)} is still pending.`,
          invoiceId,
          invoiceNumber: outstandingInvoice.invoiceNumber || `invoice-${invoiceId}`,
          receiptId: paymentReceipt.receiptId,
          receiptNumber: paymentReceipt.receiptNumber || undefined,
          paymentStatus: paymentReceipt.paymentStatus || (remainingBalance > 0 ? "PARTIALLY_PAID" : "PAID"),
          totalPaidAmount: Number(paymentReceipt.totalPaidAmount || outstandingBalance),
          balanceAmount: remainingBalance,
        });
        setActionModal(null);
      } catch (error) {
        setActionError(
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unable to collect the outstanding balance.",
        );
      } finally {
        setActionBusy(false);
      }
      return;
    }
    if (!canShowManualUnfreezeAction) {
      setActionError("Unfreeze is not available for this membership.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const response = await engagementService.unfreezeMembership(token, memberId);
      await reloadShell();
      setTabData((current) => ({
        ...current,
        "freeze-history": undefined,
        attendance: undefined,
        subscriptions: undefined,
      }));
      const restoredDays = pickNumber(response, ["restoredPauseDays"]);
      setActionSuccess(
        restoredDays > 0
          ? `Membership resumed. ${restoredDays} unused pause day${restoredDays === 1 ? "" : "s"} credited back.`
          : "Membership resumed.",
      );
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to resume membership.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddVisit = async () => {
    if (!token || !memberId || !selectedSubscriptionId) {
      return;
    }
    if (!canAddFlexVisit) {
      setActionError("Add Visit is available only when the flex check-in limit is exhausted.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const response = await subscriptionService.addFlexVisit(token, selectedSubscriptionId, {
        memberId: Number(memberId),
        paymentMode: visitForm.paymentMode,
      });
      await reloadShell();
      setActionSuccess(`Extra visit added. Invoice ${response.invoiceNumber} and receipt ${response.receiptNumber} generated.`);
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to add extra visit.");
    } finally {
      setActionBusy(false);
    }
  };

  const createPtOperationalSchedule = useCallback(async (subscriptionId: number) => {
    if (!token || !memberId || !ptForm.coachId || !selectedPtVariant) {
      throw new Error("PT assignment details are incomplete.");
    }

    const memberEmailForAssignment = email || buildSyntheticInternalEmail(phone || memberId, "members.fomotraining.internal");
    const coachEmailForAssignment =
      selectedPtCoach?.email || buildSyntheticInternalEmail(selectedPtCoach?.mobile || selectedPtCoach?.id || ptForm.coachId, "staff.fomotraining.internal");
    const payload = {
      memberEmail: memberEmailForAssignment,
      coachId: Number(ptForm.coachId),
      coachEmail: coachEmailForAssignment,
      startDate: ptForm.startDate || new Date().toISOString().slice(0, 10),
      endDate: projectedPtEndDate || undefined,
      productVariantId: Number(selectedPtVariant.variantId),
      packageName: `${formatPtProductName(selectedPtProduct?.productName || selectedPtVariant.productCode)} · ${formatPlanDuration(selectedPtVariant.durationMonths, selectedPtVariant.validityDays)}`,
      totalSessions: selectedPtSessionCount,
      rescheduleLimit: derivePtRescheduleLimit(Number(selectedPtVariant.durationMonths || 0), hasUnlimitedPtReschedules),
      slotDurationMinutes: PT_SLOT_DURATION_MINUTES,
      slots: selectedPtDays.map((dayCode) => ({
        dayOfWeek: dayCode,
        slotStartTime: `${ptForm.slotStartTime}:00`,
        slotEndTime: `${ptSlotEndTime}:00`,
      })),
    };
    await subscriptionService.provisionPtOperationalSetup(token, subscriptionId, payload);
  }, [
    email,
    hasUnlimitedPtReschedules,
    memberId,
    phone,
    projectedPtEndDate,
    ptForm.coachId,
    ptForm.slotStartTime,
    ptForm.startDate,
    ptSlotEndTime,
    selectedPtCoach,
    selectedPtDays,
    selectedPtProduct?.productName,
    selectedPtSessionCount,
    selectedPtVariant,
    token,
  ]);

  const handlePtBillingContinue = () => {
    if (!token || !memberId) {
      return;
    }
    if (!canAddPtMembershipAction) {
      setActionError("PT add-on is not available for this membership.");
      return;
    }
    if (!selectedPtVariant) {
      setActionError("Select a PT package before continuing.");
      return;
    }
    if (!ptForm.coachId) {
      setActionError("Choose a PT coach before continuing.");
      return;
    }
    if (!ptForm.startDate) {
      setActionError("Choose the PT start date before continuing.");
      return;
    }
    if (selectedPtDays.length === 0) {
      setActionError("Select at least one PT day.");
      return;
    }
    if (!Number.isFinite(selectedPtSessionCount) || selectedPtSessionCount <= 0) {
      setActionError("Enter the total PT sessions before continuing.");
      return;
    }
    if (ptCommercial.sellingPrice <= 0) {
      setActionError("Enter a valid PT selling price before continuing.");
      return;
    }

    setActionError(null);
    setPtBillingForm((current) => ({
      ...current,
      receivedAmount: current.receivedAmount || String(ptInvoiceTotal),
    }));
    setRenewCardSubtype("DEBIT_CARD");
    setActionModal("pt-billing");
  };

  const handlePtPayment = async () => {
    if (!token || !memberId || !selectedSubscriptionId || !selectedPtVariant) {
      setActionError("PT details are incomplete.");
      return;
    }

    const receivedAmount = roundAmount(Math.max(0, Number(ptBillingForm.receivedAmount || 0)));
    if (!Number.isFinite(receivedAmount)) {
      setActionError("Enter a valid received amount.");
      return;
    }
    if (receivedAmount > ptInvoiceTotal) {
      setActionError("Received amount cannot exceed the invoice total.");
      return;
    }
    if (receivedAmount < ptInvoiceTotal && !ptBillingForm.balanceDueDate) {
      setActionError("Choose the balance due date for partial payments.");
      return;
    }

    const operatorId = Number((user as { id?: string | number } | null)?.id || 0);
    const assignedToStaffId = operatorId > 0 ? operatorId : Number(editForm.clientRepStaffId || 0) || undefined;

    setActionBusy(true);
    setActionError(null);
    try {
      const response = await subscriptionService.createMemberAddOnSubscription(token, String(memberId), {
        baseSubscriptionId: Number(selectedSubscriptionId),
        startDate: ptForm.startDate,
        addOnVariantIds: [Number(selectedPtVariant.variantId)],
        inquiryId: sourceInquiryId || undefined,
        discountAmount: ptCommercial.discountAmount > 0 ? roundAmount(ptCommercial.discountAmount) : undefined,
        discountedByStaffId: operatorId > 0 ? operatorId : undefined,
        billedByStaffId: operatorId > 0 ? operatorId : undefined,
      });

      const invoiceId = Number(response.invoiceId || 0);
      const invoiceNumber = String(response.invoiceNumber || "").trim();
      const addOnSubscriptionId = Number(
        response.createdSubscriptions.find((item) => item.addOn)?.memberSubscriptionId || response.memberSubscriptionId || 0,
      );
      if (!Number.isFinite(invoiceId) || invoiceId <= 0 || !Number.isFinite(addOnSubscriptionId) || addOnSubscriptionId <= 0) {
        throw new Error("PT invoice was created without valid payment references.");
      }

      let paymentReceipt: Awaited<ReturnType<typeof subscriptionService.recordPayment>> | null = null;
      let membershipActivated = false;
      let ptSetupPendingReason: string | null = null;
      const payFullInvoice = !ptBillingForm.balanceDueDate && receivedAmount > 0;
      const paymentAmount = payFullInvoice ? ptInvoiceTotal : receivedAmount;

      if (receivedAmount > 0) {
        paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId: Number(memberId),
          amount: paymentAmount,
          paymentMode: ptBillingForm.paymentMode,
          inquiryId: sourceInquiryId || undefined,
        });

        const activationThresholdMet = meetsActivationThreshold(
          ptInvoiceTotal,
          paymentReceipt?.totalPaidAmount || paymentAmount,
          membershipPolicySettings.minPartialPaymentPercent,
        );
        if (activationThresholdMet) {
          await subscriptionService.activateMembership(token, addOnSubscriptionId);
          membershipActivated = true;
          try {
            await createPtOperationalSchedule(addOnSubscriptionId);
          } catch (setupError) {
            ptSetupPendingReason = setupError instanceof ApiError
              ? setupError.message
              : setupError instanceof Error
                ? setupError.message
                : "Operational PT setup could not be completed.";
          }
        }
      }

      const balanceAmount = Math.max(
        0,
        roundAmount(Number((paymentReceipt?.balanceAmount ?? ptInvoiceTotal - paymentAmount) || 0)),
      );

      if (balanceAmount > 0 && ptBillingForm.balanceDueDate && sourceInquiryId) {
        await subscriptionService.createInquiryFollowUp(token, sourceInquiryId, {
          dueAt: `${ptBillingForm.balanceDueDate}T09:00:00`,
          assignedToStaffId,
          createdByStaffId: operatorId > 0 ? operatorId : undefined,
          followUpType: "BALANCE_DUE",
          notes: `Collect the remaining PT balance of ${formatRoundedInr(balanceAmount)} for invoice ${invoiceNumber || invoiceId}.`,
        });
      }

      await reloadShell();
      setTabData((current) => ({
        ...current,
        subscriptions: undefined,
        billing: undefined,
        "personal-training": undefined,
      }));
      if (paymentReceipt) {
        setCompletedBilling({
          context: "pt",
          title: "PT Payment Recorded",
          message: invoiceNumber
            ? `Invoice ${invoiceNumber} was created and the PT payment was recorded successfully.`
            : "PT invoice and payment were recorded successfully.",
          invoiceId,
          invoiceNumber: invoiceNumber || `invoice-${invoiceId}`,
          receiptId: paymentReceipt.receiptId,
          receiptNumber: paymentReceipt.receiptNumber || undefined,
          paymentStatus: paymentReceipt.paymentStatus || (balanceAmount > 0 ? "PARTIALLY_PAID" : "PAID"),
          totalPaidAmount: Number(paymentReceipt.totalPaidAmount || receivedAmount),
          balanceAmount,
        });
      }
      setActionSuccess(
        membershipActivated
          ? ptSetupPendingReason
            ? `PT add-on invoiced and activated, but PT setup is pending. ${ptSetupPendingReason}`
            : "PT add-on invoiced, activated, and scheduled."
          : `PT add-on invoiced${invoiceNumber ? ` as ${invoiceNumber}` : ""}. PT scheduling will unlock after ${membershipPolicySettings.minPartialPaymentPercent}% payment collection.`,
      );
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Unable to add PT.");
    } finally {
      setActionBusy(false);
    }
  };

  const handlePtSessionAction = async (
    sessionId: string,
    action: "start" | "end" | "complete" | "cancel" | "no-show",
  ) => {
    if (!token) {
      return;
    }
    try {
      if (action === "start") {
        await trainingService.startSession(token, sessionId, "PORTAL");
      } else if (action === "end") {
        await trainingService.endSession(token, sessionId, "PORTAL");
      } else if (action === "complete") {
        await trainingService.markSessionComplete(token, sessionId);
      } else if (action === "cancel") {
        await trainingService.cancelPtSession(token, sessionId);
      } else if (action === "no-show") {
        await trainingService.markSessionNoShow(token, sessionId);
      }
      await reloadPtTab();
      setActionSuccess(
        action === "cancel"
          ? "Cancellation window was closed, so the session was treated as consumed."
          : `Session ${action === "start" ? "started" : action === "end" ? "ended" : action} successfully.`,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Failed to ${action} session.`);
    }
  };

  const loadPtSchedulingContext = useCallback(async (coachId: string) => {
    const [availabilityPage, calendarPage] = await Promise.all([
      trainingService.getTrainerAvailability(token!, coachId, 0, 100).catch(() => ({ content: [] })),
      trainingService.getPtCalendar(token!, coachId, 0, 100).catch(() => ({ content: [] })),
    ]);
    setPtAvailabilityOptions(Array.isArray(availabilityPage.content) ? availabilityPage.content : []);
    setPtCalendarEntries(Array.isArray(calendarPage.content) ? calendarPage.content : []);
  }, [token]);

  const openPtRescheduleModal = async (session: RecordLike) => {
    if (!token) {
      return;
    }
    const sessionId = pickString(session, ["id"]);
    const coachId = pickString(session, ["coachId"]) || pickString(activePtAssignmentRecord, ["coachId"]);
    if (!sessionId || !coachId) {
      setActionError("Coach or session details are missing for reschedule.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await loadPtSchedulingContext(coachId);
      setPtRescheduleForm({
        sessionId,
        currentDate: pickString(session, ["sessionDate"]) || "",
        currentTime: pickString(session, ["sessionTime", "slotStartTime"]) || "",
        newDate: pickString(session, ["sessionDate"]) || "",
        newTime: "",
        reason: "",
      });
      setActionModal("pt-reschedule");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to load coach calendar.");
    } finally {
      setActionBusy(false);
    }
  };

  const openPtCancelModal = async (session: RecordLike) => {
    if (!token) {
      return;
    }
    const sessionId = pickString(session, ["id"]);
    const coachId = pickString(session, ["coachId"]) || pickString(activePtAssignmentRecord, ["coachId"]);
    const currentDate = pickString(session, ["sessionDate"]) || "";
    if (!sessionId || !coachId || !currentDate) {
      setActionError("Coach or session details are missing for cancellation.");
      return;
    }

    const assignmentEndDate =
      pickString(activePtAssignmentRecord, ["endDate"])
      || pickString(session, ["assignmentEndDate", "endDate"])
      || "";
    const minDate = addDaysToLocalIsoDate(currentDate, 1);
    const maxDate = assignmentEndDate && assignmentEndDate >= minDate ? assignmentEndDate : "";
    if (!maxDate) {
      setActionError("PT validity end date is required before assigning a make-up slot.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await loadPtSchedulingContext(coachId);
      setPtCancelForm({
        sessionId,
        currentDate,
        currentTime: pickString(session, ["sessionTime", "slotStartTime"]) || "",
        newDate: minDate,
        newTime: "",
        maxDate,
        reason: "",
      });
      setActionModal("pt-cancel");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to load coach calendar.");
    } finally {
      setActionBusy(false);
    }
  };

  const handlePtReschedule = async () => {
    if (!token || !ptRescheduleForm.sessionId || !ptRescheduleForm.newDate || !ptRescheduleForm.newTime) {
      setActionError("Choose the same-day replacement time.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await trainingService.rescheduleSession(token, ptRescheduleForm.sessionId, {
        newDate: ptRescheduleForm.newDate,
        newTime: ptRescheduleForm.newTime,
        reason: ptRescheduleForm.reason || undefined,
      });
      await reloadPtTab();
      setActionSuccess("PT session rescheduled.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to reschedule PT session.");
    } finally {
      setActionBusy(false);
    }
  };

  const handlePtCancelWithMakeup = async () => {
    if (!token || !ptCancelForm.sessionId || !ptCancelForm.newDate || !ptCancelForm.newTime) {
      setActionError("Choose the future make-up session date and time.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await trainingService.cancelPtSessionWithMakeup(token, ptCancelForm.sessionId, {
        newDate: ptCancelForm.newDate,
        newTime: ptCancelForm.newTime,
        reason: ptCancelForm.reason || undefined,
      });
      await reloadPtTab();
      setActionSuccess("PT session cancelled and moved into a future make-up slot.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to cancel PT session with make-up slot.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleUpdatePtSessionCount = async () => {
    if (!token || !ptSessionCountForm.assignmentId) {
      return;
    }
    const totalSessions = Number(ptSessionCountForm.totalSessions || 0);
    if (!Number.isFinite(totalSessions) || totalSessions < 0) {
      setActionError("Enter a valid total PT session count.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await trainingService.updateAssignmentSessionCount(token, ptSessionCountForm.assignmentId, Math.round(totalSessions));
      await reloadPtTab();
      setActionSuccess("PT session count updated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update PT session count.");
    } finally {
      setActionBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "personal-training" || !token || !activePtCoachId) {
      return;
    }
    if (ptAvailabilityOptions.length > 0 || ptCalendarEntries.length > 0) {
      return;
    }
    void loadPtSchedulingContext(activePtCoachId).catch(() => undefined);
  }, [
    activePtCoachId,
    activeTab,
    loadPtSchedulingContext,
    ptAvailabilityOptions.length,
    ptCalendarEntries.length,
    token,
  ]);

  const handleAccessAction = async (action: string, serialOverride?: string) => {
    if (!token || !memberId) {
      return;
    }
    const targetSerial = serialOverride || selectedBiometricDeviceSerial;
    if (!targetSerial) {
      setActionError("Select a biometric device before continuing.");
      return;
    }
    const targetEnrollment = enrollmentByDeviceSerial.get(targetSerial);
    const resolvedBiometricPin = pickString(targetEnrollment, ["pin"]) || normalizedPhonePin;
    if (!resolvedBiometricPin) {
      setActionError("Member mobile number is required to sync with the biometric device.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const biometricPayload = {
        serialNumber: targetSerial,
        pin: resolvedBiometricPin,
        name: memberDisplayName,
        memberId: Number(memberId),
      };
      if (action === "ADD_USER") {
        await engagementService.enrollBiometricUser(token, biometricPayload);
      } else if (action === "RE_ADD_USER") {
        await engagementService.reAddBiometricUser(token, biometricPayload);
      } else if (action === "BLOCK_USER") {
        await engagementService.blockBiometricUser(token, biometricPayload);
      } else if (action === "UNBLOCK_USER") {
        await engagementService.unblockBiometricUser(token, biometricPayload);
      } else if (action === "DELETE_USER") {
        await engagementService.deleteBiometricUser(token, {
          serialNumber: targetSerial,
          pin: resolvedBiometricPin,
          memberId: Number(memberId),
        });
      }
      const refreshedEnrollments = await engagementService.getMemberBiometricEnrollments(token, memberId).catch(() => enrollmentRecords);
      const refreshedBiometricDevices = await engagementService.listBiometricDevices(token).catch(() => availableBiometricDevices);
      const refreshedBiometricLogs = await engagementService.getBiometricLogs(token).catch(() => biometricLogRecords);
      const refreshedAttendanceLogs = refreshedBiometricLogs.filter((entry) => {
        const logMemberId = pickString(toRecord(entry), ["memberId"]);
        const logPin = pickString(toRecord(entry), ["deviceUserId"]);
        return logMemberId === String(memberId) || (!!normalizedPhonePin && logPin === normalizedPhonePin);
      });
      setTabData((current) => ({
        ...current,
        "audit-trail": undefined,
        attendance: (() => {
          const currentAttendancePayload = toRecord(current.attendance);
          const currentAttendanceRecords: unknown[] = Array.isArray(currentAttendancePayload.records)
            ? (currentAttendancePayload.records as unknown[])
            : attendanceRecords;
          return {
            records: currentAttendanceRecords,
            biometricDevices: refreshedBiometricDevices,
            biometricLogs: refreshedAttendanceLogs,
            enrollments: refreshedEnrollments,
          };
        })(),
      }));
      setActionSuccess("Biometric device command queued. Device status will update after the ESSL machine confirms it.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to sync member access with the biometric device.");
    } finally {
      setActionBusy(false);
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <ProfilePanel title="Personal Details" subtitle="Core member identity and contact information" accent="slate">
            {(() => {
              const personalDetails = [
                { label: "Mobile Number", value: phone || "-" },
                { label: "Email Address", value: email || "-" },
                { label: "Date Of Birth", value: formatDateOnly(dateOfBirth || undefined) },
                { label: "Date Of Enquiry", value: formatDateTime(inquiryDate || undefined) },
                { label: "Client Representative", value: clientRepName },
                ...(!isFlexPlan ? [{ label: trainerLabel, value: assignedTrainer }] : []),
                ...(interestedIn !== "-" ? [{ label: "Interested In", value: interestedIn }] : []),
                { label: "Emergency Contact", value: emergencyContact },
                ...(referredBy !== "-" ? [{ label: "Referral Source", value: referredBy }] : []),
                { label: "Member Code", value: memberCode },
                { label: "Home Branch", value: branchLabel },
              ];

              return (
            <dl className="divide-y divide-white/8 overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.03]">
              {personalDetails.map((entry) => (
                <div key={entry.label} className="grid gap-2 px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                  <dd className="text-base font-medium text-white md:text-right">{entry.value}</dd>
                </div>
              ))}
            </dl>
              );
            })()}
          </ProfilePanel>

        </div>

        <div className="space-y-6">
          {hasOverviewMembership ? (
            <ProfilePanel title="Membership Summary" accent="lime">
              <div className="space-y-4">
                {overviewMembershipCards.map((membership) => {
                  const legacyUpgradeFallback = legacyUpgradeFallbackBySubscription.get(membership.subscriptionId);
                  const effectiveMembershipStartDate =
                    legacyUpgradeFallback?.previousStartDate && legacyUpgradeFallback.previousStartDate < (membership.startDate || "")
                      ? legacyUpgradeFallback.previousStartDate
                      : membership.startDate;
                  const overviewTrainerLabel =
                    membership.family === "GROUP_CLASS" ? "Group Class Trainer" : membership.family === "PT" ? "Coach" : trainerLabel;
                  const overviewTrainerValue =
                    membership.family === "PT"
                      ? activePtCoachName
                      : membership.family === "GROUP_CLASS"
                        ? assignedTrainer
                        : assignedTrainer;
                  return (
                    <div key={membership.subscriptionId} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-2xl font-semibold tracking-tight text-white">
                          {normalizeDisplayPlanName(membership.variantName || membership.productName || humanizeLabel(membership.productCode || membership.categoryCode))}
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          {humanizeLabel(membership.family)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <StatPill label="Membership Status" value={humanizeLabel(membership.status || membershipStatus)} />
                        <StatPill label="Duration" value={formatPlanDuration(membership.durationMonths, membership.validityDays)} />
                        <StatPill label="Start Date" value={formatDateOnly(effectiveMembershipStartDate || undefined)} />
                        <StatPill label="Expires In" value={formatExpiryWindow(daysUntil(membership.expiryDate))} />
                        {membership.family !== "FLEX" ? (
                          <StatPill label={overviewTrainerLabel} value={overviewTrainerValue} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ProfilePanel>
          ) : null}

          <ProfilePanel title="Alerts" subtitle="Only active items that need attention" accent={alerts.length ? "rose" : "slate"}>
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-300">
                No active alerts for this member.
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((entry) => (
                  <div key={entry} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{entry}</span>
                  </div>
                ))}
              </div>
            )}
          </ProfilePanel>
        </div>
      </div>
    </div>
  );

  const renderBilling = () => {
    const billingData = tabData.billing as LifecycleBillingTabState | undefined;
    const invoices = billingData?.invoices || [];
    const receipts = billingData?.receipts || [];
    const stats = extractInvoiceStats(invoices);
    const normalizedStats = {
      total: roundAmount(stats.total),
      paid: roundAmount(stats.paid),
      balance: roundAmount(stats.balance),
      latestInvoice: stats.latestInvoice,
      latestReceipt: stats.latestReceipt,
      latestIssuedAt: stats.latestIssuedAt,
    };
    const refreshBillingRegister = () => {
      setTabData((current) => ({ ...current, billing: undefined }));
      setTabErrors((current) => ({ ...current, billing: undefined }));
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-end gap-3">
          {canCollectOutstandingBalance ? (
            <button
              type="button"
              onClick={() => {
                setResumeBillingForm({
                  paymentMode: "UPI",
                  invoiceId: selectedOutstandingInvoice ? String(selectedOutstandingInvoice.id || "") : "",
                });
                setActionModal("unfreeze-billing");
              }}
              className="rounded-xl border border-[#c42924]/40 bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a81f1c]"
            >
              Receive Balance Payment
            </button>
          ) : null}
          <button
            type="button"
            onClick={refreshBillingRegister}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Refresh Billing
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Total Invoiced", value: formatRoundedInr(normalizedStats.total), icon: <CreditCard className="h-5 w-5 text-cyan-300" /> },
            { label: "Collected", value: formatRoundedInr(normalizedStats.paid), icon: <BadgeCheck className="h-5 w-5 text-[#c42924]" /> },
            { label: "Outstanding", value: formatRoundedInr(normalizedStats.balance), icon: <AlertTriangle className="h-5 w-5 text-amber-300" /> },
            { label: "Latest Invoice", value: normalizedStats.latestInvoice || "-", icon: <CalendarDays className="h-5 w-5 text-slate-300" /> },
          ].map((entry) => (
            <ProfilePanel key={entry.label} title={entry.label} accent="slate">
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold text-white">{entry.value}</p>
                {entry.icon}
              </div>
            </ProfilePanel>
          ))}
        </div>

        <div className="grid gap-6">
          <ProfilePanel title="Billing Contacts" accent="slate">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatPill label="Billing Representative" value={billingRepName} />
              <StatPill label="Client Representative" value={clientRepName} />
              <StatPill label="Latest Receipt" value={normalizedStats.latestReceipt || "-"} />
              <StatPill label="Payment Status" value={humanizeLabel(paymentStatus)} />
            </div>
          </ProfilePanel>
        </div>

        <ProfilePanel title="Invoice Register" accent="slate">
          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No invoices available.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Issued At</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {invoices.map((invoice) => {
                    const invoiceView = {
                      amount: roundAmount(invoice.amount),
                      paidAmount: roundAmount(invoice.paidAmount || 0),
                      balanceAmount: roundAmount(invoice.balanceAmount || 0),
                      paymentStatus: normalizePaymentStatus(
                        invoice.status,
                        invoice.amount,
                        invoice.paidAmount || 0,
                        invoice.balanceAmount || 0,
                      ),
                    };
                    return (
                      <tr key={invoice.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-medium text-white">{invoice.invoiceNumber}</td>
                        <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.amount)}</td>
                        <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.paidAmount)}</td>
                        <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.balanceAmount)}</td>
                        <td className="px-4 py-3 text-slate-200">{invoice.receiptNumber || "-"}</td>
                        <td className="px-4 py-3 text-slate-200">{humanizeLabel(invoiceView.paymentStatus)}</td>
                        <td className="px-4 py-3 text-slate-200">{formatDateTime(invoice.issuedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              title={`Print invoice ${invoice.invoiceNumber}`}
                              aria-label={`Print invoice ${invoice.invoiceNumber}`}
                              onClick={() => void printDocumentPdf("invoice", invoice.id)}
                              disabled={documentBusyKey === `invoice-print-${invoice.id}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={`Download invoice ${invoice.invoiceNumber}`}
                              aria-label={`Download invoice ${invoice.invoiceNumber}`}
                              onClick={() => void downloadDocumentPdf("invoice", invoice.id, invoice.invoiceNumber)}
                              disabled={documentBusyKey === `invoice-download-${invoice.id}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={`Share invoice ${invoice.invoiceNumber}`}
                              aria-label={`Share invoice ${invoice.invoiceNumber}`}
                              onClick={() => void shareDocumentPdf("invoice", invoice.id, invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber}`)}
                              disabled={documentBusyKey === `invoice-share-${invoice.id}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Share2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ProfilePanel>

        <ProfilePanel title="Receipt Register" accent="cyan">
          {receipts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No receipts available.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3">Paid At</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-white">{receipt.receiptNumber}</td>
                      <td className="px-4 py-3 text-slate-200">{formatRoundedInr(receipt.amount)}</td>
                      <td className="px-4 py-3 text-slate-200">{String(receipt.paymentMode || "-").toUpperCase()}</td>
                      <td className="px-4 py-3 text-slate-200">{formatDateTime(receipt.paidAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            title={`Print receipt ${receipt.receiptNumber}`}
                            aria-label={`Print receipt ${receipt.receiptNumber}`}
                            onClick={() => void printDocumentPdf("receipt", receipt.id)}
                            disabled={documentBusyKey === `receipt-print-${receipt.id}`}
                            className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={`Download receipt ${receipt.receiptNumber}`}
                            aria-label={`Download receipt ${receipt.receiptNumber}`}
                            onClick={() => void downloadDocumentPdf("receipt", receipt.id, receipt.receiptNumber)}
                            disabled={documentBusyKey === `receipt-download-${receipt.id}`}
                            className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={`Share receipt ${receipt.receiptNumber}`}
                            aria-label={`Share receipt ${receipt.receiptNumber}`}
                            onClick={() => void shareDocumentPdf("receipt", receipt.id, receipt.receiptNumber, `Receipt ${receipt.receiptNumber}`)}
                            disabled={documentBusyKey === `receipt-share-${receipt.id}`}
                            className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ProfilePanel>
      </div>
    );
  };

  const renderFitnessAssessment = () => {
    const data = tabData["fitness-assessment"];
    if (!data) {
      return null;
    }

    const formCompleted =
      pickBoolean(data.fitnessForm.consent, ["accepted"]) ??
      Object.keys(toRecord(data.fitnessForm)).length > 0;

    return (
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-3">
          <ProfilePanel title="Fitness Form" accent="slate">
            <KeyValueGrid
              payload={{
                completed: formCompleted ? "Yes" : "No",
                signature: pickString(data.fitnessForm.consent, ["signatureName"]) || "-",
                signedAt: formatDateTime(pickString(data.fitnessForm.consent, ["signedAt"]) || undefined),
              }}
            />
          </ProfilePanel>
          <ProfilePanel title="Assessment Status" accent="slate">
            <KeyValueGrid
              payload={{
                status: data.assessmentStatus.status || "-",
                coach: data.assessmentStatus.assignedCoachName || data.assessmentStatus.assignedCoachId || "-",
                scheduledAt: formatDateTime(data.assessmentStatus.scheduledAt),
                completedAt: formatDateTime(data.assessmentStatus.completedAt),
              }}
            />
          </ProfilePanel>
          <ProfilePanel title="Result" accent="slate">
            <KeyValueGrid
              payload={{
                score: data.assessmentStatus.score ?? 0,
                category: data.assessmentStatus.category || "-",
                classification: data.assessmentStatus.classification || "-",
              }}
            />
          </ProfilePanel>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runAssessmentAction("request")}
            disabled={assessmentActionBusy}
            className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a71f23] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {assessmentActionBusy ? "Working..." : "Request Assessment"}
          </button>
          <button
            type="button"
            onClick={() => void runAssessmentAction("skip")}
            disabled={assessmentActionBusy}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Skip Assessment
          </button>
        </div>

        <ProfilePanel title="Fitness Form Details" accent="slate">
          <div className="space-y-4">
            <KeyValueGrid payload={data.fitnessForm.personalInfo} />
            <KeyValueGrid payload={data.fitnessForm.physicalReadiness} />
            <KeyValueGrid payload={data.fitnessForm.fitnessGoals} />
          </div>
        </ProfilePanel>

        <ProfilePanel title="Assessment History" accent="slate">
          <GenericTable
            items={data.assessmentHistory.map((entry) => entry.raw)}
            emptyLabel="No assessment history available."
          />
        </ProfilePanel>
      </div>
    );
  };

  const renderTab = () => {
    const tabError = tabErrors[activeTab];
    const tabLoading = loadingTabs[activeTab];
    const hasResolvedSubscriptionData = activeTab === "subscriptions" && Boolean(tabData.subscriptions);

    if (tabError) {
      return <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{tabError}</div>;
    }

    if (tabLoading && !hasResolvedSubscriptionData) {
      return (
        <div className="inline-flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {activeTab.replace(/-/g, " ")}...
        </div>
      );
    }

    switch (activeTab) {
      case "overview":
        return renderOverview();
      case "subscriptions": {
        const data = tabData.subscriptions;
        if (!data) return null;
        const dashboardRecord = toRecord(data.dashboard);
        const primaryMembershipCandidate = extractMembershipPortfolioItem(dashboardRecord.primaryMembership);
        const transformationMembershipCandidate = extractMembershipPortfolioItem(dashboardRecord.transformationMembership);
        const membershipPortfolio = toArray(dashboardRecord.memberships)
          .map(extractMembershipPortfolioItem)
          .filter((entry): entry is MembershipPortfolioItem => entry !== null);
        const isUpcomingMembershipRecord = (entry: MembershipPortfolioItem | null | undefined) => {
          if (!entry) {
            return false;
          }
          const normalizedStatus = String(entry.status || "").toUpperCase();
          return (Boolean(entry.startDate) && entry.startDate > todayIsoDate) || normalizedStatus === "PENDING" || normalizedStatus === "ISSUED";
        };
        const currentMembershipPortfolio = membershipPortfolio.filter((entry) => !isUpcomingMembershipRecord(entry));
        const primaryMembershipRecord = pickPortfolioPrimaryMembership(
          !isUpcomingMembershipRecord(primaryMembershipCandidate) ? primaryMembershipCandidate : null,
          currentMembershipPortfolio,
        );
        const transformationMembershipRecord = !isUpcomingMembershipRecord(transformationMembershipCandidate)
          ? transformationMembershipCandidate
          : currentMembershipPortfolio.find((entry) => entry.family === "TRANSFORMATION") || null;
        const displayedMemberships = buildDisplayedMembershipCards(
          currentMembershipPortfolio,
          transformationMembershipRecord || primaryMembershipRecord,
        );
        const shouldShowEntitlementsBesideMembership = displayedMemberships.length <= 1;
        const upcomingMemberships = membershipPortfolio.filter((entry) => {
          if (entry.family === "CREDIT_PACK") {
            return false;
          }
          if (displayedMemberships.some((displayed) => displayed.subscriptionId === entry.subscriptionId)) {
            return false;
          }
          return isUpcomingMembershipRecord(entry);
        });
        const programEnrollmentRecords = toArray<RecordLike>(data.programEnrollments);
        const displayedEntitlementRecords = (() => {
          const visibleSubscriptionIds = new Set(displayedMemberships.map((membership) => membership.subscriptionId));
          const relevantEntitlements = normalizedEntitlementRecords.filter((entry) => {
            const linkedSubscriptionId = extractSubscriptionIdFromEntitlementSource(entry.source);
            if (!linkedSubscriptionId) {
              return true;
            }
            return visibleSubscriptionIds.has(linkedSubscriptionId);
          });
          const existingPauseBenefit = relevantEntitlements.some(
            (entry) => String(entry.feature || "").toUpperCase() === "PAUSE_BENEFIT",
          );
          if (existingPauseBenefit) {
            return relevantEntitlements;
          }

          const pauseBenefitVariant = displayedMemberships
            .map((membership) => {
              const membershipDashboardItem = toRecord(
                toArray(dashboardRecord.memberships).find(
                  (entry) => pickString(toRecord(entry), ["subscriptionId"]) === membership.subscriptionId,
                ),
              );
              const membershipVariantId = pickString(membershipDashboardItem, ["productVariantId"]) || membership.productVariantId;
              return catalogVariants.find((variant) => String(variant.variantId) === membershipVariantId);
            })
            .find((variant) => Number(variant?.passBenefitDays || 0) > 0);

          if (!pauseBenefitVariant) {
            return relevantEntitlements;
          }

          return [
            ...relevantEntitlements,
            {
              entitlementId: -1,
              feature: "PAUSE_BENEFIT",
              source: "CATALOG_FALLBACK",
              validFrom: undefined,
              validUntil: undefined,
              includedCount: pauseBenefitVariant.passBenefitDays,
              remainingCount: pauseBenefitVariant.passBenefitDays,
              recurrence: "FULL_TERM",
              usedCount: 0,
              expiredUnusedCount: 0,
              manualTopUpCount: 0,
              expiresIfUnused: false,
              currentCycleStart: undefined,
              currentCycleEnd: undefined,
              lastUtilizedAt: undefined,
              lastExpiredAt: undefined,
            },
          ];
        })();
        const shouldShowEntitlementsPanel = displayedEntitlementRecords.length > 0;
        const ptCompletedSessions = ptSessions.filter((session) => {
          const status = pickString(toRecord(session), ["status"]).toUpperCase();
          return status === "COMPLETED" || status === "DONE";
        }).length;
        const ptConsumedSessions = ptSessions.filter((session) => {
          const status = pickString(toRecord(session), ["status"]).toUpperCase();
          return status === "COMPLETED" || status === "DONE" || status === "NO_SHOW";
        }).length;
        const entitlementsUsagePanel = shouldShowEntitlementsPanel ? (
          <ProfilePanel title="Entitlements & Usage" subtitle="Tracked benefits available on this membership" accent="cyan">
              <div className="space-y-3">
                {displayedEntitlementRecords.map((entitlement) => (
                  <div key={entitlement.entitlementId} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{cleanEntitlementFeatureLabel(entitlement.feature)}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {entitlementRuleLabel(entitlement)}
                          {String(entitlement.feature || "").toUpperCase() !== "PAUSE_BENEFIT" && entitlement.currentCycleEnd
                            ? ` · resets ${formatDateOnly(entitlement.currentCycleEnd)}`
                            : ""}
                        </p>
                        {String(entitlement.feature || "").toUpperCase() === "PAUSE_BENEFIT" ? (
                          <p className="mt-2 text-xs text-slate-500">Available across the full membership duration.</p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            {Number(entitlement.expiredUnusedCount || 0) > 0 ? `${entitlement.expiredUnusedCount} expired unused` : "No expired unused balance"}
                            {Number(entitlement.manualTopUpCount || 0) > 0 ? ` · ${entitlement.manualTopUpCount} manual top-up` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-semibold text-cyan-100">{entitlementUsageLabel(entitlement)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </ProfilePanel>
        ) : null;
        return (
          <div className="space-y-6">
            <div className={`grid gap-6 ${shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? "xl:grid-cols-2" : ""}`}>
              <div className={shouldShowEntitlementsBesideMembership ? "space-y-6" : "grid gap-6 xl:grid-cols-2"}>
                {displayedMemberships.length ? displayedMemberships.map((membership) => {
                const cardTitle = trimMembershipCardTitle(
                  membership.variantName || membership.productName || humanizeLabel(membership.productCode || membership.categoryCode),
                );
                const isPrimaryCard = primaryMembershipRecord?.subscriptionId === membership.subscriptionId;
                const isTransformationCard = membership.family === "TRANSFORMATION";
                const isPtCard = membership.family === "PT";
                const isSelectedCard = selectedMembershipRecord?.subscriptionId === membership.subscriptionId;
                const isMenuOpen = openMembershipMenuId === membership.subscriptionId;
                const normalizedCardStatus = String(membership.status || "").trim().toUpperCase();
                const isPausedCard =
                  normalizedCardStatus === "PAUSED" &&
                  hasOutstandingBalance &&
                  normalizedPaymentStatus !== "PAID";
                const isFrozenCard = normalizedCardStatus === "PAUSED" && !isPausedCard;
                const ptTotalSessions = membership.includedPtSessions || 0;
                const ptUsedSessions = isPtCard ? ptConsumedSessions : 0;
                const ptRemainingSessions = isPtCard ? Math.max(ptTotalSessions - ptUsedSessions, 0) : 0;
                const ptProgressPercent = isPtCard && ptTotalSessions > 0 ? Math.min(100, Math.round((ptUsedSessions / ptTotalSessions) * 100)) : 0;
                const membershipDashboardItem = toRecord(
                  toArray(dashboardRecord.memberships).find(
                    (entry) => pickString(toRecord(entry), ["subscriptionId"]) === membership.subscriptionId,
                  ),
                );
                const membershipVariantId = pickString(membershipDashboardItem, ["productVariantId"]);
                const membershipCatalogVariant =
                  catalogVariants.find((variant) => String(variant.variantId) === membershipVariantId) ||
                  catalogVariants.find((variant) => variant.productCode === membership.productCode && variant.variantName === membership.variantName);
                const membershipPackageFeatures = toArray(membership.entitlements)
                  .map((feature) => cleanEntitlementFeatureLabel(String(feature || "")))
                  .filter((feature) => shouldShowPackageFeatureChip(feature))
                  .filter((feature, index, array) => array.indexOf(feature) === index);
                const linkedPrograms = membership.family === "GROUP_CLASS"
                  ? Array.from(
                      new Set(
                        programEnrollmentRecords
                          .map((entry) => pickString(entry, ["programName"]))
                          .filter(Boolean),
                      ),
                    )
                  : [];
                const legacyUpgradeFallback = legacyUpgradeFallbackBySubscription.get(membership.subscriptionId);
                const latestUpgradeEntry =
                  latestUpgradeAuditBySubscription.get(membership.subscriptionId) ||
                  (isPrimaryCard ? latestMembershipUpgradeEntry : undefined);
                const effectiveMembershipStartDate =
                  legacyUpgradeFallback?.previousStartDate && legacyUpgradeFallback.previousStartDate < (membership.startDate || "")
                    ? legacyUpgradeFallback.previousStartDate
                    : membership.startDate;
                const shouldShowUpgradedState = Boolean(latestUpgradeEntry || legacyUpgradeFallback) && isPrimaryCard;
                return (
                  <ProfilePanel
                    key={membership.subscriptionId}
                    title={membershipPanelTitle(membership.family)}
                    subtitle={membershipPanelSubtitle(membership.family)}
                    accent={deriveAccentForMembershipFamily(membership.family)}
                  >
                    <div
                      data-membership-menu-root="true"
                      className={`relative z-10 space-y-4 rounded-2xl border px-4 py-4 ${isSelectedCard ? "border-[#c42924]/60 bg-[#c42924]/8" : "border-white/8 bg-white/[0.02]"}`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="space-y-2">
                          <p className="text-3xl font-semibold tracking-tight text-white">{cardTitle}</p>
                          <p className="text-sm text-slate-300">Category: {String(membership.categoryCode || "").toUpperCase() === "PT" ? "PT" : humanizeLabel(membership.categoryCode)}</p>
                        </div>
                        {isPrimaryCard ? (
                          <span className="rounded-full border border-lime-400/30 bg-lime-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-lime-100">
                            Primary
                          </span>
                        ) : null}
                        {isPausedCard ? (
                          <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-100">
                            Paused
                          </span>
                        ) : null}
                        {isFrozenCard ? (
                          <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-100">
                            Frozen
                          </span>
                        ) : null}
                        {shouldShowUpgradedState ? (
                          <span className="rounded-full border border-[#c42924]/30 bg-[#c42924]/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#ffd6d4]">
                            Upgraded
                          </span>
                        ) : null}
                        {isTransformationCard ? (
                          <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                            Gym + PT Bundle
                          </span>
                        ) : null}
                        {isPtCard && !isPrimaryCard ? (
                          <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-rose-200">
                            Secondary
                          </span>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Open actions for ${cardTitle}`}
                          onClick={() => {
                            setSelectedMembershipId(membership.subscriptionId);
                            setOpenMembershipMenuId((current) => (current === membership.subscriptionId ? null : membership.subscriptionId));
                          }}
                          className="ml-auto rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08]"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {isMenuOpen ? (
                          <div className="absolute right-4 top-14 z-40 min-w-[220px] rounded-2xl border border-white/10 bg-[#111821] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                            {membershipActions
                              .filter((action) => !(isPtCard && action.key === "pt"))
                              .map((action) => (
                              <button
                                key={`${membership.subscriptionId}-${action.key}`}
                                type="button"
                                onClick={() => {
                                  setOpenMembershipMenuId(null);
                                  if (action.enabled) {
                                    openActionModal(action.key === "pt" ? "pt" : action.key);
                                  }
                                }}
                                disabled={!action.enabled}
                                className={`flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                                  action.enabled
                                    ? "text-slate-100 hover:bg-white/[0.06]"
                                    : "cursor-not-allowed text-slate-500"
                                }`}
                              >
                                {action.label}
                              </button>
                            ))}
                            {((isPtCard || isTransformationCard) && !canShowBalanceCollectionAction) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMembershipMenuId(null);
                                  setActiveTab("personal-training");
                                  setPtFocusSection("session-register");
                                }}
                                className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-[#ffd6d4] hover:bg-[#c42924]/10"
                              >
                                Open Session Register
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {membershipPackageFeatures.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {membershipPackageFeatures.map((feature) => (
                            <span
                              key={`${membership.subscriptionId}-${feature}`}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200"
                            >
                              {feature}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {shouldShowUpgradedState ? (
                        <div className="rounded-xl border border-[#c42924]/20 bg-[#c42924]/10 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ffb9b6]">Latest Upgrade</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {latestUpgradeEntry?.summary || (legacyUpgradeFallback ? `Upgraded from ${legacyUpgradeFallback.fromLabel} to ${cardTitle}` : `Upgraded to ${cardTitle}`)}
                          </p>
                          <p className="mt-1 text-xs text-[#ffd7d6]/80">
                            {latestUpgradeEntry
                              ? `${formatDateTime(latestUpgradeEntry.createdAt)} · ${resolveAuditActorLabel(latestUpgradeEntry)}`
                              : `Derived from membership history · ${humanizeLabel(legacyUpgradeFallback?.previousStatus || "Completed")}`}
                          </p>
                        </div>
                      ) : null}
                      {linkedPrograms.length > 0 ? (
                        <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/8 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
                            {linkedPrograms.length === 1 ? "Linked Program" : "Linked Programs"}
                          </p>
                          <p className="mt-2 text-sm font-medium text-cyan-100">{linkedPrograms.join(", ")}</p>
                        </div>
                      ) : null}
                      {isPtCard ? (
                        <p className="text-sm text-slate-300">
                          PT remains a separate commercial membership with its own billing and session delivery.
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <StatPill label="Membership Status" value={humanizeLabel(membership.status || "-")} />
                        <StatPill label="Duration" value={formatPlanDuration(membership.durationMonths, membership.validityDays)} />
                        <StatPill label="Start Date" value={formatDateOnly(effectiveMembershipStartDate || undefined)} />
                        <StatPill label="Expiry Date" value={formatDateOnly(membership.expiryDate || undefined)} />
                        {membership.family === "PT" ? (
                          <>
                            <StatPill label="Coach" value={activePtCoachName} />
                            <StatPill label="Sessions" value={ptTotalSessions ? `${ptUsedSessions} / ${ptTotalSessions}` : String(ptCompletedSessions)} />
                          </>
                        ) : null}
                        {membership.family === "FLEX" ? (
                          <>
                            <StatPill label="Days Included" value={formatFlexDayLabel(membership.includedCheckIns || 0)} />
                            <StatPill label="Days Used" value={formatFlexDayLabel(membership.usedCheckIns || 0)} />
                            <StatPill label="Days Remaining" value={formatFlexDayLabel(membership.checkInsRemaining || 0)} />
                          </>
                        ) : null}
                      </div>
                      {membership.family === "FLEX" ? (
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                          <p className="text-sm text-slate-300">
                            Use on any <span className="font-semibold text-white">{formatFlexDayLabel(membership.includedCheckIns || 0)}</span> within the active flex cycle. Attendance automatically stops once the remaining days reach zero.
                          </p>
                        </div>
                      ) : null}
                      {isPtCard && ptTotalSessions > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                            <span>{ptUsedSessions} completed</span>
                            <span>{ptRemainingSessions} remaining</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/8">
                            <div className="h-full rounded-full bg-rose-400 transition-all" style={{ width: `${ptProgressPercent}%` }} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </ProfilePanel>
                );
                }) : (
                  <ProfilePanel title="Membership Portfolio" subtitle="No active or recent memberships are attached to this member yet." accent="slate">
                    <p className="text-sm text-slate-300">No memberships found.</p>
                  </ProfilePanel>
                )}
                {upcomingMemberships.length > 0 ? (
                  <ProfilePanel title="Upcoming Memberships" subtitle="Renewals and future-cycle memberships waiting for activation or start date." accent="amber">
                    <div className="space-y-3">
                      {upcomingMemberships.map((membership) => (
                        <div key={`upcoming-${membership.subscriptionId}`} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="space-y-1">
                              <p className="text-lg font-semibold text-white">{trimMembershipCardTitle(membership.variantName || membership.productName || membership.productCode)}</p>
                              <p className="text-sm text-slate-300">Category: {humanizeLabel(membership.categoryCode)}</p>
                            </div>
                            <span className="ml-auto rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                              {humanizeLabel(membership.status)}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <StatPill label="Start Date" value={formatDateOnly(membership.startDate || undefined)} />
                            <StatPill label="Expiry Date" value={formatDateOnly(membership.expiryDate || undefined)} />
                            <StatPill label="Invoice" value={membership.invoiceNumber || "-"} />
                            <StatPill label="Receipt" value={membership.receiptNumber || "-"} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </ProfilePanel>
                ) : null}
              </div>
              {shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? (
                <div className="xl:min-w-0">
                  {entitlementsUsagePanel}
                </div>
              ) : null}
            </div>
            {!shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? (
              <div className="xl:w-1/2">
                {entitlementsUsagePanel}
              </div>
            ) : null}
          </div>
        );
      }
      case "billing":
        return renderBilling();
      case "attendance":
        return (
          <div className="space-y-6">
            {actionError && actionModal !== "biometric" ? (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {actionError}
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Access Status", value: displayAccessStatus },
                { label: "Biometric PIN", value: normalizedPhonePin || "-" },
                { label: "Total Check-ins", value: String(checkInRows.length) },
                { label: "Devices", value: String(availableBiometricDevices.length) },
              ].map((entry) => (
                <div key={entry.label} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{entry.value}</p>
                </div>
              ))}
            </div>
            <ProfilePanel
              title="Manage Access Devices"
              subtitle={`${onlineBiometricDevices.length} control point${onlineBiometricDevices.length === 1 ? "" : "s"} online`}
              accent="slate"
            >
              <div className="grid gap-4 xl:grid-cols-2">
                {availableBiometricDevices.length ? (
                  availableBiometricDevices.map((device, index) => {
                    const serial = pickString(device, ["serialNumber"]);
                    const deviceName = friendlyBiometricDeviceName(device, index);
                    const enrollment = enrollmentByDeviceSerial.get(serial);
                    const deviceEnrollmentStatus = pickString(enrollment, ["status"]) || "NOT_ADDED";
                    const statusLabel = biometricDeviceStatusLabel(device);
                    const enrollmentLabel = accessEnrollmentLabel(deviceEnrollmentStatus);
                    const normalizedEnrollmentStatus = normalizeEnrollmentStatus(deviceEnrollmentStatus);
                    const showAddAction = normalizedEnrollmentStatus === "NOT_ADDED" || normalizedEnrollmentStatus === "DELETED" || normalizedEnrollmentStatus === "FAILED";
                    const showBlockAction = normalizedEnrollmentStatus === "ENROLLED";
                    const showUnblockAction = normalizedEnrollmentStatus === "BLOCKED";
                    const showReAddAction = normalizedEnrollmentStatus !== "PENDING";
                    return (
                      <div key={serial || deviceName} className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold text-white">{deviceName}</h3>
                            <p className="mt-1 text-sm text-slate-400">{serial || "Serial not available"}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${accessEnrollmentTone(deviceEnrollmentStatus)}`}>
                            {enrollmentLabel}
                          </span>
                        </div>
                        <div className="mt-5 flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${isBiometricDeviceOnline(device) ? "bg-emerald-400" : "bg-slate-500"}`} />
                          <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${biometricDeviceStatusTone(device)}`}>{statusLabel}</span>
                        </div>
                        <div className="mt-5 flex flex-wrap gap-2">
                          {showAddAction ? (
                            <button
                              type="button"
                              onClick={() => void handleAccessAction("ADD_USER", serial)}
                              disabled={actionBusy || !serial}
                              className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              {actionBusy ? "Working..." : "Add User"}
                            </button>
                          ) : null}
                          {showReAddAction ? (
                            <button
                              type="button"
                              onClick={() => void handleAccessAction("RE_ADD_USER", serial)}
                              disabled={actionBusy || !serial}
                              className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              {actionBusy ? "Working..." : "Re-add"}
                            </button>
                          ) : null}
                          {showBlockAction ? (
                            <button
                              type="button"
                              onClick={() => void handleAccessAction("BLOCK_USER", serial)}
                              disabled={actionBusy || !serial}
                              className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              {actionBusy ? "Working..." : "Block"}
                            </button>
                          ) : null}
                          {showUnblockAction ? (
                            <button
                              type="button"
                              onClick={() => void handleAccessAction("UNBLOCK_USER", serial)}
                              disabled={actionBusy || !serial}
                              className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              {actionBusy ? "Working..." : "Unblock"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleAccessAction("DELETE_USER", serial)}
                            disabled={actionBusy || !serial}
                            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
                          >
                            {actionBusy ? "Working..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-slate-400">
                    No biometric devices are available for this branch yet.
                  </div>
                )}
              </div>
            </ProfilePanel>
            <ProfilePanel title="Attendance Logs" subtitle="Recent member entries recorded from attendance and biometric sources" accent="slate">
              <div className="overflow-hidden rounded-[24px] border border-white/8 bg-[#0f1726]">
                <div className="grid grid-cols-[1.15fr_0.9fr_1.2fr_1fr_0.9fr] gap-3 border-b border-white/8 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span>Date</span>
                  <span>Time</span>
                  <span>Device</span>
                  <span>Event Type</span>
                  <span>Status</span>
                </div>
                {attendanceLogRows.length ? (
                  attendanceLogRows.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid grid-cols-[1.15fr_0.9fr_1.2fr_1fr_0.9fr] gap-3 border-b border-white/6 px-5 py-4 text-sm last:border-b-0"
                    >
                      <span className="font-medium text-white">{entry.dateLabel}</span>
                      <span className="text-slate-300">{entry.timeLabel}</span>
                      <span className="text-slate-200">{entry.deviceLabel}</span>
                      <span className={`font-semibold ${attendanceEventTone(entry.eventLabel)}`}>{entry.eventLabel}</span>
                      <span className={`font-semibold ${attendanceRecordStatusTone(entry.statusLabel)}`}>{entry.statusLabel}</span>
                    </div>
                  ))
                ) : (
                  <div className="px-5 py-12 text-center text-sm text-slate-400">
                    No attendance logs are available for this member yet.
                  </div>
                )}
              </div>
            </ProfilePanel>
          </div>
        );
      case "credits-wallet": {
        const data = tabData["credits-wallet"];
        if (!data) return null;
        const ledgerContent = Array.isArray(data.ledger.content) ? data.ledger.content : [];
        return (
          <div className="space-y-6">
            <ProfilePanel title="Wallet Summary" accent="cyan">
              <KeyValueGrid payload={data.wallet} />
            </ProfilePanel>
            <ProfilePanel title="Ledger" accent="slate">
              <GenericTable items={ledgerContent} emptyLabel="No credit ledger entries available." />
            </ProfilePanel>
          </div>
        );
      }
      case "recovery-services":
        return null;
      case "personal-training": {
        const completedSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "COMPLETED" || status === "DONE";
        }).length;
        const scheduledSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "SCHEDULED" || status === "UPCOMING" || status === "PENDING";
        }).length;
        const inProgressSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "IN_PROGRESS";
        }).length;
        const noShowSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "NO_SHOW";
        }).length;
        const cancelledSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "CANCELLED" || status === "CANCELED";
        }).length;
        const totalSessions = ptSessions.length;
        const ptMembershipRecord = portfolioMembershipItems.find((entry) => entry.family === "PT") || null;
        const transformationMembershipRecord = portfolioMembershipItems.find((entry) => entry.family === "TRANSFORMATION") || null;
        const commercialPtRecord = ptMembershipRecord || (isTransformationPlan ? transformationMembershipRecord : null);
        const commercialPtCatalogVariant = commercialPtRecord
          ? catalogVariants.find((variant) => String(variant.variantId) === String(commercialPtRecord.productVariantId))
            || catalogVariants.find((variant) => variant.productCode === commercialPtRecord.productCode && variant.variantName === commercialPtRecord.variantName)
          : null;
        const activeAssignRec = activePtAssignment ? toRecord(activePtAssignment) : null;
        const activeAssignId = activeAssignRec ? pickString(activeAssignRec, ["id", "assignmentId"]) : null;
        const hasPtCommercialMembership = Boolean(commercialPtRecord || isTransformationPlan);
        const ptPackageDurationLabel = commercialPtRecord
          ? formatPlanDuration(commercialPtRecord.durationMonths, commercialPtRecord.validityDays)
          : isTransformationPlan
            ? formatPlanDuration(durationMonths, validityDays)
            : "-";
        const hasAssignedTrainer = Boolean(assignedTrainer && assignedTrainer !== "-");
        const ptPackageName =
          commercialPtRecord?.variantName
          || commercialPtRecord?.productName
          || (isTransformationPlan ? "Transformation PT Bundle" : "Personal Training");
        const includedPtSessions = Math.max(
          Number(commercialPtRecord?.includedPtSessions || 0),
          Number(commercialPtCatalogVariant?.includedPtSessions || 0),
          Number(pickNumber(activeAssignRec, ["sessionCount", "includedSessions", "totalSessions"]) || 0),
        );
        const actionableStatuses = new Set(["SCHEDULED", "UPCOMING", "PENDING", "IN_PROGRESS"]);
        const recordedSessionsCount = ptSessions.filter((session) => {
          const status = pickString(toRecord(session), ["status"])?.toUpperCase();
          return Boolean(status) && !["SCHEDULED", "UPCOMING", "PENDING"].includes(status);
        }).length;
        const actionableSessions = [...ptSessions]
          .map((session) => toRecord(session))
          .filter((session) => actionableStatuses.has((pickString(session, ["status"]) || "SCHEDULED").toUpperCase()))
          .sort((left, right) => getPtSessionSortTimestamp(left) - getPtSessionSortTimestamp(right));
        const actionableDueSessions = actionableSessions.filter((session) => {
          const status = (pickString(session, ["status"]) || "SCHEDULED").toUpperCase();
          if (status === "IN_PROGRESS") {
            return true;
          }
          const sessionDate = pickString(session, ["sessionDate"]);
          return Boolean(sessionDate) && sessionDate <= todayIsoDate;
        });
        const sessionRegisterRows = (actionableDueSessions.length > 0 ? actionableDueSessions : actionableSessions.slice(0, 1))
          .sort((left, right) => getPtSessionSortTimestamp(left) - getPtSessionSortTimestamp(right));
        const sessionRegisterKeys = new Set(
          sessionRegisterRows.map((session) => pickString(session, ["id"]) || `${pickString(session, ["sessionDate"])}-${pickString(session, ["slotStartTime", "sessionTime"])}`),
        );
        const sessionHistoryRows = [...ptSessions]
          .map((session) => toRecord(session))
          .filter((session) => {
            const key = pickString(session, ["id"]) || `${pickString(session, ["sessionDate"])}-${pickString(session, ["slotStartTime", "sessionTime"])}`;
            if (sessionRegisterKeys.has(key)) {
              return false;
            }
            const status = (pickString(session, ["status"]) || "SCHEDULED").toUpperCase();
            if (actionableStatuses.has(status)) {
              const sessionDate = pickString(session, ["sessionDate"]);
              return Boolean(sessionDate) && sessionDate < todayIsoDate;
            }
            return true;
          })
          .sort((left, right) => getPtSessionSortTimestamp(right) - getPtSessionSortTimestamp(left));
        const remainingPtSessions = includedPtSessions > 0 ? Math.max(includedPtSessions - (completedSessions + noShowSessions), 0) : 0;
        const trainerCountedSessions = completedSessions; // Only COMPLETED counts for trainer
        const memberConsumedSessions = completedSessions + noShowSessions; // COMPLETED + NO_SHOW for member
        const pendingSessions = includedPtSessions > 0
          ? Math.max(includedPtSessions - memberConsumedSessions, 0)
          : actionableSessions.length;
        const attendancePct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

        // PT slot data from tabData
        const ptSlots = Array.isArray((tabData["personal-training"] as Record<string, unknown>)?.slots)
          ? ((tabData["personal-training"] as Record<string, unknown>).slots as unknown[])
          : [];

        const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
        const sortedSlots = [...ptSlots].sort((a, b) => {
          const dayA = DAY_ORDER.indexOf(pickString(toRecord(a), ["dayOfWeek"]) || "");
          const dayB = DAY_ORDER.indexOf(pickString(toRecord(b), ["dayOfWeek"]) || "");
          return dayA - dayB;
        });

        const statusBadge = (status: string) => {
          const s = status?.toUpperCase();
          const map: Record<string, string> = {
            COMPLETED: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
            IN_PROGRESS: "border-blue-400/20 bg-blue-500/10 text-blue-200",
            SCHEDULED: "border-slate-400/20 bg-slate-500/10 text-slate-200",
            NO_SHOW: "border-rose-400/20 bg-rose-500/10 text-rose-200",
            CANCELLED: "border-orange-400/20 bg-orange-500/10 text-orange-200",
            RESCHEDULED: "border-purple-400/20 bg-purple-500/10 text-purple-200",
          };
          return map[s] || "border-slate-400/20 bg-slate-500/10 text-slate-200";
        };

        return (
          <div className="space-y-6">
            {/* Transformation bundle notice */}
            {isTransformationPlan ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-5 py-4">
                <p className="text-sm font-semibold text-amber-200">Transformation Package — Gym + PT Bundle</p>
                <p className="mt-1 text-xs text-amber-200/70">
                  This member&apos;s membership includes {includedPtSessions > 0 ? includedPtSessions : (durationMonths || 0) * 13} PT sessions in total. Personal training is bundled with gym access.
                </p>
              </div>
            ) : null}

            {/* Assignment info */}
            <ProfilePanel title="Personal Training Assignment" accent="slate">
              {activePtAssignment ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatPill label="Coach" value={activePtCoachName} />
                  <StatPill label="Training Type" value={humanizeLabel(pickString(activeAssignRec!, ["trainingType"]) || "PERSONAL_TRAINING")} />
                  <StatPill label="Start Date" value={formatDateOnly(pickString(activeAssignRec!, ["startDate"]))} />
                  <StatPill label="End Date" value={formatDateOnly(pickString(activeAssignRec!, ["endDate"])) || "Ongoing"} />
                  <StatPill label="Status" value={pickBoolean(activeAssignRec!, ["active"]) ? "Active" : "Inactive"} />
                </div>
              ) : hasPtCommercialMembership ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatPill label="PT Package" value={trimMembershipCardTitle(ptPackageName)} />
                    <StatPill label="Duration" value={ptPackageDurationLabel} />
                    <StatPill label="Total Sessions" value={includedPtSessions > 0 ? String(includedPtSessions) : "-"} />
                    <StatPill label="Assigned Trainer" value={assignedTrainer || "-"} />
                  </div>
                  <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm font-medium text-amber-100">
                      PT billing is attached, but the operational PT setup is not complete yet.
                    </p>
                    <p className="mt-1 text-xs text-amber-200/80">
                      {hasAssignedTrainer
                        ? "Complete the weekly slot schedule, workout plan, and diet plan before using the session register."
                        : "Complete the trainer assignment, weekly slot schedule, workout plan, and diet plan before using the session register."}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No active PT assignment. Assign a trainer to start tracking sessions.</p>
              )}
            </ProfilePanel>

            {/* PT Slot Schedule */}
            {activeAssignId ? (
              <ProfilePanel title="Weekly Slot Schedule" subtitle="Assigned PT time slots for this member" accent="cyan">
                {sortedSlots.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {sortedSlots.map((slot, idx) => {
                      const slotRec = toRecord(slot);
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{humanizeLabel(pickString(slotRec, ["dayOfWeek"]) || "")}</p>
                            <p className="text-xs text-slate-400">
                              {formatClockTime(pickString(slotRec, ["slotStartTime"]) || "")} — {formatClockTime(pickString(slotRec, ["slotEndTime"]) || "")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No slot schedule configured yet. Add time slots for automatic session generation.</p>
                )}
              </ProfilePanel>
            ) : null}

            {/* Session Summary */}
            {totalSessions > 0 ? (
              <ProfilePanel title="Session Tracker" subtitle="Session counts — NO_SHOW counts as consumed for member but NOT for trainer payment" accent="lime">
                {activeAssignId ? (
                  <div className="mb-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setPtSessionCountForm({
                          assignmentId: activeAssignId,
                          totalSessions: String(
                            Math.max(
                              includedPtSessions,
                              Number(pickNumber(activeAssignRec!, ["totalSessions", "sessionCount", "includedSessions"]) || 0),
                            ),
                          ),
                        });
                        setActionError(null);
                        setActionModal("pt-session-count");
                      }}
                      className="rounded-xl border border-lime-400/30 bg-lime-500/10 px-4 py-2 text-sm font-semibold text-lime-100 hover:bg-lime-500/20"
                    >
                      Edit Total PT Sessions
                    </button>
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatPill label="Total PT Sessions" value={includedPtSessions > 0 ? String(includedPtSessions) : String(totalSessions)} />
                  <StatPill label="Total Recorded Sessions" value={String(recordedSessionsCount)} />
                  <StatPill label="Pending PT Sessions" value={String(pendingSessions)} />
                  <StatPill label="Client Show" value={String(completedSessions)} />
                  <StatPill label="Client No-Show" value={String(noShowSessions)} />
                  <StatPill label="Remaining Sessions" value={includedPtSessions > 0 ? String(remainingPtSessions) : "-"} />
                  <StatPill label="Cancelled" value={String(cancelledSessions)} />
                  <StatPill label="Reschedules Used" value={ptHasUnlimitedReschedules ? `${ptUsedReschedules} / Unlimited` : `${ptUsedReschedules} / ${ptAssignmentRescheduleLimit}`} />
                  <StatPill label="Trainer Counted" value={String(trainerCountedSessions)} />
                  <StatPill label="Member Consumed" value={String(memberConsumedSessions)} />
                </div>
                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Attendance Rate</span>
                    <span className="text-lg font-semibold text-white">{attendancePct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(attendancePct, 100)}%` }} />
                  </div>
                </div>
              </ProfilePanel>
            ) : null}

            {/* Session Register with Actions */}
            {sessionRegisterRows.length > 0 ? (
              <div ref={sessionRegisterRef}>
              <ProfilePanel title="Session Register" subtitle="Only due or currently actionable PT sessions are shown here. Older and completed items move to history." accent="slate">
                <div className="mb-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Cancel Policy</p>
                    <p className="mt-2 text-sm text-white">Cancel is allowed until {PT_CANCEL_CUTOFF_HOURS} hours before the booked slot.</p>
                    <p className="mt-1 text-xs text-slate-500">Valid cancel keeps the member session available for a future make-up slot.</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Reschedule Policy</p>
                    <p className="mt-2 text-sm text-white">Reschedule is same-day only and closes {PT_RESCHEDULE_CUTOFF_HOURS} hours before the original slot.</p>
                    <p className="mt-1 text-xs text-slate-500">If no same-day slot is free, use cancel while the 8-hour window is still open.</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Late Window</p>
                    <p className="mt-2 text-sm text-white">After the cutoffs, unattended or late-cancelled sessions are treated as consumed.</p>
                    <p className="mt-1 text-xs text-slate-500">No Show consumes the member session but does not count for trainer payout.</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Slot</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">By</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionRegisterRows.map((rec, idx) => {
                        const sessId = pickString(rec, ["id"]);
                        const sessStatus = (pickString(rec, ["status"]) || "SCHEDULED").toUpperCase();
                        const slotS = pickString(rec, ["slotStartTime", "sessionTime"]) || "";
                        const slotE = pickString(rec, ["slotEndTime"]) || "";
                        const actualStart = pickString(rec, ["actualStartTime"]) || "";
                        const dur = pickString(rec, ["durationMinutes"]) || "";
                        const startBy = pickString(rec, ["startedBy"]) || "";
                        const startAllowed = canStartPtSessionNow(rec);
                        const sameDaySlotOptions = buildAvailablePtSlotsForDate({
                          dateIso: pickString(rec, ["sessionDate"]) || "",
                          availability: ptAvailabilityOptions,
                          calendarEntries: ptCalendarEntries,
                          excludeSessionId: sessId,
                        }).filter((slot) => slot !== slotS);
                        const hasSameDayRescheduleOptions = sameDaySlotOptions.length > 0;
                        const rescheduleMessage = getPtRescheduleAvailabilityMessage({
                          session: rec,
                          hasUnlimitedReschedules: ptHasUnlimitedReschedules,
                          remainingReschedules: ptRemainingReschedules || 0,
                          hasSameDayRescheduleOptions,
                        });
                        const cancelMessage = getPtCancelAvailabilityMessage(rec);
                        const canReschedule = canReschedulePtSessionInTime(rec)
                          && (ptHasUnlimitedReschedules || (ptRemainingReschedules || 0) > 0)
                          && hasSameDayRescheduleOptions;
                        const canCancel = canCancelPtSessionInTime(rec);
                        return (
                          <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-3 py-2.5 text-white">{formatDateOnly(pickString(rec, ["sessionDate"]))}</td>
                            <td className="px-3 py-2.5 text-slate-300">{slotS}{slotE ? ` - ${slotE}` : ""}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge(sessStatus)}`}>
                                {sessStatus.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">{actualStart ? formatDateTime(actualStart) : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-300">{dur ? `${dur} min` : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-400">{startBy || "-"}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {["SCHEDULED", "UPCOMING", "PENDING"].includes(sessStatus) && sessId ? (
                                  <>
                                    {startAllowed ? (
                                      <button type="button" onClick={() => void handlePtSessionAction(sessId, "start")}
                                        className="rounded-lg bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/30">
                                        Start
                                      </button>
                                    ) : (
                                      <span className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400">
                                        Start in slot window
                                      </span>
                                    )}
                                    {canReschedule ? (
                                      <button type="button" onClick={() => void openPtRescheduleModal(rec)}
                                        className="rounded-lg bg-violet-500/20 px-2 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/30">
                                        Reschedule
                                      </button>
                                    ) : (
                                      <span className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400">
                                        {rescheduleMessage}
                                      </span>
                                    )}
                                    <button type="button" onClick={() => void handlePtSessionAction(sessId, "no-show")}
                                      className="rounded-lg bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30">
                                      No Show
                                    </button>
                                    {canCancel ? (
                                      <button type="button" onClick={() => void openPtCancelModal(rec)}
                                        className="rounded-lg bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-200 hover:bg-orange-500/30">
                                        Cancel
                                      </button>
                                    ) : (
                                      <button type="button" onClick={() => void handlePtSessionAction(sessId, "cancel")}
                                        className="rounded-lg bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-200 hover:bg-orange-500/30">
                                        Late Cancel
                                      </button>
                                    )}
                                    <div className="basis-full pt-1 text-[11px] text-slate-500">
                                      <span>{describePtHoursRemaining(rec)}.</span>{" "}
                                      <span>{cancelMessage}.</span>
                                    </div>
                                  </>
                                ) : sessStatus === "IN_PROGRESS" && sessId ? (
                                  <button type="button" onClick={() => void handlePtSessionAction(sessId, "end")}
                                    className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30">
                                    End Session
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ProfilePanel>
              </div>
            ) : activePtAssignment || hasPtCommercialMembership ? (
              <div ref={sessionRegisterRef}>
              <ProfilePanel title="Session Register" accent="slate">
                <p className="text-sm text-slate-400">
                  {activePtAssignment
                    ? "No due PT session is available yet. The next actionable session will appear here on the scheduled day and slot."
                    : hasAssignedTrainer
                      ? "PT is billed and a trainer is already linked. Sessions will appear here after the weekly slot schedule is configured."
                      : "PT is billed for this member, but sessions will appear here only after the trainer assignment and weekly slot schedule are configured."}
                </p>
              </ProfilePanel>
              </div>
            ) : null}

            {sessionHistoryRows.length > 0 ? (
              <ProfilePanel title="Session History" subtitle="Completed, cancelled, no-show, and previously scheduled PT sessions." accent="slate">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Slot</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionHistoryRows.map((rec, idx) => {
                        const sessStatus = (pickString(rec, ["status"]) || "SCHEDULED").toUpperCase();
                        const slotS = pickString(rec, ["slotStartTime", "sessionTime"]) || "";
                        const slotE = pickString(rec, ["slotEndTime"]) || "";
                        const actualStart = pickString(rec, ["actualStartTime"]) || "";
                        const dur = pickString(rec, ["durationMinutes"]) || "";
                        const startBy = pickString(rec, ["startedBy"]) || "";
                        return (
                          <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-3 py-2.5 text-white">{formatDateOnly(pickString(rec, ["sessionDate"]))}</td>
                            <td className="px-3 py-2.5 text-slate-300">{slotS}{slotE ? ` - ${slotE}` : ""}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge(sessStatus)}`}>
                                {sessStatus.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">{actualStart ? formatDateTime(actualStart) : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-300">{dur ? `${dur} min` : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-400">{startBy || "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ProfilePanel>
            ) : null}

            {/* Action buttons */}
            {canShowPtActions && !hasPtCommercialMembership ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openActionModal("pt")}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a71f23]"
                >
                  {activePtAssignment ? "Renew Personal Training" : "Assign Personal Training"}
                </button>
              </div>
            ) : null}
          </div>
        );
      }
      case "progress": {
        const data = tabData.progress;
        if (!data) return null;
        return (
          <div className="space-y-6">
            <ProfilePanel title="Progress Summary" accent="slate">
              <KeyValueGrid payload={data.summary} />
            </ProfilePanel>
            <ProfilePanel title="Measurements" accent="slate">
              <GenericTable items={data.measurements} emptyLabel="No measurements available." />
            </ProfilePanel>
            <ProfilePanel title="Photos" accent="slate">
              <GenericTable items={data.photos} emptyLabel="No progress photos available." />
            </ProfilePanel>
          </div>
        );
      }
      case "freeze-history":
        const freezeHistoryRows = (tabData["freeze-history"] || []).map((entry, index) => {
          const rawId = String(entry.freezeId || "").trim();
          const numericIdMatch = rawId.match(/\d+/);
          const displayFreezeId = numericIdMatch ? `Freeze ${numericIdMatch[0]}` : `Freeze ${index + 1}`;
          return {
            freezeId: displayFreezeId,
            freezeFrom: formatDateOnly(entry.freezeFrom || entry.startDate || entry.freeze_from),
            freezeTo: formatDateOnly(entry.freezeTo || entry.endDate || entry.freeze_to),
            days: entry.days ?? "-",
            reason: entry.reason || "-",
            status: titleize((entry.status || (entry.resumedAt ? "COMPLETED" : "ACTIVE")).toLowerCase()),
            resumedAt: entry.resumedAt ? formatDateTime(entry.resumedAt) : "",
            completion: entry.completionReason ? titleize(entry.completionReason.toLowerCase()) : "",
            restoredPauseDays: entry.restoredPauseDays ?? 0,
            requestedAt: formatDateTime(entry.requestedAt || entry.createdAt),
            approvedAt: formatDateTime(entry.approvedAt || entry.createdAt),
            createdAt: formatDateTime(entry.createdAt),
          };
        });
        const showResumedAtColumn = freezeHistoryRows.some((entry) => entry.resumedAt);
        const showCompletionColumn = freezeHistoryRows.some((entry) => entry.completion);
        const showRestoredColumn = freezeHistoryRows.some((entry) => Number(entry.restoredPauseDays) > 0);
        return (
          <ProfilePanel title="Freeze History" accent="slate">
            {freezeHistoryRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
                No freeze history found.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                      <th className="px-4 py-3">Freeze ID</th>
                      <th className="px-4 py-3">Freeze From</th>
                      <th className="px-4 py-3">Freeze To</th>
                      <th className="px-4 py-3">Days</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Status</th>
                      {showResumedAtColumn ? <th className="px-4 py-3">Resumed At</th> : null}
                      {showCompletionColumn ? <th className="px-4 py-3">Completion</th> : null}
                      {showRestoredColumn ? <th className="px-4 py-3">Restored Pause Days</th> : null}
                      <th className="px-4 py-3">Created At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {freezeHistoryRows.map((entry) => (
                      <tr key={`${entry.freezeId}-${entry.createdAt}`} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 text-slate-200">{entry.freezeId}</td>
                        <td className="px-4 py-3 text-slate-200">{entry.freezeFrom}</td>
                        <td className="px-4 py-3 text-slate-200">{entry.freezeTo}</td>
                        <td className="px-4 py-3 text-slate-200">{entry.days}</td>
                        <td className="px-4 py-3 text-slate-200">{entry.reason}</td>
                        <td className="px-4 py-3 text-slate-200">{entry.status}</td>
                        {showResumedAtColumn ? <td className="px-4 py-3 text-slate-200">{entry.resumedAt || "-"}</td> : null}
                        {showCompletionColumn ? <td className="px-4 py-3 text-slate-200">{entry.completion || "-"}</td> : null}
                        {showRestoredColumn ? <td className="px-4 py-3 text-slate-200">{entry.restoredPauseDays}</td> : null}
                        <td className="px-4 py-3 text-slate-200">{entry.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ProfilePanel>
        );
      case "notes": {
        const notes = tabData.notes;
        return (
          <div className="space-y-6">
            <ProfilePanel title="Enquiry Context" accent="slate">
              <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Enquiry Status", value: notes?.inquiryStatus || "-" },
                  { label: "Interested In", value: notes?.interestedIn || interestedIn },
                  { label: "Latest Follow-up Comment", value: notes?.latestFollowUpComment || "-" },
                  { label: "Source Enquiry", value: notes?.sourceInquiryId || (sourceInquiryId ? String(sourceInquiryId) : "-") },
                ].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                    <dd className="mt-2 text-sm font-medium text-white">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </ProfilePanel>

            <div className="grid gap-6 xl:grid-cols-2">
              <ProfilePanel title="Comments" accent="slate">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Notes</p>
                    <p className="mt-2 text-sm text-slate-200">{notes?.inquiryNotes || "No enquiry notes available."}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Remarks</p>
                    <p className="mt-2 text-sm text-slate-200">{notes?.inquiryRemarks || "No remarks available."}</p>
                  </div>
                </div>
              </ProfilePanel>

              <ProfilePanel title="Follow-up History" accent="slate">
                <GenericTable
                  items={(notes?.followUps || []).map((item) => ({
                    dueAt: formatDateTime(item.dueAt),
                    channel: item.channel || "-",
                    status: item.status || "-",
                    notes: item.notes || item.customMessage || "-",
                  }))}
                  emptyLabel="No follow-up history available."
                />
              </ProfilePanel>
            </div>
          </div>
        );
      }
      case "audit-trail": {
        const auditEntries = [...(tabData["audit-trail"] || []), ...lifecycleAuditEntries]
          .sort((left, right) => Date.parse(String(right.createdAt || "")) - Date.parse(String(left.createdAt || "")));
        return (
          <ProfilePanel title="Audit Trail" subtitle="Who changed what, when, and the key values involved." accent="slate">
            <GenericTable
              items={auditEntries.map((entry) => ({
                createdAt: formatDateTime(entry.createdAt),
                action: humanizeLabel(entry.action || "-"),
                actor: resolveAuditActorLabel(entry),
                summary: entry.summary || "-",
                details: formatAuditDetailsSummary(entry) || "-",
              }))}
              emptyLabel="No member audit entries available."
            />
          </ProfilePanel>
        );
      }
      case "fitness-assessment":
        return renderFitnessAssessment();
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-start">
        <button
          type="button"
          onClick={() => router.push("/portal/members")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To Members
        </button>
      </div>

      {shellError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{shellError}</div> : null}
      {actionSuccess ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionSuccess}
        </div>
      ) : null}
      {completedBilling ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#111821] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">
                  {completedBilling.context === "renewal"
                    ? "Renewal Completed"
                    : completedBilling.context === "upgrade"
                      ? "Upgrade Completed"
                      : completedBilling.context === "pt"
                        ? "PT Added"
                        : "Billing Completed"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{completedBilling.title}</h3>
                <p className="mt-2 text-sm text-slate-300">{completedBilling.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setCompletedBilling(null)}
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-slate-300 hover:bg-white/[0.08]"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Billing Records</p>
                <dl className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between gap-3"><dt>Invoice Number</dt><dd className="font-semibold text-white">{completedBilling.invoiceNumber}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Receipt Number</dt><dd className="font-semibold text-white">{completedBilling.receiptNumber || "-"}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Payment Status</dt><dd>{humanizeLabel(completedBilling.paymentStatus)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Total Paid</dt><dd>{formatRoundedInr(completedBilling.totalPaidAmount)}</dd></div>
                  <div className="flex items-center justify-between gap-3"><dt>Balance Due</dt><dd>{formatRoundedInr(completedBilling.balanceAmount)}</dd></div>
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
                        onClick={() => void viewDocumentPdf("invoice", completedBilling.invoiceId)}
                        disabled={documentBusyKey === `invoice-view-${completedBilling.invoiceId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="View Invoice"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadDocumentPdf("invoice", completedBilling.invoiceId, completedBilling.invoiceNumber)}
                        disabled={documentBusyKey === `invoice-download-${completedBilling.invoiceId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="Download Invoice"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void shareDocumentPdf("invoice", completedBilling.invoiceId, completedBilling.invoiceNumber, `Invoice ${completedBilling.invoiceNumber}`)}
                        disabled={documentBusyKey === `invoice-share-${completedBilling.invoiceId}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                        title="Share Invoice"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {completedBilling.receiptId ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <span className="text-sm font-semibold text-white">Receipt</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void viewDocumentPdf("receipt", completedBilling.receiptId!)}
                          disabled={documentBusyKey === `receipt-view-${completedBilling.receiptId}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                          title="View Receipt"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadDocumentPdf("receipt", completedBilling.receiptId!, completedBilling.receiptNumber || `receipt-${completedBilling.receiptId}`)}
                          disabled={documentBusyKey === `receipt-download-${completedBilling.receiptId}`}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
                          title="Download Receipt"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void shareDocumentPdf("receipt", completedBilling.receiptId!, completedBilling.receiptNumber || `receipt-${completedBilling.receiptId}`, `Receipt ${completedBilling.receiptNumber || completedBilling.receiptId}`)}
                          disabled={documentBusyKey === `receipt-share-${completedBilling.receiptId}`}
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

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCompletedBilling(null)}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loadingShell ? (
        <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading member profile...
        </div>
      ) : null}

      {!loadingShell && shell ? (
        <>
          <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[#0d1016] shadow-[0_28px_100px_rgba(0,0,0,0.42)]">
            <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(196,41,36,0.16),_transparent_32%),linear-gradient(135deg,#0d1016_0%,#151a23_52%,#0f1218_100%)] px-8 py-8">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-6">
                  <div className="flex h-28 w-28 items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.06] text-3xl font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    {initials(memberName) || "M"}
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-4xl font-semibold tracking-tight text-white">{memberName}</h1>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone(displayMembershipStatus)}`}>
                        {displayMembershipStatus}
                      </span>
                    </div>
                    <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                      Member Code: {memberCode}
                    </p>
                    <p className="text-sm text-slate-300">
                      Client Rep: <span className="font-medium text-white">{clientRepName}</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <StatPill label="Join Date" value={formatDateOnly(joinDate)} />
                      <StatPill label="Last Attendance" value={formatDateTime(lastAttendance || undefined)} />
                      <StatPill label="Total Visits" value={String(totalVisits || 0)} />
                      <StatPill label="Home Branch" value={branchLabel} />
                    </div>
                  </div>
                </div>

                <div className="xl:w-[360px]">
                  <div className="mb-3 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => openActionModal("edit-profile")}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/[0.08]"
                      aria-label="Edit member profile"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 text-cyan-300" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Membership</p>
                          <p className="mt-1 text-base font-semibold text-white">{visibleCurrentMembershipLabel}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <p className="text-sm text-slate-400">{visibleCurrentMembershipDuration}</p>
                            {visibleCurrentMembershipStatus === "Paused" || visibleCurrentMembershipStatus === "Frozen" ? (
                              <span className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-100">
                                {visibleCurrentMembershipStatus}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Wallet className="h-5 w-5 text-[#c42924]" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Credits</p>
                          <p className="mt-1 text-base font-semibold text-white">{creditsBalance}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-5 w-5 text-amber-300" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Payment Status</p>
                          <p className="mt-1 text-base font-semibold text-white">{humanizeLabel(paymentStatus)}</p>
                        </div>
                      </div>
                    </div>
                    {!isFlexPlan ? (
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                        <div className="flex items-center gap-3">
                          <UserRound className="h-5 w-5 text-slate-300" />
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{trainerLabel}</p>
                            <p className="mt-1 text-base font-semibold text-white">{assignedTrainer}</p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      activeTab === tab.key
                        ? "bg-[#c42924] text-white shadow-[0_10px_30px_rgba(196,41,36,0.22)]"
                        : "border border-white/8 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {supportLoading ? <p className="mt-3 text-xs text-slate-400">Loading action catalogs and lookup data…</p> : null}
            </div>
          </section>

          {renderTab()}

          <Modal
            open={actionModal === "edit-profile"}
            onClose={() => setActionModal(null)}
            title="Edit Member Profile"
            size="lg"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="rounded-xl border border-slate-700 bg-transparent px-4 py-2 text-sm font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleEditProfile()}
                  disabled={actionBusy}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionBusy ? "Saving..." : "Save Changes"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Full Name</span>
                  <input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Mobile Number</span>
                  <div className="flex overflow-hidden rounded-xl border border-slate-200">
                    <select
                      value={editForm.mobileCountryCode}
                      onChange={(event) => setEditForm((current) => ({ ...current, mobileCountryCode: event.target.value }))}
                      className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    >
                      <option value="+91">+91</option>
                    </select>
                    <input
                      value={editForm.mobileNumber}
                      onChange={(event) => setEditForm((current) => ({ ...current, mobileNumber: normalizeIndianMobile(event.target.value) }))}
                      className="w-full px-3 py-2"
                    />
                  </div>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Email</span>
                  <input value={editForm.email} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Alternate Mobile</span>
                  <input value={editForm.alternateMobileNumber} onChange={(event) => setEditForm((current) => ({ ...current, alternateMobileNumber: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Date Of Birth</span>
                  <input type="date" value={editForm.dateOfBirth} onChange={(event) => setEditForm((current) => ({ ...current, dateOfBirth: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Enquiry Date</span>
                  <input type="date" value={editForm.inquiryDate} onChange={(event) => setEditForm((current) => ({ ...current, inquiryDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Gender</span>
                  <input value={editForm.gender} onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Client Representative</span>
                  <select value={editForm.clientRepStaffId} onChange={(event) => setEditForm((current) => ({ ...current, clientRepStaffId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Client Rep</option>
                    {staffMembers.map((staff) => (
                      <option key={staff.id} value={staff.id}>{staff.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Address</span>
                  <textarea value={editForm.address} onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))} className="min-h-[96px] w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Name</span>
                  <input value={editForm.emergencyContactName} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactName: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Phone</span>
                  <input value={editForm.emergencyContactPhone} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Relation</span>
                  <input value={editForm.emergencyContactRelation} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactRelation: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Home Branch</span>
                  <select value={editForm.defaultBranchId} onChange={(event) => setEditForm((current) => ({ ...current, defaultBranchId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={String(branch.id)}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Default Trainer</span>
                  <select value={editForm.defaultTrainerStaffId} onChange={(event) => setEditForm((current) => ({ ...current, defaultTrainerStaffId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Trainer</option>
                    {coaches.map((coach) => (
                      <option key={coach.id} value={coach.id}>{coach.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "freeze"}
            onClose={() => setActionModal(null)}
            title="Freeze membership"
            size="md"
            closeOnOverlayClick={false}
            footer={
              <div className="flex w-full gap-3">
                <button type="button" onClick={() => setActionModal(null)} className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200">Cancel</button>
                <button type="button" onClick={() => void handleFreeze()} disabled={actionBusy} className="flex-[2] rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <span className="inline-flex items-center gap-2">
                    <Snowflake className="h-4 w-4" />
                    {actionBusy ? "Saving..." : "Activate Freeze"}
                  </span>
                </button>
              </div>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
                Freeze uses the remaining pause benefit balance on this membership. Billing stays unchanged, access pauses immediately, and the membership expiry extends by the approved freeze days.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Expiry</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{formatDateOnly(selectedExpiryDate) || "-"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Pause Benefit</p>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <p className="text-base font-semibold text-white">{freezeMaxDays} days</p>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">available</span>
                  </div>
                </div>
              </div>
              <div className="h-px bg-white/10" />
              <label className="block space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-200">Freeze Days</span>
                  <span className="text-xs text-slate-500">Min {freezeMinDays} · Max {freezeMaxDays}</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={freezeMinDays}
                    max={freezeMaxDays}
                    value={freezeForm.freezeDays}
                    onChange={(event) => setFreezeForm((current) => ({ ...current, freezeDays: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 pr-16 text-sm font-semibold text-white"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">days</span>
                </div>
                <input
                  type="range"
                  min={freezeMinDays}
                  max={Math.max(freezeMaxDays, freezeMinDays)}
                  step={1}
                  value={Math.min(Math.max(freezeDaysInput || freezeMinDays, freezeMinDays), Math.max(freezeMaxDays, freezeMinDays))}
                  onChange={(event) => setFreezeForm((current) => ({ ...current, freezeDays: event.target.value }))}
                  className="w-full accent-slate-400"
                />
              </label>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-slate-200">Reason <span className="font-normal text-slate-500">(optional)</span></span>
                <textarea
                  value={freezeForm.reason}
                  onChange={(event) => setFreezeForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="E.g. travel, injury, personal..."
                  className="min-h-[92px] w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-white placeholder:text-slate-500"
                />
              </label>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Freeze Preview</p>
                </div>
                <dl className="grid grid-cols-2">
                  {[
                    ["Freeze Start", formatDateOnly(freezePreviewStartDate) || "-"],
                    ["Freeze End", formatDateOnly(freezePreviewEndDate) || "-"],
                    ["New Expiry", formatDateOnly(freezePreviewExpiryDate) || "-"],
                    ["Balance After Freeze", `${freezePreviewRemainingDays} days`],
                  ].map(([label, value], index) => (
                    <div
                      key={label}
                      className={`px-4 py-3 ${index % 2 === 0 ? "border-r border-white/10" : ""} ${index < 2 ? "border-b border-white/10" : ""}`}
                    >
                      <dt className="text-[11px] text-slate-500">{label}</dt>
                      <dd className="mt-1 text-sm font-semibold text-white">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "unfreeze-billing"}
            onClose={() => setActionModal(null)}
            title={isAccountPausedForPayment ? "Collect Remaining Balance" : "Receive Balance Payment"}
            size="lg"
            footer={
              <div className="flex w-full gap-3">
                <button type="button" onClick={() => setActionModal(null)} className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleUnfreeze()}
                  disabled={actionBusy}
                  className="flex-[2] rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    {actionBusy ? "Recording Payment..." : isAccountPausedForPayment ? "Record Payment & Unfreeze" : "Record Balance Payment"}
                  </span>
                </button>
              </div>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
                {isAccountPausedForPayment
                  ? "This membership is paused because the invoice is only partially paid. Collect the remaining balance to activate the base membership and linked PT together."
                  : "This member has an outstanding invoice balance. Record the pending payment here to update the invoice and receipt registers."}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Invoice</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{selectedOutstandingInvoiceNumber || "-"}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Outstanding Balance</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{formatRoundedInr(selectedOutstandingInvoiceBalance)}</p>
                </div>
              </div>
              {outstandingBillingInvoices.length > 1 ? (
                <label className="block space-y-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Outstanding Invoice</span>
                  <select
                    value={resumeBillingForm.invoiceId}
                    onChange={(event) => setResumeBillingForm((current) => ({ ...current, invoiceId: event.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white"
                  >
                    {outstandingBillingInvoices.map((invoice) => (
                      <option key={invoice.id} value={String(invoice.id)}>
                        {invoice.invoiceNumber || `Invoice ${invoice.id}`} · {formatRoundedInr(roundAmount(invoice.balanceAmount || 0))}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Received Amount</p>
                  <p className="mt-1 text-base font-semibold text-white">{formatRoundedInr(selectedOutstandingInvoiceBalance)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Payment Mode</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "UPI", label: "UPI" },
                      { value: "CARD", label: "Card" },
                      { value: "CASH", label: "Cash" },
                    ].map((option) => {
                      const selected = resumeBillingForm.paymentMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setResumeBillingForm((current) => ({ ...current, paymentMode: option.value }))}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            selected
                              ? "border-[#c42924]/70 bg-[#c42924]/15 text-[#ffd6d4]"
                              : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {resumeBillingForm.paymentMode === "CARD" ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Card Type</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "DEBIT_CARD", label: "Debit Card" },
                        { value: "CREDIT_CARD", label: "Credit Card" },
                      ].map((option) => {
                        const selected = renewCardSubtype === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setRenewCardSubtype(option.value as "DEBIT_CARD" | "CREDIT_CARD")}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              selected
                                ? "border-[#c42924]/70 bg-[#c42924]/15 text-[#ffd6d4]"
                                : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "unfreeze"}
            onClose={() => setActionModal(null)}
            title="Resume membership"
            size="md"
            footer={
              <div className="flex w-full gap-3">
                <button type="button" onClick={() => setActionModal(null)} className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleUnfreeze()}
                  disabled={actionBusy}
                  className="flex-[2] rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    {actionBusy ? "Resuming..." : "Resume Membership"}
                  </span>
                </button>
              </div>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                Resume this freeze now. Base membership and linked PT access will be restored, biometric access will be unblocked, and any unused freeze days after the minimum freeze window will be credited back.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Membership</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{planName}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Expiry</p>
                  <p className="mt-1.5 text-base font-semibold text-white">{formatDateOnly(selectedExpiryDate) || "-"}</p>
                </div>
              </div>
            </div>
          </Modal>

          <Modal
            open={isRenewLifecycleModal || isUpgradeLifecycleModal}
            onClose={() => setActionModal(null)}
            title={isRenewLifecycleModal ? "Renew Membership" : "Upgrade Membership"}
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleSubscriptionAction((isRenewLifecycleModal ? "renew" : "upgrade") as "renew" | "upgrade")}
                  disabled={actionBusy}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionBusy ? "Processing..." : "Continue To Billing"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              {!isRenewLifecycleModal ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Upgrade applies the selected higher package or duration. The invoice is generated only for the difference between the existing sold membership value and the selected target plan. This membership can be upgraded only within {currentUpgradeWindowDays} days of the current cycle start.
                </div>
              ) : null}
              {isRenewLifecycleModal ? (
                <div className="overflow-hidden rounded-[30px] border border-[#c42924]/35 bg-[linear-gradient(135deg,rgba(196,41,36,0.18),rgba(196,41,36,0.06))]">
                  <div className="grid lg:grid-cols-[0.95fr_1.05fr]">
                    <div className="border-b border-white/8 px-6 py-6 lg:border-b-0 lg:border-r">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#ff8c86]">Operation Renewal</p>
                      <div className="mt-6 rounded-[24px] border border-white/10 bg-black/15 px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffc3c0]/75">Target Plan</p>
                        <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                          {selectedLifecycleVariant ? normalizeDisplayPlanName(selectedLifecycleVariant.variantName) : planName}
                        </p>
                        {selectedLifecycleFeatureList.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {selectedLifecycleFeatureList.map((feature) => (
                              <span
                                key={feature}
                                className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-medium tracking-[0.08em] text-[#ffe1df]"
                              >
                                {feature}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-[#ffd7d6]">
                            Continue the same package for the next membership cycle with updated commercial values before billing.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="px-6 py-6">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffc3c0]/75">Current Status</p>
                          <p className="mt-2 text-lg font-semibold text-white">{planName}</p>
                          <p className="mt-1 text-sm text-[#ffd7d6]">{planDuration}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffc3c0]/75">Valid From / To</p>
                          <p className="mt-2 text-sm font-medium text-white">
                            {formatDateOnly(selectedStartDate)} - {formatDateOnly(selectedExpiryDate)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-6 rounded-[24px] border border-white/10 bg-black/15 px-5 py-5">
                        <div className="space-y-4 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">Start Date</span>
                            <input
                              type="date"
                              value={lifecycleForm.startDate}
                              onChange={(event) => setLifecycleForm((current) => ({ ...current, startDate: event.target.value }))}
                              className="w-[210px] rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-right text-sm font-medium text-white outline-none transition focus:border-white/20"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">Expiry Date</span>
                            <span className="text-base font-semibold text-white">{formatDateOnly(projectedRenewalEndDate)}</span>
                          </div>
                          <div className="h-px bg-white/10" />
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">Standard Plan Price</span>
                            <span className="text-base font-semibold text-white">{formatRoundedInr(targetLifecycleBasePrice)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">Selling Price</span>
                            <input
                              value={lifecycleForm.sellingPrice}
                              onChange={(event) => {
                                const value = sanitizeIntegerString(event.target.value);
                                const parsed = value ? Number(value) : undefined;
                                const sellingPrice = parsed === undefined ? undefined : Math.min(Math.max(parsed, 0), targetLifecycleBasePrice || parsed);
                                setLifecycleForm((current) => ({
                                  ...current,
                                  sellingPrice: sellingPrice === undefined ? value : String(roundAmount(sellingPrice)),
                                  discountPercent:
                                    sellingPrice !== undefined && targetLifecycleBasePrice > 0
                                      ? formatDecimalInput(((targetLifecycleBasePrice - sellingPrice) / targetLifecycleBasePrice) * 100)
                                      : current.discountPercent,
                                }));
                              }}
                              className="w-[210px] border-0 bg-transparent p-0 text-right text-base font-semibold text-white outline-none"
                              inputMode="decimal"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">Discount</span>
                            <div className="flex items-center gap-3">
                              {Number(lifecycleForm.discountPercent || 0) > 0 ? (
                                <span className="rounded-full bg-[#c42924]/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ff8c86]">
                                  {Math.round(Number(lifecycleForm.discountPercent || 0))}% off
                                </span>
                              ) : null}
                              <input
                                value={lifecycleForm.discountPercent}
                                onChange={(event) => {
                                  const value = sanitizeNumericString(event.target.value);
                                  const parsed = value ? Math.min(100, Math.max(0, Number(value))) : undefined;
                                  setLifecycleForm((current) => ({
                                    ...current,
                                    discountPercent: value,
                                    sellingPrice:
                                      parsed === undefined
                                        ? current.sellingPrice
                                        : formatDecimalInput(targetLifecycleBasePrice * (1 - parsed / 100)),
                                  }));
                                }}
                                className="w-[90px] border-0 bg-transparent p-0 text-right text-base font-semibold text-white outline-none"
                                inputMode="decimal"
                                placeholder="0"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">CGST (Included)</span>
                            <span className="text-base font-medium text-white">{formatRoundedInr(renewHalfTaxAmount)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-[#ffd7d6]">SGST (Included)</span>
                            <span className="text-base font-medium text-white">{formatRoundedInr(renewHalfTaxAmount)}</span>
                          </div>
                          <div className="h-px bg-white/10" />
                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffc3c0]/75">Total Payable</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#ffb9b6]/70">All taxes inclusive</p>
                            </div>
                            <span className="text-3xl font-semibold text-white">{formatRoundedInr(renewInvoiceTotal)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5 rounded-[28px] border border-white/8 bg-[#111827] p-5 text-sm text-slate-200">
                  <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Membership</p>
                      <p className="mt-3 text-2xl font-semibold text-white">{currentLifecycleVariantTitle}</p>
                      <p className="mt-1 text-sm text-slate-300">{currentLifecycleDurationLabel || "Current active membership"}</p>
                      <div className="mt-4 grid gap-2">
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current Validity</p>
                          <p className="mt-1 text-sm font-medium text-white">
                            {formatDateOnly(selectedStartDate)} - {formatDateOnly(selectedExpiryDate)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Current Plan Price</p>
                          <p className="mt-1 text-sm font-medium text-white">{formatRoundedInr(currentLifecycleBasePrice)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Upgrade Window</p>
                          <p className="mt-1 text-sm font-medium text-white">
                            {upgradeWindowExceeded ? "Closed" : `${currentUpgradeWindowDays} Days`}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {singleUpgradeVariant ? (
                        <div className="rounded-[24px] border border-[#c42924]/25 bg-[#c42924]/10 p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#ffb9b6]">Upgraded Membership</p>
                          <div className="mt-3 flex items-start justify-between gap-4">
                            <div>
                              <p className="text-2xl font-semibold text-white">{sanitizeMembershipVariantTitle(singleUpgradeVariant.variantName || formatVariantDisplayLabel(singleUpgradeVariant))}</p>
                              <p className="mt-1 text-sm text-[#ffd7d6]">{formatPlanDuration(singleUpgradeVariant.durationMonths, singleUpgradeVariant.validityDays)}</p>
                            </div>
                            <p className="text-right text-lg font-semibold text-white">{formatRoundedInr(Number(singleUpgradeVariant.basePrice || 0))}</p>
                          </div>
                          <p className="mt-1 text-sm text-[#ffd7d6]">Only one valid upgrade path is available for this membership.</p>
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Target Category</p>
                              <p className="mt-1 text-sm font-medium text-white">{humanizeLabel(singleUpgradeVariant.categoryCode)}</p>
                            </div>
                            <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Target Validity</p>
                              <p className="mt-1 text-sm font-medium text-white">{formatPlanDuration(singleUpgradeVariant.durationMonths, singleUpgradeVariant.validityDays)}</p>
                            </div>
                          </div>
                        </div>
                      ) : lifecycleCategoryOptions.length > 1 ? (
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Category</p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {lifecycleCategoryOptions.map((category) => {
                              const selected = lifecycleForm.categoryCode === category;
                              return (
                                <button
                                  key={category}
                                  type="button"
                                  onClick={() =>
                                    setLifecycleForm((current) => ({
                                      ...current,
                                      categoryCode: category,
                                      productCode: "",
                                      productVariantId: "",
                                      sellingPrice: "",
                                      discountPercent: "",
                                    }))
                                  }
                                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                                    selected
                                      ? "border-[#c42924]/70 bg-[#c42924]/12 text-white"
                                      : "border-white/8 bg-white/[0.03] text-slate-200 hover:border-white/15"
                                  }`}
                                >
                                  <p className="text-base font-semibold">{humanizeLabel(category)}</p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {category === "FLAGSHIP"
                                      ? "Move into a premium flagship membership."
                                      : category === "FLEX"
                                        ? "Continue within flex with a stronger duration."
                                        : "Choose the target membership family."}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {!singleUpgradeVariant && filteredLifecycleProducts.length ? (
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Product</p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {filteredLifecycleProducts.map((product) => {
                              const selected = lifecycleForm.productCode === product.productCode;
                              return (
                                <button
                                  key={product.productId}
                                  type="button"
                                  onClick={() =>
                                    setLifecycleForm((current) => ({
                                      ...current,
                                      productCode: product.productCode,
                                      productVariantId: "",
                                      sellingPrice: "",
                                      discountPercent: "",
                                    }))
                                  }
                                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                                    selected
                                      ? "border-[#c42924]/70 bg-[#c42924]/12 text-white"
                                      : "border-white/8 bg-white/[0.03] text-slate-200 hover:border-white/15"
                                  }`}
                                >
                                  <p className="text-base font-semibold text-white">{product.productName}</p>
                                  <p className="mt-1 text-xs text-slate-400">{humanizeLabel(product.categoryCode)}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {!singleUpgradeVariant ? (
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Variant</p>
                        {filteredLifecycleVariants.length ? (
                          <div className="grid gap-3">
                            {filteredLifecycleVariants.map((variant) => {
                              const selected = String(variant.variantId) === String(lifecycleForm.productVariantId);
                              return (
                                <button
                                  key={variant.variantId}
                                  type="button"
                                  onClick={() =>
                                    setLifecycleForm((current) => ({
                                      ...current,
                                      productVariantId: String(variant.variantId),
                                      sellingPrice: String(roundAmount(Math.max(Number(variant.basePrice || 0) - currentLifecycleBasePrice, 0))),
                                      discountPercent: "",
                                    }))
                                  }
                                  className={`rounded-[24px] border px-4 py-4 text-left transition ${
                                    selected
                                      ? "border-[#c42924]/70 bg-[#c42924]/12 text-white"
                                      : "border-white/8 bg-white/[0.03] text-slate-200 hover:border-white/15"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-base font-semibold text-white">{sanitizeMembershipVariantTitle(variant.variantName || formatVariantDisplayLabel(variant))}</p>
                                      <p className="mt-1 text-xs text-slate-400">{formatPlanDuration(variant.durationMonths, variant.validityDays)}</p>
                                    </div>
                                    <p className="text-right text-lg font-semibold text-white">{formatRoundedInr(Number(variant.basePrice || 0))}</p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-slate-400">
                            Select the upgrade path above to see eligible target variants.
                          </div>
                        )}
                      </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_340px]">
                    <div className="rounded-[24px] border border-white/8 bg-black/10 p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Updated Commercials</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {selectedLifecycleVariant ? selectedLifecycleVariantTitle : "Select a target variant"}
                      </p>
                      {selectedLifecycleVariant ? (
                        <p className="mt-1 text-sm text-slate-300">{selectedLifecycleDurationLabel}</p>
                      ) : null}
                      {selectedLifecycleFeatureList.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {selectedLifecycleFeatureList.slice(0, 5).map((feature) => (
                            <span key={feature} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200">
                              {feature}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Start Date</span>
                          <input
                            type="date"
                            value={lifecycleForm.startDate}
                            onChange={(event) => setLifecycleForm((current) => ({ ...current, startDate: event.target.value }))}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                          />
                        </label>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Projected End Date</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatDateOnly(projectedRenewalEndDate)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Target Plan Price</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatRoundedInr(targetLifecycleBasePrice)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Reference Upgrade Difference</p>
                          <p className="mt-2 text-sm font-semibold text-white">{formatRoundedInr(upgradeBaseDifference)}</p>
                        </div>
                        <label className="space-y-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selling Price</span>
                          <input
                            value={lifecycleForm.sellingPrice}
                            onChange={(event) => {
                              const value = sanitizeIntegerString(event.target.value);
                              const parsed = value ? Number(value) : undefined;
                              const sellingPrice = parsed === undefined ? undefined : Math.min(Math.max(parsed, 0), upgradeBaseDifference || parsed);
                              setLifecycleForm((current) => ({
                                ...current,
                                sellingPrice: sellingPrice === undefined ? value : String(roundAmount(sellingPrice)),
                                discountPercent:
                                  sellingPrice !== undefined && upgradeBaseDifference > 0
                                    ? formatDecimalInput(((upgradeBaseDifference - sellingPrice) / upgradeBaseDifference) * 100)
                                    : current.discountPercent,
                              }));
                            }}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                            inputMode="numeric"
                            placeholder="Enter selling price"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Discount %</span>
                          <input
                            value={lifecycleForm.discountPercent}
                            onChange={(event) => {
                              const value = sanitizeNumericString(event.target.value);
                              const parsed = value ? Math.min(100, Math.max(0, Number(value))) : undefined;
                              setLifecycleForm((current) => ({
                                ...current,
                                discountPercent: value,
                                sellingPrice:
                                  parsed === undefined
                                    ? current.sellingPrice
                                    : formatDecimalInput(upgradeBaseDifference * (1 - parsed / 100)),
                              }));
                            }}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                            inputMode="decimal"
                            placeholder="0"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/8 bg-black/10 p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Upgrade Summary</p>
                      <div className="mt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Current Plan Price</span>
                          <span className="font-semibold text-white">{formatRoundedInr(currentLifecycleBasePrice)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Target Plan Price</span>
                          <span className="font-semibold text-white">{formatRoundedInr(targetLifecycleBasePrice)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Upgrade Difference</span>
                          <span className="font-semibold text-white">{formatRoundedInr(upgradeCommercial.baseAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Selling Price</span>
                          <span className="font-semibold text-white">{formatRoundedInr(upgradeCommercial.sellingPrice)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Discount</span>
                          <span className="font-semibold text-white">{formatRoundedInr(upgradeCommercial.discountAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">CGST</span>
                          <span className="font-semibold text-white">{formatRoundedInr(upgradeHalfTaxAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">SGST</span>
                          <span className="font-semibold text-white">{formatRoundedInr(upgradeHalfTaxAmount)}</span>
                        </div>
                        <div className="border-t border-white/10 pt-3">
                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Total Payable</p>
                              <p className="mt-1 text-xs text-slate-500">Upgrade billing is collected on the difference only.</p>
                            </div>
                            <span className="text-3xl font-semibold text-white">{formatRoundedInr(upgradeInvoiceTotal)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <label className="space-y-2 text-sm">
                    <span className="font-medium text-slate-300">Notes</span>
                    <textarea value={lifecycleForm.notes} onChange={(event) => setLifecycleForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-white" />
                  </label>
                </div>
              )}
            </div>
          </Modal>

          <Modal
            open={isLifecycleBillingModal}
            onClose={() => setActionModal(null)}
            title={isUpgradeBillingModal ? "Upgrade Billing" : "Renewal Billing"}
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(isUpgradeBillingModal ? "upgrade" : "renew")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Back</button>
                <button type="button" onClick={() => void (isUpgradeBillingModal ? handleUpgradePayment() : handleRenewPayment())} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Create Invoice & Record Payment"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <BillingWorkflowTemplate
                infoRows={[
                  { label: "Invoice Number", value: "Generated on submit" },
                  { label: "Invoice Date", value: currentPreviewDate },
                  {
                    label: isUpgradeBillingModal ? "Target Membership" : "Membership",
                    value: (
                      <div>
                        <div>{selectedLifecycleVariant ? selectedLifecycleVariantTitle : currentLifecycleVariantTitle}</div>
                        <div className="mt-1 text-xs text-slate-400">{selectedLifecycleVariant ? selectedLifecycleDurationLabel : currentLifecycleDurationLabel}</div>
                      </div>
                    ),
                  },
                  { label: "Invoice Status", value: lifecycleBillingPreviewStatus },
                  { label: "Start Date", value: formatDateOnly(lifecycleForm.startDate) },
                  { label: "End Date", value: formatDateOnly(projectedRenewalEndDate) },
                  { label: "Membership Duration", value: selectedLifecycleVariant ? selectedLifecycleDurationLabel : currentLifecycleDurationLabel },
                  { label: "Billing Representative", value: user?.name || "-", fullWidth: true },
                ]}
                lineItems={[
                  {
                    label: isUpgradeBillingModal
                      ? `Upgrade to ${selectedLifecycleVariant ? selectedLifecycleVariantTitle : currentLifecycleVariantTitle}`
                      : selectedLifecycleVariant ? selectedLifecycleVariantTitle : currentLifecycleVariantTitle,
                    subtitle: selectedLifecycleVariant ? selectedLifecycleDurationLabel : currentLifecycleDurationLabel,
                    baseAmount: formatRoundedInr(lifecycleBillingBaseAmount),
                    sellingPrice: formatRoundedInr(lifecycleBillingSellingPrice),
                    discount: formatRoundedInr(lifecycleBillingDiscountAmount),
                  },
                ]}
                totalLabel={isUpgradeBillingModal ? "Total Upgrade Value" : "Total Plan Price"}
                totalBaseAmount={formatRoundedInr(lifecycleBillingBaseAmount)}
                totalSellingPrice={formatRoundedInr(lifecycleBillingSellingPrice)}
                totalDiscount={formatRoundedInr(lifecycleBillingDiscountAmount)}
                finalPayable={formatRoundedInr(lifecycleBillingInvoiceTotal)}
                taxRows={[
                  { label: `CGST @ ${commercialTaxRate / 2}%`, value: formatRoundedInr(lifecycleBillingHalfTaxAmount) },
                  { label: `SGST @ ${commercialTaxRate / 2}%`, value: formatRoundedInr(lifecycleBillingHalfTaxAmount) },
                ]}
                receivedAmount={lifecycleBillingForm.receivedAmount}
                onReceivedAmountChange={(value) => setLifecycleBillingForm((current) => ({ ...current, receivedAmount: sanitizeIntegerString(value) }))}
                paymentMode={lifecycleBillingForm.paymentMode}
                paymentModeOptions={String(billingSettings?.paymentModesEnabled || "UPI,CARD,CASH")
                  .split(",")
                  .map((mode) => mode.trim())
                  .filter((mode) => ["UPI", "CARD", "CASH"].includes(mode.toUpperCase()))
                  .map((mode) => ({ value: mode, label: humanizeLabel(mode) }))}
                onPaymentModeChange={(value) => setLifecycleBillingForm((current) => ({ ...current, paymentMode: value }))}
                secondaryModeLabel={lifecycleBillingForm.paymentMode === "CARD" ? "Card Type" : lifecycleBillingForm.paymentMode === "UPI" ? "UPI App" : undefined}
                secondaryModeValue={lifecycleBillingForm.paymentMode === "CARD" ? renewCardSubtype : lifecycleUpiVendor}
                secondaryModeOptions={
                  lifecycleBillingForm.paymentMode === "CARD"
                    ? PAYMENT_CARD_OPTIONS
                    : lifecycleBillingForm.paymentMode === "UPI"
                      ? PAYMENT_UPI_OPTIONS
                    : []
                }
                onSecondaryModeChange={(value) => {
                  if (lifecycleBillingForm.paymentMode === "CARD") {
                    setRenewCardSubtype(value as "DEBIT_CARD" | "CREDIT_CARD");
                    return;
                  }
                  setLifecycleUpiVendor(value as "GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER");
                }}
                showBalanceDueDate={Number(lifecycleBillingForm.receivedAmount || 0) < lifecycleBillingInvoiceTotal}
                balanceDueDate={lifecycleBillingForm.balanceDueDate}
                onBalanceDueDateChange={(value) => setLifecycleBillingForm((current) => ({ ...current, balanceDueDate: value }))}
                receiptRows={[
                  { label: "Receipt Number", value: "Generated after payment" },
                  { label: "Receipt Date", value: currentPreviewDate },
                  { label: "Payment Method", value: resolveBillingPaymentModeLabel(lifecycleBillingForm.paymentMode, renewCardSubtype, lifecycleUpiVendor) },
                  { label: "Payment Status", value: lifecycleBillingPreviewStatus },
                  { label: "Total Paid", value: formatRoundedInr(lifecycleBillingReceivedAmount) },
                  { label: "Balance Due", value: formatRoundedInr(lifecycleBillingBalanceAmount), fullWidth: true },
                ]}
              />
            </div>
          </Modal>

          <Modal
            open={actionModal === "transfer"}
            onClose={() => setActionModal(null)}
            title="Transfer Membership"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleTransfer()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Transferring..." : "Transfer"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Transfer is available only for eligible flagship memberships, and only to Admin or Gym Manager users. This action updates operational ownership only right now, without transfer billing.
              </div>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Target Enquiry</span>
                  <select value={transferForm.targetMemberId} onChange={(event) => setTransferForm((current) => ({ ...current, targetMemberId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Enquiry</option>
                    {transferInquiryOptions.map((item) => (
                      <option key={item.inquiryId} value={String(item.memberId)}>
                        {item.fullName} · {item.mobileNumber} · Inquiry #{item.inquiryId}
                      </option>
                    ))}
                  </select>
                </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Start Date</span>
                <input type="date" value={transferForm.startDate} onChange={(event) => setTransferForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={transferForm.deactivateSource} onChange={(event) => setTransferForm((current) => ({ ...current, deactivateSource: event.target.checked }))} />
                Deactivate source membership
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={transferForm.copyUsage} onChange={(event) => setTransferForm((current) => ({ ...current, copyUsage: event.target.checked }))} />
                Copy usage history
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea value={transferForm.notes} onChange={(event) => setTransferForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "pt"}
            onClose={() => setActionModal(null)}
            title="Add Personal Training"
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => handlePtBillingContinue()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  Continue to Billing
                </button>
              </>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_340px]">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-[#111827] p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Package</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Product</span>
                        <select
                          value={ptForm.productCode}
                          onChange={(event) => setPtForm((current) => ({ ...current, productCode: event.target.value, productVariantId: "", totalSessions: "", sellingPrice: "", discountPercent: "" }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          <option value="">Select Product</option>
                          {ptProducts.map((product) => (
                            <option key={product.productId} value={product.productCode}>{formatPtProductName(product.productName)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Variant</span>
                        <select
                          value={ptForm.productVariantId}
                          onChange={(event) => {
                            const nextVariant = selectablePtVariants.find((variant) => String(variant.variantId) === String(event.target.value));
                            setPtForm((current) => ({
                              ...current,
                              productVariantId: event.target.value,
                              totalSessions: nextVariant ? String(nextVariant.includedPtSessions || 0) : "",
                              sellingPrice: "",
                              discountPercent: "",
                            }));
                          }}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          <option value="">Select Variant</option>
                          {selectablePtVariants.map((variant) => (
                            <option key={variant.variantId} value={variant.variantId}>
                              {sanitizeMembershipVariantTitle(variant.variantName)} · {formatPlanDuration(variant.durationMonths, variant.validityDays)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Coach</span>
                        <select
                          value={ptForm.coachId}
                          onChange={(event) => setPtForm((current) => ({ ...current, coachId: event.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          <option value="">Select Coach</option>
                          {ptEligibleCoaches.map((coach) => (
                            <option key={coach.id} value={coach.id}>{coach.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Start Date</span>
                        <input
                          type="date"
                          value={ptForm.startDate}
                          onChange={(event) => setPtForm((current) => ({ ...current, startDate: event.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        />
                      </label>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <label className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Total Sessions</span>
                        <input
                          value={ptForm.totalSessions}
                          onChange={(event) => setPtForm((current) => ({ ...current, totalSessions: sanitizeIntegerString(event.target.value) }))}
                          className="mt-2 w-full bg-transparent text-lg font-semibold text-white outline-none"
                          inputMode="numeric"
                          placeholder="0"
                        />
                      </label>
                      <StatPill
                        label="Reschedules"
                        value={
                          selectedPtVariant
                            ? hasUnlimitedPtReschedules
                              ? "Unlimited"
                              : String(derivePtRescheduleLimit(selectedPtVariant.durationMonths, false))
                            : "-"
                        }
                      />
                      <StatPill label="Projected End" value={formatDateOnly(projectedPtEndDate) || "-"} />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#111827] p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Schedule</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Template</span>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { value: "EVERYDAY", label: "Everyday" },
                            { value: "ALTERNATE_DAYS", label: "Alternate Days" },
                          ].map((option) => {
                            const selected = ptForm.scheduleTemplate === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setPtForm((current) => ({ ...current, scheduleTemplate: option.value as PtScheduleTemplate }))}
                                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                  selected
                                    ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                                    : "border-white/10 bg-[#0f141d] text-slate-300 hover:border-white/20"
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Slot</span>
                        <select
                          value={ptForm.slotStartTime}
                          onChange={(event) => setPtForm((current) => ({ ...current, slotStartTime: event.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          {ptTimeSlotOptions.map((slot) => (
                            <option key={slot} value={slot}>{formatClockTime(slot)} - {formatClockTime(addMinutesToTime(slot, PT_SLOT_DURATION_MINUTES))}</option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500">Session duration is fixed at 1 hour.</p>
                      </label>
                    </div>
                    <div className="mt-4 space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Weekdays</span>
                      <div className="flex flex-wrap gap-2">
                        {PT_WEEKDAY_OPTIONS.map((day) => {
                          const locked = ptForm.scheduleTemplate === "EVERYDAY";
                          const selected = selectedPtDays.includes(day.code);
                          return (
                            <button
                              key={day.code}
                              type="button"
                              disabled={locked}
                              onClick={() =>
                                setPtForm((current) => {
                                  const exists = current.scheduleDays.includes(day.code);
                                  const nextDays = exists
                                    ? current.scheduleDays.filter((code) => code !== day.code)
                                    : [...current.scheduleDays, day.code];
                                  return { ...current, scheduleDays: nextDays };
                                })
                              }
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                                selected
                                  ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                                  : "border-white/10 bg-[#0f141d] text-slate-400 hover:border-white/20"
                              } ${locked ? "cursor-default opacity-80" : ""}`}
                            >
                              {day.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-slate-500">
                        {ptForm.scheduleTemplate === "EVERYDAY"
                          ? "Everyday PT uses Monday to Saturday."
                          : "Choose the recurring PT days for this member."}
                      </p>
                    </div>
                    <div className="mt-4 rounded-xl border border-white/8 bg-[#0f141d] px-4 py-3 text-sm text-slate-300">
                      Session window: <span className="font-semibold text-white">{formatClockTime(ptForm.slotStartTime)}</span> to <span className="font-semibold text-white">{formatClockTime(ptSlotEndTime)}</span>
                      <span className="mx-2 text-slate-500">•</span>
                      Days: <span className="font-semibold text-white">{selectedPtDays.map((day) => formatPtDayLabel(day)).join(", ") || "-"}</span>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#111827] p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Commercials</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-white/8 bg-[#0f141d] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Base Price</p>
                        <p className="mt-2 text-lg font-semibold text-white">{formatRoundedInr(Number(selectedPtVariant?.basePrice || 0))}</p>
                      </div>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selling Price</span>
                        <input
                          value={ptForm.sellingPrice}
                          onChange={(event) => {
                            const value = sanitizeIntegerString(event.target.value);
                            const parsed = value ? Number(value) : undefined;
                            const basePrice = Number(selectedPtVariant?.basePrice || 0);
                            const sellingPrice = parsed === undefined ? undefined : Math.min(Math.max(parsed, 0), basePrice || parsed);
                            setPtForm((current) => ({
                              ...current,
                              sellingPrice: sellingPrice === undefined ? value : String(roundAmount(sellingPrice)),
                              discountPercent:
                                sellingPrice !== undefined && basePrice > 0
                                  ? formatDecimalInput(((basePrice - sellingPrice) / basePrice) * 100)
                                  : current.discountPercent,
                            }));
                          }}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                          inputMode="numeric"
                          placeholder="Enter PT selling price"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Discount %</span>
                        <input
                          value={ptForm.discountPercent}
                          onChange={(event) => {
                            const value = sanitizeNumericString(event.target.value);
                            const parsed = value ? Math.min(100, Math.max(0, Number(value))) : undefined;
                            const basePrice = Number(selectedPtVariant?.basePrice || 0);
                            setPtForm((current) => ({
                              ...current,
                              discountPercent: value,
                              sellingPrice:
                                parsed === undefined
                                  ? current.sellingPrice
                                  : String(roundAmount(basePrice * (1 - parsed / 100))),
                            }));
                          }}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </label>
                      <div className="rounded-xl border border-white/8 bg-[#0f141d] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">GST (Included)</p>
                        <p className="mt-2 text-lg font-semibold text-white">{formatRoundedInr(ptTaxAmount)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-black/10 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Summary</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {selectedPtVariant ? formatPtProductName(selectedPtProduct?.productName || selectedPtVariant.productCode) : "Select a package"}
                  </p>
                  {selectedPtVariant ? (
                    <p className="mt-1 text-sm text-slate-300">{formatPlanDuration(selectedPtVariant.durationMonths, selectedPtVariant.validityDays)}</p>
                  ) : null}
                  <div className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Coach</span>
                      <span className="font-semibold text-white">{selectedPtCoach?.name || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Sessions</span>
                      <span className="font-semibold text-white">{selectedPtSessionCount > 0 ? String(selectedPtSessionCount) : "-"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Reschedule Limit</span>
                      <span className="font-semibold text-white">
                        {selectedPtVariant
                          ? hasUnlimitedPtReschedules
                            ? "Unlimited"
                            : String(derivePtRescheduleLimit(selectedPtVariant.durationMonths, false))
                          : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Schedule</span>
                      <span className="font-semibold text-white">{ptForm.scheduleTemplate === "EVERYDAY" ? "Everyday" : "Alternate Days"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Window</span>
                      <span className="font-semibold text-white">{formatClockTime(ptForm.slotStartTime)} - {formatClockTime(ptSlotEndTime)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Selling Price</span>
                      <span className="font-semibold text-white">{formatRoundedInr(ptCommercial.sellingPrice)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Discount</span>
                      <span className="font-semibold text-white">{formatRoundedInr(ptCommercial.discountAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">CGST</span>
                      <span className="font-semibold text-white">{formatRoundedInr(ptHalfTaxAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">SGST</span>
                      <span className="font-semibold text-white">{formatRoundedInr(ptHalfTaxAmount)}</span>
                    </div>
                    <div className="border-t border-white/10 pt-3">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Total Payable</p>
                          <p className="mt-1 text-xs text-slate-500">PT is billed as an add-on to the current gym membership.</p>
                        </div>
                        <span className="text-3xl font-semibold text-white">{formatRoundedInr(ptInvoiceTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "pt-session-count"}
            onClose={() => setActionModal(null)}
            title="Edit Total PT Sessions"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleUpdatePtSessionCount()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Update Sessions"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm text-slate-300">
                  Update the member&apos;s total PT entitlement. This cannot be lower than the sessions already consumed.
                </p>
                <label className="mt-4 block space-y-2">
                  <span className="text-xs font-medium text-slate-300">Total PT Sessions</span>
                  <input
                    value={ptSessionCountForm.totalSessions}
                    onChange={(event) => setPtSessionCountForm((current) => ({ ...current, totalSessions: sanitizeIntegerString(event.target.value) }))}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                    inputMode="numeric"
                    placeholder="0"
                  />
                </label>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "pt-reschedule"}
            onClose={() => setActionModal(null)}
            title="Reschedule PT Session"
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handlePtReschedule()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Reschedule Session"}
                </button>
              </>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current Slot</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-slate-500">Date</p>
                        <p className="mt-1 text-sm font-semibold text-white">{formatDateOnly(ptRescheduleForm.currentDate) || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Time</p>
                        <p className="mt-1 text-sm font-semibold text-white">{ptRescheduleForm.currentTime ? formatClockTime(ptRescheduleForm.currentTime) : "-"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">New Slot</p>
                    <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-3 text-xs text-violet-100">
                      Same-day only. This option stays open until {PT_RESCHEDULE_CUTOFF_HOURS} hours before the original session.
                    </div>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-medium text-slate-300">Reschedule Date</span>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-white">
                          {formatDateOnly(ptRescheduleForm.newDate) || "-"}
                        </div>
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-medium text-slate-300">Same-Day Time</span>
                        <select
                          value={ptRescheduleForm.newTime}
                          onChange={(event) => setPtRescheduleForm((current) => ({ ...current, newTime: event.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          <option value="">Select same-day slot</option>
                          {ptRescheduleSlotOptions.map((slot) => (
                            <option key={slot} value={slot}>
                              {formatClockTime(slot)} - {formatClockTime(addMinutesToTime(slot, PT_SLOT_DURATION_MINUTES))}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      Reschedule only shifts this session to another slot on the same day. If no same-day slot is free, use cancel to move it into a future make-up slot.
                    </p>
                    <label className="mt-4 block space-y-2">
                      <span className="text-xs font-medium text-slate-300">Reason</span>
                      <textarea
                        value={ptRescheduleForm.reason}
                        onChange={(event) => setPtRescheduleForm((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Reason for rescheduling"
                        className="min-h-[88px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white placeholder:text-slate-500"
                      />
                    </label>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Same-Day Availability</p>
                    <div className="mt-3 space-y-2">
                      {ptRescheduleSlotOptions.length > 0 ? ptRescheduleSlotOptions.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setPtRescheduleForm((current) => ({ ...current, newTime: slot }))}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                            ptRescheduleForm.newTime === slot
                              ? "border-violet-400/40 bg-violet-500/10 text-violet-100"
                              : "border-white/8 bg-white/[0.03] text-slate-300"
                          }`}
                        >
                          <span>Same day</span>
                          <span className="font-semibold">
                            {formatClockTime(slot)} - {formatClockTime(addMinutesToTime(slot, PT_SLOT_DURATION_MINUTES))}
                          </span>
                        </button>
                      )) : (
                        <p className="text-sm text-slate-400">No same-day slot is free for this trainer. Use cancel to assign a future make-up slot.</p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Coach Calendar Snapshot</p>
                    <div className="mt-3 space-y-2">
                      {ptCalendarEntries.length > 0 ? ptCalendarEntries.slice(0, 8).map((entry, index) => {
                        const record = toRecord(entry);
                        const status = (pickString(record, ["status"]) || "SCHEDULED").replaceAll("_", " ");
                        return (
                          <div key={index} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-white">{formatDateOnly(pickString(record, ["sessionDate"])) || "-"}</span>
                              <span className="text-xs text-slate-400">{status}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">{formatClockTime(pickString(record, ["sessionTime", "slotStartTime"]) || "")}</p>
                          </div>
                        );
                      }) : (
                        <p className="text-sm text-slate-400">No booked PT sessions found for this coach.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "pt-cancel"}
            onClose={() => setActionModal(null)}
            title="Cancel PT Session And Assign Make-Up Slot"
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Back</button>
                <button type="button" onClick={() => void handlePtCancelWithMakeup()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Cancel And Rebook"}
                </button>
              </>
            }
          >
            <div className="space-y-5">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Cancelled Slot</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-slate-500">Original Date</p>
                        <p className="mt-1 text-sm font-semibold text-white">{formatDateOnly(ptCancelForm.currentDate) || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Original Time</p>
                        <p className="mt-1 text-sm font-semibold text-white">{ptCancelForm.currentTime ? formatClockTime(ptCancelForm.currentTime) : "-"}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Future Make-Up Slot</p>
                    <div className="mt-3 rounded-xl border border-orange-400/20 bg-orange-500/10 px-3 py-3 text-xs text-orange-100">
                      Valid cancellation keeps the member session available. Rebook the replacement slot within the current PT validity only.
                    </div>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-medium text-slate-300">New Date</span>
                        <input
                          type="date"
                          min={addDaysToLocalIsoDate(ptCancelForm.currentDate, 1)}
                          max={ptCancelForm.maxDate}
                          value={ptCancelForm.newDate}
                          onChange={(event) => setPtCancelForm((current) => ({ ...current, newDate: event.target.value, newTime: "" }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-medium text-slate-300">Available Time</span>
                        <select
                          value={ptCancelForm.newTime}
                          onChange={(event) => setPtCancelForm((current) => ({ ...current, newTime: event.target.value }))}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                        >
                          <option value="">Select make-up slot</option>
                          {ptCancelSlotOptions.map((slot) => (
                            <option key={slot} value={slot}>
                              {formatClockTime(slot)} - {formatClockTime(addMinutesToTime(slot, PT_SLOT_DURATION_MINUTES))}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      Cancel closes {PT_CANCEL_CUTOFF_HOURS} hours before the slot. Late cancellation is treated as consumed and should use the register action instead.
                    </p>
                    <label className="mt-4 block space-y-2">
                      <span className="text-xs font-medium text-slate-300">Reason</span>
                      <textarea
                        value={ptCancelForm.reason}
                        onChange={(event) => setPtCancelForm((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Reason for cancellation / make-up request"
                        className="min-h-[88px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white placeholder:text-slate-500"
                      />
                    </label>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Next 7 Days Of Available Slots</p>
                    <div className="mt-3 space-y-2">
                      {ptCancelDateSummaries.length > 0 ? ptCancelDateSummaries.map((entry) => (
                        <button
                          key={entry.date}
                          type="button"
                          onClick={() => setPtCancelForm((current) => ({ ...current, newDate: entry.date, newTime: entry.slots[0] || "" }))}
                          className={`w-full rounded-xl border px-3 py-3 text-left ${
                            ptCancelForm.newDate === entry.date
                              ? "border-orange-400/40 bg-orange-500/10"
                              : "border-white/8 bg-white/[0.03]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-white">{formatDateOnly(entry.date) || entry.date}</span>
                            <span className="text-xs text-slate-400">
                              {entry.slots.length > 0 ? `${entry.slots.length} slot${entry.slots.length > 1 ? "s" : ""}` : "No free slots"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">
                            {entry.slots.length > 0
                              ? entry.slots.slice(0, 3).map((slot) => formatClockTime(slot)).join(" · ")
                              : "Trainer is unavailable or fully booked"}
                          </p>
                        </button>
                      )) : (
                        <p className="text-sm text-slate-400">No future slots are available inside the current PT validity window.</p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Coach Calendar Snapshot</p>
                    <div className="mt-3 space-y-2">
                      {ptCalendarEntries.length > 0 ? ptCalendarEntries.slice(0, 8).map((entry, index) => {
                        const record = toRecord(entry);
                        const status = (pickString(record, ["status"]) || "SCHEDULED").replaceAll("_", " ");
                        return (
                          <div key={index} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-white">{formatDateOnly(pickString(record, ["sessionDate"])) || "-"}</span>
                              <span className="text-xs text-slate-400">{status}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-400">{formatClockTime(pickString(record, ["sessionTime", "slotStartTime"]) || "")}</p>
                          </div>
                        );
                      }) : (
                        <p className="text-sm text-slate-400">No booked PT sessions found for this coach.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Modal>

          <Modal
            open={isPtBillingModal}
            onClose={() => setActionModal(null)}
            title="PT Billing"
            size="xl"
            footer={
              <>
                <button type="button" onClick={() => setActionModal("pt")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Back</button>
                <button type="button" onClick={() => void handlePtPayment()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Create Invoice & Record Payment"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <BillingWorkflowTemplate
                infoRows={[
                  { label: "Invoice Number", value: "Generated on submit" },
                  { label: "Invoice Date", value: currentPreviewDate },
                  { label: "PT Package", value: formatPtProductName(selectedPtProduct?.productName || selectedPtVariant?.productCode) },
                  { label: "Membership Duration", value: formatPlanDuration(selectedPtVariant?.durationMonths || 0, selectedPtVariant?.validityDays || 0) },
                  { label: "Coach", value: selectedPtCoach?.name || "-" },
                  { label: "Total Sessions", value: selectedPtSessionCount > 0 ? selectedPtSessionCount : "-" },
                  { label: "Schedule", value: selectedPtDays.map((day) => formatPtDayLabel(day)).join(", ") || "-" },
                  { label: "Slot", value: `${formatClockTime(ptForm.slotStartTime)} - ${formatClockTime(ptSlotEndTime)}` },
                  { label: "Billing Representative", value: billingRepName || clientRepName, fullWidth: true },
                ]}
                lineItems={[
                  {
                    label: formatPtProductName(selectedPtProduct?.productName || selectedPtVariant?.productCode),
                    subtitle: `${formatPlanDuration(selectedPtVariant?.durationMonths || 0, selectedPtVariant?.validityDays || 0)} • ${selectedPtSessionCount || 0} sessions`,
                    baseAmount: formatRoundedInr(ptCommercial.baseAmount),
                    sellingPrice: formatRoundedInr(ptCommercial.sellingPrice),
                    discount: formatRoundedInr(ptCommercial.discountAmount),
                  },
                ]}
                totalLabel="Total PT Value"
                totalBaseAmount={formatRoundedInr(ptCommercial.baseAmount)}
                totalSellingPrice={formatRoundedInr(ptCommercial.sellingPrice)}
                totalDiscount={formatRoundedInr(ptCommercial.discountAmount)}
                finalPayable={formatRoundedInr(ptInvoiceTotal)}
                taxRows={[
                  { label: "CGST", value: formatRoundedInr(ptHalfTaxAmount) },
                  { label: "SGST", value: formatRoundedInr(ptHalfTaxAmount) },
                ]}
                receivedAmount={ptBillingForm.receivedAmount}
                onReceivedAmountChange={(value) => setPtBillingForm((current) => ({ ...current, receivedAmount: sanitizeIntegerString(value) }))}
                paymentMode={ptBillingForm.paymentMode}
                paymentModeOptions={String(billingSettings?.paymentModesEnabled || "UPI,CARD,CASH")
                  .split(",")
                  .map((mode) => mode.trim())
                  .filter((mode) => ["UPI", "CARD", "CASH"].includes(mode.toUpperCase()))
                  .map((mode) => ({ value: mode, label: humanizeLabel(mode) }))}
                onPaymentModeChange={(value) => setPtBillingForm((current) => ({ ...current, paymentMode: value }))}
                secondaryModeLabel={ptBillingForm.paymentMode === "CARD" ? "Card Type" : ptBillingForm.paymentMode === "UPI" ? "UPI App" : undefined}
                secondaryModeValue={ptBillingForm.paymentMode === "CARD" ? ptCardSubtype : ptUpiVendor}
                secondaryModeOptions={
                  ptBillingForm.paymentMode === "CARD"
                    ? PAYMENT_CARD_OPTIONS
                    : ptBillingForm.paymentMode === "UPI"
                      ? PAYMENT_UPI_OPTIONS
                    : []
                }
                onSecondaryModeChange={(value) => {
                  if (ptBillingForm.paymentMode === "CARD") {
                    setPtCardSubtype(value as "DEBIT_CARD" | "CREDIT_CARD");
                    return;
                  }
                  setPtUpiVendor(value as "GOOGLE_PAY" | "PHONEPE" | "PAYTM" | "OTHER");
                }}
                showBalanceDueDate={Number(ptBillingForm.receivedAmount || 0) < ptInvoiceTotal}
                balanceDueDate={ptBillingForm.balanceDueDate}
                onBalanceDueDateChange={(value) => setPtBillingForm((current) => ({ ...current, balanceDueDate: value }))}
                receiptRows={[
                  { label: "Receipt Number", value: "Generated after payment" },
                  { label: "Receipt Date", value: currentPreviewDate },
                  { label: "Payment Method", value: resolveBillingPaymentModeLabel(ptBillingForm.paymentMode, ptCardSubtype, ptUpiVendor) },
                  { label: "Payment Status", value: ptPreviewStatus },
                  { label: "Total Paid", value: formatRoundedInr(ptReceivedAmount) },
                  { label: "Balance Due", value: formatRoundedInr(ptBalanceAmount), fullWidth: true },
                ]}
              />
            </div>
          </Modal>

          <Modal
            open={actionModal === "visit"}
            onClose={() => setActionModal(null)}
            title="Add Flex Visit"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleAddVisit()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Processing..." : "Add Visit"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <StatPill label="Included Check-Ins" value={String(selectedIncludedCheckIns)} />
                <StatPill label="Used Check-Ins" value={String(selectedUsedCheckIns)} />
                <StatPill label="Remaining Check-Ins" value={String(selectedCheckInsRemaining)} />
                <StatPill label="Extra Visit Price" value={formatRoundedInr(selectedExtraVisitPrice)} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                This creates an invoice and immediate receipt for one additional flex visit. Once payment succeeds, the check-in allowance increases by one and attendance is unlocked again.
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Payment Mode</span>
                <select value={visitForm.paymentMode} onChange={(event) => setVisitForm({ paymentMode: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="UPI">UPI</option>
                  <option value="NET_BANKING">Net Banking</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "biometric"}
            onClose={() => setActionModal(null)}
            title="Biometric & Access Actions"
            size="md"
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Current state: <span className="font-semibold">{tabData["recovery-services"]?.status || "NOT_ADDED"}</span>
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Biometric Device</span>
                <select
                  value={selectedBiometricDeviceSerial}
                  onChange={(event) => setSelectedBiometricDeviceSerial(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  <option value="">Select Device</option>
                  {availableBiometricDevices.map((device) => {
                    const serial = pickString(device, ["serialNumber"]);
                    return (
                      <option key={serial} value={serial}>
                        {pickString(device, ["deviceName"]) || serial} · {serial}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea value={accessNotes} onChange={(event) => setAccessNotes(event.target.value)} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { action: "ADD_USER", label: "Add User" },
                  { action: "RE_ADD_USER", label: "Re-add User" },
                  { action: "BLOCK_USER", label: "Block User" },
                  { action: "UNBLOCK_USER", label: "Unblock User" },
                  { action: "DELETE_USER", label: "Delete User" },
                ].map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => void handleAccessAction(item.action)}
                    disabled={actionBusy}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {actionBusy ? "Working..." : item.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                These actions now queue the corresponding ESSL device command for the selected branch device and then update the internal member access registry.
              </p>
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
