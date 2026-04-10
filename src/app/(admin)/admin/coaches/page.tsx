"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

interface CoachRow {
  user: UserDirectoryItem;
  trainerType: string;
  currentStatus: "CHECKED_IN" | "CHECKED_OUT" | "NO_PUNCH";
  programCount: number;
  totalClientCount: number;
  generalClientCount: number;
  ptClientCount: number;
  ptInactiveCount: number;
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function toDisplayLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  return value.replaceAll("_", " ");
}

function normalizeCurrentStatus(records: Record<string, unknown>[], coachId: string): CoachRow["currentStatus"] {
  const todaysRecords = records.filter((item) => String(item.staffId ?? "") === coachId);
  if (todaysRecords.length === 0) {
    return "NO_PUNCH";
  }
  return todaysRecords.some((item) => !item.clockOutAt) ? "CHECKED_IN" : "CHECKED_OUT";
}

function statusPill(status: CoachRow["currentStatus"]): string {
  switch (status) {
    case "CHECKED_IN":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "CHECKED_OUT":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function statusLabel(status: CoachRow["currentStatus"]): string {
  switch (status) {
    case "CHECKED_IN":
      return "Checked In";
    case "CHECKED_OUT":
      return "Checked Out";
    default:
      return "No Punch";
  }
}

function buildUpdatePayload(user: UserDirectoryItem, active: boolean) {
  return {
    fullName: user.name,
    email: user.email || `${user.mobile}@fomo.local`,
    mobileNumber: user.mobile,
    role: user.role as "ADMIN" | "STAFF" | "COACH" | "MEMBER",
    active,
    employmentType: user.employmentType as
      | "INTERNAL"
      | "VENDOR"
      | undefined,
    designation: user.designation as
      | "SUPER_ADMIN"
      | "GYM_MANAGER"
      | "SALES_MANAGER"
      | "SALES_EXECUTIVE"
      | "FRONT_DESK_EXECUTIVE"
      | "FITNESS_MANAGER"
      | "HEAD_COACH"
      | "PT_COACH"
      | "GENERAL_TRAINER"
      | "YOGA_INSTRUCTOR"
      | "ZUMBA_INSTRUCTOR"
      | "BOXING_INSTRUCTOR"
      | "FREELANCE_TRAINER"
      | "MEMBER"
      | undefined,
    dataScope: user.dataScope as "GLOBAL" | "BRANCH" | "ASSIGNED_ONLY" | undefined,
    defaultBranchId: user.defaultBranchId,
    alternateMobileNumber: user.alternateMobileNumber,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    aadhaarNumber: user.aadhaarNumber,
    gstNumber: user.gstNumber,
    address: user.address,
    emergencyContactName: user.emergencyContactName,
    emergencyContactPhone: user.emergencyContactPhone,
    emergencyContactRelation: user.emergencyContactRelation,
    defaultTrainerStaffId: user.defaultTrainerStaffId,
  };
}

export default function CoachesPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingCoachId, setUpdatingCoachId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const today = new Date().toISOString().slice(0, 10);
        const [coaches, programsPage, attendanceReport, memberDirectory] = await Promise.all([
          usersService.searchUsers(token, {
            role: "COACH",
            query: search.trim() || undefined,
          }),
          trainingService.listPrograms(token, 0, 200),
          usersService.getTrainerAttendanceReport(token, { from: today, to: today }),
          usersService.searchUsers(token, { role: "MEMBER" }),
        ]);

        const programsByTrainer = new Map<string, number>();
        programsPage.content.forEach((program) => {
          if (!program.trainerId) {
            return;
          }
          const key = String(program.trainerId);
          programsByTrainer.set(key, (programsByTrainer.get(key) || 0) + 1);
        });

        const attendanceRecords = Array.isArray(attendanceReport.records) ? attendanceReport.records.map((item) => toRecord(item)) : [];

        const coachRows = await Promise.all(
          coaches.map(async (coach) => {
            const assignmentResult = await Promise.allSettled([trainingService.getCoachAssignments(token, coach.id)]);
            const assignments = assignmentResult[0]?.status === "fulfilled" ? assignmentResult[0].value : [];
            const generalClientCount = memberDirectory.filter((member) => String(member.defaultTrainerStaffId ?? "") === coach.id).length;
            const ptClientCount = assignments.length;
            const ptInactiveCount = assignments.filter((item) => toRecord(item).active === false).length;
            return {
              user: coach,
              trainerType: toDisplayLabel(coach.designation),
              currentStatus: normalizeCurrentStatus(attendanceRecords, coach.id),
              programCount: programsByTrainer.get(String(coach.id)) || 0,
              totalClientCount: generalClientCount + ptClientCount,
              generalClientCount,
              ptClientCount,
              ptInactiveCount,
            } satisfies CoachRow;
          }),
        );

        if (!active) {
          return;
        }

        setRows(coachRows);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load coaches.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [search, token]);

  const totals = useMemo(() => {
    return rows.reduce(
      (summary, row) => {
        if (row.user.active) {
          summary.active += 1;
        } else {
          summary.inactive += 1;
        }
        if (row.currentStatus === "CHECKED_IN") {
          summary.checkedIn += 1;
        }
        return summary;
      },
      { total: rows.length, active: 0, inactive: 0, checkedIn: 0 },
    );
  }, [rows]);

  const toggleCoachActive = async (coachId: string, nextActive: boolean) => {
    if (!token) {
      return;
    }

    setUpdatingCoachId(coachId);
    setError(null);
    try {
      const latest = await usersService.getUserById(token, coachId);
      if (!latest) {
        throw new Error("Coach not found.");
      }
      const updated = await usersService.updateUser(token, coachId, buildUpdatePayload(latest, nextActive));
      setRows((current) =>
        current.map((row) =>
          row.user.id === coachId
            ? {
                ...row,
                user: updated,
              }
            : row,
        ),
      );
    } catch (updateError) {
      setError(updateError instanceof ApiError ? updateError.message : "Unable to update coach status.");
    } finally {
      setUpdatingCoachId(null);
    }
  };

  return (
    <AdminPageFrame
      title="Coaches"
      description="Operational trainer directory with active status, check-in state, PT load, and contact details."
      searchPlaceholder="Search coach name, mobile, designation..."
      searchValue={search}
      onSearchChange={setSearch}
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="Total Coaches">
          <p className="text-2xl font-bold text-slate-800">{totals.total}</p>
        </SurfaceCard>
        <SurfaceCard title="Active Coaches">
          <p className="text-2xl font-bold text-slate-800">{totals.active}</p>
        </SurfaceCard>
        <SurfaceCard title="Inactive Coaches">
          <p className="text-2xl font-bold text-slate-800">{totals.inactive}</p>
        </SurfaceCard>
        <SurfaceCard title="Checked In Now">
          <p className="text-2xl font-bold text-slate-800">{totals.checkedIn}</p>
        </SurfaceCard>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Trainer Type</th>
                <th className="px-4 py-3">Check-In</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Clients</th>
                <th className="px-4 py-3">General</th>
                <th className="px-4 py-3">PT</th>
                <th className="px-4 py-3">Programs</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.user.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{row.user.name || row.user.mobile}</div>
                    <div className="text-xs text-slate-500">{row.user.employmentType || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.trainerType}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusPill(row.currentStatus)}`}>
                      {statusLabel(row.currentStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.user.email || "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{row.user.mobile}</td>
                  <td className="px-4 py-3 text-slate-700">{row.totalClientCount}</td>
                  <td className="px-4 py-3 text-slate-700">{row.generalClientCount}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.ptClientCount}
                    {row.ptInactiveCount > 0 ? <span className="ml-1 text-xs text-slate-500">({row.ptInactiveCount} inactive)</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.programCount}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.user.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.user.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={updatingCoachId === row.user.id}
                        onClick={() => void toggleCoachActive(row.user.id, !row.user.active)}
                        className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                          row.user.active
                            ? "border border-slate-200 text-slate-700 hover:bg-slate-50"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        } disabled:opacity-50`}
                      >
                        {updatingCoachId === row.user.id ? "Saving..." : row.user.active ? "Deactivate" : "Activate"}
                      </button>
                      <Link
                        href={`/admin/coaches/${row.user.id}`}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Open Profile
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {loading ? <div className="text-sm text-slate-500">Loading coaches...</div> : null}
      {!loading && rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">No coaches found.</div>
      ) : null}
    </AdminPageFrame>
  );
}
