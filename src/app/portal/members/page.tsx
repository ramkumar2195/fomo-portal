"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, Users, XCircle } from "lucide-react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasCapability } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatMemberCode } from "@/lib/inquiry-code";
import { UserDirectoryItem } from "@/types/models";

const CAPABILITIES = {
  viewMembers: ["MEMBER_VIEW", "MEMBERS_VIEW", "MEMBER_READ", "MEMBER_MANAGE"],
} as const;

type MemberLifecycle = "ACTIVE" | "EXPIRED" | "IRREGULAR";
type MemberFilter = "ALL" | "ACTIVE" | "EXPIRED" | "IRREGULAR";
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
  const [dashboard, entitlements, attendanceRaw, inquiry] = await Promise.all([
    subscriptionService.getMemberDashboard(token, member.id),
    subscriptionService.getMemberEntitlements(token, member.id),
    engagementService.getAttendanceByMember(token, member.id),
    sourceInquiryId ? subscriptionService.getInquiryById(token, sourceInquiryId) : Promise.resolve(null),
  ]);

  const activePlan = resolveActivePlan(dashboard, entitlements);
  const attendance = Array.isArray(attendanceRaw)
    ? attendanceRaw.map((item, index) => mapAttendance(item, index))
    : [];
  const addedByStaffId =
    inquiry && typeof inquiry.clientRepStaffId === "number" ? String(inquiry.clientRepStaffId) : undefined;

  return {
    activePlan,
    membershipState: resolveLifecycle(dashboard, entitlements, activePlan),
    memberCode: resolveMemberCode(member, {
      branchCode: inquiry?.branchCode,
      inquiryCreatedAt: inquiry?.createdAt || inquiry?.inquiryAt,
    }),
    addedByLabel: addedByStaffId ? staffNameById[addedByStaffId] || `Staff #${addedByStaffId}` : "-",
    checkInStatus: resolveCheckInStatus(attendance),
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
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsByMemberId, setDetailsByMemberId] = useState<Record<string, MemberDetailSummary>>({});
  const [staffNameById, setStaffNameById] = useState<Record<string, string>>({});

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
        const [staff, admins] = await Promise.all([
          usersService.searchUsers(token, {
            role: "STAFF",
            ...(branchFilter ? { defaultBranchId: branchFilter } : {}),
          }),
          usersService.searchUsers(token, { role: "ADMIN" }),
        ]);

        const next: Record<string, string> = {};
        [...staff, ...admins].forEach((entry) => {
          if (entry.id) {
            next[entry.id] = entry.name;
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

  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        const lifecycle = detailsByMemberId[member.id]?.membershipState || "ACTIVE";
        if (memberFilter === "ACTIVE" && lifecycle !== "ACTIVE") {
          return false;
        }
        if (memberFilter === "EXPIRED" && lifecycle !== "EXPIRED") {
          return false;
        }
        if (memberFilter === "IRREGULAR" && lifecycle !== "IRREGULAR") {
          return false;
        }
        return true;
      }),
    [detailsByMemberId, memberFilter, members],
  );

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
          <button
            type="button"
            onClick={() => void loadMembers(searchTerm)}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Refresh
          </button>
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#c42924]/60"
            placeholder="Search members by name or mobile"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loadMembers(searchTerm);
              }
            }}
          />
          <button
            type="button"
            onClick={() => void loadMembers(searchTerm)}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              void loadMembers();
            }}
            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Reset
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { key: "ALL", label: "All Members" },
              { key: "ACTIVE", label: "Active" },
              { key: "EXPIRED", label: "Expired" },
              { key: "IRREGULAR", label: "Irregular" },
            ] as Array<{ key: MemberFilter; label: string }>
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMemberFilter(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                memberFilter === item.key
                  ? "border-[#c42924]/40 bg-[#c42924]/12 text-[#ffd6d4]"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
              }`}
            >
              {item.label} ({filterCounts[item.key]})
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        <div className="mt-4 overflow-x-auto rounded-[24px] border border-white/8 bg-[#111821]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Member Code</th>
                <th className="px-4 py-3">Membership</th>
                <th className="px-4 py-3">Added By</th>
                <th className="px-4 py-3">Check-in Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {filteredMembers.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={5}>
                    No members found.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => {
                  const details = detailsByMemberId[member.id];
                  const lifecycle = details?.membershipState || "ACTIVE";

                  return (
                    <tr
                      key={member.id}
                      className="cursor-pointer hover:bg-white/[0.03]"
                      onClick={() => router.push(`/admin/members/${member.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{member.name}</p>
                        <p className="text-xs text-slate-400">{member.mobile}</p>
                        <p className="text-xs text-slate-400">{member.email || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-200">{details?.memberCode || resolveMemberCode(member, details)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${lifecycleClasses(lifecycle)}`}
                          >
                            {lifecycle}
                          </span>
                          <span className="text-xs text-slate-400">
                            {details?.activePlan || (loadingSummaries ? "Loading..." : "-")}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{details ? details.addedByLabel : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3 text-slate-300">{details ? details.checkInStatus : loadingSummaries ? "..." : "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
