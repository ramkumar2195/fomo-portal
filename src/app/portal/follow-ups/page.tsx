"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Filter, History, PlusCircle } from "lucide-react";
import { Modal } from "@/components/common/modal";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { formatDateTime } from "@/lib/formatters";
import { formatInquiryCode } from "@/lib/inquiry-code";
import { resolveStaffId } from "@/lib/staff-id";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { FollowUpRecord, FollowUpType } from "@/types/follow-up";
import { InquiryConvertibility, InquiryRecord, InquiryResponseType, InquiryStatus } from "@/types/inquiry";

type DashboardView = "ALL" | "EXPECTED" | "DONE";
type ClientTypeFilter = "ALL" | "INQUIRY" | "MEMBER";

const PAGE_SIZE = 15;
const STAFF_ROLES = new Set(["ADMIN", "STAFF", "COACH"]);

const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  MEMBERSHIP_RENEWAL: "Membership Renewal",
  MEMBERSHIP_ENQUIRY: "Membership Enquiry",
  ENQUIRY: "Enquiry",
  IRREGULAR_MEMBER: "Irregular Member",
  BALANCE_DUE: "Balance Due",
  FREEZE: "Freeze",
  ASSIGN_TRIAL: "Assign Trial",
  FEEDBACK: "Feedback",
  MEASUREMENT: "Measurement",
  PT_RENEWAL: "PT Renewal",
  PT_TRIAL: "PT Trial",
  COMMITMENT: "Commitment",
  ANNIVERSARY: "Anniversary",
  BIRTHDAY: "Birthday",
  REFERRAL: "Referral",
  TRANSFER: "Transfer",
  UPGRADE: "Upgrade",
  ONLINE_PROSPECT: "Online Prospect (Non gym)",
  ONLINE_TRAINING: "Online Training",
  TRIAL_ONLINE_PT: "Trial Online PT",
  TRIAL_ONLINE_PT_FEEDBACK: "Trial Online PT Feedback",
  NUTRITION: "Nutrition",
  OTHER: "Other",
  EX_MEMBER: "Ex-Member",
  READY_TO_SIGN_UP: "Ready To Sign Up",
  DEMO_SCHEDULED: "Demo Scheduled",
  DEMO_CONDUCTED: "Demo Conducted",
  CONFIRMATION_CALLS: "Confirmation Calls",
  GYM_STUDIO_TRIAL: "Gym/Studio Trial",
};

const FOLLOW_UP_TYPE_OPTIONS = Object.values(FOLLOW_UP_TYPE_LABELS);
const LEAD_STATUS_MASTER_OPTIONS: InquiryStatus[] = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "TRIAL_BOOKED",
  "CONVERTED",
  "NOT_INTERESTED",
  "LOST",
];
const CONVERTIBILITY_MASTER_OPTIONS: InquiryConvertibility[] = ["HOT", "WARM", "COLD"];
const RESPONSE_TYPE_MASTER_OPTIONS: InquiryResponseType[] = [
  "READY_TO_PAY",
  "ASKED_CALLBACK",
  "NEEDS_DETAILS",
  "REQUESTED_TRIAL",
  "NOT_INTERESTED",
  "OTHER",
];
const GENDER_MASTER_OPTIONS = ["Male", "Female", "Other"];

function getFollowUpSourceType(item: FollowUpRecord): "MEMBER" | "INQUIRY" {
  return item.memberId ? "MEMBER" : "INQUIRY";
}

function isMeaningfulValue(value?: string | null): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return !["", "-", "null", "undefined", "n/a", "none"].includes(normalized);
}

function humanizeText(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatFollowUpType(type?: string | null): string {
  if (!type || !isMeaningfulValue(type)) {
    return "Enquiry";
  }
  return FOLLOW_UP_TYPE_LABELS[type as FollowUpType] || humanizeText(type);
}

function deriveFollowUpType(
  item: {
    followUpType?: string | null;
    notes?: string | null;
    outcomeNotes?: string | null;
    responseType?: InquiryResponseType;
    memberId?: number | null;
  },
  inquiry?: InquiryRecord,
): string {
  if (item.followUpType) {
    return item.followUpType;
  }

  const noteText = `${item.notes || ""} ${item.outcomeNotes || ""}`.toLowerCase();
  if (noteText.includes("balance")) {
    return "BALANCE_DUE";
  }
  if (noteText.includes("renewal")) {
    return "MEMBERSHIP_RENEWAL";
  }
  if (noteText.includes("upgrade")) {
    return "UPGRADE";
  }
  if (noteText.includes("transfer")) {
    return "TRANSFER";
  }
  if (item.responseType === "REQUESTED_TRIAL") {
    return "ASSIGN_TRIAL";
  }
  if (inquiry?.memberId || item.memberId) {
    return "MEMBERSHIP_ENQUIRY";
  }
  return "ENQUIRY";
}

function getPriority(dueAt: string, overdue: boolean): "HIGH" | "MEDIUM" | "LOW" {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return "MEDIUM";
  }

  const now = new Date();
  if (overdue || dueDate.getTime() <= now.getTime()) {
    return "HIGH";
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const dueStart = new Date(dueDate);
  dueStart.setHours(0, 0, 0, 0);

  if (dueStart.getTime() === todayStart.getTime() || dueStart.getTime() === tomorrowStart.getTime()) {
    return "MEDIUM";
  }

  return "LOW";
}

function priorityClass(priority: "HIGH" | "MEDIUM" | "LOW"): string {
  if (priority === "HIGH") {
    return "bg-red-600/20 text-red-200 border border-red-500/30";
  }
  if (priority === "MEDIUM") {
    return "bg-amber-500/20 text-amber-200 border border-amber-400/30";
  }
  return "bg-slate-500/20 text-slate-200 border border-slate-400/20";
}

function typeClass(type: "MEMBER" | "INQUIRY"): string {
  if (type === "MEMBER") {
    return "bg-emerald-500/15 text-emerald-200 border border-emerald-400/20";
  }
  return "bg-blue-500/15 text-blue-200 border border-blue-400/20";
}

function getRequirement(item: Pick<FollowUpRecord, "notes" | "outcomeNotes">, inquiry?: InquiryRecord): string {
  const fromNotes = (item.notes || "").trim();
  const fromInquiryComment = (inquiry?.followUpComment || "").trim();
  const fromInquiryRemarks = (inquiry?.remarks || "").trim();

  return fromNotes || fromInquiryComment || fromInquiryRemarks || "No requirement added.";
}

function extractExpectedAmount(item: Pick<FollowUpRecord, "notes" | "outcomeNotes">, inquiry?: InquiryRecord): string {
  const source = `${item.notes || ""} ${item.outcomeNotes || ""} ${inquiry?.followUpComment || ""}`;
  const match = source.match(/(?:₹|rs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)/i);
  return match?.[1] ? `₹${match[1]}` : "";
}

function formatLeadStatus(status?: string): string {
  if (!status || !isMeaningfulValue(status)) {
    return "-";
  }
  return humanizeText(status);
}

function formatStaffDisplayName(value?: string, fallbackId?: string): string {
  if (isMeaningfulValue(value)) {
    return value!.trim();
  }
  if (fallbackId) {
    return `Staff ${fallbackId}`;
  }
  return "Unassigned";
}

function extractLegacyMetadataValue(source: string | null | undefined, label: string): string {
  const text = String(source || "");
  const match = text.match(new RegExp(`${label}:\\s*([^|\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function getLegacyInquiryHandledBy(inquiry?: InquiryRecord): string {
  return extractLegacyMetadataValue(inquiry?.remarks, "Legacy Handled By");
}

function getLegacyFollowUpAssignedTo(source: string | null | undefined): string {
  return extractLegacyMetadataValue(source, "Assigned To");
}

function getLegacyFollowUpClientRep(source: string | null | undefined): string {
  return extractLegacyMetadataValue(source, "Client Rep");
}

function statusClass(status?: string): string {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
    case "PENDING":
    case "SCHEDULED":
      return "border-sky-400/20 bg-sky-500/10 text-sky-100";
    case "OVERDUE":
      return "border-rose-400/20 bg-rose-500/10 text-rose-100";
    case "CANCELLED":
      return "border-slate-400/20 bg-slate-500/10 text-slate-200";
    default:
      return "border-white/10 bg-white/[0.04] text-slate-200";
  }
}

function buildUniqueOptions(values: Array<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  values.forEach((value) => {
    if (!isMeaningfulValue(value)) {
      return;
    }
    const normalized = value!.trim().replace(/\s{2,}/g, " ");
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, normalized);
    }
  });
  return Array.from(seen.values()).sort((left, right) => left.localeCompare(right));
}

export default function FollowUpsPage() {
  const searchParams = useSearchParams();
  const { token, user } = useAuth();
  const { selectedBranchCode, effectiveBranchId } = useBranch();
  const focusInquiryId = Number(searchParams.get("inquiryId") || 0) || null;
  const focusFollowUpType = searchParams.get("followUpType");

  const [dashboardView, setDashboardView] = useState<DashboardView>("EXPECTED");
  const [followUps, setFollowUps] = useState<FollowUpRecord[]>([]);
  const [inquiriesById, setInquiriesById] = useState<Record<number, InquiryRecord>>({});
  const [staffById, setStaffById] = useState<Record<string, string>>({});
  const [staffDirectoryOptions, setStaffDirectoryOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [followUpTypeFilter, setFollowUpTypeFilter] = useState("ALL");
  const [assignedToFilter, setAssignedToFilter] = useState("ALL");
  const [scheduledByFilter, setScheduledByFilter] = useState("ALL");
  const [leadStatusFilter, setLeadStatusFilter] = useState("ALL");
  const [convertibilityFilter, setConvertibilityFilter] = useState("ALL");
  const [responseTypeFilter, setResponseTypeFilter] = useState("ALL");
  const [genderFilter, setGenderFilter] = useState("ALL");
  const [clientTypeFilter, setClientTypeFilter] = useState<ClientTypeFilter>("ALL");
  // Two-tab segmentation: LEADS (open enquiries without a member) vs
  // MEMBER_RENEWALS (follow-ups with a linked member — renewals, balance-due,
  // freeze reminders, etc.). Defaults to LEADS because the sales pipeline is
  // the primary workload for most staff designations.
  const [activeSegment, setActiveSegment] = useState<"LEADS" | "MEMBER_RENEWALS">("LEADS");
  const [clientRepFilter, setClientRepFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ inquiryId: number; clientName: string } | null>(null);
  const [historyRows, setHistoryRows] = useState<FollowUpRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [addFollowUpFor, setAddFollowUpFor] = useState<{ inquiryId: number; clientName: string; assignedToStaffId?: string } | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [addFollowUpForm, setAddFollowUpForm] = useState({
    dueAt: "",
    assignedToStaffId: "",
    channel: "CALL" as FollowUpRecord["channel"],
    followUpType: "ENQUIRY" as FollowUpType,
    responseType: "NEEDS_DETAILS" as InquiryResponseType,
    notes: "",
  });

  const loadQueue = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queueBaseQuery =
        focusInquiryId
          ? {
              inquiryId: focusInquiryId,
            }
          : {
              branchId: effectiveBranchId,
              branchCode: selectedBranchCode || undefined,
              // Send the tab segment through so backend returns only one bucket.
              // Omitted when focusing a specific inquiry so Add Follow-up's
              // history view still sees every row tied to that inquiry.
              segment: activeSegment,
            };

      const [branchUsers, admins] = await Promise.all([
        usersService.searchUsers(token, {
          active: true,
          ...(effectiveBranchId ? { defaultBranchId: String(effectiveBranchId) } : {}),
        }),
        usersService.searchUsers(token, { role: "ADMIN", active: true }),
      ]);

      const nextStaffById: Record<string, string> = {};
      const nextStaffOptionMap = new Map<string, string>();
      [...branchUsers, ...admins].forEach((entry) => {
        if (entry.id) {
          nextStaffById[String(entry.id)] = entry.name;
        }
        if (STAFF_ROLES.has(String(entry.role || "").toUpperCase()) && isMeaningfulValue(entry.name)) {
          nextStaffOptionMap.set(entry.name.trim().toLowerCase(), entry.name.trim());
        }
      });

      const aggregatedFollowUps: FollowUpRecord[] = [];
      let page = 0;
      while (true) {
        const response = await subscriptionFollowUpService.searchFollowUpQueuePaged(token, queueBaseQuery, page, 200);
        aggregatedFollowUps.push(...response.content);
        if (response.last || page >= response.totalPages - 1) {
          break;
        }
        page += 1;
      }

      const inquiryIndex: Record<number, InquiryRecord> = {};
      let inquiryPage = 0;
      while (true) {
        const response = await subscriptionService.searchInquiriesPaged(
          token,
          {
            ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
            ...(selectedBranchCode ? { branchCode: selectedBranchCode } : {}),
          },
          inquiryPage,
          200,
        );
        response.content.forEach((inquiry) => {
          inquiryIndex[inquiry.inquiryId] = inquiry;
        });
        if (response.last || inquiryPage >= response.totalPages - 1) {
          break;
        }
        inquiryPage += 1;
      }

      const referencedStaffIds = new Set<string>();
      aggregatedFollowUps.forEach((followUp) => {
        if (followUp.assignedToStaffId) {
          referencedStaffIds.add(String(followUp.assignedToStaffId));
        }
        if (followUp.createdByStaffId) {
          referencedStaffIds.add(String(followUp.createdByStaffId));
        }
      });
      Object.values(inquiryIndex).forEach((inquiry) => {
        if (inquiry.clientRepStaffId) {
          referencedStaffIds.add(String(inquiry.clientRepStaffId));
        }
      });

      const unresolvedStaffIds = Array.from(referencedStaffIds).filter((staffId) => !nextStaffById[staffId]);
      if (unresolvedStaffIds.length > 0) {
        const resolvedUsers = await Promise.all(
          unresolvedStaffIds.map(async (staffId) => {
            try {
              return await usersService.getUserById(token, staffId);
            } catch {
              try {
                const matches = await usersService.searchUsers(token, { query: staffId, active: true });
                return (
                  matches.find(
                    (entry) =>
                      String(entry.id || "").trim() === String(staffId).trim()
                      || String(entry.mobile || "").replace(/[^0-9]/g, "") === String(staffId).replace(/[^0-9]/g, ""),
                  ) || null
                );
              } catch {
                return null;
              }
            }
          }),
        );

        resolvedUsers.forEach((entry) => {
          if (!entry?.id || !isMeaningfulValue(entry.name)) {
            return;
          }
          nextStaffById[String(entry.id)] = entry.name.trim();
          if (STAFF_ROLES.has(String(entry.role || "").toUpperCase())) {
            nextStaffOptionMap.set(entry.name.trim().toLowerCase(), entry.name.trim());
          }
        });
      }

      setStaffById(nextStaffById);
      setStaffDirectoryOptions(Array.from(nextStaffOptionMap.values()).sort((left, right) => left.localeCompare(right)));
      setFollowUps(aggregatedFollowUps);
      setInquiriesById(inquiryIndex);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load follow-up dashboard";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user, effectiveBranchId, selectedBranchCode, focusInquiryId, activeSegment]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    dashboardView,
    searchTerm,
    followUpTypeFilter,
    assignedToFilter,
    scheduledByFilter,
    leadStatusFilter,
    convertibilityFilter,
    responseTypeFilter,
    genderFilter,
    clientTypeFilter,
    clientRepFilter,
    fromDate,
    toDate,
    focusInquiryId,
    focusFollowUpType,
  ]);

  const enrichedFollowUps = useMemo(
    () =>
      followUps.map((item) => {
        const inquiry = inquiriesById[item.inquiryId];
        const clientType = getFollowUpSourceType(item);
        const followUpType = deriveFollowUpType(item, inquiry);
        const clientRepId = inquiry?.clientRepStaffId ? String(inquiry.clientRepStaffId) : "";
        const assignedToId = item.assignedToStaffId ? String(item.assignedToStaffId) : "";
        const scheduledById = item.createdByStaffId ? String(item.createdByStaffId) : "";
        const legacyClientRepName =
          getLegacyFollowUpClientRep(item.outcomeNotes) ||
          getLegacyInquiryHandledBy(inquiry);
        const legacyAssignedToName =
          getLegacyFollowUpAssignedTo(item.outcomeNotes) ||
          legacyClientRepName;
        const legacyScheduledByName = legacyClientRepName || legacyAssignedToName;

        return {
          ...item,
          inquiry,
          clientType,
          followUpType,
          clientName: inquiry?.fullName || `Client #${item.memberId || item.inquiryId}`,
          mobileNumber: inquiry?.mobileNumber || "-",
          clientRepId,
          clientRepName: isMeaningfulValue(staffById[clientRepId])
            ? formatStaffDisplayName(staffById[clientRepId], clientRepId)
            : legacyClientRepName || formatStaffDisplayName(staffById[clientRepId], clientRepId),
          assignedToId,
          assignedToName: isMeaningfulValue(staffById[assignedToId])
            ? formatStaffDisplayName(staffById[assignedToId], assignedToId)
            : legacyAssignedToName || formatStaffDisplayName(staffById[assignedToId], assignedToId),
          scheduledById,
          scheduledByName: isMeaningfulValue(staffById[scheduledById])
            ? formatStaffDisplayName(staffById[scheduledById], scheduledById)
            : legacyScheduledByName || formatStaffDisplayName(staffById[scheduledById], scheduledById),
          leadStatus: inquiry?.status || "-",
          convertibility: inquiry?.convertibility || "-",
          gender: inquiry?.gender || "-",
          priority: getPriority(item.dueAt, item.overdue),
          requirement: getRequirement(item, inquiry),
        };
      }),
    [followUps, inquiriesById, staffById],
  );

  const followUpTypeOptions = useMemo(() => FOLLOW_UP_TYPE_OPTIONS, []);

  const assignedToOptions = useMemo(() => staffDirectoryOptions, [staffDirectoryOptions]);

  const scheduledByOptions = useMemo(() => staffDirectoryOptions, [staffDirectoryOptions]);

  const leadStatusOptions = useMemo(() => LEAD_STATUS_MASTER_OPTIONS.map((item) => formatLeadStatus(item)), []);

  const convertibilityOptions = useMemo(() => CONVERTIBILITY_MASTER_OPTIONS.map((item) => formatLeadStatus(item)), []);

  const responseTypeOptions = useMemo(() => RESPONSE_TYPE_MASTER_OPTIONS.map((item) => formatLeadStatus(item)), []);

  const genderOptions = useMemo(() => GENDER_MASTER_OPTIONS, []);

  const clientRepOptions = useMemo(() => staffDirectoryOptions, [staffDirectoryOptions]);

  const filteredFollowUps = useMemo(() => {
    return enrichedFollowUps
      .filter((item) => {
        const dueTime = new Date(item.dueAt).getTime();
        const now = Date.now();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayStartMs = todayStart.getTime();

        if (dashboardView === "EXPECTED") {
          if (item.status !== "SCHEDULED") {
            return false;
          }
          if (Number.isNaN(dueTime) || dueTime < todayStartMs) {
            return false;
          }
        }
        if (dashboardView === "DONE" && item.status !== "COMPLETED") {
          return false;
        }
        if (focusInquiryId && item.inquiryId !== focusInquiryId) {
          return false;
        }
        if (focusFollowUpType && String(deriveFollowUpType(item, item.inquiry)).toUpperCase() !== focusFollowUpType.toUpperCase()) {
          return false;
        }

        if (clientTypeFilter !== "ALL" && item.clientType !== clientTypeFilter) {
          return false;
        }
        if (followUpTypeFilter !== "ALL" && formatFollowUpType(item.followUpType) !== followUpTypeFilter) {
          return false;
        }
        if (assignedToFilter !== "ALL" && item.assignedToName !== assignedToFilter) {
          return false;
        }
        if (scheduledByFilter !== "ALL" && item.scheduledByName !== scheduledByFilter) {
          return false;
        }
        if (leadStatusFilter !== "ALL" && formatLeadStatus(item.leadStatus) !== leadStatusFilter) {
          return false;
        }
        if (convertibilityFilter !== "ALL" && formatLeadStatus(item.convertibility) !== convertibilityFilter) {
          return false;
        }
        if (responseTypeFilter !== "ALL" && formatLeadStatus(item.responseType) !== responseTypeFilter) {
          return false;
        }
        if (genderFilter !== "ALL" && formatLeadStatus(item.gender) !== genderFilter) {
          return false;
        }
        if (clientRepFilter !== "ALL" && item.clientRepName !== clientRepFilter) {
          return false;
        }

        if (fromDate) {
          const filterStart = new Date(`${fromDate}T00:00:00`).getTime();
          if (Number.isNaN(dueTime) || dueTime < filterStart) {
            return false;
          }
        }
        if (toDate) {
          const filterEnd = new Date(`${toDate}T23:59:59`).getTime();
          if (Number.isNaN(dueTime) || dueTime > filterEnd) {
            return false;
          }
        }

        const searchNeedle = searchTerm.trim().toLowerCase();
        if (searchNeedle) {
          const inquiryCode = formatInquiryCode(item.inquiryId, {
            branchCode: item.inquiry?.branchCode || selectedBranchCode || undefined,
            createdAt: item.createdAt,
          });
          const haystack = [
            item.clientName,
            item.mobileNumber,
            item.clientType,
            item.clientRepName,
            item.assignedToName,
            item.scheduledByName,
            item.requirement,
            inquiryCode,
            formatFollowUpType(item.followUpType),
          ]
            .join(" ")
            .toLowerCase();

          if (!haystack.includes(searchNeedle)) {
            return false;
          }
        }

        return dashboardView !== "EXPECTED" || dueTime >= now || item.status === "SCHEDULED";
      })
      .sort((left, right) => {
        if (dashboardView === "DONE") {
          const leftCompleted = new Date(left.completedAt || left.updatedAt || left.dueAt).getTime();
          const rightCompleted = new Date(right.completedAt || right.updatedAt || right.dueAt).getTime();
          return (Number.isNaN(rightCompleted) ? 0 : rightCompleted) - (Number.isNaN(leftCompleted) ? 0 : leftCompleted);
        }
        return new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
      });
  }, [
    enrichedFollowUps,
    dashboardView,
    clientTypeFilter,
    followUpTypeFilter,
    assignedToFilter,
    scheduledByFilter,
    leadStatusFilter,
    convertibilityFilter,
    responseTypeFilter,
    genderFilter,
    clientRepFilter,
    fromDate,
    toDate,
    searchTerm,
    selectedBranchCode,
    focusInquiryId,
    focusFollowUpType,
  ]);

  const counts = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(todayStart.getDate() + 1);

    return {
      total: filteredFollowUps.length,
      expected: filteredFollowUps.filter((item) => item.status === "SCHEDULED").length,
      completed: filteredFollowUps.filter((item) => item.status === "COMPLETED").length,
      overdue: filteredFollowUps.filter((item) => item.overdue).length,
      dueToday: filteredFollowUps.filter((item) => {
        const dueAt = new Date(item.dueAt).getTime();
        return dueAt >= todayStart.getTime() && dueAt < tomorrowStart.getTime();
      }).length,
    };
  }, [filteredFollowUps]);

  const totalPages = Math.max(1, Math.ceil(filteredFollowUps.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredFollowUps.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredFollowUps]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const exportCsv = useCallback(() => {
    const header = [
      "Client Name",
      "Mobile",
      "Client Type",
      "Client Rep",
      "Follow-up Type",
      "Assigned To",
      "Scheduled By",
      "Lead Status",
      "Convertibility",
      "Response",
      "Due At",
      "Status",
      "Comment",
    ];
    const rows = filteredFollowUps.map((item) =>
      [
        item.clientName,
        item.mobileNumber,
        item.clientType,
        item.clientRepName,
        formatFollowUpType(item.followUpType),
        item.assignedToName,
        item.scheduledByName,
        formatLeadStatus(item.leadStatus),
        formatLeadStatus(item.convertibility),
        formatLeadStatus(item.responseType),
        formatDateTime(item.dueAt),
        humanizeText(item.status),
        item.requirement,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "follow-ups-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredFollowUps]);

  const staffSelectOptions = useMemo(
    () =>
      Object.entries(staffById)
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [staffById],
  );

  const openHistory = useCallback(async (item: { inquiryId: number; clientName: string }) => {
    if (!token) {
      return;
    }
    setHistoryFor(item);
    setHistoryLoading(true);
    try {
      const rows = await subscriptionFollowUpService.listInquiryFollowUps(token, item.inquiryId);
      setHistoryRows(
        [...rows].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
      );
    } catch (historyError) {
      const message = historyError instanceof Error ? historyError.message : "Unable to load follow-up history";
      setToast({ kind: "error", message });
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [token]);

  const submitAdditionalFollowUp = useCallback(async () => {
    if (!token || !addFollowUpFor) {
      return;
    }
    const createdByStaffId = resolveStaffId(user);
    if (!createdByStaffId) {
      setToast({ kind: "error", message: "Unable to resolve current staff identity." });
      return;
    }
    if (!addFollowUpForm.assignedToStaffId || !addFollowUpForm.dueAt) {
      setToast({ kind: "error", message: "Assigned staff and follow-up date/time are required." });
      return;
    }

    try {
      await subscriptionFollowUpService.createFollowUp(token, addFollowUpFor.inquiryId, {
        assignedToStaffId: Number(addFollowUpForm.assignedToStaffId),
        createdByStaffId,
        dueAt: addFollowUpForm.dueAt,
        channel: addFollowUpForm.channel,
        followUpType: addFollowUpForm.followUpType,
        responseType: addFollowUpForm.responseType,
        notes: addFollowUpForm.notes.trim() || undefined,
      });
      setToast({ kind: "success", message: "Follow-up added." });
      setAddFollowUpFor(null);
      setAddFollowUpForm({
        dueAt: "",
        assignedToStaffId: "",
        channel: "CALL",
        followUpType: "ENQUIRY",
        responseType: "NEEDS_DETAILS",
        notes: "",
      });
      await loadQueue();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Unable to add follow-up";
      setToast({ kind: "error", message });
    }
  }, [token, addFollowUpFor, addFollowUpForm, user, loadQueue]);

  if (loading) {
    return <PageLoader label="Loading follow-ups..." />;
  }

  return (
    <div className="space-y-8">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
      <div>
        <h1 className="text-2xl font-bold text-white">Follow-up Dashboard</h1>
        <p className="text-slate-400">Access-scoped follow-up queue with quick actions, history, and filtering.</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {[
            { value: "ALL", label: "All Follow-ups" },
            { value: "EXPECTED", label: "Expected Follow-ups" },
            { value: "DONE", label: "Done Follow-ups" },
          ].map((option) => {
            const active = dashboardView === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setDashboardView(option.value as DashboardView)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${active ? "bg-[#c42924] text-white" : "text-slate-300 hover:bg-white/[0.05]"}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {[
          { label: "Total Follow-ups", value: counts.total },
          { label: "Expected", value: counts.expected },
          { label: "Done", value: counts.completed },
          { label: "Overdue", value: counts.overdue },
          { label: "Due Today", value: counts.dueToday },
        ].map((item) => (
          <article key={item.label} className="rounded-2xl border border-white/10 bg-[#111821] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
            <p className="mt-2 text-3xl font-bold text-white">{item.value}</p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[#131925] p-2">
        {([
          { key: "LEADS", label: "Leads", hint: "Open enquiries" },
          { key: "MEMBER_RENEWALS", label: "Member Renewals", hint: "Renewals · Balance due · Freeze" },
        ] as const).map((tab) => {
          const isActive = activeSegment === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                if (!isActive) {
                  setActiveSegment(tab.key);
                  setCurrentPage(1);
                }
              }}
              className={
                "flex flex-col items-start rounded-xl px-4 py-2 text-left transition " +
                (isActive
                  ? "bg-[#c42924] text-white shadow-[0_12px_30px_rgba(196,41,36,0.35)]"
                  : "text-slate-300 hover:bg-white/[0.06]")
              }
            >
              <span className="text-sm font-semibold">{tab.label}</span>
              <span className={"text-[11px] uppercase tracking-[0.14em] " + (isActive ? "text-white/80" : "text-slate-500")}>
                {tab.hint}
              </span>
            </button>
          );
        })}
      </div>

      <SectionCard
        title="Follow-up Analysis"
        subtitle="Filter, review, and export branch follow-up activity."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              <Filter className="h-4 w-4" />
              Filters
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Refresh
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <input
            className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#c42924]/60"
            placeholder="Search client, mobile, follow-up type, comment, or inquiry code"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          {filtersOpen ? (
          <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Follow-up Type
              <select value={followUpTypeFilter} onChange={(event) => setFollowUpTypeFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Follow-up Types</option>
                {followUpTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Assigned To
              <select value={assignedToFilter} onChange={(event) => setAssignedToFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Assignees</option>
                {assignedToOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Scheduled By
              <select value={scheduledByFilter} onChange={(event) => setScheduledByFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Schedulers</option>
                {scheduledByOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Client Type
              <select value={clientTypeFilter} onChange={(event) => setClientTypeFilter(event.target.value as ClientTypeFilter)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Clients</option>
                <option value="INQUIRY">Inquiry</option>
                <option value="MEMBER">Member</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Lead Status
              <select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Statuses</option>
                {leadStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Response
              <select value={responseTypeFilter} onChange={(event) => setResponseTypeFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Responses</option>
                {responseTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Convertibility
              <select value={convertibilityFilter} onChange={(event) => setConvertibilityFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Convertibility</option>
                {convertibilityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Gender
              <select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Genders</option>
                {genderOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Client Rep
              <select value={clientRepFilter} onChange={(event) => setClientRepFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60">
                <option value="ALL">All Client Reps</option>
                {clientRepOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              From Date
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60" />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              To Date
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60" />
            </label>
          </div>
          </>
          ) : null}
        </div>

        <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8 bg-[#111821]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Rep</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Assigned / Scheduled</th>
                  <th className="px-4 py-3">Comment</th>
                  <th className="px-4 py-3">Next Follow-up</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-400" colSpan={8}>No follow-ups found.</td>
                  </tr>
                ) : (
                  paginatedRows.map((item) => {
                    const isRenewal =
                      item.followUpType === "MEMBERSHIP_RENEWAL" ||
                      item.followUpType === "PT_RENEWAL";
                    const expectedAmount = isRenewal ? extractExpectedAmount(item, item.inquiry) : "";
                    return (
                      <tr key={item.followUpId} className="align-top hover:bg-white/[0.02]">
                        <td className="px-4 py-4">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-white">{item.clientName}</p>
                              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${typeClass(item.clientType)}`}>{item.clientType}</span>
                              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priorityClass(item.priority)}`}>{item.priority}</span>
                              {item.overdue ? <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-200">Overdue</span> : null}
                            </div>
                            <p className="text-xs text-slate-400">{item.mobileNumber}</p>
                            <p className="text-[11px] text-slate-500">
                              {formatInquiryCode(item.inquiryId, {
                                branchCode: item.inquiry?.branchCode || selectedBranchCode || undefined,
                                createdAt: item.createdAt,
                              })}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="space-y-1">
                            <p>{item.clientRepName}</p>
                            <p className="text-xs text-slate-400">{formatLeadStatus(item.leadStatus)} • {formatLeadStatus(item.convertibility)}</p>
                            <p className="text-xs text-slate-500">{formatLeadStatus(item.gender)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="space-y-1">
                            <p>{formatFollowUpType(item.followUpType)}</p>
                            <p className="text-xs text-slate-500">{formatLeadStatus(item.responseType)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="space-y-1">
                            <p>Assigned: {item.assignedToName}</p>
                            <p className="text-xs text-slate-500">Scheduled by: {item.scheduledByName}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="max-w-sm space-y-1 text-sm leading-6">
                            <p>{item.requirement}</p>
                            {isRenewal ? (
                              <p className="text-xs text-slate-500">
                                Expected date: {formatDateTime(item.dueAt)}
                                {expectedAmount ? ` • Expected amount: ${expectedAmount}` : ""}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="space-y-1">
                            <p>Next: {formatDateTime(item.dueAt)}</p>
                            <p className="text-xs text-slate-500">Commented: {formatDateTime(item.createdAt)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-slate-300">
                          <div className="space-y-1">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusClass(item.overdue ? "OVERDUE" : item.status)}`}>
                              {humanizeText(item.overdue ? "OVERDUE" : item.status)}
                            </span>
                            {item.completedAt ? <p className="text-xs text-slate-500">Completed {formatDateTime(item.completedAt)}</p> : null}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void openHistory({ inquiryId: item.inquiryId, clientName: item.clientName })}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                            >
                              <History className="h-4 w-4" />
                              History
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddFollowUpFor({
                                  inquiryId: item.inquiryId,
                                  clientName: item.clientName,
                                  assignedToStaffId: item.assignedToId || undefined,
                                });
                                setAddFollowUpForm((current) => ({
                                  ...current,
                                  assignedToStaffId: item.assignedToId || "",
                                  followUpType: (item.followUpType as FollowUpType) || "ENQUIRY",
                                  dueAt: "",
                                  notes: "",
                                }));
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-[#c42924]/30 bg-[#c42924]/12 px-3 py-2 text-xs font-semibold text-white hover:bg-[#c42924]/20"
                            >
                              <PlusCircle className="h-4 w-4" />
                              Follow-up Response
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400">
            Showing {(currentPage - 1) * PAGE_SIZE + (paginatedRows.length > 0 ? 1 : 0)}-
            {(currentPage - 1) * PAGE_SIZE + paginatedRows.length} of {filteredFollowUps.length}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
            <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">Page {currentPage} of {totalPages}</span>
            <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50">Next</button>
          </div>
        </div>
      </SectionCard>

      <Modal
        open={Boolean(historyFor)}
        title={historyFor ? `Follow-up History · ${historyFor.clientName}` : "Follow-up History"}
        onClose={() => {
          setHistoryFor(null);
          setHistoryRows([]);
        }}
      >
        {historyLoading ? (
          <p className="text-sm text-slate-300">Loading history...</p>
        ) : historyRows.length === 0 ? (
          <p className="text-sm text-slate-400">No follow-up history found.</p>
        ) : (
          <div className="space-y-3">
            {historyRows.map((row) => (
              <div key={row.followUpId} className="rounded-2xl border border-white/10 bg-[#111821] p-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusClass(row.status)}`}>
                    {humanizeText(row.status)}
                  </span>
                  <span className="text-xs text-slate-400">{formatDateTime(row.dueAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-white">{formatFollowUpType(deriveFollowUpType(row, inquiriesById[row.inquiryId]))}</p>
                <p className="mt-1 text-sm text-slate-300">{row.notes || row.outcomeNotes || "No notes added."}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Scheduled by {
                    isMeaningfulValue(staffById[String(row.createdByStaffId || "")])
                      ? formatStaffDisplayName(staffById[String(row.createdByStaffId || "")], String(row.createdByStaffId || ""))
                      : getLegacyFollowUpClientRep(row.outcomeNotes) ||
                        getLegacyFollowUpAssignedTo(row.outcomeNotes) ||
                        getLegacyInquiryHandledBy(inquiriesById[row.inquiryId]) ||
                        formatStaffDisplayName(staffById[String(row.createdByStaffId || "")], String(row.createdByStaffId || ""))
                  }
                </p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(addFollowUpFor)}
        title={addFollowUpFor ? `Add Follow-up · ${addFollowUpFor.clientName}` : "Add Follow-up"}
        onClose={() => setAddFollowUpFor(null)}
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Due At</span>
            <input
              type="datetime-local"
              className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60"
              value={addFollowUpForm.dueAt}
              onChange={(event) => setAddFollowUpForm((current) => ({ ...current, dueAt: event.target.value }))}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Assigned Staff</span>
            <select
              className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60"
              value={addFollowUpForm.assignedToStaffId}
              onChange={(event) => setAddFollowUpForm((current) => ({ ...current, assignedToStaffId: event.target.value }))}
            >
              <option value="">Select assignee</option>
              {staffSelectOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Follow-up Type</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60"
                value={addFollowUpForm.followUpType}
                onChange={(event) => setAddFollowUpForm((current) => ({ ...current, followUpType: event.target.value as FollowUpType }))}
              >
                {followUpTypeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Channel</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60"
                value={addFollowUpForm.channel}
                onChange={(event) => setAddFollowUpForm((current) => ({ ...current, channel: event.target.value as FollowUpRecord["channel"] }))}
              >
                {["CALL", "WHATSAPP", "SMS", "EMAIL", "VISIT"].map((option) => (
                  <option key={option} value={option}>{humanizeText(option)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Notes</span>
            <textarea
              rows={4}
              className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none focus:border-[#c42924]/60"
              value={addFollowUpForm.notes}
              onChange={(event) => setAddFollowUpForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setAddFollowUpFor(null)}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitAdditionalFollowUp()}
              className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b]"
            >
              Save Follow-up
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
