"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Mail,
  MapPin,
  Phone,
  Shield,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { usersService } from "@/lib/api/services/users-service";
import { engagementService } from "@/lib/api/services/engagement-service";
import type { BiometricAttendanceLogRecord, BiometricDeviceRecord, MemberBiometricEnrollmentRecord } from "@/lib/api/services/engagement-service";
import { ToastBanner } from "@/components/common/toast-banner";
import { AttendanceAccessSection } from "@/components/portal/attendance-access-section";
import { isRealBiometricDevice } from "@/lib/biometric-device-filter";

/* ── helpers ─────────────────────────────────────────────────── */

type Rec = Record<string, unknown>;
function toRec(v: unknown): Rec {
  return typeof v === "object" && v !== null ? (v as Rec) : {};
}
function str(r: Rec, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "-";
}

function formatDate(value: string | undefined | null): string {
  if (!value || value === "-") return "-";
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizePin(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

/* ── types ───────────────────────────────────────────────────── */

type TabKey = "overview" | "attendance" | "leave";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "attendance", label: "Attendance & Access" },
  { key: "leave", label: "Leave History" },
];

/* ── component ───────────────────────────────────────────────── */

export default function StaffProfilePage() {
  const params = useParams();
  const staffId = String(params.staffId);
  const { token } = useAuth();

  const [staff, setStaff] = useState<Rec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Tab data
  const [attendanceData, setAttendanceData] = useState<unknown[]>([]);
  const [biometricDevices, setBiometricDevices] = useState<BiometricDeviceRecord[]>([]);
  const [biometricLogs, setBiometricLogs] = useState<BiometricAttendanceLogRecord[]>([]);
  const [enrollments, setEnrollments] = useState<MemberBiometricEnrollmentRecord[]>([]);
  const [leaveData, setLeaveData] = useState<unknown[]>([]);
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [accessActionError, setAccessActionError] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);

  // Load staff profile
  useEffect(() => {
    if (!token || !staffId) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        // Search with STAFF role first, then try direct lookup as fallback
        let user = await usersService.searchUsers(token, { role: "STAFF" })
          .then((list) => list.find((u) => String(u.id) === String(staffId)) || null);
        if (!user) {
          user = await usersService.getUserById(token, staffId);
        }
        if (active && user) setStaff(user as unknown as Rec);
        else if (active) setError("Staff member not found");
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load staff profile");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, staffId]);

  // Load tab data
  const loadTab = useCallback(async (tab: TabKey) => {
    if (!token || !staffId || tabLoading[tab]) return;
    setTabLoading((prev) => ({ ...prev, [tab]: true }));
    try {
      switch (tab) {
        case "attendance": {
          try {
            const staffPin = normalizePin(str(toRec(staff), "mobile", "mobileNumber", "phoneNumber"));
            const [report, devices, allLogs, enrollmentRows] = await Promise.all([
              usersService.getTrainerAttendanceReport(token, { trainerId: Number(staffId) }),
              engagementService.listBiometricDevices(token).catch(() => []),
              engagementService.getBiometricLogs(token).catch(() => []),
              engagementService.getMemberBiometricEnrollments(token, staffId).catch(() => []),
            ]);
            const entries = Array.isArray(report) ? report : (Array.isArray((report as Rec).entries) ? (report as Rec).entries as unknown[] : []);
            setAttendanceData(entries);
            setBiometricDevices(Array.isArray(devices) ? devices.filter(isRealBiometricDevice) : []);
            setBiometricLogs(
              Array.isArray(allLogs)
                ? allLogs.filter((entry) => str(toRec(entry), "deviceUserId") === staffPin)
                : [],
            );
            setEnrollments(Array.isArray(enrollmentRows) ? enrollmentRows : []);
            setAccessActionError(null);
          } catch {
            setAttendanceData([]);
            setBiometricDevices([]);
            setBiometricLogs([]);
            setEnrollments([]);
          }
          break;
        }
        case "leave": {
          try {
            const requests = await usersService.getTrainerLeaveRequests(token, { trainerId: Number(staffId) });
            setLeaveData(Array.isArray(requests) ? requests : []);
          } catch {
            setLeaveData([]);
          }
          break;
        }
        default:
          break;
      }
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab]: false }));
    }
  }, [token, staffId, tabLoading, staff]);

  useEffect(() => {
    if (activeTab !== "overview") {
      loadTab(activeTab);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive staff info
  const s = staff || {};
  const name = str(s, "name", "fullName", "displayName");
  const designation = str(s, "designation");
  const email = str(s, "email");
  const mobile = str(s, "mobile", "mobileNumber", "phoneNumber");
  const dob = str(s, "dateOfBirth", "dob");
  const gender = str(s, "gender");
  const joinDate = str(s, "createdAt", "joinDate", "hireDate");
  const branchName = str(s, "defaultBranchName", "branchName");
  const branchId = str(s, "defaultBranchId", "branchId");
  const employmentType = str(s, "employmentType");
  const active = s.active !== false;
  const emergencyContact = str(s, "emergencyContactName", "emergencyContact");
  const emergencyPhone = str(s, "emergencyContactNumber", "emergencyPhone");
  const address = str(s, "address", "fullAddress");
  const normalizedPin = normalizePin(mobile !== "-" ? mobile : "");
  const initials = name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();

  const handleAccessAction = async (action: "ADD_USER" | "RE_ADD_USER" | "BLOCK_USER" | "UNBLOCK_USER" | "DELETE_USER", serial: string) => {
    if (!token || !staffId || !serial) return;
    if (!normalizedPin) {
      setAccessActionError("Staff mobile number is required to sync with the biometric device.");
      return;
    }

    setAccessBusy(true);
    setAccessActionError(null);
    try {
      const payload = {
        serialNumber: serial,
        pin: normalizedPin,
        name,
        memberId: Number(staffId),
      };
      if (action === "ADD_USER") {
        await engagementService.enrollBiometricUser(token, payload);
      } else if (action === "RE_ADD_USER") {
        await engagementService.reAddBiometricUser(token, payload);
      } else if (action === "BLOCK_USER") {
        await engagementService.blockBiometricUser(token, payload);
      } else if (action === "UNBLOCK_USER") {
        await engagementService.unblockBiometricUser(token, payload);
      } else {
        await engagementService.deleteBiometricUser(token, {
          serialNumber: serial,
          pin: normalizedPin,
          memberId: Number(staffId),
        });
      }
      setToast({ kind: "success", message: "Biometric device action queued." });
      await loadTab("attendance");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update biometric access.";
      setAccessActionError(message);
      setToast({ kind: "error", message });
    } finally {
      setAccessBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
      </div>
    );
  }

  if (error || !staff) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <ToastBanner kind="error" message={error || "Staff member not found"} onClose={() => setError(null)} />
        <Link href="/portal/staff" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Staff
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      {/* Back link */}
      <Link href="/portal/staff" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">
        <ArrowLeft className="h-4 w-4" /> Back To Staff
      </Link>

      {/* Header card */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
        <div className="flex items-start gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#c42924]/20 text-2xl font-bold text-[#c42924]">
            {initials}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{name}</h1>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wider ${active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                {active ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{humanize(designation)} {employmentType !== "-" ? `\u00b7 ${humanize(employmentType)}` : ""}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
              {mobile !== "-" && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />{mobile}</span>}
              {email !== "-" && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-500" />{email}</span>}
              {branchName !== "-" && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-500" />{branchName || `Branch #${branchId}`}</span>}
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Calendar} label="Join Date" value={formatDate(joinDate !== "-" ? joinDate : undefined)} />
          <StatCard icon={Shield} label="Designation" value={humanize(designation)} />
          <StatCard icon={UserRound} label="Employment" value={employmentType !== "-" ? humanize(employmentType) : "-"} />
          <StatCard icon={Clock} label="Status" value={active ? "Active" : "Inactive"} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "bg-[#c42924] text-white"
                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Personal details */}
            <Panel title="Personal Details">
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Full Name", value: name },
                  { label: "Mobile", value: mobile },
                  { label: "Email", value: email },
                  { label: "Date of Birth", value: formatDate(dob !== "-" ? dob : undefined) },
                  { label: "Gender", value: gender !== "-" ? humanize(gender) : "-" },
                  { label: "Home Branch", value: branchName || `Branch #${branchId}` },
                  { label: "Employment Type", value: employmentType !== "-" ? humanize(employmentType) : "-" },
                  { label: "Designation", value: humanize(designation) },
                  { label: "Join Date", value: formatDate(joinDate !== "-" ? joinDate : undefined) },
                ].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                    <dd className="mt-2 text-base font-medium text-white">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            {/* Emergency Contact */}
            <Panel title="Emergency Contact">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Name</dt>
                  <dd className="mt-2 text-base font-medium text-white">{emergencyContact}</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Number</dt>
                  <dd className="mt-2 text-base font-medium text-white">{emergencyPhone}</dd>
                </div>
                {address !== "-" && (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Address</dt>
                    <dd className="mt-2 text-base font-medium text-white">{address}</dd>
                  </div>
                )}
              </dl>
            </Panel>
          </div>
        )}

        {activeTab === "attendance" && (
          <div className="space-y-6">
            {tabLoading.attendance ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
              </div>
            ) : (
              <>
                <AttendanceAccessSection
                  pin={normalizedPin}
                  devices={biometricDevices}
                  enrollments={enrollments}
                  logs={biometricLogs}
                  actionBusy={accessBusy}
                  actionError={accessActionError}
                  onAction={handleAccessAction}
                />

                <Panel title="Daily Attendance Register" subtitle="Check-in and check-out summary records">
                  {attendanceData.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">No attendance records found.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Check In</th>
                            <th className="px-4 py-3">Check Out</th>
                            <th className="px-4 py-3">Hours</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {attendanceData.map((entry, i) => {
                            const r = toRec(entry);
                            const date = str(r, "date", "attendanceDate", "checkInAt");
                            const checkIn = str(r, "checkInAt", "checkIn", "entryTime", "firstPunch");
                            const checkOut = str(r, "checkOutAt", "checkOut", "exitTime", "lastPunch");
                            const hours = str(r, "totalHours", "hoursWorked", "duration");
                            const status = str(r, "status", "attendanceStatus");
                            return (
                              <tr key={i} className="text-slate-300 hover:bg-white/5">
                                <td className="px-4 py-3">{formatDate(date !== "-" ? date : undefined)}</td>
                                <td className="px-4 py-3">{checkIn}</td>
                                <td className="px-4 py-3">{checkOut}</td>
                                <td className="px-4 py-3">{hours}</td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                    status.toUpperCase() === "PRESENT" ? "bg-emerald-500/10 text-emerald-400" :
                                    status.toUpperCase() === "ABSENT" ? "bg-rose-500/10 text-rose-400" :
                                    "bg-amber-500/10 text-amber-400"
                                  }`}>{status !== "-" ? humanize(status) : "-"}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </div>
        )}

        {activeTab === "leave" && (
          <div className="space-y-6">
            {tabLoading.leave ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
              </div>
            ) : (
              <Panel title="Leave History" subtitle="Past and upcoming leave requests">
                {leaveData.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">No leave requests found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">From</th>
                          <th className="px-4 py-3">To</th>
                          <th className="px-4 py-3">Days</th>
                          <th className="px-4 py-3">Reason</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {leaveData.map((entry, i) => {
                          const r = toRec(entry);
                          const leaveType = str(r, "leaveType", "type");
                          const fromDate = str(r, "fromDate", "startDate", "from");
                          const toDate = str(r, "toDate", "endDate", "to");
                          const days = str(r, "days", "numberOfDays", "duration");
                          const reason = str(r, "reason", "remarks");
                          const status = str(r, "status", "leaveStatus");
                          return (
                            <tr key={i} className="text-slate-300 hover:bg-white/5">
                              <td className="px-4 py-3 font-medium text-white">{leaveType !== "-" ? humanize(leaveType) : "-"}</td>
                              <td className="px-4 py-3">{formatDate(fromDate !== "-" ? fromDate : undefined)}</td>
                              <td className="px-4 py-3">{formatDate(toDate !== "-" ? toDate : undefined)}</td>
                              <td className="px-4 py-3">{days}</td>
                              <td className="px-4 py-3 max-w-[200px] truncate">{reason}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  status.toUpperCase() === "APPROVED" ? "bg-emerald-500/10 text-emerald-400" :
                                  status.toUpperCase() === "REJECTED" ? "bg-rose-500/10 text-rose-400" :
                                  status.toUpperCase() === "PENDING" ? "bg-amber-500/10 text-amber-400" :
                                  "bg-blue-500/10 text-blue-400"
                                }`}>{status !== "-" ? humanize(status) : "-"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────────────── */

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-slate-300" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
          <p className="mt-1 text-base font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}
