"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { canAccessRoute, hasCapability } from "@/lib/access-policy";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { toDateTimeLocalInput } from "@/lib/formatters";
import { formatInquiryCode } from "@/lib/inquiry-code";
import { resolveStaffId } from "@/lib/staff-id";
import { normalizeInquirySourceLabel } from "@/lib/inquiry-source";
import { FollowUpChannel, FollowUpRecord } from "@/types/follow-up";
import {
  InquiryCustomerStatus,
  InquiryConvertibility,
  InquiryRecord,
  InquiryResponseType,
  InquirySearchQuery,
  InquiryStatus,
  InquiryStatusHistoryEntry,
  PreferredContactChannel,
  UpdateInquiryRequest,
} from "@/types/inquiry";
import { UserDirectoryItem } from "@/types/models";
import { CreateInquiryModal } from "@/components/inquiries/create-inquiry-modal";
import { Modal } from "@/components/common/modal";
import {
  CLOSEABLE_STATUSES,
  CONVERTIBILITY_OPTIONS,
  CUSTOMER_STATUS_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  GENDER_OPTIONS,
  INQUIRY_STATUS_OPTIONS,
  INTERESTED_SERVICE_OPTIONS,
  PREFERRED_CONTACT_CHANNEL_OPTIONS,
  PROMOTION_SOURCE_OPTIONS,
  REFERRED_BY_TYPE_OPTIONS,
  RESPONSE_TYPE_OPTIONS,
} from "@/components/inquiries/inquiry-form-constants";
import type {
  InquiryCoreFormValues,
  StaffOption,
} from "@/components/inquiries/inquiry-form-types";
import {
  sanitizeFormValue,
  parseNumeric,
  toOptionalString,
  toIsoDatetime,
  toCreateInquiryPayload,
} from "@/components/inquiries/inquiry-form-utils";

const CAPABILITIES = {
  viewInquiries: ["INQUIRY_VIEW", "INQUIRIES_VIEW", "INQUIRY_READ", "INQUIRY_MANAGE"],
  createInquiry: ["INQUIRY_CREATE", "INQUIRIES_CREATE", "INQUIRY_MANAGE", "MEMBER_INTAKE_CREATE"],
  updateInquiry: ["INQUIRY_UPDATE", "INQUIRIES_UPDATE", "INQUIRY_EDIT", "INQUIRY_MANAGE"],
  convertInquiry: ["INQUIRY_CONVERT", "MEMBER_ONBOARDING", "INQUIRY_MANAGE"],
} as const;

interface ToastState {
  kind: "success" | "error";
  message: string;
}

interface InquiryFilterState {
  query: string;
  status: string;
  converted: "" | "true" | "false";
  convertibility: string;
  closeReason: string;
  fromDate: string;
  toDate: string;
  clientRepStaffId: string;
}

interface FollowUpPreview {
  followUpId?: number;
  dueAt?: string;
  assignedToStaffId?: number | null;
  status?: string;
  channel?: FollowUpChannel;
  responseType?: InquiryResponseType;
  notes?: string | null;
  outcomeNotes?: string | null;
  createdAt?: string;
  overdue?: boolean;
}

function extractLegacyMetadataValue(source: string | null | undefined, label: string): string {
  const text = String(source || "");
  const match = text.match(new RegExp(`${label}:\\s*([^|]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function getLegacyInquiryHandledBy(inquiry: InquiryRecord): string {
  return extractLegacyMetadataValue(inquiry.remarks, "Legacy Handled By");
}

function getLegacyFollowUpAssignedTo(source: string | null | undefined): string {
  return extractLegacyMetadataValue(source, "Assigned To");
}

function getLegacyFollowUpClientRep(source: string | null | undefined): string {
  return extractLegacyMetadataValue(source, "Client Rep");
}

function formatDateTimeDisplay(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString("en-IN");
}

function formatDateDisplay(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function isMeaningfulStaffId(value?: number | null): value is number {
  return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function buildLegacyFollowUpRecord(inquiry: InquiryRecord): FollowUpRecord | null {
  const notes = (inquiry.followUpComment || inquiry.remarks || inquiry.notes || "").trim();
  const hasLegacySignal = Boolean(notes || inquiry.responseType || inquiry.customerStatus || inquiry.updatedAt || inquiry.createdAt || inquiry.inquiryAt);
  if (!hasLegacySignal) {
    return null;
  }

  return {
    followUpId: -Math.abs(inquiry.inquiryId),
    inquiryId: inquiry.inquiryId,
    memberId: inquiry.memberId ?? null,
    branchId: inquiry.branchId ?? null,
    branchCode: inquiry.branchCode ?? null,
    assignedToStaffId: inquiry.assignedToStaffId ?? inquiry.clientRepStaffId ?? null,
    createdByStaffId: inquiry.clientRepStaffId ?? null,
    channel: "CALL",
    responseType: inquiry.responseType,
    followUpType: "ENQUIRY",
    dueAt: "",
    notes: notes || "Legacy imported inquiry follow-up",
    status: inquiry.converted || inquiry.status === "CONVERTED" ? "COMPLETED" : "SCHEDULED",
    completedByStaffId: null,
    completedAt: null,
    outcomeNotes: inquiry.customerStatus ? formatStatusLabel(inquiry.customerStatus) : null,
    overdue: false,
    createdAt: inquiry.createdAt || inquiry.inquiryAt || new Date().toISOString(),
    updatedAt: inquiry.updatedAt || inquiry.createdAt || inquiry.inquiryAt || new Date().toISOString(),
  };
}

function legacyFollowUpPreview(inquiry: InquiryRecord): FollowUpPreview | null {
  const legacy = buildLegacyFollowUpRecord(inquiry);
  if (!legacy) return null;
  return {
    followUpId: legacy.followUpId,
    dueAt: legacy.dueAt,
    assignedToStaffId: legacy.assignedToStaffId,
    status: "LEGACY",
    channel: legacy.channel,
    responseType: legacy.responseType,
    notes: legacy.notes,
    overdue: false,
  };
}

interface QuickFollowUpForm {
  inquiryId: number;
  dueAt: string;
  responseType: InquiryResponseType;
  channel: FollowUpChannel;
  assignedToStaffId: string;
  trialGiven: boolean;
  trialDays: string;
  trialExpiryAt: string;
  notes: string;
  closeReason: string;
}

interface CloseInquiryForm {
  inquiryId: number;
  closeStatus: "NOT_INTERESTED" | "LOST";
  closeReason: string;
}

interface DisplayStatusHistoryRow {
  kind: "created" | "transition";
  title: string;
  changedAt?: string;
  remarks?: string;
  changedByStaffId?: number | null;
}

interface InquiryEditFormValues extends InquiryCoreFormValues {
  memberId: string;
}

const PAGE_SIZE = 10;

function RequiredFieldIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 text-rose-600">
      <path d="M10 2.8a1 1 0 0 1 .95.68l1.03 3.16h3.32a1 1 0 0 1 .59 1.81l-2.69 1.96 1.03 3.15a1 1 0 0 1-1.54 1.12L10 12.72l-2.69 1.96a1 1 0 0 1-1.54-1.12l1.03-3.15-2.69-1.96a1 1 0 0 1 .58-1.81h3.33l1.03-3.16A1 1 0 0 1 10 2.8Z" />
    </svg>
  );
}

function parseNumericFromDirectoryUser(user: UserDirectoryItem): number | null {
  const idDigits = String(user.id ?? "").replace(/[^0-9]/g, "");
  if (idDigits.length > 0) {
    const fromId = Number(idDigits);
    if (!Number.isNaN(fromId) && Number.isFinite(fromId)) {
      return fromId;
    }
  }

  const mobileDigits = String(user.mobile ?? "").replace(/[^0-9]/g, "");
  if (mobileDigits.length > 0) {
    const fromMobile = Number(mobileDigits);
    if (!Number.isNaN(fromMobile) && Number.isFinite(fromMobile)) {
      return fromMobile;
    }
  }

  return null;
}

function isConvertedInquiry(inquiry: InquiryRecord): boolean {
  return inquiry.converted || inquiry.status.toUpperCase() === "CONVERTED";
}

function toInquiryEditFormValues(inquiry: InquiryRecord): InquiryEditFormValues {
  return {
    fullName: inquiry.fullName || "",
    mobileNumber: inquiry.mobileNumber || "",
    alternateMobileNumber: inquiry.alternateMobileNumber || "",
    email: inquiry.email || "",
    dateOfBirth: inquiry.dateOfBirth || "",
    inquiryAt: toDateTimeLocalInput(inquiry.inquiryAt),
    clientRepStaffId: inquiry.clientRepStaffId ? String(inquiry.clientRepStaffId) : "",
    gender: inquiry.gender || "",
    aadhaarNumber: inquiry.aadhaarNumber || "",
    gstNumber: inquiry.gstNumber || "",
    defaultTrainerStaffId: inquiry.defaultTrainerStaffId ? String(inquiry.defaultTrainerStaffId) : "",
    referredByType: inquiry.referredByType || "",
    referredByName: inquiry.referredByName || "",
    promotionSource: inquiry.promotionSource || "",
    employmentStatus: inquiry.employmentStatus || "",
    address: inquiry.address || "",
    emergencyContactName: inquiry.emergencyContactName || "",
    emergencyContactPhone: inquiry.emergencyContactPhone || "",
    emergencyContactRelation: inquiry.emergencyContactRelation || "",
    branchCode: inquiry.branchCode || "",
    notes: inquiry.notes || "",
    remarks: inquiry.remarks || "",
    responseType: (inquiry.responseType || "NEEDS_DETAILS") as InquiryResponseType,
    preferredContactChannel: (inquiry.preferredContactChannel || "CALL") as PreferredContactChannel,
    customerStatus: (inquiry.customerStatus || "") as InquiryCustomerStatus | "",
    interestedIn: inquiry.interestedIn || "",
    trialGiven: Boolean(inquiry.trialGiven),
    trialDays:
      inquiry.trialDays !== undefined && inquiry.trialDays !== null ? String(inquiry.trialDays) : "",
    trialExpiryAt: toDateTimeLocalInput(inquiry.trialExpiryAt),
    followUpComment: inquiry.followUpComment || "",
    status: inquiry.status as InquiryStatus,
    convertibility: (inquiry.convertibility || "") as InquiryConvertibility,
    closeReason: inquiry.closeReason || "",
    memberId: inquiry.memberId ? String(inquiry.memberId) : "",
  };
}

function toUpdateInquiryPayload(values: InquiryEditFormValues): UpdateInquiryRequest {
  const status = toOptionalString(values.status) as InquiryStatus | undefined;
  const closeReason = toOptionalString(values.closeReason);

  return {
    ...toCreateInquiryPayload(values),
    status,
    convertibility: toOptionalString(values.convertibility) as InquiryConvertibility | undefined,
    closeReason: status && CLOSEABLE_STATUSES.has(status) ? closeReason : undefined,
    memberId: parseNumeric(values.memberId),
  };
}

function getConvertibilityTag(value?: InquiryConvertibility): { label: string; className: string } {
  const normalized = (value || "").toUpperCase();

  if (normalized === "HOT") {
    return { label: "HOT", className: "bg-rose-50 text-rose-700 border-rose-200" };
  }
  if (normalized === "COLD") {
    return { label: "COLD", className: "bg-slate-100 text-slate-700 border-slate-200" };
  }
  if (normalized === "WARM") {
    return { label: "WARM", className: "bg-amber-50 text-amber-700 border-amber-200" };
  }

  return { label: "-", className: "bg-slate-50 text-slate-500 border-slate-200" };
}

function getStatusBadgeClass(status?: string): string {
  const normalized = (status || "").toUpperCase();
  if (normalized === "CONVERTED") {
    return "border-emerald-200 bg-emerald-100 text-emerald-700";
  }
  if (normalized === "NOT_INTERESTED" || normalized === "LOST") {
    return "border-slate-300 bg-slate-100 text-slate-700";
  }
  if (normalized === "TRIAL_BOOKED") {
    return "border-indigo-200 bg-indigo-100 text-indigo-700";
  }
  if (normalized === "FOLLOW_UP") {
    return "border-blue-200 bg-blue-100 text-blue-700";
  }
  if (normalized === "CONTACTED") {
    return "border-violet-200 bg-violet-100 text-violet-700";
  }

  return "border-amber-200 bg-amber-100 text-amber-800";
}

function formatStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  if (!normalized) {
    return "-";
  }

  return normalized.replace(/_/g, " ");
}

function formatSourceLabel(source?: string): string {
  return normalizeInquirySourceLabel(source);
}

function formatResponseTypeLabel(responseType?: InquiryResponseType): string {
  const value = (responseType || "").trim();
  if (!value) {
    return "Follow-up";
  }

  const matched = RESPONSE_TYPE_OPTIONS.find((option) => option.value === value);
  return matched?.label || value.replace(/_/g, " ");
}

function buildDisplayStatusHistoryRows(
  history: InquiryStatusHistoryEntry[],
  inquiry?: Pick<InquiryRecord, "createdAt" | "inquiryAt"> | null,
): DisplayStatusHistoryRow[] {
  const meaningfulTransitions = [...history]
    .filter((entry) => {
      const fromStatus = (entry.fromStatus || "").trim().toUpperCase();
      const toStatus = (entry.toStatus || "").trim().toUpperCase();
      if (!toStatus) {
        return false;
      }
      return fromStatus !== toStatus;
    })
    .reverse()
    .map((entry) => ({
      kind: "transition" as const,
      title: `${formatStatusLabel(entry.fromStatus)} → ${formatStatusLabel(entry.toStatus)}`,
      changedAt: entry.changedAt,
      remarks: entry.remarks,
      changedByStaffId: entry.changedByStaffId,
    }));

  const creationTimestamp = inquiry?.createdAt || inquiry?.inquiryAt;
  const creationRow: DisplayStatusHistoryRow | null = inquiry
    ? {
        kind: "created",
        title: formatStatusLabel("NEW"),
        changedAt: creationTimestamp,
        remarks: "Inquiry created",
      }
    : null;

  return creationRow ? [creationRow, ...meaningfulTransitions] : meaningfulTransitions;
}

function deriveDisplayInquiryStatus(
  currentStatus: InquiryStatus,
  responseType?: InquiryResponseType,
): InquiryStatus {
  const normalizedStatus = String(currentStatus || "").toUpperCase() as InquiryStatus;
  if (normalizedStatus && normalizedStatus !== "NEW") {
    return normalizedStatus;
  }

  switch (responseType) {
    case "NEEDS_DETAILS":
      return "CONTACTED";
    case "ASKED_CALLBACK":
      return "FOLLOW_UP";
    case "REQUESTED_TRIAL":
      return "TRIAL_BOOKED";
    case "NOT_INTERESTED":
      return "NOT_INTERESTED";
    case "READY_TO_PAY":
      return normalizedStatus === "NEW" ? "CONTACTED" : normalizedStatus;
    default:
      return normalizedStatus || "NEW";
  }
}

function deriveLeadStatusFromResponseType(
  currentStatus: InquiryStatus,
  responseType?: InquiryResponseType,
): InquiryStatus {
  const normalizedStatus = String(currentStatus || "").toUpperCase() as InquiryStatus;
  if (normalizedStatus === "CONVERTED" || normalizedStatus === "NOT_INTERESTED" || normalizedStatus === "LOST") {
    return normalizedStatus;
  }

  switch (responseType) {
    case "REQUESTED_TRIAL":
      return "TRIAL_BOOKED";
    case "NEEDS_DETAILS":
      return normalizedStatus === "NEW" ? "CONTACTED" : normalizedStatus;
    case "ASKED_CALLBACK":
      return "FOLLOW_UP";
    case "READY_TO_PAY":
      return normalizedStatus === "NEW" ? "CONTACTED" : normalizedStatus;
    case "NOT_INTERESTED":
      return "NOT_INTERESTED";
    default:
      return normalizedStatus === "NEW" ? "CONTACTED" : normalizedStatus;
  }
}

function isClosedInquiryStatus(status?: InquiryStatus): boolean {
  const normalized = String(status || "").toUpperCase();
  return normalized === "NOT_INTERESTED" || normalized === "LOST";
}

function getInquiryMessage(inquiry: InquiryRecord): string {
  const raw = (inquiry.followUpComment || inquiry.remarks || inquiry.notes || "").trim();
  if (!raw) {
    return "";
  }

  const compact = raw.replace(/\s+/g, " ");
  return compact.length > 70 ? `${compact.slice(0, 67)}...` : compact;
}

function queryDateTimeRange(value?: string): { from?: string; to?: string } {
  if (!value) {
    return {};
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {};
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function toWhatsAppPhoneNumber(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }

  return digits;
}

function followUpRequiresDueDate(responseType: InquiryResponseType): boolean {
  return responseType === "ASKED_CALLBACK" || responseType === "NEEDS_DETAILS" || responseType === "REQUESTED_TRIAL";
}

function followUpRequiresTrialGiven(responseType: InquiryResponseType): boolean {
  return responseType === "REQUESTED_TRIAL";
}

function followUpRequiresComment(responseType: InquiryResponseType): boolean {
  return responseType === "ASKED_CALLBACK" || responseType === "NEEDS_DETAILS" || responseType === "REQUESTED_TRIAL";
}

function followUpRequiresAssignment(responseType: InquiryResponseType): boolean {
  return followUpRequiresDueDate(responseType);
}

function followUpRequiresCloseReason(responseType: InquiryResponseType): boolean {
  return responseType === "NOT_INTERESTED";
}

export default function InquiriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user, accessMetadata } = useAuth();
  const { selectedBranchCode, effectiveBranchId } = useBranch();
  const routeAllowsInquiries = canAccessRoute("/portal/inquiries", user, accessMetadata);
  const staffCapabilityFallback = user?.role !== "STAFF" || user.designation !== "GYM_MANAGER";
  const canViewInquiries = routeAllowsInquiries || hasCapability(user, accessMetadata, CAPABILITIES.viewInquiries, true);
  const canCreateInquiry = hasCapability(user, accessMetadata, CAPABILITIES.createInquiry, staffCapabilityFallback);
  const canUpdateInquiry = hasCapability(user, accessMetadata, CAPABILITIES.updateInquiry, staffCapabilityFallback);
  const canConvertInquiry = hasCapability(user, accessMetadata, CAPABILITIES.convertInquiry, staffCapabilityFallback);

  const initialStaffId = useMemo(() => resolveStaffId(user), [user]);
  const effectiveBranchCode = selectedBranchCode || "";

  const [inquiries, setInquiries] = useState<InquiryRecord[]>([]);
  const [analysisInquiries, setAnalysisInquiries] = useState<InquiryRecord[]>([]);
  const [analysisMemberCount, setAnalysisMemberCount] = useState(0);
  const [filters, setFilters] = useState<InquiryFilterState>({
    query: "",
    status: "",
    converted: "false",
    convertibility: "",
    closeReason: "",
    fromDate: "",
    toDate: "",
    clientRepStaffId: "",
  });
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [followUpByInquiry, setFollowUpByInquiry] = useState<Record<number, FollowUpPreview>>({});
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [quickFollowUpForm, setQuickFollowUpForm] = useState<QuickFollowUpForm | null>(null);
  const [quickFollowUpHistory, setQuickFollowUpHistory] = useState<FollowUpRecord[]>([]);
  const [loadingQuickFollowUpHistory, setLoadingQuickFollowUpHistory] = useState(false);
  const [closeInquiryForm, setCloseInquiryForm] = useState<CloseInquiryForm | null>(null);
  const [viewingInquiry, setViewingInquiry] = useState<InquiryRecord | null>(null);
  const [historyInquiry, setHistoryInquiry] = useState<InquiryRecord | null>(null);
  const [historyOnlyFollowUps, setHistoryOnlyFollowUps] = useState<FollowUpRecord[]>([]);
  const [loadingHistoryOnly, setLoadingHistoryOnly] = useState(false);
  const [viewFollowUpHistory, setViewFollowUpHistory] = useState<FollowUpRecord[]>([]);
  const [viewStatusHistory, setViewStatusHistory] = useState<InquiryStatusHistoryEntry[]>([]);
  const [loadingViewHistory, setLoadingViewHistory] = useState(false);
  const [editingInquiryId, setEditingInquiryId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<InquiryEditFormValues | null>(null);
  const [statusHistory, setStatusHistory] = useState<InquiryStatusHistoryEntry[]>([]);
  const [loadingStatusHistory, setLoadingStatusHistory] = useState(false);
  const [editFollowUpHistory, setEditFollowUpHistory] = useState<FollowUpRecord[]>([]);
  const [loadingEditFollowUpHistory, setLoadingEditFollowUpHistory] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingInquiries, setLoadingInquiries] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [rowActionLoadingId, setRowActionLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const deepLinkedOpenInquiryId = searchParams.get("openInquiryId");
  const deepLinkedQuery = searchParams.get("query") || "";

  const loadInquiries = useCallback(
    async (nextFilters?: InquiryFilterState, nextPage = currentPage) => {
      if (!token || !canViewInquiries) {
        setLoadingInquiries(false);
        return;
      }

      const appliedQuery = toOptionalString(nextFilters?.query ?? filters.query);
      const appliedStatus = toOptionalString(nextFilters?.status ?? filters.status);
      const appliedConvertibility = toOptionalString(nextFilters?.convertibility ?? filters.convertibility);
      const appliedCloseReason = toOptionalString(nextFilters?.closeReason ?? filters.closeReason);
      const convertedRaw = nextFilters?.converted ?? filters.converted;
      const clientRepRaw = nextFilters?.clientRepStaffId ?? filters.clientRepStaffId;
      const fromDateRaw = nextFilters?.fromDate ?? filters.fromDate;
      const toDateRaw = nextFilters?.toDate ?? filters.toDate;

      const appliedConverted = convertedRaw === "true" ? true : convertedRaw === "false" ? false : undefined;
      const appliedClientRepStaffId = parseNumeric(clientRepRaw);
      const fromRange = queryDateTimeRange(fromDateRaw).from;
      const toRange = queryDateTimeRange(toDateRaw).to;
      const pageToLoad = Math.max(0, nextPage - 1);

      setLoadingInquiries(true);
      setError(null);

      try {
        const query: InquirySearchQuery = {
          query: appliedQuery,
          status: appliedStatus,
          convertibility: appliedConvertibility,
          closeReason: appliedCloseReason,
          converted: appliedConverted,
          clientRepStaffId: appliedClientRepStaffId,
          from: fromRange,
          to: toRange,
          branchId: effectiveBranchId,
          branchCode: effectiveBranchCode || undefined,
        };

        const pageResult = await subscriptionService.searchInquiriesPaged(token, query, pageToLoad, PAGE_SIZE);
        const sortedContent = [...pageResult.content].sort((left, right) => {
          const leftTime = new Date(left.inquiryAt || left.createdAt || "").getTime();
          const rightTime = new Date(right.inquiryAt || right.createdAt || "").getTime();
          return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
        });
        setInquiries(sortedContent);
        setCurrentPage(pageResult.number + 1);
        setTotalPages(Math.max(pageResult.totalPages, 1));
        setTotalRows(pageResult.totalElements);

        const previewEntries = await Promise.all(
          sortedContent.map(async (inquiry) => {
            try {
              const history = await subscriptionFollowUpService.listInquiryFollowUps(token, inquiry.inquiryId);
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const sorted = [...history]
                .filter((item) => item.status === "SCHEDULED")
                .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
              const nextUpcoming = sorted.find((item) => {
                const dueTime = new Date(item.dueAt).getTime();
                return !Number.isNaN(dueTime) && dueTime >= todayStart.getTime();
              });
              const next = nextUpcoming || null;
              if (!next) {
                return [inquiry.inquiryId, legacyFollowUpPreview(inquiry)] as const;
              }

              return [
                inquiry.inquiryId,
                {
                  followUpId: next.followUpId,
                  dueAt: next.dueAt,
                  assignedToStaffId: next.assignedToStaffId,
                  status: next.status,
                  channel: next.channel,
                  responseType: next.responseType,
                  notes: next.notes,
                  overdue: next.overdue,
                } satisfies FollowUpPreview,
              ] as const;
            } catch {
              return [inquiry.inquiryId, legacyFollowUpPreview(inquiry)] as const;
            }
          }),
        );

        const previewMap: Record<number, FollowUpPreview> = {};
        for (const [inquiryId, preview] of previewEntries) {
          if (preview) {
            previewMap[inquiryId] = preview;
          }
        }
        setFollowUpByInquiry(previewMap);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load inquiries";
        setError(message);
        setToast({ kind: "error", message });
      } finally {
        setLoadingInquiries(false);
      }
    },
    [
      token,
      canViewInquiries,
      filters.query,
      filters.status,
      filters.convertibility,
      filters.closeReason,
      filters.converted,
      filters.clientRepStaffId,
      filters.fromDate,
      filters.toDate,
      currentPage,
      effectiveBranchCode,
      effectiveBranchId,
    ],
  );

  useEffect(() => {
    void loadInquiries();
  }, [loadInquiries]);

  useEffect(() => {
    if (!deepLinkedQuery) {
      return;
    }

    setCurrentPage(1);
    setFilters((prev) => {
      if (prev.query === deepLinkedQuery) {
        return prev;
      }
      return { ...prev, query: deepLinkedQuery };
    });
  }, [deepLinkedQuery]);

  const loadInquiryAnalysis = useCallback(async () => {
    if (!token || !canViewInquiries) {
      setAnalysisMemberCount(0);
      return;
    }

    try {
      const aggregated: InquiryRecord[] = [];
      const size = 200;
      const branchFilter = effectiveBranchId ? String(effectiveBranchId) : undefined;

      const inquiryPromise = (async () => {
        let page = 0;
        while (true) {
          const pageResult = await subscriptionService.searchInquiriesPaged(
            token,
            { branchId: effectiveBranchId, branchCode: effectiveBranchCode || undefined },
            page,
            size,
          );
          aggregated.push(...pageResult.content);

          if (pageResult.last || page >= pageResult.totalPages - 1) {
            break;
          }

          page += 1;
        }
      })();

      const membersPromise = usersService.searchUsers(token, {
        role: "MEMBER",
        ...(branchFilter ? { defaultBranchId: branchFilter } : {}),
      });

      const [, members] = await Promise.all([inquiryPromise, membersPromise]);
      setAnalysisInquiries(aggregated);
      setAnalysisMemberCount(members.length);
    } catch {
      setAnalysisInquiries([]);
      setAnalysisMemberCount(0);
    }
  }, [token, canViewInquiries, effectiveBranchCode, effectiveBranchId]);

  useEffect(() => {
    void loadInquiryAnalysis();
  }, [loadInquiryAnalysis]);

  useEffect(() => {
    if (!token || !deepLinkedOpenInquiryId) {
      return;
    }

    const inquiryId = Number(deepLinkedOpenInquiryId);
    if (!Number.isFinite(inquiryId)) {
      return;
    }

    const existing = inquiries.find((item) => item.inquiryId === inquiryId);
    if (existing) {
      openInquiryProfile(existing);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const inquiry = await subscriptionService.getInquiryById(token, inquiryId);
        if (!cancelled) {
          openInquiryProfile(inquiry);
        }
      } catch {
        if (!cancelled) {
          setToast({ kind: "error", message: "Unable to open enquiry from global search." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deepLinkedOpenInquiryId, inquiries, token]);

  useEffect(() => {
    if (!token || (!canCreateInquiry && !canViewInquiries)) {
      return;
    }

    let isCancelled = false;

    const loadStaffOptions = async () => {
      try {
        const [staffUsers, adminUsers] = await Promise.all([
          usersService.searchUsers(token, { role: "STAFF", active: true }),
          usersService.searchUsers(token, { role: "ADMIN", active: true }),
        ]);

        const mapped = [...staffUsers, ...adminUsers]
          .map((record) => {
            const numericId = parseNumericFromDirectoryUser(record);
            if (numericId === null) {
              return null;
            }
            return {
              id: numericId,
              label: `${record.name} (${record.designation || "STAFF"})`,
            };
          })
          .filter((item): item is StaffOption => Boolean(item));

        if (initialStaffId && user) {
          const selfExists = mapped.some((option) => option.id === initialStaffId);
          if (!selfExists) {
            mapped.unshift({
              id: initialStaffId,
              label: `${user.name || "Current User"} (${user.designation || user.role})`,
            });
          }
        }

        const uniqueById = Array.from(new Map(mapped.map((item) => [item.id, item])).values());
        if (!isCancelled) {
          setStaffOptions(uniqueById);
        }
      } catch {
        if (!isCancelled && initialStaffId && user) {
          setStaffOptions([
            {
              id: initialStaffId,
              label: `${user.name || "Current User"} (${user.designation || user.role})`,
            },
          ]);
        }
      }
    };

    void loadStaffOptions();

    return () => {
      isCancelled = true;
    };
  }, [token, canCreateInquiry, canViewInquiries, initialStaffId, user]);

  const setEditField = (key: keyof InquiryCoreFormValues, value: string) => {
    setEditForm((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        [key]: sanitizeFormValue(key, value),
      };
    });
  };

  const openCreateModal = () => {
    setIsCreateModalOpen(true);
  };

  const openInquiryProfile = (inquiry: InquiryRecord) => {
    setViewingInquiry(inquiry);
    setViewFollowUpHistory([]);
    setViewStatusHistory([]);
  };

  const closeInquiryProfile = () => {
    setViewingInquiry(null);
    setViewFollowUpHistory([]);
    setViewStatusHistory([]);
    setLoadingViewHistory(false);
  };

  const openFollowUpHistory = async (inquiry: InquiryRecord) => {
    setHistoryInquiry(inquiry);
    setHistoryOnlyFollowUps([]);

    if (!token) {
      return;
    }

    setLoadingHistoryOnly(true);
    try {
      const history = await subscriptionFollowUpService.listInquiryFollowUps(token, inquiry.inquiryId);
      const sorted = [...history].sort(
        (a, b) =>
          new Date(b.createdAt || b.dueAt || "").getTime() -
          new Date(a.createdAt || a.dueAt || "").getTime(),
      );
      setHistoryOnlyFollowUps(sorted.length > 0 ? sorted : (buildLegacyFollowUpRecord(inquiry) ? [buildLegacyFollowUpRecord(inquiry)!] : []));
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : "Unable to load follow-up history";
      setToast({ kind: "error", message });
      const legacy = buildLegacyFollowUpRecord(inquiry);
      setHistoryOnlyFollowUps(legacy ? [legacy] : []);
    } finally {
      setLoadingHistoryOnly(false);
    }
  };

  const closeFollowUpHistory = () => {
    setHistoryInquiry(null);
    setHistoryOnlyFollowUps([]);
    setLoadingHistoryOnly(false);
  };

  const onInquiryCreated = useCallback(async () => {
    setCurrentPage(1);
    await loadInquiries(undefined, 1);
    await loadInquiryAnalysis();
    setIsCreateModalOpen(false);
    setToast({ kind: "success", message: "Enquiry created." });
  }, [loadInquiries, loadInquiryAnalysis]);

  const openInquiryEditor = (inquiry: InquiryRecord) => {
    if (isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "Converted inquiries are locked for edit." });
      return;
    }

    setEditingInquiryId(inquiry.inquiryId);
    setEditForm(toInquiryEditFormValues(inquiry));
  };

  const closeInquiryEditor = () => {
    setEditingInquiryId(null);
    setEditForm(null);
  };

  const onSaveInquiryEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !canUpdateInquiry || !editingInquiryId || !editForm) {
      return;
    }

    setIsSavingEdit(true);
    setError(null);

    try {
      if (CLOSEABLE_STATUSES.has(editForm.status) && !toOptionalString(editForm.closeReason)) {
        setToast({ kind: "error", message: "Close reason is required for NOT_INTERESTED or LOST status." });
        setIsSavingEdit(false);
        return;
      }

      const updated = await subscriptionService.updateInquiry(token, editingInquiryId, {
        ...toUpdateInquiryPayload(editForm),
        branchId: effectiveBranchId,
        branchCode: toOptionalString(editForm.branchCode || effectiveBranchCode),
      });

      setInquiries((prev) => prev.map((item) => (item.inquiryId === editingInquiryId ? updated : item)));
      await loadInquiryAnalysis();
      setToast({ kind: "success", message: "Enquiry updated" });
      closeInquiryEditor();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Unable to update enquiry";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const assignInquiryToStaff = async (inquiry: InquiryRecord, staffIdRaw: string) => {
    if (!token || !canUpdateInquiry) {
      return;
    }
    const staffId = parseNumeric(staffIdRaw);
    if (staffId === undefined) {
      setToast({ kind: "error", message: "Assigned staff is required." });
      return;
    }

    setRowActionLoadingId(inquiry.inquiryId);
    try {
      const updated = await subscriptionService.updateInquiry(token, inquiry.inquiryId, {
        clientRepStaffId: staffId,
        assignedToStaffId: staffId,
      });

      setInquiries((prev) => prev.map((item) => (item.inquiryId === inquiry.inquiryId ? updated : item)));
      setFollowUpByInquiry((prev) => ({
        ...prev,
        [inquiry.inquiryId]: {
          ...(prev[inquiry.inquiryId] || {}),
          assignedToStaffId: staffId,
        },
      }));
      setToast({ kind: "success", message: "Enquiry assigned." });
    } catch (assignError) {
      const message = assignError instanceof Error ? assignError.message : "Unable to assign enquiry";
      setToast({ kind: "error", message });
    } finally {
      setRowActionLoadingId(null);
    }
  };

  const openQuickFollowUp = async (inquiry: InquiryRecord) => {
    if (isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "Follow-up cannot be added for converted inquiries." });
      return;
    }

    setQuickFollowUpForm({
      inquiryId: inquiry.inquiryId,
      dueAt: toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
      responseType: "NEEDS_DETAILS",
      channel: "CALL",
      assignedToStaffId: inquiry.clientRepStaffId ? String(inquiry.clientRepStaffId) : initialStaffId ? String(initialStaffId) : "",
      trialGiven: false,
      trialDays: "",
      trialExpiryAt: "",
      notes: "",
      closeReason: "",
    });
    setQuickFollowUpHistory([]);

    if (!token) {
      return;
    }

    setLoadingQuickFollowUpHistory(true);
    try {
      const history = await subscriptionFollowUpService.listInquiryFollowUps(token, inquiry.inquiryId);
      const sorted = history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setQuickFollowUpHistory(sorted);
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : "Unable to load follow-up history";
      setToast({ kind: "error", message });
      setQuickFollowUpHistory([]);
    } finally {
      setLoadingQuickFollowUpHistory(false);
    }
  };

  const submitQuickFollowUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !quickFollowUpForm) {
      return;
    }

    const requiresDueDate = followUpRequiresDueDate(quickFollowUpForm.responseType);
    const requiresTrialGiven = followUpRequiresTrialGiven(quickFollowUpForm.responseType);
    const requiresComment = followUpRequiresComment(quickFollowUpForm.responseType);
    const requiresAssignment = followUpRequiresAssignment(quickFollowUpForm.responseType);
    const requiresCloseReason = followUpRequiresCloseReason(quickFollowUpForm.responseType);
    const dueAt = requiresDueDate ? toIsoDatetime(quickFollowUpForm.dueAt) : undefined;
    const assignedToStaffId = requiresAssignment ? parseNumeric(quickFollowUpForm.assignedToStaffId) : undefined;
    const inquiry = inquiries.find((item) => item.inquiryId === quickFollowUpForm.inquiryId);
    const createdByStaffId =
      resolveStaffId(user) ??
      (inquiry?.clientRepStaffId !== undefined ? parseNumeric(String(inquiry.clientRepStaffId)) : undefined);

    if ((!dueAt && requiresDueDate) || (requiresAssignment && assignedToStaffId === undefined) || createdByStaffId === undefined) {
      setToast({ kind: "error", message: "Assigned staff and next follow-up date are required." });
      return;
    }

    if (requiresTrialGiven && !quickFollowUpForm.trialGiven) {
      setToast({ kind: "error", message: "Trial Given is required for requested trial follow-ups." });
      return;
    }
    if (requiresTrialGiven && quickFollowUpForm.trialGiven && !quickFollowUpForm.trialDays.trim()) {
      setToast({ kind: "error", message: "Trial days are required for requested trial follow-ups." });
      return;
    }
    if (requiresTrialGiven && quickFollowUpForm.trialGiven && !toIsoDatetime(quickFollowUpForm.trialExpiryAt)) {
      setToast({ kind: "error", message: "Trial expiry is required for requested trial follow-ups." });
      return;
    }
    if (requiresComment && !quickFollowUpForm.notes.trim()) {
      setToast({ kind: "error", message: "Follow-up comment is required for this response type." });
      return;
    }
    if (requiresCloseReason && !quickFollowUpForm.closeReason.trim()) {
      setToast({ kind: "error", message: "Close reason is required when the enquiry is not interested." });
      return;
    }

    if (inquiry && isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "Follow-up cannot be added for converted inquiries." });
      return;
    }

    setRowActionLoadingId(quickFollowUpForm.inquiryId);
    try {
      if (quickFollowUpForm.responseType === "NOT_INTERESTED") {
        await subscriptionService.closeInquiry(token, quickFollowUpForm.inquiryId, {
          status: "NOT_INTERESTED",
          closeReason: quickFollowUpForm.closeReason.trim(),
          remarks: quickFollowUpForm.closeReason.trim(),
        });
      } else if (requiresDueDate && assignedToStaffId !== undefined && dueAt) {
        await subscriptionFollowUpService.createFollowUp(token, quickFollowUpForm.inquiryId, {
          dueAt,
          channel: quickFollowUpForm.channel,
          assignedToStaffId,
          createdByStaffId,
          followUpType: quickFollowUpForm.responseType === "REQUESTED_TRIAL" ? "ASSIGN_TRIAL" : "ENQUIRY",
          notes: toOptionalString(quickFollowUpForm.notes),
          responseType: quickFollowUpForm.responseType,
        });
      }

      if (quickFollowUpForm.responseType === "REQUESTED_TRIAL" || quickFollowUpForm.responseType === "READY_TO_PAY") {
        await subscriptionService.updateInquiry(token, quickFollowUpForm.inquiryId, {
          responseType: quickFollowUpForm.responseType,
          preferredContactChannel: quickFollowUpForm.channel,
          trialGiven: quickFollowUpForm.trialGiven,
          trialDays: parseNumeric(quickFollowUpForm.trialDays),
          trialExpiryAt: toIsoDatetime(quickFollowUpForm.trialExpiryAt) || dueAt || undefined,
          followUpComment: requiresComment ? toOptionalString(quickFollowUpForm.notes) : undefined,
        });
      }

      const nextDueAt = dueAt || undefined;
      const nextStatus = deriveLeadStatusFromResponseType(inquiry?.status || "NEW", quickFollowUpForm.responseType);
      setInquiries((prev) =>
        prev.map((item) =>
          item.inquiryId === quickFollowUpForm.inquiryId
            ? {
                ...item,
                responseType: quickFollowUpForm.responseType,
                preferredContactChannel: requiresDueDate ? quickFollowUpForm.channel : item.preferredContactChannel,
                followUpComment: requiresComment ? quickFollowUpForm.notes.trim() || item.followUpComment : item.followUpComment,
                trialGiven:
                  quickFollowUpForm.responseType === "REQUESTED_TRIAL"
                    ? quickFollowUpForm.trialGiven
                    : item.trialGiven,
                trialDays:
                  quickFollowUpForm.responseType === "REQUESTED_TRIAL"
                    ? parseNumeric(quickFollowUpForm.trialDays) ?? item.trialDays
                    : item.trialDays,
                trialExpiryAt:
                  quickFollowUpForm.responseType === "REQUESTED_TRIAL"
                    ? toIsoDatetime(quickFollowUpForm.trialExpiryAt) || nextDueAt || item.trialExpiryAt
                    : item.trialExpiryAt,
                status: quickFollowUpForm.responseType === "NOT_INTERESTED" ? "NOT_INTERESTED" : nextStatus,
                closeReason: quickFollowUpForm.responseType === "NOT_INTERESTED" ? quickFollowUpForm.closeReason.trim() : item.closeReason,
              }
            : item,
        ),
      );
      if (nextDueAt && assignedToStaffId !== undefined) {
        setFollowUpByInquiry((prev) => ({
          ...prev,
          [quickFollowUpForm.inquiryId]: {
            followUpId: prev[quickFollowUpForm.inquiryId]?.followUpId,
            dueAt: nextDueAt,
            assignedToStaffId,
            status: "SCHEDULED",
            channel: quickFollowUpForm.channel,
            responseType: quickFollowUpForm.responseType,
            notes: requiresComment ? quickFollowUpForm.notes.trim() || undefined : undefined,
            overdue: false,
          },
        }));
      } else if (quickFollowUpForm.responseType === "NOT_INTERESTED" || quickFollowUpForm.responseType === "READY_TO_PAY") {
        setFollowUpByInquiry((prev) => {
          const next = { ...prev };
          delete next[quickFollowUpForm.inquiryId];
          return next;
        });
      }

      setQuickFollowUpForm(null);
      setQuickFollowUpHistory([]);
      await loadInquiries(undefined, currentPage);
      await loadInquiryAnalysis();

      if (inquiry && quickFollowUpForm.responseType === "READY_TO_PAY") {
        setToast({ kind: "success", message: "Follow-up saved. Opening member onboarding." });
        await convertInquiry(inquiry);
        return;
      }

      setToast({ kind: "success", message: quickFollowUpForm.responseType === "NOT_INTERESTED" ? "Enquiry closed." : "Follow-up saved." });
    } catch (followUpError) {
      const message = followUpError instanceof Error ? followUpError.message : "Unable to add follow-up";
      setToast({ kind: "error", message });
    } finally {
      setRowActionLoadingId(null);
    }
  };

  const openCloseInquiry = (inquiry: InquiryRecord) => {
    if (isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "Converted enquiry cannot be closed." });
      return;
    }
    setCloseInquiryForm({
      inquiryId: inquiry.inquiryId,
      closeStatus: "NOT_INTERESTED",
      closeReason: "",
    });
  };

  const submitCloseInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !canUpdateInquiry || !closeInquiryForm) {
      return;
    }

    const inquiry = inquiries.find((item) => item.inquiryId === closeInquiryForm.inquiryId);
    if (!inquiry) {
      return;
    }

    const createdByStaffId = resolveStaffId(user) ?? inquiry.clientRepStaffId ?? undefined;
    const assignedToStaffId = inquiry.clientRepStaffId ?? createdByStaffId;
    if (!createdByStaffId || !assignedToStaffId) {
      setToast({ kind: "error", message: "Assigned staff is required to close an enquiry." });
      return;
    }

    if (!closeInquiryForm.closeReason.trim()) {
      setToast({ kind: "error", message: "Close reason is required." });
      return;
    }

    setRowActionLoadingId(closeInquiryForm.inquiryId);
    try {
      const followUp = await subscriptionFollowUpService.createFollowUp(token, closeInquiryForm.inquiryId, {
        dueAt: new Date().toISOString(),
        channel: "CALL",
        assignedToStaffId,
        createdByStaffId,
        followUpType: "ENQUIRY",
        notes: closeInquiryForm.closeReason.trim(),
        responseType: "NOT_INTERESTED",
      });

      await subscriptionFollowUpService.completeFollowUp(token, followUp.followUpId, {
        completedByStaffId: createdByStaffId,
        outcomeNotes: closeInquiryForm.closeReason.trim(),
      });

      await subscriptionService.updateInquiry(token, closeInquiryForm.inquiryId, {
        status: closeInquiryForm.closeStatus,
        closeReason: closeInquiryForm.closeReason.trim(),
      });

      setInquiries((prev) =>
        prev.map((item) =>
          item.inquiryId === closeInquiryForm.inquiryId
            ? {
                ...item,
                status: closeInquiryForm.closeStatus,
                responseType: "NOT_INTERESTED",
                closeReason: closeInquiryForm.closeReason.trim(),
              }
            : item,
        ),
      );
      setFollowUpByInquiry((prev) => {
        const next = { ...prev };
        delete next[closeInquiryForm.inquiryId];
        return next;
      });
      setCloseInquiryForm(null);
      await loadInquiries(undefined, currentPage);
      await loadInquiryAnalysis();
      setToast({ kind: "success", message: "Enquiry closed." });
    } catch (closeError) {
      const message = closeError instanceof Error ? closeError.message : "Unable to close enquiry";
      setToast({ kind: "error", message });
    } finally {
      setRowActionLoadingId(null);
    }
  };

  const sendWhatsAppMessage = (inquiry: InquiryRecord) => {
    if (isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "Messaging is disabled for converted enquiries in this view." });
      return;
    }

    const mobile = inquiry.mobileNumber?.trim();
    if (!mobile) {
      setToast({ kind: "error", message: "Mobile number is missing for this enquiry." });
      return;
    }

    const message = getInquiryMessage(inquiry) || "Hi, following up on your enquiry.";
    const phone = toWhatsAppPhoneNumber(mobile);
    const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const convertInquiry = async (inquiry: InquiryRecord) => {
    if (!canConvertInquiry) {
      setToast({ kind: "error", message: "You do not have capability to convert enquiries" });
      return;
    }

    if (isConvertedInquiry(inquiry)) {
      setToast({ kind: "error", message: "This enquiry is already converted." });
      return;
    }

    if (!token) {
      return;
    }

    const params = new URLSearchParams();
    params.set("sourceInquiryId", String(inquiry.inquiryId));
    if (inquiry.fullName?.trim()) {
      params.set("name", inquiry.fullName.trim());
    }
    if (inquiry.mobileNumber?.trim()) {
      params.set("mobile", inquiry.mobileNumber.trim());
    }
    if (inquiry.email?.trim()) {
      params.set("email", inquiry.email.trim());
    }

    router.push(`/portal/members/add?${params.toString()}`);
  };

  const selectedInquiry = useMemo(
    () => inquiries.find((item) => item.inquiryId === editingInquiryId) || null,
    [inquiries, editingInquiryId],
  );

  useEffect(() => {
    if (!token || !viewingInquiry) {
      setViewFollowUpHistory([]);
      setViewStatusHistory([]);
      setLoadingViewHistory(false);
      return;
    }

    let cancelled = false;

    const loadViewData = async () => {
      setLoadingViewHistory(true);
      try {
        const [followUps, history] = await Promise.all([
          subscriptionFollowUpService.listInquiryFollowUps(token, viewingInquiry.inquiryId),
          subscriptionService.getInquiryStatusHistory(token, viewingInquiry.inquiryId),
        ]);
        if (!cancelled) {
          const legacy = buildLegacyFollowUpRecord(viewingInquiry);
          setViewFollowUpHistory(followUps.length > 0 ? followUps : legacy ? [legacy] : []);
          setViewStatusHistory(history);
        }
      } catch {
        if (!cancelled) {
          const legacy = buildLegacyFollowUpRecord(viewingInquiry);
          setViewFollowUpHistory(legacy ? [legacy] : []);
          setViewStatusHistory([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingViewHistory(false);
        }
      }
    };

    void loadViewData();

    return () => {
      cancelled = true;
    };
  }, [token, viewingInquiry]);

  const staffNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const staff of staffOptions) {
      const name = staff.label.split(" (")[0] || staff.label;
      map.set(staff.id, name);
    }
    return map;
  }, [staffOptions]);

  const tableRows = useMemo(() => {
    const shouldHideClosedByDefault = !filters.status && filters.converted === "false";
    if (!shouldHideClosedByDefault) {
      return inquiries;
    }

    return inquiries.filter((inquiry) => {
      const displayStatus = deriveDisplayInquiryStatus(
        inquiry.status,
        followUpByInquiry[inquiry.inquiryId]?.responseType || inquiry.responseType,
      );
      return !isConvertedInquiry(inquiry) && !isClosedInquiryStatus(displayStatus);
    });
  }, [filters.converted, filters.status, followUpByInquiry, inquiries]);
  const displayViewStatusHistory = useMemo(
    () => buildDisplayStatusHistoryRows(viewStatusHistory, viewingInquiry),
    [viewStatusHistory, viewingInquiry],
  );
  const displayStatusHistory = useMemo(
    () => buildDisplayStatusHistoryRows(statusHistory, selectedInquiry),
    [selectedInquiry, statusHistory],
  );

  useEffect(() => {
    if (!token || !selectedInquiry) {
      setStatusHistory([]);
      setLoadingStatusHistory(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      setLoadingStatusHistory(true);
      try {
        const history = await subscriptionService.getInquiryStatusHistory(token, selectedInquiry.inquiryId);
        if (!cancelled) {
          setStatusHistory(history);
        }
      } catch {
        if (!cancelled) {
          setStatusHistory([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingStatusHistory(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [token, selectedInquiry]);

  useEffect(() => {
    if (!token || !selectedInquiry) {
      setEditFollowUpHistory([]);
      setLoadingEditFollowUpHistory(false);
      return;
    }

    let cancelled = false;

    const loadFollowUps = async () => {
      setLoadingEditFollowUpHistory(true);
      try {
        const history = await subscriptionFollowUpService.listInquiryFollowUps(token, selectedInquiry.inquiryId);
        if (!cancelled) {
          setEditFollowUpHistory(
            [...history].sort(
              (a, b) =>
                new Date(b.createdAt || b.dueAt || "").getTime() -
                new Date(a.createdAt || a.dueAt || "").getTime(),
            ),
          );
        }
      } catch {
        if (!cancelled) {
          setEditFollowUpHistory([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingEditFollowUpHistory(false);
        }
      }
    };

    void loadFollowUps();

    return () => {
      cancelled = true;
    };
  }, [token, selectedInquiry]);

  const inquiryAnalysis = useMemo(() => {
    const statusCounts = new Map<string, number>(
      INQUIRY_STATUS_OPTIONS.map((option) => [option.value, 0]),
    );
    const sourceCounts = new Map<string, number>();
    let convertedInquiryCount = 0;
    let closedCount = 0;

    for (const inquiry of analysisInquiries) {
      const statusKey = String(inquiry.status || "").toUpperCase();
      if (statusCounts.has(statusKey)) {
        statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
      }
      if (isConvertedInquiry(inquiry)) {
        convertedInquiryCount += 1;
      } else if (statusKey === "LOST" || statusKey === "NOT_INTERESTED") {
        closedCount += 1;
      }

      const source = formatSourceLabel(inquiry.promotionSource);
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }

    const sourceSeries = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const convertedCount = Math.max(analysisMemberCount, convertedInquiryCount);
    statusCounts.set("CONVERTED", convertedCount);

    const statusSeries = INQUIRY_STATUS_OPTIONS.map((option) => ({
      key: option.value,
      label: option.label,
      count: statusCounts.get(option.value) || 0,
    }));

    const total = analysisInquiries.length + Math.max(analysisMemberCount - convertedInquiryCount, 0);
    const conversionRate = total > 0 ? Math.round((convertedCount / total) * 100) : 0;

    return {
      statusSeries,
      sourceSeries,
      total,
      convertedCount,
      openCount: Math.max(total - convertedCount - closedCount, 0),
      conversionRate,
    };
  }, [analysisInquiries, analysisMemberCount]);

  const statusOverview = useMemo(() => {
    const palette = ["#2563eb", "#7c3aed", "#0ea5e9", "#f59e0b", "#16a34a", "#475569", "#dc2626"];
    const series = inquiryAnalysis.statusSeries.map((item, index) => ({
      ...item,
      color: palette[index % palette.length],
    }));
    const maxCount = Math.max(...series.map((item) => item.count), 1);
    const total = series.reduce((sum, item) => sum + item.count, 0);

    return {
      series,
      total,
      maxCount,
    };
  }, [inquiryAnalysis.statusSeries]);

  const sourcePie = useMemo(() => {
    const colors = ["#be123c", "#fb7185", "#f97316", "#eab308", "#0ea5e9", "#14b8a6"];
    const total = inquiryAnalysis.sourceSeries.reduce((sum, item) => sum + item.count, 0);
    const safeTotal = total > 0 ? total : 1;
    const segments = inquiryAnalysis.sourceSeries.map((item, index) => ({
      label: item.source,
      value: item.count,
      percent: Math.round((item.count / safeTotal) * 100),
      color: colors[index % colors.length],
    }));

    let cursor = 0;
    const gradientSegments = segments.map((segment) => {
      const start = cursor;
      const width = safeTotal > 0 ? (segment.value / safeTotal) * 100 : 0;
      cursor += width;
      return `${segment.color} ${start}% ${Math.max(start, cursor)}%`;
    });

    return {
      total,
      segments,
      gradient: gradientSegments.length > 0 ? `conic-gradient(${gradientSegments.join(", ")})` : "none",
    };
  }, [inquiryAnalysis.sourceSeries]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = tableRows;

  if (!canViewInquiries) {
    return (
      <SectionCard title="Enquiry Access" subtitle="Capabilities are controlled by designation metadata">
        <p className="text-sm text-slate-500">You do not have capability to view enquiry data.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-8">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enquiry Management</h1>
          <p className="text-gray-500">Track and manage potential members.</p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        >
          Add Enquiry
        </button>
      </div>

      <SectionCard title="Enquiry Analysis" subtitle="Lead status mix, top sources, and enquiry-to-member conversion">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status Overview</p>
            {statusOverview.total === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No enquiry status data yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {statusOverview.series.map((segment) => (
                  <div key={segment.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                      <span>{segment.label}</span>
                      <span>{segment.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.08]">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.max(4, (segment.count / statusOverview.maxCount) * 100)}%`,
                          backgroundColor: segment.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Top Sources</p>
            {sourcePie.total === 0 ? (
              <p className="mt-3 text-sm text-slate-400">No source data yet.</p>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                <div className="relative h-28 w-28 rounded-full" style={{ background: sourcePie.gradient }}>
                  <div className="absolute inset-4 rounded-full bg-[#131925]" />
                </div>
                <div className="space-y-1 text-xs text-slate-300">
                  {sourcePie.segments.map((segment) => (
                    <div key={segment.label} className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                      <span>
                        {segment.label}: {segment.value} ({segment.percent}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Enquiry to Member Conversion</p>
            <div className="mt-4">
              <p className="text-3xl font-bold text-white">{inquiryAnalysis.conversionRate}%</p>
              <p className="mt-1 text-xs text-slate-400">
                Converted {inquiryAnalysis.convertedCount} of {inquiryAnalysis.total} enquiries
              </p>
              <div className="mt-3 h-2.5 rounded-full bg-white/[0.08]">
                <div
                  className="h-2.5 rounded-full bg-emerald-500"
                  style={{ width: `${Math.max(0, Math.min(100, inquiryAnalysis.conversionRate))}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                  Converted: {inquiryAnalysis.convertedCount}
                </div>
                <div className="rounded-md border border-white/8 bg-white/[0.05] px-2 py-1 text-slate-200">Open: {inquiryAnalysis.openCount}</div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Enquiry Table"
        subtitle="Search, filter and convert enquiries"
        actions={
          <button
            type="button"
            onClick={() => void loadInquiries(undefined, currentPage)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
          >
            Refresh
          </button>
        }
      >
        <form
          className="rounded-2xl border border-white/10 bg-[#111826] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setCurrentPage(1);
            void loadInquiries(undefined, 1);
          }}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                className="w-full rounded-lg border border-white/10 bg-[#0d131d] py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500"
                placeholder="Search enquiries..."
                value={filters.query}
                onChange={(event) => {
                  setCurrentPage(1);
                  setFilters((prev) => ({ ...prev, query: event.target.value }));
                }}
              />
            </div>
            <div className="relative flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFiltersOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#0d131d] px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M3 5h18l-7 8v5l-4 1v-6z" />
                </svg>
                Filters
              </button>
            </div>
          </div>
          {isFiltersOpen ? (
            <div className="mt-3 rounded-lg border border-white/10 bg-[#0d131d] p-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <select
                  className="rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                  value={filters.status}
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilters((prev) => ({ ...prev, status: event.target.value }));
                  }}
                >
                  <option value="">All Status</option>
                  {INQUIRY_STATUS_OPTIONS.map((statusOption) => (
                    <option key={`filter-status-${statusOption.value}`} value={statusOption.value}>
                      {statusOption.label}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                  value={filters.converted}
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilters((prev) => ({ ...prev, converted: event.target.value as "" | "true" | "false" }));
                  }}
                >
                  <option value="">All Conversion</option>
                  <option value="false">Not Converted</option>
                  <option value="true">Converted</option>
                </select>
                <select
                  className="rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                  value={filters.convertibility}
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilters((prev) => ({ ...prev, convertibility: event.target.value }));
                  }}
                >
                  <option value="">All Convertibility</option>
                  {CONVERTIBILITY_OPTIONS.map((option) => (
                    <option key={`filter-convertibility-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  className="rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  value={filters.closeReason}
                  placeholder="Close reason contains..."
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilters((prev) => ({ ...prev, closeReason: event.target.value }));
                  }}
                />
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400">From Date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                    value={filters.fromDate}
                    onChange={(event) => {
                      setCurrentPage(1);
                      setFilters((prev) => ({ ...prev, fromDate: event.target.value }));
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400">To Date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                    value={filters.toDate}
                    onChange={(event) => {
                      setCurrentPage(1);
                      setFilters((prev) => ({ ...prev, toDate: event.target.value }));
                    }}
                  />
                </div>
                <select
                  className="rounded-lg border border-white/10 bg-[#121a25] px-3 py-2 text-sm text-white"
                  value={filters.clientRepStaffId}
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilters((prev) => ({ ...prev, clientRepStaffId: event.target.value }));
                  }}
                >
                  <option value="">All Client Reps</option>
                  {staffOptions.map((staff) => (
                    <option key={`filter-rep-${staff.id}`} value={staff.id}>
                      {staff.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const resetFilters: InquiryFilterState = {
                      query: "",
                      status: "",
                      converted: "false",
                      convertibility: "",
                      closeReason: "",
                      fromDate: "",
                      toDate: "",
                      clientRepStaffId: "",
                    };
                    setFilters(resetFilters);
                    setCurrentPage(1);
                    void loadInquiries(resetFilters, 1);
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          ) : null}
        </form>

        {error ? <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}

        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-[#101722]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Enquiry Date</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned Staff</th>
                <th className="px-4 py-3">Next Follow-up</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loadingInquiries ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={8}>
                    Loading enquiries...
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={8}>
                    No enquiries found
                  </td>
                </tr>
              ) : (
                paginatedRows.map((inquiry) => {
                  const convertibilityTag = getConvertibilityTag(inquiry.convertibility);
                  const isConverting = rowActionLoadingId === inquiry.inquiryId;
                  const isConverted = isConvertedInquiry(inquiry);
                  const followUp = followUpByInquiry[inquiry.inquiryId];
                  const displayStatus = deriveDisplayInquiryStatus(
                    inquiry.status,
                    followUp?.responseType || inquiry.responseType,
                  );
                  const isClosed = isClosedInquiryStatus(displayStatus);
                  const assignedId = followUp?.assignedToStaffId ?? inquiry.clientRepStaffId;
                  const signedInMobileDigits = String(user?.mobile ?? "").replace(/[^0-9]/g, "");
                  const signedInIdDigits = String(user?.id ?? "").replace(/[^0-9]/g, "");
                  const signedInMobile = signedInMobileDigits ? Number(signedInMobileDigits) : NaN;
                  const signedInId = signedInIdDigits ? Number(signedInIdDigits) : NaN;
                  const legacyHandledBy = getLegacyInquiryHandledBy(inquiry);
                  const legacyAssignedTo = getLegacyFollowUpAssignedTo(followUp?.outcomeNotes);
                  const legacyClientRep = getLegacyFollowUpClientRep(followUp?.outcomeNotes);
                  const assignedName =
                    assignedId && !Number.isNaN(assignedId)
                      ? (staffNameById.get(assignedId) ||
                        (signedInMobile === assignedId || signedInId === assignedId ? user?.name || "-" : null) ||
                        legacyAssignedTo ||
                        legacyClientRep ||
                        legacyHandledBy ||
                        `Staff #${assignedId}`)
                      : legacyAssignedTo || legacyClientRep || legacyHandledBy || "-";
                  const followUpComment = (
                    followUp?.notes ||
                    inquiry.followUpComment ||
                    inquiry.notes ||
                    ""
                  ).trim();
                  const initials =
                    inquiry.fullName
                      ?.trim()
                      .split(" ")
                      .map((part) => part.slice(0, 1).toUpperCase())
                      .slice(0, 2)
                      .join("") || "?";

                  return (
                    <tr
                      key={inquiry.inquiryId}
                      className="cursor-pointer align-top border-l-2 border-transparent transition hover:border-[#c42924]/70 hover:bg-[#151e2b]"
                      onClick={() => openInquiryProfile(inquiry)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-xs font-semibold text-slate-200">
                            {initials}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{inquiry.fullName || "-"}</p>
                            <p className="text-xs text-slate-400">{inquiry.mobileNumber || "-"}</p>
                            <p className="text-[11px] font-medium text-slate-400">
                              {formatInquiryCode(inquiry.inquiryId, {
                                branchCode: inquiry.branchCode,
                                createdAt: inquiry.createdAt || inquiry.inquiryAt,
                              })}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {formatDateDisplay(inquiry.inquiryAt || inquiry.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        <p className="max-w-[18rem] truncate">
                        {followUpComment || <span className="text-slate-400">-</span>}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-200">
                        <p>{formatSourceLabel(inquiry.promotionSource)}</p>
                        <p className="text-xs text-slate-500">Handled by: {legacyHandledBy || assignedName}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-semibold ${getStatusBadgeClass(
                              displayStatus,
                            )}`}
                          >
                            {formatStatusLabel(displayStatus)}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${convertibilityTag.className}`}
                          >
                            {convertibilityTag.label}
                          </span>
                          {inquiry.closeReason ? (
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                              Reason: {inquiry.closeReason}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {assignedName !== "-" ? (
                          assignedName
                        ) : canUpdateInquiry ? (
                          <select
                            value=""
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              event.stopPropagation();
                              void assignInquiryToStaff(inquiry, event.target.value);
                            }}
                            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200 outline-none focus:border-white/20"
                          >
                            <option value="">Assign enquiry</option>
                            {staffOptions.map((staff) => (
                              <option key={`assign-${staff.id}`} value={String(staff.id)}>
                                {staff.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {!isConverted && followUp?.dueAt
                          ? formatDateDisplay(followUp.dueAt)
                          : "-"}
                        {!isConverted && followUp?.createdAt ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Commented: {formatDateTimeDisplay(followUp.createdAt)}
                          </p>
                        ) : null}
                        {!isConverted && followUp?.status ? (
                          <p className="mt-1 text-xs font-medium text-slate-500">{followUp.status}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {isConverted || isClosed ? (
                              <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                No actions
                              </p>
                            ) : (
                              <>
                                {!canUpdateInquiry && !canConvertInquiry ? (
                                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                                    No actions
                                  </p>
                                ) : null}
                                {canUpdateInquiry ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openInquiryEditor(inquiry);
                                    }}
                                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
                                  >
                                    Edit
                                  </button>
                                ) : null}
                                {canConvertInquiry ? (
                                  <button
                                    type="button"
                                    disabled={isConverting}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void convertInquiry(inquiry);
                                    }}
                                    className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:bg-emerald-300"
                                  >
                                    Convert
                                  </button>
                                ) : null}
                                {canUpdateInquiry ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void openFollowUpHistory(inquiry);
                                    }}
                                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
                                  >
                                    Follow-up History
                                  </button>
                                ) : null}
                                {canUpdateInquiry ? (
                                  <button
                                    type="button"
                                    disabled={isConverting}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void openQuickFollowUp(inquiry);
                                    }}
                                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/15 disabled:opacity-60"
                                  >
                                    Add Follow-up
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    sendWhatsAppMessage(inquiry);
                                  }}
                                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
                                >
                                  WhatsApp
                                </button>
                                {canUpdateInquiry ? (
                                  <button
                                    type="button"
                                    disabled={isConverting}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCloseInquiry(inquiry);
                                    }}
                                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-50"
                                  >
                                    {isConverting ? "Working..." : "Close"}
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Showing {(currentPage - 1) * PAGE_SIZE + (paginatedRows.length > 0 ? 1 : 0)}-
            {(currentPage - 1) * PAGE_SIZE + paginatedRows.length} of {totalRows}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs font-semibold text-slate-300">
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      <Modal
        open={Boolean(historyInquiry)}
        onClose={closeFollowUpHistory}
        title={
          historyInquiry
            ? `Follow-up History • ${historyInquiry.fullName || "Enquiry"}`
            : "Follow-up History"
        }
        size="lg"
      >
        {!historyInquiry ? null : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              {formatInquiryCode(historyInquiry.inquiryId, {
                branchCode: historyInquiry.branchCode,
                createdAt: historyInquiry.createdAt || historyInquiry.inquiryAt,
              })}
            </p>
            {loadingHistoryOnly ? (
              <p className="text-sm text-slate-500">Loading follow-up history...</p>
            ) : historyOnlyFollowUps.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No follow-up history recorded.</p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {historyOnlyFollowUps.map((entry) => {
                  const assignedName =
                    (entry.assignedToStaffId ? staffNameById.get(Number(entry.assignedToStaffId)) : null) ||
                    getLegacyFollowUpAssignedTo(entry.outcomeNotes) ||
                    getLegacyFollowUpClientRep(entry.outcomeNotes) ||
                    getLegacyInquiryHandledBy(historyInquiry);
                  return (
                    <div key={entry.followUpId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-900">{formatResponseTypeLabel(entry.responseType)}</span>
                        <span className="text-xs text-slate-500">Next: {formatDateTimeDisplay(entry.dueAt)}</span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {(entry.channel || "CALL").replace(/_/g, " ")} • {entry.status || "PENDING"}
                      </p>
                      <p className="mt-1">{entry.notes || entry.outcomeNotes || "No notes"}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Commented: {formatDateTimeDisplay(entry.createdAt)}
                        {assignedName ? ` • Assigned: ${assignedName}` : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(viewingInquiry)}
        onClose={closeInquiryProfile}
        title={viewingInquiry ? `${viewingInquiry.fullName || "Enquiry"} • ${formatInquiryCode(viewingInquiry.inquiryId, {
          branchCode: viewingInquiry.branchCode,
          createdAt: viewingInquiry.createdAt || viewingInquiry.inquiryAt,
        })}` : "Enquiry Profile"}
        size="xl"
      >
        {!viewingInquiry ? null : (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium text-slate-900">Name:</span> {viewingInquiry.fullName || "-"}</p>
                  <p><span className="font-medium text-slate-900">Mobile:</span> {viewingInquiry.mobileNumber || "-"}</p>
                  <p><span className="font-medium text-slate-900">Email:</span> {viewingInquiry.email || "-"}</p>
                  <p><span className="font-medium text-slate-900">Branch:</span> {viewingInquiry.branchCode || "-"}</p>
                  <p><span className="font-medium text-slate-900">Address:</span> {viewingInquiry.address || "-"}</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sales Context</p>
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium text-slate-900">Inquiry Date:</span> {formatDateTimeDisplay(viewingInquiry.inquiryAt || viewingInquiry.createdAt)}</p>
                  <p><span className="font-medium text-slate-900">Status:</span> {formatStatusLabel(deriveDisplayInquiryStatus(viewingInquiry.status, viewFollowUpHistory[0]?.responseType || viewingInquiry.responseType))}</p>
                  <p><span className="font-medium text-slate-900">Convertibility:</span> {viewingInquiry.convertibility || "-"}</p>
                  <p><span className="font-medium text-slate-900">Client Rep:</span> {viewingInquiry.clientRepStaffId ? (staffNameById.get(Number(viewingInquiry.clientRepStaffId)) || viewingInquiry.clientRepStaffId) : (getLegacyInquiryHandledBy(viewingInquiry) || "-")}</p>
                  <p><span className="font-medium text-slate-900">Interested In:</span> {viewingInquiry.interestedIn || "-"}</p>
                  <p><span className="font-medium text-slate-900">Promotion Source:</span> {formatSourceLabel(viewingInquiry.promotionSource)}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-up History</p>
                  {canUpdateInquiry ? (
                    <button
                      type="button"
                      onClick={() => void openQuickFollowUp(viewingInquiry)}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Add Follow-up
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {loadingViewHistory ? (
                    <p className="text-sm text-slate-500">Loading follow-up history...</p>
                  ) : viewFollowUpHistory.length === 0 ? (
                    <p className="text-sm text-slate-500">No follow-up history recorded.</p>
                  ) : (
                    viewFollowUpHistory.map((entry) => {
                      const assignedName =
                        (entry.assignedToStaffId ? staffNameById.get(Number(entry.assignedToStaffId)) : null) ||
                        getLegacyFollowUpAssignedTo(entry.outcomeNotes) ||
                        getLegacyFollowUpClientRep(entry.outcomeNotes) ||
                        getLegacyInquiryHandledBy(viewingInquiry);
                      return (
                        <div key={entry.followUpId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-slate-900">{formatResponseTypeLabel(entry.responseType)}</span>
                            <span className="text-xs text-slate-500">Next: {formatDateTimeDisplay(entry.dueAt)}</span>
                          </div>
                          <p className="mt-1 text-xs font-medium text-slate-500">
                            {(entry.channel || "CALL").replace(/_/g, " ")} • {entry.status || "PENDING"}
                          </p>
                          <p className="mt-1">{entry.notes || entry.outcomeNotes || "No notes"}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            Commented: {formatDateTimeDisplay(entry.createdAt)}
                            {assignedName ? ` • Assigned: ${assignedName}` : ""}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status History</p>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {loadingViewHistory ? (
                    <p className="text-sm text-slate-500">Loading status history...</p>
                  ) : displayViewStatusHistory.length === 0 ? (
                    <p className="text-sm text-slate-500">No status history recorded.</p>
                  ) : (
                    displayViewStatusHistory.map((entry, index) => (
                      <div key={`${entry.kind}-${entry.changedAt || "history"}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <p className="font-semibold text-slate-900">{entry.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {entry.changedAt ? new Date(entry.changedAt).toLocaleString("en-IN") : "-"}
                        </p>
                        {entry.remarks ? <p className="mt-1">{entry.remarks}</p> : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <CreateInquiryModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={onInquiryCreated}
        staffOptions={staffOptions}
        initialStaffId={initialStaffId}
        effectiveBranchId={effectiveBranchId}
        effectiveBranchCode={effectiveBranchCode}
        token={token || ""}
        user={user}
      />

      {quickFollowUpForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add Follow-up</h2>
                <p className="text-sm text-slate-500">
                  {formatInquiryCode(quickFollowUpForm.inquiryId, {
                    branchCode: selectedInquiry?.branchCode,
                    createdAt: selectedInquiry?.createdAt || selectedInquiry?.inquiryAt,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickFollowUpForm(null);
                  setQuickFollowUpHistory([]);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Follow-up History</p>
              {loadingQuickFollowUpHistory ? (
                <p className="text-xs text-slate-500">Loading history...</p>
              ) : quickFollowUpHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No previous follow-ups. New follow-up will be added as history.</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {quickFollowUpHistory.map((history) => (
                    <div key={history.followUpId} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                      <p className="text-xs font-semibold text-slate-700">
                        {formatResponseTypeLabel(history.responseType)} • {history.status} • {new Date(history.dueAt).toLocaleString("en-IN")}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {history.notes || history.outcomeNotes || "No notes"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form className="space-y-3" onSubmit={submitQuickFollowUp}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Follow-up Response</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.responseType}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              responseType: event.target.value as InquiryResponseType,
                              ...(event.target.value === "REQUESTED_TRIAL"
                                ? {}
                                : { trialGiven: false, trialDays: "", trialExpiryAt: "" }),
                              ...(followUpRequiresDueDate(event.target.value as InquiryResponseType)
                                ? {}
                                : { dueAt: "", assignedToStaffId: "" }),
                              ...(followUpRequiresComment(event.target.value as InquiryResponseType)
                                ? {}
                                : { notes: "" }),
                              ...(followUpRequiresCloseReason(event.target.value as InquiryResponseType)
                                ? {}
                                : { closeReason: "" }),
                            }
                          : prev,
                      )
                    }
                  >
                    {RESPONSE_TYPE_OPTIONS.map((option) => (
                      <option key={`quick-response-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {followUpRequiresDueDate(quickFollowUpForm.responseType) ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Next Follow-up Date</label>
                  <input
                    type="datetime-local"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.dueAt}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) => (prev ? { ...prev, dueAt: event.target.value } : prev))
                    }
                    required
                  />
                </div>
                ) : null}
                {followUpRequiresDueDate(quickFollowUpForm.responseType) ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Preferred Contact</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.channel}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) =>
                        prev ? { ...prev, channel: event.target.value as FollowUpChannel } : prev,
                      )
                    }
                  >
                    {PREFERRED_CONTACT_CHANNEL_OPTIONS.map((option) => (
                      <option key={`quick-contact-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                ) : null}
                {followUpRequiresTrialGiven(quickFollowUpForm.responseType) ? (
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={quickFollowUpForm.trialGiven}
                        onChange={(event) =>
                          setQuickFollowUpForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  trialGiven: event.target.checked,
                                  ...(event.target.checked ? {} : { trialDays: "", trialExpiryAt: "" }),
                                }
                              : prev,
                          )
                        }
                      />
                      Trial Given
                    </label>
                  </div>
                ) : null}
                {followUpRequiresTrialGiven(quickFollowUpForm.responseType) && quickFollowUpForm.trialGiven ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Days</label>
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={quickFollowUpForm.trialDays}
                        onChange={(event) =>
                          setQuickFollowUpForm((prev) =>
                            prev ? { ...prev, trialDays: event.target.value.replace(/[^0-9]/g, "") } : prev,
                          )
                        }
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Expiry</label>
                      <input
                        type="datetime-local"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={quickFollowUpForm.trialExpiryAt}
                        onChange={(event) =>
                          setQuickFollowUpForm((prev) =>
                            prev ? { ...prev, trialExpiryAt: event.target.value } : prev,
                          )
                        }
                        required
                      />
                    </div>
                  </>
                ) : null}
                {followUpRequiresAssignment(quickFollowUpForm.responseType) ? (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Assign To</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.assignedToStaffId}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) =>
                        prev ? { ...prev, assignedToStaffId: event.target.value } : prev,
                      )
                    }
                    required
                  >
                    <option value="">Select staff</option>
                    {staffOptions.map((staff) => (
                      <option key={`quick-follow-${staff.id}`} value={staff.id}>
                        {staff.label}
                      </option>
                    ))}
                  </select>
                </div>
                ) : null}
                {followUpRequiresComment(quickFollowUpForm.responseType) ? (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.notes}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                    }
                  />
                </div>
                ) : null}
                {followUpRequiresCloseReason(quickFollowUpForm.responseType) ? (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Close Reason</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={quickFollowUpForm.closeReason}
                    onChange={(event) =>
                      setQuickFollowUpForm((prev) => (prev ? { ...prev, closeReason: event.target.value } : prev))
                    }
                  />
                </div>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={rowActionLoadingId === quickFollowUpForm.inquiryId}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
              >
                {rowActionLoadingId === quickFollowUpForm.inquiryId
                  ? "Saving..."
                  : quickFollowUpForm.responseType === "READY_TO_PAY"
                    ? "Save and Convert"
                    : quickFollowUpForm.responseType === "NOT_INTERESTED"
                      ? "Close Enquiry"
                    : "Save Follow-up"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(closeInquiryForm)}
        onClose={() => setCloseInquiryForm(null)}
        title={closeInquiryForm ? `Close Enquiry • ${formatInquiryCode(closeInquiryForm.inquiryId, {
          branchCode: selectedInquiry?.branchCode,
          createdAt: selectedInquiry?.createdAt || selectedInquiry?.inquiryAt,
        })}` : "Close Enquiry"}
        size="md"
      >
        {!closeInquiryForm ? null : (
          <form className="space-y-4" onSubmit={submitCloseInquiry}>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Close Type</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={closeInquiryForm.closeStatus}
                onChange={(event) =>
                  setCloseInquiryForm((prev) =>
                    prev ? { ...prev, closeStatus: event.target.value as "NOT_INTERESTED" | "LOST" } : prev,
                  )
                }
              >
                <option value="NOT_INTERESTED">Not Interested</option>
                <option value="LOST">Lost</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Close Reason</label>
              <textarea
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={closeInquiryForm.closeReason}
                onChange={(event) =>
                  setCloseInquiryForm((prev) =>
                    prev ? { ...prev, closeReason: event.target.value } : prev,
                  )
                }
                placeholder="Reason for closing this enquiry"
                required
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseInquiryForm(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={rowActionLoadingId === closeInquiryForm.inquiryId}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-rose-300"
              >
                {rowActionLoadingId === closeInquiryForm.inquiryId ? "Closing..." : "Close Enquiry"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {selectedInquiry && editForm ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-3xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edit Inquiry</h2>
                <p className="text-sm text-slate-500">
                  {selectedInquiry.fullName || "Enquiry"} •{" "}
                  {formatInquiryCode(selectedInquiry.inquiryId, {
                    branchCode: selectedInquiry.branchCode,
                    createdAt: selectedInquiry.createdAt || selectedInquiry.inquiryAt,
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeInquiryEditor}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form className="space-y-5" onSubmit={onSaveInquiryEdit}>
              {/* ── Section 1: Contact Info ──────────────────────────── */}
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Contact Info</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">Full Name <RequiredFieldIcon /></label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.fullName} required onChange={(e) => setEditField("fullName", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">Mobile Number <RequiredFieldIcon /></label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="tel" value={editForm.mobileNumber} required onChange={(e) => setEditField("mobileNumber", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Alternate Mobile</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="tel" value={editForm.alternateMobileNumber} onChange={(e) => setEditField("alternateMobileNumber", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="email" value={editForm.email} onChange={(e) => setEditField("email", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Date of Birth</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={editForm.dateOfBirth} onChange={(e) => setEditField("dateOfBirth", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Gender</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.gender} onChange={(e) => setEditField("gender", e.target.value)}>
                      <option value="">Select</option>
                      {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2 xl:col-span-3">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Address</label>
                    <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={editForm.address} onChange={(e) => setEditField("address", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Emergency Contact Name</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.emergencyContactName} onChange={(e) => setEditField("emergencyContactName", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Emergency Contact Phone</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="tel" value={editForm.emergencyContactPhone} onChange={(e) => setEditField("emergencyContactPhone", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Emergency Contact Relation</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.emergencyContactRelation} onChange={(e) => setEditField("emergencyContactRelation", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Aadhaar Number</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.aadhaarNumber} onChange={(e) => setEditField("aadhaarNumber", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">GST Number</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.gstNumber} onChange={(e) => setEditField("gstNumber", e.target.value)} />
                  </div>
                </div>
              </fieldset>

              {/* ── Section 2: Enquiry Context ───────────────────────── */}
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Enquiry Context</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Enquiry Date</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="datetime-local" value={editForm.inquiryAt} onChange={(e) => setEditField("inquiryAt", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Client Rep</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.clientRepStaffId} onChange={(e) => setEditField("clientRepStaffId", e.target.value)}>
                      <option value="">Select staff</option>
                      {staffOptions.map((s) => <option key={s.id} value={String(s.id)}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Source of Promotion</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.promotionSource} onChange={(e) => setEditField("promotionSource", e.target.value)}>
                      <option value="">Select</option>
                      {PROMOTION_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Customer Status</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.customerStatus} onChange={(e) => setEditForm((prev) => prev ? { ...prev, customerStatus: e.target.value as InquiryCustomerStatus | "" } : prev)}>
                      <option value="">Select</option>
                      {CUSTOMER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Employment Status</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.employmentStatus} onChange={(e) => setEditField("employmentStatus", e.target.value)}>
                      <option value="">Select</option>
                      {EMPLOYMENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Interested In</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.interestedIn} onChange={(e) => setEditField("interestedIn", e.target.value)}>
                      <option value="">Select service</option>
                      {INTERESTED_SERVICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Referred By Type</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.referredByType} onChange={(e) => setEditField("referredByType", e.target.value)}>
                      <option value="">Select</option>
                      {REFERRED_BY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Referred By Name</label>
                    <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.referredByName} onChange={(e) => setEditField("referredByName", e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Default Trainer</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.defaultTrainerStaffId} onChange={(e) => setEditField("defaultTrainerStaffId", e.target.value)}>
                      <option value="">Select trainer</option>
                      {staffOptions.map((s) => <option key={s.id} value={String(s.id)}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2 xl:col-span-3">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Enquiry Notes</label>
                    <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={editForm.notes} onChange={(e) => setEditField("notes", e.target.value)} />
                  </div>
                </div>
              </fieldset>

              {/* ── Section 3: Status & Classification ───────────────── */}
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Status &amp; Classification</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Status</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.status} onChange={(e) => setEditForm((prev) => prev ? { ...prev, status: e.target.value as InquiryStatus } : prev)}>
                      {INQUIRY_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Convertibility</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.convertibility} onChange={(e) => setEditForm((prev) => prev ? { ...prev, convertibility: e.target.value as InquiryConvertibility } : prev)}>
                      {CONVERTIBILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Member ID</label>
                    <input className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600" value={editForm.memberId || "-"} readOnly />
                  </div>
                  {CLOSEABLE_STATUSES.has(editForm.status) && (
                    <div className="sm:col-span-2 xl:col-span-3">
                      <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">Close Reason <RequiredFieldIcon /></label>
                      <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={editForm.closeReason} required placeholder="Required when status is NOT_INTERESTED or LOST" onChange={(e) => setEditForm((prev) => prev ? { ...prev, closeReason: e.target.value } : prev)} />
                    </div>
                  )}
                </div>
              </fieldset>

              {/* ── Section 4: Follow-up Context ─────────────────────── */}
              <fieldset className="rounded-xl border border-slate-200 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Follow-up Context</legend>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Follow-up Response</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.responseType} onChange={(e) => setEditForm((prev) => prev ? { ...prev, responseType: e.target.value as InquiryResponseType } : prev)}>
                      {RESPONSE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Preferred Contact</label>
                    <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.preferredContactChannel} onChange={(e) => setEditForm((prev) => prev ? { ...prev, preferredContactChannel: e.target.value as PreferredContactChannel } : prev)}>
                      {PREFERRED_CONTACT_CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={editForm.trialGiven} onChange={(e) => setEditForm((prev) => prev ? { ...prev, trialGiven: e.target.checked } : prev)} />
                    Trial Given
                  </label>
                  {editForm.trialGiven && (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Days</label>
                        <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={0} value={editForm.trialDays} onChange={(e) => setEditField("trialDays", e.target.value)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Expiry</label>
                        <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="datetime-local" value={editForm.trialExpiryAt} onChange={(e) => setEditField("trialExpiryAt", e.target.value)} />
                      </div>
                    </>
                  )}
                  <div className="sm:col-span-2 xl:col-span-4">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Follow-up Comment</label>
                    <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={editForm.followUpComment} onChange={(e) => setEditField("followUpComment", e.target.value)} />
                  </div>
                </div>
              </fieldset>

              {/* ── Section 5: Follow-up History ────────────────────────── */}
              <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Follow-up History</legend>
                {loadingEditFollowUpHistory ? (
                  <p className="text-xs text-slate-500">Loading follow-up history...</p>
                ) : editFollowUpHistory.length === 0 ? (
                  <p className="text-xs text-slate-500">No follow-up records.</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {editFollowUpHistory.map((entry) => (
                      <div key={entry.followUpId} className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-xs font-semibold text-slate-700">
                          {entry.status}{entry.channel ? ` · ${entry.channel}` : ""}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Due: {entry.dueAt ? new Date(entry.dueAt).toLocaleString("en-IN") : "-"}
                          {entry.assignedToStaffId ? ` · Staff: ${staffNameById.get(entry.assignedToStaffId) || entry.assignedToStaffId}` : ""}
                        </p>
                        {entry.notes || entry.outcomeNotes ? (
                          <p className="text-[11px] text-slate-600">{entry.notes || entry.outcomeNotes}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>

              {/* ── Section 6: Status History ─────────────────────────── */}
              <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <legend className="px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Status History</legend>
                {loadingStatusHistory ? (
                  <p className="text-xs text-slate-500">Loading status history...</p>
                ) : displayStatusHistory.length === 0 ? (
                  <p className="text-xs text-slate-500">No status history entries.</p>
                ) : (
                  <div className="space-y-2">
                    {displayStatusHistory.map((entry, index) => (
                      <div key={`status-history-${entry.kind}-${index}`} className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-xs font-semibold text-slate-700">{entry.title}</p>
                        <p className="text-[11px] text-slate-500">
                          Changed by: {entry.changedByStaffId ?? "-"} •{" "}
                          {entry.changedAt ? new Date(entry.changedAt).toLocaleString("en-IN") : "-"}
                        </p>
                        {entry.remarks ? <p className="text-[11px] text-slate-600">{entry.remarks}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>

              <button
                type="submit"
                disabled={isSavingEdit}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isSavingEdit ? "Saving..." : "Save Enquiry"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
