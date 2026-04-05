"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, MoreHorizontal, ShieldCheck, Users, XCircle } from "lucide-react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasCapability } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatMemberCode } from "@/lib/inquiry-code";
import { UserDirectoryItem } from "@/types/models";

const CAPABILITIES = {
  viewMembers: ["MEMBER_VIEW", "MEMBERS_VIEW", "MEMBER_READ", "MEMBER_MANAGE"],
} as const;

type MemberLifecycle = "ACTIVE" | "EXPIRED" | "IRREGULAR";
type MemberFilter = "ALL" | "ACTIVE" | "EXPIRED" | "IRREGULAR";
type GenderFilter = "ALL" | "MALE" | "FEMALE" | "OTHER";
type JsonRecord = Record<string, unknown>;

interface AttendanceSummary {
  id: string;
  checkInAt?: string;
  checkOutAt?: string;
}

interface MemberDetailSummary {
  activePlan: string;
  membershipState: MemberLifecycle;
  memberCode: string;
  addedByLabel: string;
  checkInStatus: string;
  gender: string;
  serviceTypes: string[];
  membershipNames: string[];
  trainerNames: string[];
  recordStatus: "ACTIVE" | "INACTIVE";
  branchCode?: string;
  inquiryCreatedAt?: string;
}

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function getString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

function normalizeDisplayPlanName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return "No subscription is active";
  }

  return trimmed
    .replace(/\b(1|3|6|12)M\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-/]\s*$/g, "")
    .trim();
}

function formatDisplayLabel(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function resolveActivePlan(dashboard: unknown, entitlements: unknown): string {
  const dashboardRecord = toRecord(dashboard);
  const entitlementsRecord = toRecord(entitlements);

  return normalizeDisplayPlanName(
    (
    getString(dashboardRecord, ["activePlan", "planName", "currentPlan"]) ||
    getString(entitlementsRecord, ["activePlan", "planName", "currentPlan"]) ||
    "-"
    ),
  );
}

function resolveSubscriptionStatus(dashboard: unknown, entitlements: unknown): string {
  const status =
    getString(toRecord(dashboard), ["membershipStatus", "status", "subscriptionStatus", "planStatus"]) ||
    getString(toRecord(entitlements), ["membershipStatus", "status", "subscriptionStatus", "planStatus"]);

  return status || "-";
}

function resolveLifecycle(
  dashboard: unknown,
  entitlements: unknown,
  activePlan: string,
): MemberLifecycle {
  const normalized = resolveSubscriptionStatus(dashboard, entitlements).toUpperCase();

  if (normalized.includes("EXPIRED") || normalized.includes("LAPSED") || normalized.includes("INACTIVE")) {
    return "EXPIRED";
  }

  if (normalized.includes("IRREGULAR") || normalized.includes("AT_RISK") || normalized.includes("PENDING")) {
    return "IRREGULAR";
  }

  if (normalized.includes("ACTIVE") || normalized.includes("RUNNING") || normalized.includes("VALID")) {
    return "ACTIVE";
  }

  return activePlan === "-" ? "EXPIRED" : "ACTIVE";
}

function resolveMemberCode(member: UserDirectoryItem, details?: Pick<MemberDetailSummary, "branchCode" | "inquiryCreatedAt">): string {
  if (!member.sourceInquiryId) {
    return "-";
  }

  return formatMemberCode(member.sourceInquiryId, {
    branchCode: details?.branchCode,
    createdAt: details?.inquiryCreatedAt,
  });
}

function mapAttendance(item: unknown, index: number): AttendanceSummary {
  const record = toRecord(item);
  return {
    id: getString(record, ["id", "checkInId"]) || `attendance-${index}`,
    checkInAt: getString(record, ["checkInAt", "entryTime", "createdAt"]) || undefined,
    checkOutAt: getString(record, ["checkOutAt", "exitTime", "updatedAt"]) || undefined,
  };
}

function resolveCheckInStatus(attendance: AttendanceSummary[]): string {
  if (attendance.length === 0) {
    return "Not Checked In";
  }

  const latest = attendance
    .filter((entry) => entry.checkInAt)
    .sort((left, right) => {
      const leftTime = left.checkInAt ? new Date(left.checkInAt).getTime() : 0;
      const rightTime = right.checkInAt ? new Date(right.checkInAt).getTime() : 0;
      return rightTime - leftTime;
    })[0];

  if (!latest?.checkInAt) {
    return "Not Checked In";
  }

  const today = new Date();
  const latestCheckIn = new Date(latest.checkInAt);
  if (
    latestCheckIn.getFullYear() !== today.getFullYear()
    || latestCheckIn.getMonth() !== today.getMonth()
    || latestCheckIn.getDate() !== today.getDate()
  ) {
    return "Not Checked In";
  }

  return latest.checkOutAt ? "Checked Out" : "Checked In";
}

function lifecycleClasses(lifecycle: MemberLifecycle): string {
  if (lifecycle === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (lifecycle === "EXPIRED") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-amber-200 bg-amber-50 text-amber-700";
}

async function fetchMemberSummary(
  token: string,
  member: UserDirectoryItem,
  staffNameById: Record<string, string>,
): Promise<MemberDetailSummary> {
  const sourceInquiryId = member.sourceInquiryId ? Number(member.sourceInquiryId) : undefined;
  const [dashboard, entitlements, attendanceRaw, inquiry, assignments] = await Promise.all([
    subscriptionService.getMemberDashboard(token, member.id),
    subscriptionService.getMemberEntitlements(token, member.id),
    engagementService.getAttendanceByMember(token, member.id),
    sourceInquiryId ? subscriptionService.getInquiryById(token, sourceInquiryId) : Promise.resolve(null),
    trainingService.getMemberAssignments(token, member.id),
  ]);

  const dashboardRecord = toRecord(dashboard);
  const activePlan = resolveActivePlan(dashboard, entitlements);
  const attendance = Array.isArray(attendanceRaw)
    ? attendanceRaw.map((item, index) => mapAttendance(item, index))
    : [];
  const inquiryRecord = inquiry ? (inquiry as unknown as JsonRecord) : null;
  const addedByStaffIdValue = inquiryRecord?.clientRepStaffId;
  const addedByStaffId =
    typeof addedByStaffIdValue === "number" || typeof addedByStaffIdValue === "string"
      ? String(addedByStaffIdValue)
      : undefined;
  const addedByName =
    inquiryRecord && typeof inquiryRecord.clientRepName === "string" && inquiryRecord.clientRepName.trim().length > 0
      ? inquiryRecord.clientRepName.trim()
      : undefined;
  const membershipRecords = Array.isArray(dashboardRecord.memberships)
    ? dashboardRecord.memberships.map((item) => toRecord(item))
    : [];
  const serviceTypes = Array.from(
    new Set(
      membershipRecords
        .map((record) => getString(record, ["family", "categoryCode"]))
        .filter(Boolean)
        .map((value) => formatDisplayLabel(value)),
    ),
  );
  const membershipNames = Array.from(
    new Set(
      membershipRecords
        .map((record) => normalizeDisplayPlanName(getString(record, ["variantName", "productName"])))
        .filter((value) => value && value !== "No subscription is active"),
    ),
  );
  const trainerNames = Array.from(
    new Set(
      (Array.isArray(assignments) ? assignments : [])
        .map((item) => {
          const record = toRecord(item);
          const resolved = (
            getString(record, ["coachName", "trainerName", "assignedCoachName", "assignedTrainerName"]) ||
            getString(record, ["coachId", "trainerId"])
          );
          return staffNameById[resolved] || resolved;
        })
        .filter(Boolean)
        .filter((value) => /[A-Za-z]/.test(value)),
    ),
  );
  const fallbackTrainerName =
    !trainerNames.length && member.defaultTrainerStaffId
      ? staffNameById[member.defaultTrainerStaffId] || member.defaultTrainerStaffId
      : "";

  return {
    activePlan,
    membershipState: resolveLifecycle(dashboard, entitlements, activePlan),
    memberCode: resolveMemberCode(member, {
      branchCode: inquiry?.branchCode,
      inquiryCreatedAt: inquiry?.createdAt || inquiry?.inquiryAt,
    }),
    addedByLabel: addedByName || (addedByStaffId ? staffNameById[addedByStaffId] || `Staff #${addedByStaffId}` : "-"),
    checkInStatus: resolveCheckInStatus(attendance),
    gender:
      inquiry && typeof inquiry.gender === "string" && inquiry.gender.trim().length > 0
        ? formatDisplayLabel(inquiry.gender.trim())
        : "-",
    serviceTypes,
    membershipNames,
    trainerNames: fallbackTrainerName ? [fallbackTrainerName] : trainerNames,
    recordStatus: member.active === false ? "INACTIVE" : "ACTIVE",
    branchCode: inquiry?.branchCode,
    inquiryCreatedAt: inquiry?.createdAt || inquiry?.inquiryAt,
  };
}

export default function MembersPage() {
  const router = useRouter();
  const { token, user, accessMetadata } = useAuth();
  const { effectiveBranchId } = useBranch();
  const canViewMembers = hasCapability(user, accessMetadata, CAPABILITIES.viewMembers, true);

  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("ALL");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("ALL");
  const [trainerFilter, setTrainerFilter] = useState("ALL");
  const [serviceFilter, setServiceFilter] = useState("ALL");
  const [membershipFilter, setMembershipFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsByMemberId, setDetailsByMemberId] = useState<Record<string, MemberDetailSummary>>({});
  const [staffNameById, setStaffNameById] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [openMenuMemberId, setOpenMenuMemberId] = useState<string | null>(null);
  const pageSize = 10;
  const dateRangeError = useMemo(() => {
    if (!fromDate || !toDate) {
      return "";
    }
    return new Date(`${fromDate}T00:00:00`) > new Date(`${toDate}T23:59:59`)
      ? "From date cannot be later than To date."
      : "";
  }, [fromDate, toDate]);

  const loadMembers = useCallback(
    async (query?: string) => {
      if (!token || !canViewMembers) {
        return;
      }

      setLoadingMembers(true);
      setError(null);

      try {
        const normalized = query?.trim() || "";
        const branchFilter = effectiveBranchId ? String(effectiveBranchId) : undefined;
        const response = await usersService.searchUsers(token, {
          role: "MEMBER",
          ...(normalized ? { query: normalized } : {}),
          ...(branchFilter ? { defaultBranchId: branchFilter } : {}),
        });

        setMembers(response);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load members";
        setError(message);
      } finally {
        setLoadingMembers(false);
      }
    },
    [token, canViewMembers, effectiveBranchId],
  );

  const hydrateMemberSummaries = useCallback(
    async (list: UserDirectoryItem[]) => {
      if (!token || list.length === 0) {
        setDetailsByMemberId({});
        return;
      }

      setLoadingSummaries(true);

      try {
        const entries = await Promise.all(
          list.map(async (member) => {
            try {
              const summary = await fetchMemberSummary(token, member, staffNameById);
              return [member.id, summary] as const;
            } catch {
              return [
                member.id,
                {
                  activePlan: "-",
                  membershipState: "ACTIVE" as MemberLifecycle,
                  memberCode: resolveMemberCode(member),
                  addedByLabel: "-",
                  checkInStatus: "Not Checked In",
                  gender: "-",
                  serviceTypes: [] as string[],
                  membershipNames: [] as string[],
                  trainerNames: [] as string[],
                  recordStatus: member.active === false ? "INACTIVE" : "ACTIVE",
                },
              ] as const;
            }
          }),
        );

        const next: Record<string, MemberDetailSummary> = {};
        entries.forEach(([memberId, summary]) => {
          next[memberId] = summary;
        });
        setDetailsByMemberId(next);
      } finally {
        setLoadingSummaries(false);
      }
    },
    [token, staffNameById],
  );

  useEffect(() => {
    if (!canViewMembers) {
      setLoadingMembers(false);
      return;
    }

    void loadMembers();
  }, [canViewMembers, loadMembers]);

  useEffect(() => {
    if (!token || !canViewMembers) {
      setStaffNameById({});
      return;
    }

    const branchFilter = effectiveBranchId ? String(effectiveBranchId) : undefined;

    void (async () => {
      try {
        const [staff, coaches, admins] = await Promise.all([
          usersService.searchUsers(token, {
            role: "STAFF",
            ...(branchFilter ? { defaultBranchId: branchFilter } : {}),
          }),
          usersService.searchUsers(token, {
            role: "COACH",
            ...(branchFilter ? { defaultBranchId: branchFilter } : {}),
          }),
          usersService.searchUsers(token, { role: "ADMIN" }),
        ]);

        const next: Record<string, string> = {};
        [...staff, ...coaches, ...admins].forEach((entry) => {
          if (entry.id) {
            next[entry.id] = entry.name;
          }
          if (entry.mobile) {
            next[entry.mobile] = entry.name;
          }
        });
        setStaffNameById(next);
      } catch {
        setStaffNameById({});
      }
    })();
  }, [token, canViewMembers, effectiveBranchId]);

  useEffect(() => {
    if (members.length === 0) {
      setDetailsByMemberId({});
      return;
    }

    void hydrateMemberSummaries(members);
  }, [members, hydrateMemberSummaries]);

  const summaryStats = useMemo(() => {
    let active = 0;
    let expired = 0;
    let irregular = 0;

    members.forEach((member) => {
      const lifecycle = detailsByMemberId[member.id]?.membershipState || "ACTIVE";
      if (lifecycle === "ACTIVE") {
        active += 1;
      }
      if (lifecycle === "EXPIRED") {
        expired += 1;
      }
      if (lifecycle === "IRREGULAR") {
        irregular += 1;
      }
    });

    return { active, expired, irregular };
  }, [members, detailsByMemberId]);

  const filterCounts = useMemo(
    () => ({
      ALL: members.length,
      ACTIVE: summaryStats.active,
      EXPIRED: summaryStats.expired,
      IRREGULAR: summaryStats.irregular,
    }),
    [members.length, summaryStats.active, summaryStats.expired, summaryStats.irregular],
  );

  const trainerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(detailsByMemberId)
            .flatMap((details) => details.trainerNames)
            .filter((value) => Boolean(value) && /[A-Za-z]/.test(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [detailsByMemberId],
  );

  const serviceOptions = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(detailsByMemberId)
            .flatMap((details) => details.serviceTypes)
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [detailsByMemberId],
  );

  const membershipOptions = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(detailsByMemberId)
            .flatMap((details) => details.membershipNames)
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [detailsByMemberId],
  );

  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        const details = detailsByMemberId[member.id];
        const lifecycle = details?.membershipState || "ACTIVE";
        const searchNeedle = searchTerm.trim().toLowerCase();
        const searchHaystack = [
          member.name,
          member.mobile,
          member.email || "",
          details?.memberCode || "",
          details?.activePlan || "",
          details?.addedByLabel || "",
        ]
          .join(" ")
          .toLowerCase();

        if (searchNeedle && !searchHaystack.includes(searchNeedle)) {
          return false;
        }
        if (memberFilter === "ACTIVE" && lifecycle !== "ACTIVE") {
          return false;
        }
        if (memberFilter === "EXPIRED" && lifecycle !== "EXPIRED") {
          return false;
        }
        if (memberFilter === "IRREGULAR" && lifecycle !== "IRREGULAR") {
          return false;
        }
        const normalizedGender = (details?.gender || "-").trim().toUpperCase();
        if (genderFilter === "MALE" && normalizedGender !== "MALE") {
          return false;
        }
        if (genderFilter === "FEMALE" && normalizedGender !== "FEMALE") {
          return false;
        }
        if (genderFilter === "OTHER" && normalizedGender !== "OTHER") {
          return false;
        }
        if (trainerFilter !== "ALL" && !details?.trainerNames.includes(trainerFilter)) {
          return false;
        }
        if (serviceFilter !== "ALL" && !details?.serviceTypes.includes(serviceFilter)) {
          return false;
        }
        if (membershipFilter !== "ALL" && !details?.membershipNames.includes(membershipFilter)) {
          return false;
        }
        if (dateRangeError) {
          return false;
        }
        if (fromDate) {
          const memberDate = details?.inquiryCreatedAt ? new Date(details.inquiryCreatedAt) : null;
          const filterStart = new Date(`${fromDate}T00:00:00`);
          if (!memberDate || memberDate < filterStart) {
            return false;
          }
        }
        if (toDate) {
          const memberDate = details?.inquiryCreatedAt ? new Date(details.inquiryCreatedAt) : null;
          const filterEnd = new Date(`${toDate}T23:59:59`);
          if (!memberDate || memberDate > filterEnd) {
            return false;
          }
        }
        return true;
      }),
    [dateRangeError, detailsByMemberId, fromDate, genderFilter, memberFilter, membershipFilter, members, searchTerm, serviceFilter, toDate, trainerFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const paginatedMembers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredMembers.slice(start, start + pageSize);
  }, [currentPage, filteredMembers]);

  useEffect(() => {
    setCurrentPage(1);
  }, [fromDate, genderFilter, memberFilter, membershipFilter, members.length, searchTerm, serviceFilter, toDate, trainerFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setOpenMenuMemberId(null);
  }, [currentPage, filteredMembers.length]);

  const resetFilters = useCallback(() => {
    setSearchTerm("");
    setMemberFilter("ALL");
    setGenderFilter("ALL");
    setTrainerFilter("ALL");
    setServiceFilter("ALL");
    setMembershipFilter("ALL");
    setFromDate("");
    setToDate("");
    setCurrentPage(1);
  }, []);

  const exportRows = useMemo(
    () =>
      filteredMembers.map((member) => {
        const details = detailsByMemberId[member.id];
        const membershipPortfolio = details?.membershipNames || [];
        return {
          memberName: member.name,
          mobile: member.mobile,
          email: member.email || "-",
          memberCode: details?.memberCode || resolveMemberCode(member, details),
          membershipStatus: details?.membershipState || "ACTIVE",
          membership: details?.activePlan || "-",
          gender: details?.gender || "-",
          addedBy: details?.addedByLabel || "-",
          checkInStatus: details?.checkInStatus || "-",
          recordStatus: details?.recordStatus || "ACTIVE",
          trainers: details?.trainerNames.join(", ") || "-",
          services: details?.serviceTypes.join(", ") || "-",
          memberships: membershipPortfolio.join(", ") || "-",
          joinedAt: details?.inquiryCreatedAt || "-",
        };
      }),
    [detailsByMemberId, filteredMembers],
  );

  const handleExportCsv = useCallback(() => {
    const header = [
      "Member Name",
      "Mobile",
      "Email",
      "Member Code",
      "Membership Status",
      "Membership",
      "Gender",
      "Added By",
      "Check-in Status",
      "Record Status",
      "Assigned Trainers",
      "Service Types",
      "Membership Portfolio",
      "Joined Date",
    ];
    const rows = exportRows.map((row) =>
      [
        row.memberName,
        row.mobile,
        row.email,
        row.memberCode,
        row.membershipStatus,
        row.membership,
        row.gender,
        row.addedBy,
        row.checkInStatus,
        row.recordStatus,
        row.trainers,
        row.services,
        row.memberships,
        row.joinedAt,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "members-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, [exportRows]);

  const handleExportPdf = useCallback(() => {
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) {
      return;
    }

    const rows = exportRows
      .map(
        (row) => `
          <tr>
            <td>${row.memberName}</td>
            <td>${row.mobile}</td>
            <td>${row.memberCode}</td>
            <td>${row.membershipStatus}</td>
            <td>${row.membership}</td>
            <td>${row.gender}</td>
            <td>${row.addedBy}</td>
            <td>${row.checkInStatus}</td>
            <td>${row.trainers}</td>
          </tr>`,
      )
      .join("");

    win.document.write(`
      <html>
        <head>
          <title>Members Export</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1 { margin: 0 0 8px; font-size: 24px; }
            p { margin: 0 0 16px; color: #475569; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>FOMO Training Members Export</h1>
          <p>Filtered rows: ${exportRows.length}</p>
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Mobile</th>
                <th>Member Code</th>
                <th>Status</th>
                <th>Membership</th>
                <th>Gender</th>
                <th>Added By</th>
                <th>Check-in</th>
                <th>Assigned Trainers</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }, [exportRows]);

  if (loadingMembers) {
    return <PageLoader label="Loading members..." />;
  }

  if (!canViewMembers) {
    return (
      <SectionCard title="Member Management" subtitle="Capabilities are controlled by designation metadata">
        <p className="text-sm text-slate-500">You do not have capability to view member data.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">All Members</h1>
        <p className="text-slate-400">Clean directory view for branch members.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        {[
          {
            label: "Total Members",
            value: members.length,
            border: "border-white/10",
            bg: "bg-[#141b25]",
            tone: "text-white",
            icon: <Users className="h-5 w-5 text-slate-200" />,
            chip: "Directory strength",
          },
          {
            label: "Active Members",
            value: summaryStats.active,
            border: "border-emerald-400/20",
            bg: "bg-[#131d1b]",
            tone: "text-white",
            icon: <ShieldCheck className="h-5 w-5 text-emerald-200" />,
            chip: "Live memberships",
          },
          {
            label: "Expired Members",
            value: summaryStats.expired,
            border: "border-rose-400/20",
            bg: "bg-[#1e1518]",
            tone: "text-white",
            icon: <XCircle className="h-5 w-5 text-rose-200" />,
            chip: "Needs renewal",
          },
          {
            label: "Irregular Members",
            value: summaryStats.irregular,
            border: "border-amber-400/20",
            bg: "bg-[#211912]",
            tone: "text-white",
            icon: <AlertTriangle className="h-5 w-5 text-amber-200" />,
            chip: "Attendance watch",
          },
        ].map((item) => (
          <article key={item.label} className={`rounded-[28px] border ${item.border} ${item.bg} p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
                <p className={`mt-1 text-2xl font-bold ${item.tone}`}>{item.value}</p>
                <p className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-300">
                  {item.chip}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-sm">{item.icon}</div>
            </div>
          </article>
        ))}
      </div>

      <SectionCard
        title="Member Table"
        subtitle="Search, filter, and open member profiles."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Export Excel
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={() => {
                resetFilters();
                void loadMembers();
              }}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Refresh
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <input
            className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#c42924]/60"
            placeholder="Search members by name or mobile"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Member Status
              <select
                value={memberFilter}
                onChange={(event) => setMemberFilter(event.target.value as MemberFilter)}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              >
                <option value="ALL">All Members ({filterCounts.ALL})</option>
                <option value="ACTIVE">Active ({filterCounts.ACTIVE})</option>
                <option value="EXPIRED">Expired ({filterCounts.EXPIRED})</option>
                <option value="IRREGULAR">Irregular ({filterCounts.IRREGULAR})</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Gender
              <select
                value={genderFilter}
                onChange={(event) => setGenderFilter(event.target.value as GenderFilter)}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              >
                <option value="ALL">All Genders</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              From Date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                max={toDate || undefined}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              To Date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                min={fromDate || undefined}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Assigned Trainer
              <select
                value={trainerFilter}
                onChange={(event) => setTrainerFilter(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              >
                <option value="ALL">All Trainers</option>
                {trainerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Service Type
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              >
                <option value="ALL">All Services</option>
                {serviceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Membership
              <select
                value={membershipFilter}
                onChange={(event) => setMembershipFilter(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm font-medium normal-case tracking-normal text-white outline-none focus:border-[#c42924]/60"
              >
                <option value="ALL">All Memberships</option>
                {membershipOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        {dateRangeError ? (
          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{dateRangeError}</p>
        ) : null}

        <div className="mt-4 rounded-[24px] border border-white/8 bg-[#111821]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Mobile Number</th>
                <th className="px-4 py-3">Membership</th>
                <th className="px-4 py-3">Gender</th>
                <th className="px-4 py-3">Added By</th>
                <th className="px-4 py-3">Check-in Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {paginatedMembers.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={7}>
                    No members found.
                  </td>
                </tr>
              ) : (
                paginatedMembers.map((member) => {
                  const details = detailsByMemberId[member.id];
                  const lifecycle = details?.membershipState || "ACTIVE";

                  return (
                    <tr
                      key={member.id}
                      onClick={() => router.push(`/admin/members/${member.id}`)}
                      className="cursor-pointer hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{member.name}</p>
                        <p className="text-xs text-slate-400">{details?.memberCode || resolveMemberCode(member, details)}</p>
                        <p className="text-xs text-slate-400">{member.email || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-200">{member.mobile || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${lifecycleClasses(lifecycle)}`}
                          >
                            {formatDisplayLabel(lifecycle)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {details?.activePlan || (loadingSummaries ? "Loading..." : "-")}
                          </span>
                          {details?.membershipNames && details.membershipNames.length > 1 ? (
                            <span className="text-[11px] text-slate-500">
                              Also: {details.membershipNames.filter((name) => name !== details.activePlan).join(", ")}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{details?.gender || "-"}</td>
                      <td className="px-4 py-3 text-slate-300">{details ? details.addedByLabel : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3 text-slate-300">{details ? details.checkInStatus : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3">
                        <div className="relative flex justify-end">
                          <button
                            type="button"
                            aria-label={`Open actions for ${member.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuMemberId((current) => (current === member.id ? null : member.id));
                            }}
                            className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08]"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openMenuMemberId === member.id ? (
                            <div className="absolute right-0 top-11 z-20 min-w-[200px] rounded-2xl border border-white/10 bg-[#111821] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenMenuMemberId(null);
                                  router.push(`/admin/members/${member.id}?tab=notes`);
                                }}
                                className="flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-100 hover:bg-white/[0.06]"
                              >
                                Follow-up History
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenMenuMemberId(null);
                                  router.push(`/admin/members/${member.id}?tab=notes&mode=add-follow-up`);
                                }}
                                className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-[#ffd6d4] hover:bg-[#c42924]/10"
                              >
                                Add Follow-up
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredMembers.length > pageSize ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-400">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredMembers.length)} of {filteredMembers.length} members
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
