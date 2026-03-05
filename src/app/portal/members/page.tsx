"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { hasCapability } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatDateTime } from "@/lib/formatters";
import { UserDirectoryItem } from "@/types/models";

const CAPABILITIES = {
  viewMembers: ["MEMBER_VIEW", "MEMBERS_VIEW", "MEMBER_READ", "MEMBER_MANAGE"],
  createMember: ["MEMBER_CREATE", "MEMBER_ONBOARDING", "USER_CREATE", "USERS_CREATE", "USER_MANAGE"],
} as const;

type MemberLifecycle = "ACTIVE" | "EXPIRED" | "IRREGULAR";
type MemberFilter = "ALL" | "ACTIVE" | "EXPIRED" | "IRREGULAR" | "PT" | "NON_PT";

interface MemberDetailSummary {
  activePlan: string;
  credits: number;
  ptSessions: number;
  checkIns: number;
  membershipState: MemberLifecycle;
}

interface PtAssignmentSummary {
  assignmentId: string;
  trainerName: string;
  status: string;
}

interface PtSessionSummary {
  sessionId: string;
  assignmentId: string;
  sessionAt?: string;
  status?: string;
}

interface AttendanceSummary {
  id: string;
  checkInAt?: string;
  checkOutAt?: string;
}

interface MemberProfileData {
  activePlan: string;
  subscriptionStatus: string;
  subscriptionStart?: string;
  subscriptionEnd?: string;
  credits: number;
  assignments: PtAssignmentSummary[];
  sessions: PtSessionSummary[];
  attendance: AttendanceSummary[];
}

type JsonRecord = Record<string, unknown>;

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

function getNumber(payload: JsonRecord, keys: string[]): number {
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

function resolveActivePlan(dashboard: unknown, entitlements: unknown): string {
  const dashboardRecord = toRecord(dashboard);
  const entitlementsRecord = toRecord(entitlements);

  return (
    getString(dashboardRecord, ["activePlan", "planName", "currentPlan"]) ||
    getString(entitlementsRecord, ["activePlan", "planName", "currentPlan"]) ||
    "-"
  );
}

function resolveCredits(wallet: unknown): number {
  const walletRecord = toRecord(wallet);
  return getNumber(walletRecord, ["balance", "credits", "availableCredits"]);
}

function resolveSubscriptionStatus(dashboard: unknown, entitlements: unknown): string {
  const status =
    getString(toRecord(dashboard), ["membershipStatus", "status", "subscriptionStatus", "planStatus"]) ||
    getString(toRecord(entitlements), ["membershipStatus", "status", "subscriptionStatus", "planStatus"]);

  return status || "-";
}

function resolveSubscriptionStart(dashboard: unknown, entitlements: unknown): string | undefined {
  const value =
    getString(toRecord(dashboard), ["startDate", "subscriptionStart", "activeFrom", "planStartDate"]) ||
    getString(toRecord(entitlements), ["startDate", "subscriptionStart", "activeFrom", "planStartDate"]);

  return value || undefined;
}

function resolveSubscriptionEnd(dashboard: unknown, entitlements: unknown): string | undefined {
  const value =
    getString(toRecord(dashboard), ["expiryDate", "endDate", "subscriptionEnd", "activeTill", "planEndDate"]) ||
    getString(toRecord(entitlements), ["expiryDate", "endDate", "subscriptionEnd", "activeTill", "planEndDate"]);

  return value || undefined;
}

function resolveLifecycle(
  dashboard: unknown,
  entitlements: unknown,
  activePlan: string,
  checkIns: number,
): MemberLifecycle {
  const statusRaw = resolveSubscriptionStatus(dashboard, entitlements);
  const normalized = statusRaw.toUpperCase();

  if (normalized.includes("EXPIRED") || normalized.includes("LAPSED") || normalized.includes("INACTIVE")) {
    return "EXPIRED";
  }

  if (normalized.includes("IRREGULAR") || normalized.includes("AT_RISK") || normalized.includes("PENDING")) {
    return "IRREGULAR";
  }

  if (normalized.includes("ACTIVE") || normalized.includes("RUNNING") || normalized.includes("VALID")) {
    return "ACTIVE";
  }

  if (activePlan === "-") {
    return "EXPIRED";
  }

  if (checkIns === 0) {
    return "IRREGULAR";
  }

  return "ACTIVE";
}

function isPtClient(member: UserDirectoryItem, details?: MemberDetailSummary): boolean {
  if ((details?.ptSessions || 0) > 0) {
    return true;
  }

  return member.designation?.toUpperCase().includes("PT") || false;
}

function lifecycleClasses(lifecycle: MemberLifecycle): string {
  if (lifecycle === "ACTIVE") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (lifecycle === "EXPIRED") {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }

  return "bg-amber-50 text-amber-700 border-amber-200";
}

function mapAssignment(item: unknown, index: number): PtAssignmentSummary {
  const record = toRecord(item);

  return {
    assignmentId: getString(record, ["assignmentId", "id"]) || `assignment-${index}`,
    trainerName: getString(record, ["trainerName", "assignedTrainerName", "coachName", "trainer"]) || "-",
    status: getString(record, ["status", "assignmentStatus"]) || "-",
  };
}

function mapSession(item: unknown, assignmentId: string, index: number): PtSessionSummary {
  const record = toRecord(item);

  return {
    sessionId: getString(record, ["sessionId", "id"]) || `${assignmentId}-session-${index}`,
    assignmentId,
    sessionAt: getString(record, ["sessionAt", "scheduledAt", "startTime", "createdAt"]) || undefined,
    status: getString(record, ["status"]) || undefined,
  };
}

function mapAttendance(item: unknown, index: number): AttendanceSummary {
  const record = toRecord(item);
  return {
    id: getString(record, ["id", "checkInId"]) || `attendance-${index}`,
    checkInAt: getString(record, ["checkInAt", "entryTime", "createdAt"]) || undefined,
    checkOutAt: getString(record, ["checkOutAt", "exitTime", "updatedAt"]) || undefined,
  };
}

async function fetchMemberSummary(token: string, memberId: string): Promise<MemberDetailSummary> {
  const [dashboard, entitlements, wallet, assignments, attendance] = await Promise.all([
    subscriptionService.getMemberDashboard(token, memberId),
    subscriptionService.getMemberEntitlements(token, memberId),
    subscriptionService.getCreditsWallet(token, memberId),
    trainingService.getMemberAssignments(token, memberId),
    engagementService.getAttendanceByMember(token, memberId),
  ]);

  const activePlan = resolveActivePlan(dashboard, entitlements);
  const checkIns = Array.isArray(attendance) ? attendance.length : 0;

  return {
    activePlan,
    credits: resolveCredits(wallet),
    ptSessions: assignments.length,
    checkIns,
    membershipState: resolveLifecycle(dashboard, entitlements, activePlan, checkIns),
  };
}

export default function MembersPage() {
  const { token, user, accessMetadata } = useAuth();
  const canViewMembers = hasCapability(user, accessMetadata, CAPABILITIES.viewMembers, true);
  const canCreateMember = hasCapability(user, accessMetadata, CAPABILITIES.createMember, true);

  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("ALL");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsByMemberId, setDetailsByMemberId] = useState<Record<string, MemberDetailSummary>>({});
  const [memberProfile, setMemberProfile] = useState<MemberProfileData | null>(null);

  const loadMembers = useCallback(
    async (query?: string) => {
      if (!token || !canViewMembers) {
        return;
      }

      setLoadingMembers(true);
      setError(null);

      try {
        const normalized = query?.trim() || "";
        const response = normalized
          ? await usersService.searchMembers(token, normalized)
          : await usersService.getUsersByRole(token, "MEMBER");

        setMembers(response);
        setSelectedMemberId((current) => {
          if (current && response.some((item) => item.id === current)) {
            return current;
          }
          return response[0]?.id || "";
        });
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load members";
        setError(message);
      } finally {
        setLoadingMembers(false);
      }
    },
    [token, canViewMembers],
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
              const summary = await fetchMemberSummary(token, member.id);
              return [member.id, summary] as const;
            } catch {
              return [
                member.id,
                {
                  activePlan: "-",
                  credits: 0,
                  ptSessions: 0,
                  checkIns: 0,
                  membershipState: "ACTIVE" as MemberLifecycle,
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
    [token],
  );

  const loadMemberProfile = useCallback(
    async (memberId: string) => {
      if (!token || !memberId) {
        setMemberProfile(null);
        return;
      }

      setLoadingProfile(true);
      setError(null);

      try {
        const [dashboard, entitlements, wallet, assignmentRaw, attendanceRaw] = await Promise.all([
          subscriptionService.getMemberDashboard(token, memberId),
          subscriptionService.getMemberEntitlements(token, memberId),
          subscriptionService.getCreditsWallet(token, memberId),
          trainingService.getMemberAssignments(token, memberId),
          engagementService.getAttendanceByMember(token, memberId),
        ]);

        const assignments = assignmentRaw.map((item, index) => mapAssignment(item, index));
        const sessionsNested = await Promise.all(
          assignments.map(async (assignment) => {
            if (!assignment.assignmentId) {
              return [] as PtSessionSummary[];
            }

            try {
              const sessionRaw = await trainingService.getPtSessionsByAssignment(token, assignment.assignmentId);
              return sessionRaw.map((item, index) => mapSession(item, assignment.assignmentId, index));
            } catch {
              return [] as PtSessionSummary[];
            }
          }),
        );

        const sessions = sessionsNested.flat();
        const attendance = attendanceRaw.map((item, index) => mapAttendance(item, index));

        setMemberProfile({
          activePlan: resolveActivePlan(dashboard, entitlements),
          subscriptionStatus: resolveSubscriptionStatus(dashboard, entitlements),
          subscriptionStart: resolveSubscriptionStart(dashboard, entitlements),
          subscriptionEnd: resolveSubscriptionEnd(dashboard, entitlements),
          credits: resolveCredits(wallet),
          assignments,
          sessions,
          attendance,
        });
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load member profile";
        setError(message);
        setMemberProfile(null);
      } finally {
        setLoadingProfile(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!canViewMembers) {
      setLoadingMembers(false);
      return;
    }

    void loadMembers();
  }, [loadMembers, canViewMembers]);

  useEffect(() => {
    if (members.length === 0) {
      setDetailsByMemberId({});
      return;
    }

    void hydrateMemberSummaries(members);
  }, [members, hydrateMemberSummaries]);

  useEffect(() => {
    if (!selectedMemberId) {
      setMemberProfile(null);
      return;
    }

    void loadMemberProfile(selectedMemberId);
  }, [selectedMemberId, loadMemberProfile]);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) || null,
    [members, selectedMemberId],
  );

  const summaryStats = useMemo(() => {
    let active = 0;
    let expired = 0;
    let irregular = 0;
    let ptClients = 0;

    members.forEach((member) => {
      const details = detailsByMemberId[member.id];
      const lifecycle = details?.membershipState || "ACTIVE";

      if (lifecycle === "ACTIVE") {
        active += 1;
      }
      if (lifecycle === "EXPIRED") {
        expired += 1;
      }
      if (lifecycle === "IRREGULAR") {
        irregular += 1;
      }
      if (isPtClient(member, details)) {
        ptClients += 1;
      }
    });

    return { active, expired, irregular, ptClients };
  }, [members, detailsByMemberId]);

  const filterCounts = useMemo(
    () => ({
      ALL: members.length,
      ACTIVE: summaryStats.active,
      EXPIRED: summaryStats.expired,
      IRREGULAR: summaryStats.irregular,
      PT: summaryStats.ptClients,
      NON_PT: Math.max(members.length - summaryStats.ptClients, 0),
    }),
    [members.length, summaryStats],
  );

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const details = detailsByMemberId[member.id];
      const lifecycle = details?.membershipState || "ACTIVE";
      const ptClient = isPtClient(member, details);

      if (memberFilter === "ACTIVE" && lifecycle !== "ACTIVE") {
        return false;
      }
      if (memberFilter === "EXPIRED" && lifecycle !== "EXPIRED") {
        return false;
      }
      if (memberFilter === "IRREGULAR" && lifecycle !== "IRREGULAR") {
        return false;
      }
      if (memberFilter === "PT" && !ptClient) {
        return false;
      }
      if (memberFilter === "NON_PT" && ptClient) {
        return false;
      }

      return true;
    });
  }, [members, memberFilter, detailsByMemberId]);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Member Directory</h1>
          <p className="text-gray-500">Active, expired, irregular and PT breakdown with member list.</p>
        </div>
        {canCreateMember ? (
          <Link
            href="/portal/members/add"
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            New Member
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        {[
          { label: "Active Members", value: summaryStats.active },
          { label: "Expired Members", value: summaryStats.expired },
          { label: "Irregular Members", value: summaryStats.irregular },
          { label: "PT Clients", value: summaryStats.ptClients },
        ].map((item) => (
          <article key={item.label} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-gray-500">{item.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{item.value}</p>
          </article>
        ))}
      </div>

      <SectionCard
        title="Member Table"
        subtitle="Filter members similar to manager dashboard layout"
        actions={
          <button
            type="button"
            onClick={() => void loadMembers(searchTerm)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              void loadMembers();
            }}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
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
              { key: "PT", label: "PT" },
              { key: "NON_PT", label: "Non-PT" },
            ] as Array<{ key: MemberFilter; label: string }>
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMemberFilter(item.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                memberFilter === item.key
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {item.label} ({filterCounts[item.key]})
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Membership</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">PT Sessions</th>
                <th className="px-4 py-3">Check-ins</th>
                <th className="px-4 py-3">Segment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredMembers.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={7}>
                    No members found
                  </td>
                </tr>
              ) : (
                filteredMembers.map((member) => {
                  const details = detailsByMemberId[member.id];
                  const lifecycle = details?.membershipState || "ACTIVE";
                  const ptClient = isPtClient(member, details);
                  const selected = selectedMemberId === member.id;

                  return (
                    <tr
                      key={member.id}
                      className={`cursor-pointer hover:bg-gray-50/50 ${selected ? "bg-red-50/40" : ""}`}
                      onClick={() => setSelectedMemberId(member.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{member.name}</p>
                        <p className="text-xs text-gray-500">{member.designation || "MEMBER"}</p>
                      </td>
                      <td className="px-4 py-3">{member.mobile}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-semibold ${lifecycleClasses(lifecycle)}`}
                          >
                            {lifecycle}
                          </span>
                          <span className="text-xs text-gray-500">
                            {details?.activePlan || (loadingSummaries ? "Loading..." : "-")}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{details ? details.credits : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3">{details ? details.ptSessions : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3">{details ? details.checkIns : loadingSummaries ? "..." : "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                            ptClient
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {ptClient ? "PT" : "Non-PT"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Member Profile"
        subtitle="Subscription, PT details and attendance timeline"
        actions={
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
            >
              {members.map((member) => (
                <option key={`profile-member-${member.id}`} value={member.id}>
                  {member.name} ({member.mobile})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (selectedMemberId) {
                  void loadMemberProfile(selectedMemberId);
                }
              }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Refresh
            </button>
          </div>
        }
      >
        {!selectedMember ? (
          <p className="text-sm text-slate-500">Select a member to view profile details.</p>
        ) : loadingProfile ? (
          <p className="text-sm text-slate-500">Loading profile details...</p>
        ) : !memberProfile ? (
          <p className="text-sm text-slate-500">No profile details available for this member.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Member</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{selectedMember.name}</p>
                <p className="text-xs text-gray-500">{selectedMember.mobile}</p>
              </article>
              <article className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Current Plan</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{memberProfile.activePlan}</p>
              </article>
              <article className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Subscription Status</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{memberProfile.subscriptionStatus}</p>
              </article>
              <article className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Credits</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{memberProfile.credits}</p>
              </article>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-xl border border-gray-100 bg-white p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Subscription Start</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatDateTime(memberProfile.subscriptionStart)}</p>
              </article>
              <article className="rounded-xl border border-gray-100 bg-white p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase">Subscription End</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatDateTime(memberProfile.subscriptionEnd)}</p>
              </article>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-800">PT Assignments</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                        <th className="px-3 py-2">Assignment</th>
                        <th className="px-3 py-2">Trainer</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {memberProfile.assignments.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-gray-500" colSpan={3}>
                            No PT assignments
                          </td>
                        </tr>
                      ) : (
                        memberProfile.assignments.map((assignment) => (
                          <tr key={assignment.assignmentId}>
                            <td className="px-3 py-3 text-gray-700">#{assignment.assignmentId}</td>
                            <td className="px-3 py-3 text-gray-700">{assignment.trainerName}</td>
                            <td className="px-3 py-3 text-gray-700">{assignment.status}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-800">PT Sessions</h3>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                        <th className="px-3 py-2">Session</th>
                        <th className="px-3 py-2">Assignment</th>
                        <th className="px-3 py-2">When</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {memberProfile.sessions.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-gray-500" colSpan={4}>
                            No PT sessions recorded
                          </td>
                        </tr>
                      ) : (
                        memberProfile.sessions.slice(0, 12).map((session) => (
                          <tr key={session.sessionId}>
                            <td className="px-3 py-3 text-gray-700">#{session.sessionId}</td>
                            <td className="px-3 py-3 text-gray-700">{session.assignmentId}</td>
                            <td className="px-3 py-3 text-gray-700">{formatDateTime(session.sessionAt)}</td>
                            <td className="px-3 py-3 text-gray-700">{session.status || "-"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">Attendance History</h3>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                      <th className="px-3 py-2">Check-in</th>
                      <th className="px-3 py-2">Check-out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {memberProfile.attendance.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-500" colSpan={2}>
                          No attendance history
                        </td>
                      </tr>
                    ) : (
                      memberProfile.attendance.slice(0, 15).map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-3 py-3 text-gray-700">{formatDateTime(entry.checkInAt)}</td>
                          <td className="px-3 py-3 text-gray-700">{formatDateTime(entry.checkOutAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
