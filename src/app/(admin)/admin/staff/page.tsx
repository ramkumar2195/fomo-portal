"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { UpdateUserRequest, usersService } from "@/lib/api/services/users-service";
import { UserDesignation } from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";

interface StaffRow {
  user: UserDirectoryItem;
  assignedLeads: string;
  conversionRate: string;
  activityStatus: string;
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractNumericId(user: UserDirectoryItem): number | null {
  const direct = parseNumber(user.id);
  if (direct !== null) {
    return direct;
  }

  const mobileDigits = user.mobile.replace(/[^0-9]/g, "");
  if (!mobileDigits) {
    return null;
  }

  return parseNumber(mobileDigits);
}

function pickString(payload: unknown, keys: string[]): string | null {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickNumber(payload: unknown, keys: string[]): number | null {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    const parsed = parseNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function formatEnum(value?: string): string {
  if (!value) {
    return "-";
  }
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildUpdatePayload(user: UserDirectoryItem, active: boolean): UpdateUserRequest {
  return {
    fullName: user.name,
    name: user.name,
    email: user.email || `${user.mobile}@fomo.local`,
    mobileNumber: user.mobile,
    role: "STAFF",
    active,
    employmentType: user.employmentType as "INTERNAL" | "VENDOR" | undefined,
    designation: user.designation as UserDesignation | undefined,
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
    dateOfJoining: user.dateOfJoining,
    shiftTimings: user.shiftTimings,
    profileImageUrl: user.profileImageUrl,
  };
}

async function enrichStaffRow(token: string, staffUser: UserDirectoryItem): Promise<StaffRow> {
  const numericId = extractNumericId(staffUser);

  const [dashboardResult, inquiriesResult] = await Promise.allSettled([
    engagementService.getStaffDashboard(token, staffUser.id),
    numericId === null
      ? Promise.resolve(null)
      : subscriptionService.searchInquiriesPaged(token, { clientRepStaffId: numericId }, 0, 1),
  ]);

  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const inquiriesPage = inquiriesResult.status === "fulfilled" ? inquiriesResult.value : null;

  const assignedLeads = inquiriesPage ? String(inquiriesPage.totalElements) : "-";
  const conversionRate = pickNumber(dashboard, ["conversionRate", "leadConversionRate"]);
  const activityStatus = pickString(dashboard, ["activityStatus", "status", "onlineStatus"]);

  return {
    user: staffUser,
    assignedLeads,
    conversionRate: conversionRate === null ? "-" : `${conversionRate}%`,
    activityStatus: activityStatus || "-",
  };
}

export default function StaffPage() {
  const router = useRouter();
  const { token } = useAuth();
  const { branches } = useBranch();
  const [search, setSearch] = useState("");
  const [designationFilter, setDesignationFilter] = useState("ALL");
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStaffId, setUpdatingStaffId] = useState<string | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffRow | null>(null);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((branch) => map.set(String(branch.id), branch.name));
    return map;
  }, [branches]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const staffUsers = await usersService.searchUsers(token, {
          role: "STAFF",
          query: search.trim() || undefined,
          designation: designationFilter === "ALL" ? undefined : (designationFilter as UserDesignation),
        });

        const enriched = await Promise.all(staffUsers.slice(0, 20).map((user) => enrichStaffRow(token, user)));

        if (!active) {
          return;
        }

        setRows(enriched);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load staff.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [designationFilter, search, token]);

  const filterValues = useMemo(
    () => ({
      designation: designationFilter,
    }),
    [designationFilter],
  );

  const toggleStaffActive = async (staffId: string, nextActive: boolean) => {
    if (!token) {
      return;
    }
    setUpdatingStaffId(staffId);
    setError(null);
    try {
      const latest = await usersService.getUserById(token, staffId);
      if (!latest) {
        throw new Error("Staff not found.");
      }
      const updated = await usersService.updateUser(token, staffId, buildUpdatePayload(latest, nextActive));
      setRows((current) =>
        current.map((row) => (row.user.id === staffId ? { ...row, user: updated } : row)),
      );
    } catch (updateError) {
      setError(updateError instanceof ApiError ? updateError.message : "Unable to update staff status.");
    } finally {
      setUpdatingStaffId(null);
    }
  };

  const deleteStaff = async () => {
    if (!token || !deletingStaff) {
      return;
    }
    setUpdatingStaffId(deletingStaff.user.id);
    setError(null);
    try {
      await usersService.deleteUser(token, deletingStaff.user.id);
      setRows((current) => current.filter((row) => row.user.id !== deletingStaff.user.id));
      setDeletingStaff(null);
    } catch (deleteError) {
      setError(deleteError instanceof ApiError ? deleteError.message : "Unable to delete staff.");
    } finally {
      setUpdatingStaffId(null);
    }
  };

  return (
    <AdminPageFrame
      title="Staff"
      description="Staff directory with branch mapping, activity, lead ownership, and profile actions."
      searchPlaceholder="Search staff name, role, branch..."
      searchValue={search}
      onSearchChange={setSearch}
      action={
        <Link
          href="/portal/staff/add"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          Add Staff
        </Link>
      }
      filters={[
        {
          id: "designation",
          label: "Role",
          options: [
            { label: "All Roles", value: "ALL" },
            { label: "GYM_MANAGER", value: "GYM_MANAGER" },
            { label: "SALES_MANAGER", value: "SALES_MANAGER" },
            { label: "SALES_EXECUTIVE", value: "SALES_EXECUTIVE" },
            { label: "FRONT_DESK_EXECUTIVE", value: "FRONT_DESK_EXECUTIVE" },
            { label: "FITNESS_MANAGER", value: "FITNESS_MANAGER" },
          ],
        },
      ]}
      filterValues={filterValues}
      onFilterChange={(filterId, value) => {
        if (filterId === "designation") {
          setDesignationFilter(value);
        }
      }}
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Assigned Leads</th>
              <th className="px-4 py-3">Conversion Rate</th>
              <th className="px-4 py-3">Activity Status</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={row.user.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => router.push(`/admin/staff/${row.user.id}`)}
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{row.user.name || row.user.mobile}</div>
                  <div className="text-xs text-slate-500">{row.user.email || "-"}</div>
                </td>
                <td className="px-4 py-3 text-slate-700">{formatEnum(row.user.designation)}</td>
                <td className="px-4 py-3 text-slate-700">{branchNameById.get(String(row.user.defaultBranchId || "")) || "-"}</td>
                <td className="px-4 py-3 text-slate-700">{row.user.mobile}</td>
                <td className="px-4 py-3 text-slate-700">{row.assignedLeads}</td>
                <td className="px-4 py-3 text-slate-700">{row.conversionRate}</td>
                <td className="px-4 py-3 text-slate-700">{row.activityStatus}</td>
                <td className="px-4 py-3 text-slate-700">
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
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleStaffActive(row.user.id, !row.user.active);
                      }}
                      disabled={updatingStaffId === row.user.id}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                        row.user.active
                          ? "border border-slate-200 text-slate-700 hover:bg-slate-50"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      } disabled:opacity-50`}
                    >
                      {updatingStaffId === row.user.id ? "Saving..." : row.user.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeletingStaff(row);
                      }}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {loading ? <div className="text-sm text-slate-500">Loading staff...</div> : null}

      {!loading && rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">No staff found.</div>
      ) : null}

      <Modal
        open={Boolean(deletingStaff)}
        onClose={() => setDeletingStaff(null)}
        title={deletingStaff ? `Delete ${deletingStaff.user.name}` : "Delete Staff"}
      >
        {!deletingStaff ? null : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This removes the staff profile and login completely. Use deactivate if you only want to stop login access.
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingStaff(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteStaff()}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Delete Staff
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AdminPageFrame>
  );
}
