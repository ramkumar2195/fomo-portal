"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, CalendarClock, CheckCheck, CircleCheckBig, FolderOpen, Inbox, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatInquiryCode } from "@/lib/inquiry-code";
import { normalizeInquirySourceLabel } from "@/lib/inquiry-source";
import { resolveStaffId } from "@/lib/staff-id";
import { FollowUpChannel, FollowUpRecord } from "@/types/follow-up";
import {
  CreateInquiryRequest,
  InquiryAnalyticsResponse,
  InquiryConvertibility,
  InquiryCustomerStatus,
  InquiryRecord,
  InquiryResponseType,
  InquirySearchQuery,
  InquiryStatus,
  InquiryStatusHistoryEntry,
  PreferredContactChannel,
  UpdateInquiryRequest,
} from "@/types/inquiry";
import { BranchResponse } from "@/types/admin";
import { UserDirectoryItem } from "@/types/models";
import { SpringPage } from "@/types/pagination";

type ViewMode = "TABLE" | "KANBAN";
type InquiryModalMode = "CREATE" | "EDIT";

interface InquiryFormState {
  fullName: string;
  mobileNumber: string;
  email: string;
  promotionSource: string;
  status: InquiryStatus;
  convertibility: InquiryConvertibility;
  assignedToStaffId: string;
  responseType: InquiryResponseType | "";
  preferredContactChannel: PreferredContactChannel | "";
  interestedIn: string;
  customerStatus: InquiryCustomerStatus | "";
  followUpComment: string;
  trialGiven: boolean;
  trialDays: string;
  trialAttempts: string;
  trialExpiryAt: string;
  notes: string;
  remarks: string;
}

interface FollowUpFormState {
  dueAt: string;
  channel: FollowUpChannel;
  assignedToStaffId: string;
  notes: string;
}

interface AssignFormState {
  assignedToStaffId: string;
  remarks: string;
}

interface CloseFormState {
  status: "NOT_INTERESTED" | "LOST";
  closeReason: string;
  remarks: string;
}

interface ConvertFormState {
  memberId: string;
  remarks: string;
}

interface BranchFilterOption {
  id: string;
  label: string;
  branchCode?: string;
}

interface SummaryCard {
  title: string;
  value: number;
  icon: ReactNode;
  iconClass: string;
}

const PAGE_SIZE = 10;

const INQUIRY_STATUSES: InquiryStatus[] = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "TRIAL_BOOKED",
  "CONVERTED",
  "NOT_INTERESTED",
  "LOST",
];

const CONVERTIBILITY_VALUES: InquiryConvertibility[] = ["HOT", "WARM", "COLD"];
const RESPONSE_TYPES: InquiryResponseType[] = [
  "READY_TO_PAY",
  "ASKED_CALLBACK",
  "NEEDS_DETAILS",
  "REQUESTED_TRIAL",
  "NOT_INTERESTED",
  "OTHER",
];
const CUSTOMER_STATUSES: InquiryCustomerStatus[] = [
  "NEW_LEAD",
  "EXISTING_MEMBER",
  "FORMER_MEMBER",
  "CORPORATE",
  "STUDENT",
  "OTHER",
];
const CONTACT_CHANNELS: PreferredContactChannel[] = ["CALL", "WHATSAPP", "SMS", "EMAIL", "VISIT"];
const FOLLOW_UP_CHANNELS: FollowUpChannel[] = ["CALL", "WHATSAPP", "SMS", "EMAIL", "VISIT"];

function formatInquiryResponseType(value: InquiryResponseType | ""): string {
  switch (value) {
    case "NEEDS_DETAILS":
      return "New Follow-up";
    case "ASKED_CALLBACK":
      return "Follow-up Again";
    case "REQUESTED_TRIAL":
      return "Trial Booked";
    case "READY_TO_PAY":
      return "Ready to Convert";
    case "NOT_INTERESTED":
      return "Not Interested";
    case "OTHER":
      return "Successful Follow-up";
    default:
      return value ? value.replace(/_/g, " ") : "";
  }
}

const EMPTY_PAGE: SpringPage<InquiryRecord> = {
  content: [],
  number: 0,
  size: PAGE_SIZE,
  totalElements: 0,
  totalPages: 1,
  first: true,
  last: true,
  empty: true,
  numberOfElements: 0,
};

const EMPTY_INQUIRY_FORM: InquiryFormState = {
  fullName: "",
  mobileNumber: "",
  email: "",
  promotionSource: "",
  status: "NEW",
  convertibility: "WARM",
  assignedToStaffId: "",
  responseType: "",
  preferredContactChannel: "",
  interestedIn: "",
  customerStatus: "",
  followUpComment: "",
  trialGiven: false,
  trialDays: "",
  trialAttempts: "",
  trialExpiryAt: "",
  notes: "",
  remarks: "",
};

const EMPTY_FOLLOW_UP_FORM: FollowUpFormState = {
  dueAt: "",
  channel: "CALL",
  assignedToStaffId: "",
  notes: "",
};

function toLocalDateInput(value?: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function toIsoDateTime(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function buildInquiryForm(record?: InquiryRecord | null): InquiryFormState {
  if (!record) {
    return EMPTY_INQUIRY_FORM;
  }

  return {
    fullName: record.fullName || "",
    mobileNumber: record.mobileNumber || "",
    email: record.email || "",
    promotionSource: record.promotionSource || "",
    status: record.status || "NEW",
    convertibility: record.convertibility || "WARM",
    assignedToStaffId: String(record.assignedToStaffId ?? record.clientRepStaffId ?? ""),
    responseType: record.responseType || "",
    preferredContactChannel: record.preferredContactChannel || "",
    interestedIn: record.interestedIn || "",
    customerStatus: record.customerStatus || "",
    followUpComment: record.followUpComment || "",
    trialGiven: Boolean(record.trialGiven),
    trialDays: record.trialDays !== undefined && record.trialDays !== null ? String(record.trialDays) : "",
    trialAttempts: record.trialAttempts !== undefined && record.trialAttempts !== null ? String(record.trialAttempts) : "",
    trialExpiryAt: toLocalDateInput(record.trialExpiryAt),
    notes: record.notes || "",
    remarks: record.remarks || "",
  };
}

function buildCreatePayload(form: InquiryFormState): CreateInquiryRequest {
  return {
    fullName: form.fullName.trim(),
    mobileNumber: form.mobileNumber.trim(),
    email: form.email.trim() || undefined,
    promotionSource: form.promotionSource.trim() || undefined,
    status: form.status,
    convertibility: form.convertibility,
    assignedToStaffId: toOptionalNumber(form.assignedToStaffId),
    clientRepStaffId: toOptionalNumber(form.assignedToStaffId),
    responseType: form.responseType || undefined,
    preferredContactChannel: form.preferredContactChannel || undefined,
    interestedIn: form.interestedIn.trim() || undefined,
    customerStatus: form.customerStatus || undefined,
    followUpComment: form.followUpComment.trim() || undefined,
    trialGiven: form.trialGiven,
    trialDays: toOptionalNumber(form.trialDays),
    trialAttempts: toOptionalNumber(form.trialAttempts),
    trialExpiryAt: form.trialExpiryAt ? new Date(form.trialExpiryAt).toISOString() : undefined,
    notes: form.notes.trim() || undefined,
    remarks: form.remarks.trim() || undefined,
  };
}

function buildUpdatePayload(form: InquiryFormState): UpdateInquiryRequest {
  return {
    fullName: form.fullName.trim() || undefined,
    mobileNumber: form.mobileNumber.trim() || undefined,
    email: form.email.trim() || undefined,
    promotionSource: form.promotionSource.trim() || undefined,
    status: form.status,
    convertibility: form.convertibility,
    assignedToStaffId: toOptionalNumber(form.assignedToStaffId),
    clientRepStaffId: toOptionalNumber(form.assignedToStaffId),
    responseType: form.responseType || undefined,
    preferredContactChannel: form.preferredContactChannel || undefined,
    interestedIn: form.interestedIn.trim() || undefined,
    customerStatus: form.customerStatus || undefined,
    followUpComment: form.followUpComment.trim() || undefined,
    trialGiven: form.trialGiven,
    trialDays: toOptionalNumber(form.trialDays),
    trialAttempts: toOptionalNumber(form.trialAttempts),
    trialExpiryAt: form.trialExpiryAt ? new Date(form.trialExpiryAt).toISOString() : undefined,
    notes: form.notes.trim() || undefined,
    remarks: form.remarks.trim() || undefined,
  };
}

function statusColor(status: InquiryStatus): string {
  if (status === "CONVERTED") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "LOST" || status === "NOT_INTERESTED") {
    return "bg-rose-100 text-rose-700";
  }
  if (status === "TRIAL_BOOKED") {
    return "bg-sky-100 text-sky-700";
  }
  if (status === "FOLLOW_UP") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-slate-100 text-slate-700";
}

function convertibilityColor(value?: InquiryConvertibility): string {
  if (value === "HOT") {
    return "bg-rose-100 text-rose-700";
  }
  if (value === "COLD") {
    return "bg-sky-100 text-sky-700";
  }
  return "bg-amber-100 text-amber-700";
}

function getAnalyticsNumber(payload: InquiryAnalyticsResponse, keys: string[]): number {
  for (const key of keys) {
    const value = payload[key];
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

export default function LeadsPage() {
  const { token, user } = useAuth();
  const actingStaffId = resolveStaffId(user);

  const [viewMode, setViewMode] = useState<ViewMode>("TABLE");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [convertibilityFilter, setConvertibilityFilter] = useState("ALL");
  const [convertedFilter, setConvertedFilter] = useState("ALL");
  const [branchFilterId, setBranchFilterId] = useState("ALL");
  const [assignedFilter, setAssignedFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [closeReasonFilter, setCloseReasonFilter] = useState("");

  const [inquiriesPage, setInquiriesPage] = useState<SpringPage<InquiryRecord>>(EMPTY_PAGE);
  const [analytics, setAnalytics] = useState<InquiryAnalyticsResponse>({});
  const [followUpQueue, setFollowUpQueue] = useState<FollowUpRecord[]>([]);
  const [branchOptions, setBranchOptions] = useState<BranchFilterOption[]>([{ id: "ALL", label: "All Branches" }]);
  const [staffOptions, setStaffOptions] = useState<UserDirectoryItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [page, setPage] = useState(0);

  const [selectedInquiryIds, setSelectedInquiryIds] = useState<number[]>([]);
  const [bulkAssignStaffId, setBulkAssignStaffId] = useState("");

  const [inquiryModalMode, setInquiryModalMode] = useState<InquiryModalMode | null>(null);
  const [selectedInquiry, setSelectedInquiry] = useState<InquiryRecord | null>(null);
  const [inquiryForm, setInquiryForm] = useState<InquiryFormState>(EMPTY_INQUIRY_FORM);

  const [followUpInquiry, setFollowUpInquiry] = useState<InquiryRecord | null>(null);
  const [followUpForm, setFollowUpForm] = useState<FollowUpFormState>(EMPTY_FOLLOW_UP_FORM);

  const [assignInquiry, setAssignInquiry] = useState<InquiryRecord | null>(null);
  const [assignForm, setAssignForm] = useState<AssignFormState>({ assignedToStaffId: "", remarks: "" });

  const [closeInquiry, setCloseInquiry] = useState<InquiryRecord | null>(null);
  const [closeForm, setCloseForm] = useState<CloseFormState>({
    status: "LOST",
    closeReason: "",
    remarks: "",
  });

  const [convertInquiry, setConvertInquiry] = useState<InquiryRecord | null>(null);
  const [convertForm, setConvertForm] = useState<ConvertFormState>({ memberId: "", remarks: "" });

  const [historyInquiry, setHistoryInquiry] = useState<InquiryRecord | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<InquiryStatusHistoryEntry[]>([]);

  useEffect(() => {
    const modalOpen = Boolean(inquiryModalMode || followUpInquiry || assignInquiry || closeInquiry || convertInquiry || historyInquiry);
    if (!modalOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [assignInquiry, closeInquiry, convertInquiry, followUpInquiry, historyInquiry, inquiryModalMode]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [search]);

  const selectedBranch = useMemo(
    () => branchOptions.find((branch) => branch.id === branchFilterId) || null,
    [branchFilterId, branchOptions],
  );

  const selectedBranchCode = useMemo(() => {
    if (!selectedBranch || selectedBranch.id === "ALL") {
      return undefined;
    }
    return selectedBranch.branchCode || undefined;
  }, [selectedBranch]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const page = await branchService.listBranches(token, { page: 0, size: 200 });
        const nextOptions: BranchFilterOption[] = [
          { id: "ALL", label: "All Branches" },
          ...page.content.map((branch: BranchResponse) => ({
            id: String(branch.id),
            label: branch.name,
            branchCode: branch.branchCode,
          })),
        ];
        if (active) {
          setBranchOptions(nextOptions);
        }
      } catch {
        if (active) {
          setBranchOptions([{ id: "ALL", label: "All Branches" }]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      try {
        if (branchFilterId !== "ALL") {
          const page = await branchService.getBranchStaff(token, branchFilterId, {
            active: true,
            page: 0,
            size: 200,
          });
          if (active) {
            setStaffOptions(page.content);
          }
          return;
        }

        const rows = await usersService.searchUsers(token, {
          role: "STAFF",
          active: true,
        });
        if (active) {
          setStaffOptions(rows);
        }
      } catch {
        if (active) {
          setStaffOptions([]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchFilterId, token]);

  useEffect(() => {
    if (assignedFilter === "ALL") {
      return;
    }
    if (!staffOptions.some((staff) => staff.id === assignedFilter)) {
      setAssignedFilter("ALL");
    }
  }, [assignedFilter, staffOptions]);

  const loadLeads = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    const assignedTo = assignedFilter === "ALL" ? undefined : toOptionalNumber(assignedFilter);
    const converted = convertedFilter === "ALL" ? undefined : convertedFilter === "TRUE";
    const query: InquirySearchQuery = {
      query: debouncedSearch || undefined,
      status: statusFilter !== "ALL" ? statusFilter : undefined,
      convertibility: convertibilityFilter !== "ALL" ? convertibilityFilter : undefined,
      closeReason: closeReasonFilter.trim() || undefined,
      assignedToStaffId: assignedTo,
      converted,
      from: fromDate || undefined,
      to: toDate || undefined,
      branchCode: selectedBranchCode,
    };

    try {
      const [inquiries, analyticsData, followUps] = await Promise.all([
        subscriptionService.searchInquiriesPaged(token, query, page, PAGE_SIZE),
        subscriptionService.getInquiryAnalytics(token, {
          assignedToStaffId: assignedTo,
          branchCode: selectedBranchCode,
          from: fromDate || undefined,
          to: toDate || undefined,
        }),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            assignedToStaffId: assignedTo,
            dueFrom: fromDate ? `${fromDate}T00:00:00` : undefined,
            dueTo: toDate ? `${toDate}T23:59:59` : undefined,
          },
          0,
          250,
        ),
      ]);

      setInquiriesPage(inquiries);
      setAnalytics(analyticsData);
      setFollowUpQueue(followUps.content);
      setSelectedInquiryIds([]);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Unable to load enquiries.");
    } finally {
      setLoading(false);
    }
  }, [assignedFilter, closeReasonFilter, convertibilityFilter, debouncedSearch, fromDate, page, selectedBranchCode, statusFilter, toDate, token, convertedFilter]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    staffOptions.forEach((staff) => {
      map.set(staff.id, staff.name);
    });
    return map;
  }, [staffOptions]);

  const followUpByInquiry = useMemo(() => {
    const map = new Map<number, FollowUpRecord[]>();
    followUpQueue.forEach((row) => {
      const current = map.get(row.inquiryId) || [];
      current.push(row);
      map.set(row.inquiryId, current);
    });
    map.forEach((rows) => {
      rows.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    });
    return map;
  }, [followUpQueue]);

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const total = getAnalyticsNumber(analytics, ["total", "totalInquiries"]) || inquiriesPage.totalElements;
    const open = getAnalyticsNumber(analytics, ["open", "openInquiries"]);
    const converted = getAnalyticsNumber(analytics, ["converted", "convertedInquiries"]);
    const closed = getAnalyticsNumber(analytics, ["closed", "closedInquiries"]);
    const dueToday = getAnalyticsNumber(analytics, ["followUpsDueToday"]);
    const overdue = getAnalyticsNumber(analytics, ["followUpsOverdue"]);

    return [
      {
        title: "Total Enquiries",
        value: total,
        icon: <Inbox className="h-4 w-4" />,
        iconClass: "bg-slate-100 text-slate-700",
      },
      {
        title: "Open",
        value: open,
        icon: <FolderOpen className="h-4 w-4" />,
        iconClass: "bg-sky-100 text-sky-700",
      },
      {
        title: "Converted",
        value: converted,
        icon: <CircleCheckBig className="h-4 w-4" />,
        iconClass: "bg-emerald-100 text-emerald-700",
      },
      {
        title: "Closed",
        value: closed,
        icon: <Archive className="h-4 w-4" />,
        iconClass: "bg-slate-200 text-slate-700",
      },
      {
        title: "Follow-ups Today",
        value: dueToday,
        icon: <CalendarClock className="h-4 w-4" />,
        iconClass: "bg-amber-100 text-amber-700",
      },
      {
        title: "Overdue Follow-ups",
        value: overdue,
        icon: <AlertTriangle className="h-4 w-4" />,
        iconClass: "bg-rose-100 text-rose-700",
      },
    ];
  }, [analytics, inquiriesPage.totalElements]);

  const kanbanColumns = useMemo(
    () => [
      { label: "New", statuses: ["NEW"] as InquiryStatus[] },
      { label: "Contacted", statuses: ["CONTACTED"] as InquiryStatus[] },
      { label: "Follow-up", statuses: ["FOLLOW_UP"] as InquiryStatus[] },
      { label: "Trial", statuses: ["TRIAL_BOOKED"] as InquiryStatus[] },
      { label: "Converted", statuses: ["CONVERTED"] as InquiryStatus[] },
      { label: "Closed", statuses: ["NOT_INTERESTED", "LOST"] as InquiryStatus[] },
    ],
    [],
  );

  const openCreateModal = () => {
    setSelectedInquiry(null);
    setInquiryForm(EMPTY_INQUIRY_FORM);
    setInquiryModalMode("CREATE");
  };

  const openEditModal = (row: InquiryRecord) => {
    setSelectedInquiry(row);
    setInquiryForm(buildInquiryForm(row));
    setInquiryModalMode("EDIT");
  };

  const submitInquiry = async () => {
    if (!token) {
      return;
    }

    if (!inquiryForm.fullName.trim() || !inquiryForm.mobileNumber.trim()) {
      setError("Full name and mobile number are required.");
      return;
    }

    setSubmitting(true);
    try {
      if (inquiryModalMode === "CREATE") {
        await subscriptionService.createInquiry(token, buildCreatePayload(inquiryForm));
      }

      if (inquiryModalMode === "EDIT" && selectedInquiry) {
        await subscriptionService.updateInquiry(token, selectedInquiry.inquiryId, buildUpdatePayload(inquiryForm));
      }

      setInquiryModalMode(null);
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to save enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitFollowUp = async () => {
    if (!token || !followUpInquiry) {
      return;
    }

    const assignedToStaffId = toOptionalNumber(followUpForm.assignedToStaffId);
    const createdBy = actingStaffId || assignedToStaffId;
    const dueAt = toIsoDateTime(followUpForm.dueAt);

    if (!dueAt || !assignedToStaffId || !createdBy) {
      setError("Follow-up due date/time and assignee are required.");
      return;
    }

    setSubmitting(true);
    try {
      await subscriptionFollowUpService.createFollowUp(token, followUpInquiry.inquiryId, {
        dueAt,
        channel: followUpForm.channel,
        assignedToStaffId,
        createdByStaffId: createdBy,
        notes: followUpForm.notes.trim() || undefined,
      });
      setFollowUpInquiry(null);
      setFollowUpForm(EMPTY_FOLLOW_UP_FORM);
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to schedule follow-up.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitAssign = async () => {
    if (!token || !assignInquiry) {
      return;
    }

    const assignedTo = toOptionalNumber(assignForm.assignedToStaffId);
    if (!assignedTo) {
      setError("Please choose staff to assign.");
      return;
    }

    setSubmitting(true);
    try {
      await subscriptionService.assignInquiry(token, assignInquiry.inquiryId, {
        assignedToStaffId: assignedTo,
        changedByStaffId: actingStaffId || undefined,
        remarks: assignForm.remarks.trim() || undefined,
      });
      setAssignInquiry(null);
      setAssignForm({ assignedToStaffId: "", remarks: "" });
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to assign enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitBulkAssign = async () => {
    if (!token || selectedInquiryIds.length === 0) {
      return;
    }

    const assignedTo = toOptionalNumber(bulkAssignStaffId);
    if (!assignedTo) {
      setError("Select staff for bulk assignment.");
      return;
    }

    setSubmitting(true);
    try {
      await subscriptionService.bulkAssignInquiries(token, {
        inquiryIds: selectedInquiryIds,
        assignedToStaffId: assignedTo,
        changedByStaffId: actingStaffId || undefined,
      });
      setBulkAssignStaffId("");
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to bulk assign enquiries.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitClose = async () => {
    if (!token || !closeInquiry) {
      return;
    }

    if (!closeForm.closeReason.trim()) {
      setError("Close reason is required.");
      return;
    }

    setSubmitting(true);
    try {
      await subscriptionService.closeInquiry(token, closeInquiry.inquiryId, {
        status: closeForm.status,
        closeReason: closeForm.closeReason.trim(),
        changedByStaffId: actingStaffId || undefined,
        remarks: closeForm.remarks.trim() || undefined,
      });
      setCloseInquiry(null);
      setCloseForm({ status: "LOST", closeReason: "", remarks: "" });
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to close enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitConvert = async () => {
    if (!token || !convertInquiry) {
      return;
    }

    setSubmitting(true);
    try {
      await subscriptionService.convertInquiry(token, String(convertInquiry.inquiryId), {
        memberId: toOptionalNumber(convertForm.memberId),
        changedByStaffId: actingStaffId || undefined,
        remarks: convertForm.remarks.trim() || undefined,
      });
      setConvertInquiry(null);
      setConvertForm({ memberId: "", remarks: "" });
      await loadLeads();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Unable to convert enquiry.");
    } finally {
      setSubmitting(false);
    }
  };

  const openHistory = async (row: InquiryRecord) => {
    if (!token) {
      return;
    }

    setHistoryInquiry(row);
    setHistoryLoading(true);
    setHistoryRows([]);
    try {
      const response = await subscriptionService.getInquiryStatusHistory(token, row.inquiryId);
      setHistoryRows(response);
    } catch (historyError) {
      setError(historyError instanceof ApiError ? historyError.message : "Unable to load status history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleSelected = (inquiryId: number, checked: boolean) => {
    setSelectedInquiryIds((current) => {
      if (checked) {
        return current.includes(inquiryId) ? current : [...current, inquiryId];
      }
      return current.filter((id) => id !== inquiryId);
    });
  };

  return (
    <AdminPageFrame
      title="Leads & Enquiries"
      description="Manage lead pipeline, assignments, follow-ups, and conversions"
      searchPlaceholder="Search by name, mobile, source..."
      searchValue={search}
      onSearchChange={(value) => {
        setPage(0);
        setSearch(value);
      }}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadLeads()}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1 rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
          >
            <Plus className="h-4 w-4" />
            Add Enquiry
          </button>
        </div>
      }
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {summaryCards.map((item) => (
          <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{item.title}</p>
                <p className="mt-2 text-2xl font-bold text-[#282828]">{item.value}</p>
              </div>
              <div className={`rounded-xl p-2 ${item.iconClass}`}>{item.icon}</div>
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <select
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={statusFilter}
            onChange={(event) => {
              setPage(0);
              setStatusFilter(event.target.value);
            }}
          >
            <option value="ALL">All Statuses</option>
            {INQUIRY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <select
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={convertibilityFilter}
            onChange={(event) => {
              setPage(0);
              setConvertibilityFilter(event.target.value);
            }}
          >
            <option value="ALL">All Convertibility</option>
            {CONVERTIBILITY_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={convertedFilter}
            onChange={(event) => {
              setPage(0);
              setConvertedFilter(event.target.value);
            }}
          >
            <option value="ALL">All Conversion</option>
            <option value="TRUE">Converted</option>
            <option value="FALSE">Not Converted</option>
          </select>

          <select
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={branchFilterId}
            onChange={(event) => {
              setPage(0);
              setBranchFilterId(event.target.value);
              setAssignedFilter("ALL");
            }}
          >
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>

          <select
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={assignedFilter}
            onChange={(event) => {
              setPage(0);
              setAssignedFilter(event.target.value);
            }}
          >
            <option value="ALL">All Staff</option>
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={fromDate}
            onChange={(event) => {
              setPage(0);
              setFromDate(event.target.value);
            }}
          />

          <input
            type="date"
            className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            value={toDate}
            onChange={(event) => {
              setPage(0);
              setToDate(event.target.value);
            }}
          />
        </div>

        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm md:max-w-xs"
            value={closeReasonFilter}
            onChange={(event) => {
              setPage(0);
              setCloseReasonFilter(event.target.value);
            }}
            placeholder="Filter by close reason..."
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("TABLE")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${viewMode === "TABLE" ? "bg-[#C42429] text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("KANBAN")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${viewMode === "KANBAN" ? "bg-[#C42429] text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Kanban
            </button>
          </div>
        </div>
      </section>

      {selectedInquiryIds.length > 0 ? (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <span>{selectedInquiryIds.length} selected</span>
          <select
            className="h-9 rounded-lg border border-sky-200 bg-white px-3 text-sm"
            value={bulkAssignStaffId}
            onChange={(event) => setBulkAssignStaffId(event.target.value)}
          >
            <option value="">Assign to staff</option>
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void submitBulkAssign()}
            disabled={submitting}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {submitting ? "Assigning..." : "Assign Selected"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedInquiryIds([])}
            className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
          >
            Clear
          </button>
        </section>
      ) : null}

      {viewMode === "TABLE" ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-3">
                    <CheckCheck className="h-4 w-4" />
                  </th>
                  <th className="px-4 py-3">Enquiry</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Convertibility</th>
                  <th className="px-4 py-3">Assigned Staff</th>
                  <th className="px-4 py-3">Next Follow-up</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {inquiriesPage.content.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={9}>
                      No enquiries found.
                    </td>
                  </tr>
                ) : (
                  inquiriesPage.content.map((row) => {
                    const assignedId = row.assignedToStaffId ?? row.clientRepStaffId;
                    const assignedLabel = assignedId ? staffNameById.get(String(assignedId)) || `Staff ${assignedId}` : "-";
                    const nextFollowUp = followUpByInquiry.get(row.inquiryId)?.[0];
                    const isFinalized =
                      row.status === "CONVERTED" || row.status === "NOT_INTERESTED" || row.status === "LOST" || row.converted;

                    return (
                      <tr key={row.inquiryId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedInquiryIds.includes(row.inquiryId)}
                            onChange={(event) => toggleSelected(row.inquiryId, event.target.checked)}
                            disabled={isFinalized}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{row.fullName}</p>
                          <p className="text-xs text-slate-500">{row.mobileNumber}</p>
                          <p className="text-xs text-slate-400">
                            {formatInquiryCode(row.inquiryId, {
                              branchCode: row.branchCode,
                              createdAt: row.createdAt || row.inquiryAt,
                            })}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{normalizeInquirySourceLabel(row.promotionSource)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusColor(row.status)}`}>{row.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${convertibilityColor(row.convertibility)}`}>
                            {row.convertibility || "-"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{assignedLabel}</td>
                        <td className="px-4 py-3">
                          <p className="text-slate-700">{nextFollowUp ? formatDateTime(nextFollowUp.dueAt) : "-"}</p>
                          {nextFollowUp?.overdue ? <p className="text-xs font-semibold text-rose-600">Overdue</p> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(row.updatedAt || row.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {isFinalized ? (
                              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Finalized</span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(row)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAssignInquiry(row);
                                    setAssignForm({
                                      assignedToStaffId: String(row.assignedToStaffId ?? row.clientRepStaffId ?? ""),
                                      remarks: "",
                                    });
                                  }}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Assign
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFollowUpInquiry(row);
                                    setFollowUpForm({
                                      ...EMPTY_FOLLOW_UP_FORM,
                                      assignedToStaffId: String(row.assignedToStaffId ?? row.clientRepStaffId ?? actingStaffId ?? ""),
                                    });
                                  }}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  Follow-up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConvertInquiry(row);
                                    setConvertForm({ memberId: "", remarks: "" });
                                  }}
                                  className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                >
                                  Convert
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCloseInquiry(row);
                                    setCloseForm({ status: "LOST", closeReason: "", remarks: "" });
                                  }}
                                  className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                >
                                  Close
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => void openHistory(row)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              History
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
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-6">
          {kanbanColumns.map((column) => {
            const rows = inquiriesPage.content.filter((row) => column.statuses.includes(row.status));
            return (
              <div key={column.label} className="min-h-[420px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">{column.label}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{rows.length}</span>
                </div>
                <div className="space-y-2">
                  {rows.length === 0 ? <p className="text-xs text-slate-400">No enquiries.</p> : null}
                  {rows.map((row) => {
                    const nextFollowUp = followUpByInquiry.get(row.inquiryId)?.[0];
                    return (
                      <article key={row.inquiryId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-800">{row.fullName}</p>
                        <p className="text-xs text-slate-500">{row.mobileNumber}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{normalizeInquirySourceLabel(row.promotionSource)}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{nextFollowUp ? formatDateTime(nextFollowUp.dueAt) : "No follow-up"}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
        <span>
          Page {inquiriesPage.number + 1} of {Math.max(inquiriesPage.totalPages, 1)} ({inquiriesPage.totalElements} total)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={inquiriesPage.first}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(inquiriesPage.totalPages - 1, current + 1))}
            disabled={inquiriesPage.last}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {loading ? <div className="text-sm text-slate-500">Loading enquiries...</div> : null}

      {inquiryModalMode ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{inquiryModalMode === "CREATE" ? "Add Enquiry" : "Edit Enquiry"}</h2>
                <p className="text-sm text-slate-500">Structured enquiry capture with lead and follow-up context.</p>
              </div>
              <button
                type="button"
                onClick={() => setInquiryModalMode(null)}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Close enquiry modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Customer Name *</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.fullName}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, fullName: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Mobile Number *</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.mobileNumber}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, mobileNumber: event.target.value.replace(/[^0-9]/g, "") }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.email}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Source of Promotion</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.promotionSource}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, promotionSource: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Status</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.status}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, status: event.target.value as InquiryStatus }))}
                >
                  {INQUIRY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Convertibility</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.convertibility}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, convertibility: event.target.value as InquiryConvertibility }))}
                >
                  {CONVERTIBILITY_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Assigned Staff</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.assignedToStaffId}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, assignedToStaffId: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Follow-up Response</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.responseType}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, responseType: event.target.value as InquiryResponseType }))}
                >
                  <option value="">Select</option>
                  {RESPONSE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {formatInquiryResponseType(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Preferred Contact</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.preferredContactChannel}
                  onChange={(event) =>
                    setInquiryForm((current) => ({
                      ...current,
                      preferredContactChannel: event.target.value as PreferredContactChannel,
                    }))
                  }
                >
                  <option value="">Select</option>
                  {CONTACT_CHANNELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Customer Status</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.customerStatus}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, customerStatus: event.target.value as InquiryCustomerStatus }))}
                >
                  <option value="">Select</option>
                  {CUSTOMER_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Interested In</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.interestedIn}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, interestedIn: event.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={inquiryForm.trialGiven}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, trialGiven: event.target.checked }))}
                />
                Trial Given
              </label>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Days</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.trialDays}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, trialDays: event.target.value.replace(/[^0-9]/g, "") }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Attempts</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.trialAttempts}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, trialAttempts: event.target.value.replace(/[^0-9]/g, "") }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Trial Expiry</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.trialExpiryAt}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, trialExpiryAt: event.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">Follow-up Comment</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.followUpComment}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, followUpComment: event.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.notes}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">Remarks</label>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={inquiryForm.remarks}
                  onChange={(event) => setInquiryForm((current) => ({ ...current, remarks: event.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInquiryModalMode(null)}
                disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitInquiry()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {inquiryModalMode === "CREATE" ? "Create Enquiry" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {followUpInquiry ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Schedule Follow-up</h2>
                <p className="text-sm text-slate-500">{followUpInquiry.fullName}</p>
              </div>
              <button
                type="button"
                onClick={() => setFollowUpInquiry(null)}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Close follow-up modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Due At *</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={followUpForm.dueAt}
                  onChange={(event) => setFollowUpForm((current) => ({ ...current, dueAt: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Channel</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={followUpForm.channel}
                  onChange={(event) => setFollowUpForm((current) => ({ ...current, channel: event.target.value as FollowUpChannel }))}
                >
                  {FOLLOW_UP_CHANNELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Assigned Staff *</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={followUpForm.assignedToStaffId}
                  onChange={(event) => setFollowUpForm((current) => ({ ...current, assignedToStaffId: event.target.value }))}
                >
                  <option value="">Select</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={followUpForm.notes}
                  onChange={(event) => setFollowUpForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFollowUpInquiry(null)}
                disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitFollowUp()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save Follow-up
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assignInquiry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Assign Enquiry</h2>
            <p className="mt-1 text-sm text-slate-500">{assignInquiry.fullName}</p>
            <div className="mt-4 grid gap-3">
              <select
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                value={assignForm.assignedToStaffId}
                onChange={(event) => setAssignForm((current) => ({ ...current, assignedToStaffId: event.target.value }))}
              >
                <option value="">Select staff</option>
                {staffOptions.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Remarks (optional)"
                value={assignForm.remarks}
                onChange={(event) => setAssignForm((current) => ({ ...current, remarks: event.target.value }))}
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAssignInquiry(null)}
                disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitAssign()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Assign
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closeInquiry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Close Enquiry</h2>
            <p className="mt-1 text-sm text-slate-500">{closeInquiry.fullName}</p>
            <div className="mt-4 grid gap-3">
              <select
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                value={closeForm.status}
                onChange={(event) => setCloseForm((current) => ({ ...current, status: event.target.value as "NOT_INTERESTED" | "LOST" }))}
              >
                <option value="LOST">LOST</option>
                <option value="NOT_INTERESTED">NOT_INTERESTED</option>
              </select>
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Close reason *"
                value={closeForm.closeReason}
                onChange={(event) => setCloseForm((current) => ({ ...current, closeReason: event.target.value }))}
              />
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Remarks (optional)"
                value={closeForm.remarks}
                onChange={(event) => setCloseForm((current) => ({ ...current, remarks: event.target.value }))}
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCloseInquiry(null)}
                disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitClose()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Close Enquiry
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {convertInquiry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">Convert Enquiry</h2>
            <p className="mt-1 text-sm text-slate-500">{convertInquiry.fullName}</p>
            <div className="mt-4 grid gap-3">
              <input
                className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                placeholder="Member ID (optional)"
                value={convertForm.memberId}
                onChange={(event) => setConvertForm((current) => ({ ...current, memberId: event.target.value.replace(/[^0-9]/g, "") }))}
              />
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Remarks (optional)"
                value={convertForm.remarks}
                onChange={(event) => setConvertForm((current) => ({ ...current, remarks: event.target.value }))}
              />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConvertInquiry(null)}
                disabled={submitting}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitConvert()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Convert
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {historyInquiry ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Status History</h2>
                <p className="text-sm text-slate-500">
                  {historyInquiry.fullName} ({formatInquiryCode(historyInquiry.inquiryId, {
                    branchCode: historyInquiry.branchCode,
                    createdAt: historyInquiry.createdAt || historyInquiry.inquiryAt,
                  })})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryInquiry(null)}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Close history modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {historyLoading ? <p className="text-sm text-slate-500">Loading history...</p> : null}
            {!historyLoading && historyRows.length === 0 ? <p className="text-sm text-slate-500">No history available.</p> : null}

            <div className="space-y-3">
              {historyRows.map((row, index) => (
                <div key={`${row.changedAt}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-700">
                    {row.fromStatus || "-"} {"->"} {row.toStatus || "-"}
                  </p>
                  <p className="text-xs text-slate-500">Changed by: {row.changedByStaffId ?? "-"}</p>
                  <p className="text-xs text-slate-500">At: {formatDateTime(row.changedAt)}</p>
                  <p className="mt-1 text-xs text-slate-600">{row.remarks || "-"}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </AdminPageFrame>
  );
}
