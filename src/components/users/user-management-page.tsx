"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/modal";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { canAccessRoute, hasCapability } from "@/lib/access-policy";
import { engagementService } from "@/lib/api/services/engagement-service";
import {
  CreateLeaveRequestPayload,
  UpdateUserRequest,
  usersService,
} from "@/lib/api/services/users-service";
import { useBranch } from "@/contexts/branch-context";
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

interface OwnAttendanceRow {
  id: string;
  staffId?: string;
  staffName: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  status: string;
}

interface LeaveRequestRow {
  id: string | number;
  staffName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
}

type ManagementTab = "directory" | "attendance" | "leave";

const LEAVE_TYPES = [
  { label: "Casual Leave", value: "CASUAL" },
  { label: "Sick Leave", value: "SICK" },
  { label: "Earned Leave", value: "EARNED" },
  { label: "Compensatory Off", value: "COMP_OFF" },
  { label: "Loss of Pay", value: "LOP" },
];

const LEAVE_STATUS_STYLES: Record<string, string> = {
  APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-500",
};

function mapOwnAttendance(payload: unknown): OwnAttendanceRow[] {
  if (!payload || typeof payload !== "object") return [];
  const items = Array.isArray(payload) ? payload : (payload as Record<string, unknown>).records as unknown[] ?? [];
  return items.map((item, index) => {
    const r = toRecord(item);
    return {
      id: String(r.id ?? r.attendanceId ?? `att-${index}`),
      staffId: r.staffId !== undefined ? String(r.staffId) : r.trainerId !== undefined ? String(r.trainerId) : undefined,
      staffName: String(r.staffName ?? r.trainerName ?? r.name ?? "-"),
      date: String(r.date ?? r.attendanceDate ?? "-"),
      clockIn: r.clockInTime ? String(r.clockInTime) : r.checkInAt ? String(r.checkInAt) : undefined,
      clockOut: r.clockOutTime ? String(r.clockOutTime) : r.checkOutAt ? String(r.checkOutAt) : undefined,
      status: String(r.status ?? "PRESENT"),
    };
  });
}

function mapLeaveRequests(payload: unknown[]): LeaveRequestRow[] {
  return payload.map((item, index) => {
    const r = toRecord(item);
    return {
      id: r.id ?? r.leaveRequestId ?? `leave-${index}`,
      staffName: String(r.staffName ?? r.trainerName ?? r.name ?? "-"),
      leaveType: String(r.leaveType ?? "-"),
      fromDate: String(r.fromDate ?? r.startDate ?? "-"),
      toDate: String(r.toDate ?? r.endDate ?? "-"),
      reason: String(r.reason ?? "-"),
      status: String(r.status ?? "PENDING"),
    } as LeaveRequestRow;
  });
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
  /** Base route for profile navigation, e.g. "/portal/trainers". User ID is appended. */
  profileRoute?: string;
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

/** Format raw enum values like "SALES_MANAGER" → "Sales Manager", "ASSIGNED_ONLY" → "Assigned Only" */
function formatEnum(val: string): string {
  if (!val || val === "-") return val;
  return val
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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

function buildUpdatePayload(item: UserDirectoryItem, active: boolean, role: Extract<UserRole, "STAFF" | "COACH">): UpdateUserRequest {
  return {
    name: item.name,
    fullName: item.name,
    mobileNumber: item.mobile,
    email: item.email || `${item.mobile}@fomo.local`,
    defaultBranchId: item.defaultBranchId,
    role,
    employmentType: item.employmentType as EmploymentType | undefined,
    designation: item.designation as UserDesignation | undefined,
    dataScope: item.dataScope as DataScope | undefined,
    active,
    alternateMobileNumber: item.alternateMobileNumber,
    dateOfBirth: item.dateOfBirth,
    gender: item.gender,
    aadhaarNumber: item.aadhaarNumber,
    gstNumber: item.gstNumber,
    address: item.address,
    emergencyContactName: item.emergencyContactName,
    emergencyContactPhone: item.emergencyContactPhone,
    emergencyContactRelation: item.emergencyContactRelation,
    defaultTrainerStaffId: item.defaultTrainerStaffId,
    dateOfJoining: item.dateOfJoining,
    totalExperienceYears: item.totalExperienceYears,
    maxClientCapacity: item.maxClientCapacity,
    shiftTimings: item.shiftTimings,
    assignedCategory: item.assignedCategory,
    profileImageUrl: item.profileImageUrl,
  };
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
  profileRoute,
}: UserManagementPageProps) {
  const router = useRouter();
  const { token, user, accessMetadata } = useAuth();
  const { branches } = useBranch();

  /** Resolve numeric branch ID to branch name */
  const branchNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of branches) {
      if (b.id) map.set(String(b.id), b.name || String(b.id));
    }
    return map;
  }, [branches]);

  const routeAllowsView = canAccessRoute(profileRoute || addHref, user, accessMetadata);
  const staffCapabilityFallback = user?.role !== "STAFF" || user.designation !== "GYM_MANAGER";
  const canView = routeAllowsView || hasCapability(user, accessMetadata, requiredViewCapabilities, true);
  const canUpdate = hasCapability(user, accessMetadata, requiredUpdateCapabilities, staffCapabilityFallback);
  const canCreate = hasCapability(user, accessMetadata, requiredCreateCapabilities, staffCapabilityFallback);

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
    defaultBranchId: "",
    employmentType: "INTERNAL" as EmploymentType,
    designation: designationOptions[0]?.value || "GYM_MANAGER",
    dataScope: "BRANCH" as DataScope,
    active: true,
  });

  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [directoryAttendanceByUserId, setDirectoryAttendanceByUserId] = useState<Record<string, OwnAttendanceRow>>({});

  const [activeTab, setActiveTab] = useState<ManagementTab>("directory");
  const [ownAttendance, setOwnAttendance] = useState<OwnAttendanceRow[]>([]);
  const [ownAttendanceLoading, setOwnAttendanceLoading] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<string>("");
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "CASUAL",
    fromDate: "",
    toDate: "",
    reason: "",
    staffId: "",
  });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserDirectoryItem | null>(null);

  const { selectedBranchId, effectiveBranchId } = useBranch();

  const loadUsers = useCallback(async () => {
    if (!token || !canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const [list, attendanceReport] = await Promise.all([
        usersService.searchUsers(token, {
          role,
          query: toOptionalString(searchQuery),
          active: resolveBooleanFilter(activeFilter),
          designation: designationFilter ? (designationFilter as UserDesignation) : undefined,
          employmentType: employmentTypeFilter || undefined,
          dataScope: dataScopeFilter || undefined,
          defaultBranchId: effectiveBranchId ? String(effectiveBranchId) : undefined,
        }),
        role === "COACH"
          ? usersService.getTrainerAttendanceReport(token, { from: today, to: today })
          : usersService.getStaffAttendanceReport(token, { from: today, to: today }),
      ]);

      setUsers(list);

      const attendanceRows = mapOwnAttendance(attendanceReport);
      const nextDirectoryAttendance: Record<string, OwnAttendanceRow> = {};
      attendanceRows.forEach((row) => {
        if (!row.staffId) {
          return;
        }
        const existing = nextDirectoryAttendance[row.staffId];
        if (!existing || (!!row.clockIn && !existing.clockIn)) {
          nextDirectoryAttendance[row.staffId] = row;
        }
      });
      setDirectoryAttendanceByUserId(nextDirectoryAttendance);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : `Unable to load ${role.toLowerCase()} users`;
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }, [token, canView, role, searchQuery, activeFilter, designationFilter, employmentTypeFilter, dataScopeFilter, effectiveBranchId]);

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

  const loadOwnAttendance = useCallback(async () => {
    if (!token) return;
    setOwnAttendanceLoading(true);
    try {
      const data =
        role === "COACH"
          ? await usersService.getTrainerAttendanceReport(token)
          : await usersService.getStaffAttendanceReport(token);
      setOwnAttendance(mapOwnAttendance(data));
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Unable to load attendance report" });
    } finally {
      setOwnAttendanceLoading(false);
    }
  }, [token, role]);

  const loadLeaveRequests = useCallback(async () => {
    if (!token) return;
    setLeaveLoading(true);
    try {
      const query = leaveStatusFilter ? { status: leaveStatusFilter } : {};
      const data =
        role === "COACH"
          ? await usersService.getTrainerLeaveRequests(token, query)
          : await usersService.getStaffLeaveRequests(token, query);
      setLeaveRequests(mapLeaveRequests(data));
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Unable to load leave requests" });
    } finally {
      setLeaveLoading(false);
    }
  }, [token, role, leaveStatusFilter]);

  const submitLeaveRequest = useCallback(async () => {
    if (!token || !user) return;
    setLeaveSubmitting(true);
    try {
      const body: CreateLeaveRequestPayload = {
        leaveType: leaveForm.leaveType,
        fromDate: leaveForm.fromDate,
        toDate: leaveForm.toDate,
        reason: leaveForm.reason || undefined,
        branchCode: selectedBranchId || undefined,
      };
      if (leaveForm.staffId) {
        if (role === "COACH") {
          body.trainerId = Number(leaveForm.staffId);
        } else {
          body.staffId = Number(leaveForm.staffId);
        }
      }
      body.requestedByStaffId = Number(user.id);

      if (role === "COACH") {
        await usersService.createTrainerLeaveRequest(token, body);
      } else {
        await usersService.createStaffLeaveRequest(token, body);
      }
      setToast({ kind: "success", message: "Leave request submitted." });
      setShowLeaveForm(false);
      setLeaveForm({ leaveType: "CASUAL", fromDate: "", toDate: "", reason: "", staffId: "" });
      void loadLeaveRequests();
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Unable to submit leave request" });
    } finally {
      setLeaveSubmitting(false);
    }
  }, [token, user, role, leaveForm, selectedBranchId, loadLeaveRequests]);

  const updateLeaveStatus = useCallback(
    async (leaveId: string | number, newStatus: string) => {
      if (!token) return;
      try {
        if (role === "COACH") {
          await usersService.updateTrainerLeaveRequestStatus(token, leaveId, newStatus);
        } else {
          await usersService.updateStaffLeaveRequestStatus(token, leaveId, newStatus);
        }
        setToast({ kind: "success", message: `Leave request ${newStatus.toLowerCase()}.` });
        void loadLeaveRequests();
      } catch (e) {
        setToast({ kind: "error", message: e instanceof Error ? e.message : "Unable to update leave status" });
      }
    },
    [token, role, loadLeaveRequests],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (activeTab === "attendance") void loadOwnAttendance();
  }, [activeTab, loadOwnAttendance]);

  useEffect(() => {
    if (activeTab === "leave") void loadLeaveRequests();
  }, [activeTab, loadLeaveRequests]);

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

  const attendanceStatusForUser = useCallback(
    (userId: string) => {
      const row = directoryAttendanceByUserId[userId];
      if (!row) {
        return { label: "No Punch", className: "border-slate-200 bg-slate-50 text-slate-600" };
      }
      if (row.clockIn && !row.clockOut) {
        return { label: "Checked In", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
      }
      return { label: "Checked Out", className: "border-amber-200 bg-amber-50 text-amber-700" };
    },
    [directoryAttendanceByUserId],
  );

  const toggleUserActive = useCallback(
    async (item: UserDirectoryItem, nextActive: boolean) => {
      if (!token || !canUpdate) {
        return;
      }

      setStatusSavingId(item.id);
      try {
        const latest = await usersService.getUserById(token, item.id);
        if (!latest) {
          throw new Error("User not found");
        }
        const updated = await usersService.updateUser(token, item.id, buildUpdatePayload(latest, nextActive, role));
        setUsers((prev) => prev.map((current) => (current.id === updated.id ? updated : current)));
        setToast({
          kind: "success",
          message: `${role === "COACH" ? "Trainer" : "Staff"} ${nextActive ? "activated" : "deactivated"} successfully.`,
        });
      } catch (updateError) {
        setToast({
          kind: "error",
          message: updateError instanceof Error ? updateError.message : "Unable to update user status",
        });
      } finally {
        setStatusSavingId(null);
      }
    },
    [canUpdate, role, token],
  );

  const deleteManagedUser = useCallback(async () => {
    if (!token || !deletingUser) {
      return;
    }
    setStatusSavingId(deletingUser.id);
    try {
      await usersService.deleteUser(token, deletingUser.id);
      setUsers((prev) => prev.filter((item) => item.id !== deletingUser.id));
      setToast({
        kind: "success",
        message: `${role === "COACH" ? "Trainer" : "Staff"} deleted successfully.`,
      });
      setDeletingUser(null);
    } catch (deleteError) {
      setToast({
        kind: "error",
        message: deleteError instanceof Error ? deleteError.message : "Unable to delete user",
      });
    } finally {
      setStatusSavingId(null);
    }
  }, [deletingUser, role, token]);

  const openEdit = (item: UserDirectoryItem) => {
    setEditingUser(item);
    setEditForm({
      name: item.name || "",
      mobileNumber: item.mobile || "",
      email: item.email || "",
      defaultBranchId: item.defaultBranchId || "",
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
        defaultBranchId: toOptionalString(editForm.defaultBranchId),
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
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-slate-400">{subtitle}</p>
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

      {/* ---- Tab Navigation ---- */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-[#121722] p-1">
        {(
          [
            { key: "directory", label: "Directory" },
            { key: "attendance", label: "Attendance" },
            { key: "leave", label: "Leave Requests" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.key ? "bg-[#1b2230] text-white shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- Directory Tab ---- */}
      {activeTab === "directory" ? (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <article className="rounded-2xl border border-white/10 bg-[#121722] p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-400">Total</p>
              <p className="mt-1 text-2xl font-bold text-white">{summary.total}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-[#121722] p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-400">Active</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{summary.active}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-[#121722] p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-400">Inactive</p>
              <p className="mt-1 text-2xl font-bold text-rose-700">{summary.inactive}</p>
            </article>
          </div>

      <SectionCard
        title={`${role === "STAFF" ? "Staff" : "Trainer"} Directory`}
        actions={
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Refresh
          </button>
        }
      >
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
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

          <button
            type="button"
            onClick={() => void loadUsers()}
            className="rounded-lg bg-[#c42924] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b]"
          >
            Search
          </button>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-[#171d29] text-left text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">{role === "COACH" ? "Trainer Type" : "Designation"}</th>
                <th className="px-4 py-3">Employment</th>
                <th className="px-4 py-3">Check-In</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {users.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={7}>
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-white/5 ${profileRoute ? "cursor-pointer" : ""}`}
                    onClick={profileRoute ? () => router.push(`${profileRoute}/${item.id}`) : undefined}
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.email || "-"}</p>
                    </td>
                    <td className="px-4 py-3">{item.mobile}</td>
                    <td className="px-4 py-3">{item.designation ? formatEnum(item.designation) : "-"}</td>
                    <td className="px-4 py-3">{item.employmentType ? formatEnum(item.employmentType) : "-"}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const attendanceStatus = attendanceStatusForUser(item.id);
                        return (
                          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${attendanceStatus.className}`}>
                            {attendanceStatus.label}
                          </span>
                        );
                      })()}
                    </td>
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
                      <div className="flex flex-wrap gap-2">
                        {canUpdate ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleUserActive(item, item.active === false);
                            }}
                            className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                              item.active === false
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "border border-white/10 text-slate-200 hover:bg-white/5"
                            } disabled:opacity-50`}
                            disabled={statusSavingId === item.id}
                          >
                            {statusSavingId === item.id ? "Saving..." : item.active === false ? "Activate" : "Deactivate"}
                          </button>
                        ) : null}
                        {canUpdate ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeletingUser(item);
                            }}
                            className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        ) : profileRoute ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`${profileRoute}/${item.id}`);
                            }}
                            className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5"
                          >
                            Open Profile
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
        </>
      ) : null}

      {/* ---- Attendance Report Tab ---- */}
      {activeTab === "attendance" ? (
        <SectionCard
          title={`${role === "STAFF" ? "Staff" : "Coach"} Attendance`}
          subtitle="Attendance records from ESSL face recognition / manual clock-in"
          actions={
            <button
              type="button"
              onClick={() => void loadOwnAttendance()}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
            >
              Refresh
            </button>
          }
        >
          {role === "COACH" ? (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Current base attendance model uses trainer punches. Shift-aware salary and auto-deduction should be built on top of assigned shift windows like `6-10`, `5-9`, `5-9 premium`, `6-10 premium`, and Sunday 4-hour duty.
            </div>
          ) : null}
          {ownAttendanceLoading ? (
            <p className="py-4 text-sm text-slate-500">Loading attendance...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#171d29] text-left text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Clock In</th>
                    <th className="px-4 py-3">Clock Out</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {ownAttendance.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-400" colSpan={5}>
                        No attendance punches found yet.
                      </td>
                    </tr>
                  ) : (
                    ownAttendance.map((row) => (
                      <tr key={row.id} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-semibold text-white">{row.staffName}</td>
                        <td className="px-4 py-3">{row.date}</td>
                        <td className="px-4 py-3">{formatDateTime(row.clockIn)}</td>
                        <td className="px-4 py-3">{formatDateTime(row.clockOut)}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* ---- Leave Requests Tab ---- */}
      {activeTab === "leave" ? (
        <SectionCard
          title={leaveTitle}
          subtitle={leaveSubtitle}
          actions={
            <div className="flex gap-2">
              <select
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                value={leaveStatusFilter}
                onChange={(e) => setLeaveStatusFilter(e.target.value)}
              >
                <option value="">All status</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
              <button
                type="button"
                onClick={() => setShowLeaveForm(true)}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                New Leave Request
              </button>
            </div>
          }
        >
          {leaveLoading ? (
            <p className="py-4 text-sm text-slate-500">Loading leave requests...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#171d29] text-left text-xs font-semibold tracking-wide text-slate-400 uppercase">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">From</th>
                    <th className="px-4 py-3">To</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {leaveRequests.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-400" colSpan={7}>
                        No leave requests found yet.
                      </td>
                    </tr>
                  ) : (
                    leaveRequests.map((row) => (
                      <tr key={row.id} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-semibold text-white">{row.staffName}</td>
                        <td className="px-4 py-3">{row.leaveType}</td>
                        <td className="px-4 py-3">{row.fromDate}</td>
                        <td className="px-4 py-3">{row.toDate}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate">{row.reason}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-semibold ${LEAVE_STATUS_STYLES[row.status] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.status === "PENDING" && canUpdate ? (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => void updateLeaveStatus(row.id, "APPROVED")}
                                className="rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateLeaveStatus(row.id, "REJECTED")}
                                className="rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {/* ---- Leave Request Creation Modal ---- */}
      {showLeaveForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121722] p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-white">New Leave Request</h3>
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  {role === "COACH" ? "Coach" : "Staff"} (select from directory)
                </label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={leaveForm.staffId}
                  onChange={(e) => setLeaveForm((prev) => ({ ...prev, staffId: e.target.value }))}
                >
                  <option value="">-- Select --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.designation ? formatEnum(u.designation) : ""})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Leave Type</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm((prev) => ({ ...prev, leaveType: e.target.value }))}
                >
                  {LEAVE_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>
                      {lt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">From</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={leaveForm.fromDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, fromDate: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">To</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={leaveForm.toDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, toDate: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Reason</label>
                <textarea
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((prev) => ({ ...prev, reason: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowLeaveForm(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={leaveSubmitting || !leaveForm.fromDate || !leaveForm.toDate || !leaveForm.staffId}
                  onClick={() => void submitLeaveRequest()}
                  className="rounded-lg bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:bg-slate-400"
                >
                  {leaveSubmitting ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Client Attendance (coaches only — today's PT sessions) ---- */}
      {showClientAttendance && activeTab === "directory" ? (
        <SectionCard
          title="Client Attendance"
          subtitle="Today attendance from engagement-service"
          actions={
            <button
              type="button"
              onClick={() => void loadAttendance()}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
            >
              Refresh
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#171d29] text-left text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Check-out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {attendanceRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-400" colSpan={3}>
                      No attendance records today
                    </td>
                  </tr>
                ) : (
                  attendanceRows.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-semibold text-white">{row.memberName}</td>
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
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-[#121722] p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Manage {editingUser.name}</h2>
                <p className="text-sm text-slate-400">Update user details via users-service.</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
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
                <label className="mb-1 block text-xs font-semibold text-slate-600">Default Branch ID</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.defaultBranchId}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, defaultBranchId: event.target.value }))}
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
                  className="rounded-lg bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:bg-slate-400"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <Modal
        open={Boolean(deletingUser)}
        onClose={() => setDeletingUser(null)}
        title={deletingUser ? `Delete ${deletingUser.name}` : "Delete User"}
      >
        {!deletingUser ? null : (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This permanently deletes the profile and login. Use deactivate if you only want to block access.
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteManagedUser()}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
