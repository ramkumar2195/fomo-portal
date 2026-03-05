"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { hasCapability } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import { UpdateUserRequest, usersService } from "@/lib/api/services/users-service";
import { formatDateTime } from "@/lib/formatters";
import { DataScope, EmploymentType, UserDesignation, UserRole } from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";

interface ToastState {
  kind: "success" | "error";
  message: string;
}

interface Option<T extends string> {
  label: string;
  value: T;
}

interface AttendanceRow {
  id: string;
  memberName: string;
  checkInAt?: string;
  checkOutAt?: string;
}

interface UserManagementPageProps {
  role: Extract<UserRole, "STAFF" | "COACH">;
  title: string;
  subtitle: string;
  addHref: string;
  addLabel: string;
  designationOptions: Option<UserDesignation>[];
  requiredViewCapabilities: readonly string[];
  requiredUpdateCapabilities: readonly string[];
  requiredCreateCapabilities: readonly string[];
  leaveTitle: string;
  leaveSubtitle: string;
  showClientAttendance?: boolean;
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

function mapTodayAttendance(payload: unknown[]): AttendanceRow[] {
  return payload.map((item, index) => {
    const record = toRecord(item);
    return {
      id: getString(record, ["id", "checkInId"]) || `attendance-${index}`,
      memberName: getString(record, ["memberName", "name"]) || "-",
      checkInAt: getString(record, ["checkInAt", "entryTime", "createdAt"]) || undefined,
      checkOutAt: getString(record, ["checkOutAt", "exitTime", "updatedAt"]) || undefined,
    };
  });
}

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveBooleanFilter(value: "ALL" | "ACTIVE" | "INACTIVE"): boolean | undefined {
  if (value === "ACTIVE") {
    return true;
  }

  if (value === "INACTIVE") {
    return false;
  }

  return undefined;
}

export function UserManagementPage({
  role,
  title,
  subtitle,
  addHref,
  addLabel,
  designationOptions,
  requiredViewCapabilities,
  requiredUpdateCapabilities,
  requiredCreateCapabilities,
  leaveTitle,
  leaveSubtitle,
  showClientAttendance = false,
}: UserManagementPageProps) {
  const { token, user, accessMetadata } = useAuth();

  const canView = hasCapability(user, accessMetadata, requiredViewCapabilities, true);
  const canUpdate = hasCapability(user, accessMetadata, requiredUpdateCapabilities, true);
  const canCreate = hasCapability(user, accessMetadata, requiredCreateCapabilities, true);

  const [users, setUsers] = useState<UserDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [designationFilter, setDesignationFilter] = useState("");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState<"" | EmploymentType>("");
  const [dataScopeFilter, setDataScopeFilter] = useState<"" | DataScope>("");

  const [editingUser, setEditingUser] = useState<UserDirectoryItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    mobileNumber: "",
    email: "",
    employmentType: "INTERNAL" as EmploymentType,
    designation: designationOptions[0]?.value || "GYM_MANAGER",
    dataScope: "BRANCH" as DataScope,
    active: true,
  });

  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);

  const loadUsers = useCallback(async () => {
    if (!token || !canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await usersService.searchUsers(token, {
        role,
        query: toOptionalString(searchQuery),
        active: resolveBooleanFilter(activeFilter),
        designation: designationFilter ? (designationFilter as UserDesignation) : undefined,
        employmentType: employmentTypeFilter || undefined,
        dataScope: dataScopeFilter || undefined,
      });

      setUsers(list);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : `Unable to load ${role.toLowerCase()} users`;
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }, [token, canView, role, searchQuery, activeFilter, designationFilter, employmentTypeFilter, dataScopeFilter]);

  const loadAttendance = useCallback(async () => {
    if (!token || !showClientAttendance) {
      return;
    }

    try {
      const raw = await engagementService.getTodayAttendance(token);
      setAttendanceRows(mapTodayAttendance(raw));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load client attendance";
      setError(message);
    }
  }, [token, showClientAttendance]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!showClientAttendance) {
      return;
    }

    void loadAttendance();
  }, [showClientAttendance, loadAttendance]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const summary = useMemo(() => {
    const activeCount = users.filter((item) => item.active !== false).length;
    const inactiveCount = users.filter((item) => item.active === false).length;
    return {
      total: users.length,
      active: activeCount,
      inactive: inactiveCount,
    };
  }, [users]);

  const openEdit = (item: UserDirectoryItem) => {
    setEditingUser(item);
    setEditForm({
      name: item.name || "",
      mobileNumber: item.mobile || "",
      email: item.email || "",
      employmentType: (item.employmentType as EmploymentType) || "INTERNAL",
      designation: (item.designation as UserDesignation) || designationOptions[0]?.value || "GYM_MANAGER",
      dataScope: (item.dataScope as DataScope) || "BRANCH",
      active: item.active !== false,
    });
  };

  const closeEdit = () => {
    setEditingUser(null);
  };

  const onSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !editingUser || !canUpdate) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: UpdateUserRequest = {
        name: editForm.name.trim(),
        mobileNumber: editForm.mobileNumber,
        email: toOptionalString(editForm.email),
        role,
        employmentType: editForm.employmentType,
        designation: editForm.designation,
        dataScope: editForm.dataScope,
        active: editForm.active,
      };

      const updated = await usersService.updateUser(token, editingUser.id, payload);

      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setToast({ kind: "success", message: `${role === "STAFF" ? "Staff" : "Trainer"} updated successfully.` });
      closeEdit();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to update user";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <SectionCard title={title} subtitle="Capabilities are controlled by designation metadata">
        <p className="text-sm text-slate-500">You do not have permission to view this module.</p>
      </SectionCard>
    );
  }

  if (loading) {
    return <PageLoader label={`Loading ${title.toLowerCase()}...`} />;
  }

  return (
    <div className="space-y-6">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500">{subtitle}</p>
        </div>
        {canCreate ? (
          <Link
            href={addHref}
            className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            {addLabel}
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.total}</p>
        </article>
        <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Active</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{summary.active}</p>
        </article>
        <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Inactive</p>
          <p className="mt-1 text-2xl font-bold text-rose-700">{summary.inactive}</p>
        </article>
      </div>

      <SectionCard
        title={`${role === "STAFF" ? "Staff" : "Trainer"} Directory`}
        actions={
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        }
      >
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Search by name/mobile"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />

          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
          >
            <option value="ALL">All status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={designationFilter}
            onChange={(event) => setDesignationFilter(event.target.value)}
          >
            <option value="">All designations</option>
            {designationOptions.map((item) => (
              <option key={`filter-designation-${item.value}`} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={employmentTypeFilter}
            onChange={(event) => setEmploymentTypeFilter(event.target.value as "" | EmploymentType)}
          >
            <option value="">All employment</option>
            <option value="INTERNAL">INTERNAL</option>
            <option value="VENDOR">VENDOR</option>
          </select>

          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={dataScopeFilter}
            onChange={(event) => setDataScopeFilter(event.target.value as "" | DataScope)}
          >
            <option value="">All scopes</option>
            <option value="GLOBAL">GLOBAL</option>
            <option value="BRANCH">BRANCH</option>
            <option value="ASSIGNED_ONLY">ASSIGNED_ONLY</option>
          </select>

          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Search
          </button>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Employment</th>
                <th className="px-4 py-3">Data Scope</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={7}>
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.email || "-"}</p>
                    </td>
                    <td className="px-4 py-3">{item.mobile}</td>
                    <td className="px-4 py-3">{item.designation || "-"}</td>
                    <td className="px-4 py-3">{item.employmentType || "-"}</td>
                    <td className="px-4 py-3">{item.dataScope || "-"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                          item.active === false
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {item.active === false ? "INACTIVE" : "ACTIVE"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!canUpdate}
                        onClick={() => openEdit(item)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title={leaveTitle} subtitle={leaveSubtitle}>
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Leave approval APIs are not available in current backend contracts. UI is prepared for integration once
          leave endpoints are provided.
        </p>
      </SectionCard>

      {showClientAttendance ? (
        <SectionCard
          title="Client Attendance"
          subtitle="Today attendance from engagement-service"
          actions={
            <button
              type="button"
              onClick={() => void loadAttendance()}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Refresh
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Check-out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attendanceRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-gray-500" colSpan={3}>
                      No attendance records today
                    </td>
                  </tr>
                ) : (
                  attendanceRows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-semibold text-gray-900">{row.memberName}</td>
                      <td className="px-4 py-3">{formatDateTime(row.checkInAt)}</td>
                      <td className="px-4 py-3">{formatDateTime(row.checkOutAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {editingUser ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Manage {editingUser.name}</h2>
                <p className="text-sm text-slate-500">Update user details via users-service.</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form className="grid gap-3 md:grid-cols-2" onSubmit={onSaveEdit}>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.name}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Mobile</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.mobileNumber}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      mobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                    }))
                  }
                  minLength={10}
                  maxLength={10}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  type="email"
                  value={editForm.email}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Employment Type</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.employmentType}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, employmentType: event.target.value as EmploymentType }))
                  }
                >
                  <option value="INTERNAL">INTERNAL</option>
                  <option value="VENDOR">VENDOR</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Designation</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.designation}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, designation: event.target.value as UserDesignation }))
                  }
                >
                  {designationOptions.map((item) => (
                    <option key={`edit-designation-${item.value}`} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Data Scope</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.dataScope}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, dataScope: event.target.value as DataScope }))}
                >
                  <option value="GLOBAL">GLOBAL</option>
                  <option value="BRANCH">BRANCH</option>
                  <option value="ASSIGNED_ONLY">ASSIGNED_ONLY</option>
                </select>
              </div>

              <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, active: event.target.checked }))}
                />
                Active
              </label>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
