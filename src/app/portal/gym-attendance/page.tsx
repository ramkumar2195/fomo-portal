"use client";

/**
 * Gym-entry attendance register — unified view of who walked in through the
 * flap gate, drawn from {@code biometric_attendance_logs}. Covers members,
 * staff, and coaches in one screen; role is a filter, not a separate page.
 *
 * Distinct from {@code /portal/trainer-attendance}, which handles the future
 * QR-based PT session check-in flow. See DECISIONS.md on the check_ins vs
 * biometric_attendance_logs split.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { shiftService, type ExpectedShiftDto } from "@/lib/api/services/shift-service";
import { usersService } from "@/lib/api/services/users-service";
import type { BiometricGymAttendanceRow } from "@/lib/api/services/engagement-service";
import type { UserDirectoryItem } from "@/types/models";

// 12-hour clock everywhere, locale-stable via en-IN. Seconds dropped —
// attendance is a minute-precision concern.
function formatTime12h(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// The synthetic LEGACY_GYMSW serial is surfaced as "Legacy" so operators
// don't see an opaque serial string on imported pre-ESSL rows.
function displayDevice(serial?: string | null): string {
  const normalized = (serial || "").trim().toUpperCase();
  if (!normalized) return "-";
  if (normalized === "LEGACY_GYMSW") return "Legacy";
  return serial || "-";
}

/**
 * Hours-present for a staff / coach row: if they scanned on entry AND again
 * on exit, the gap between first and last entry of the day is their
 * approximate floor time. Minimum gap of 5 minutes (below that = same
 * session, never mind Item 7 prompt). Returns a display label; null signals
 * "no second scan yet" so the cell can render a nudge instead of a number.
 */
function staffHoursPresent(firstIso: string, lastIso: string): string | null {
  const first = new Date(firstIso).getTime();
  const last = new Date(lastIso).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  const diffMinutes = Math.round((last - first) / 60_000);
  if (diffMinutes < 5) return null;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Signed-minutes variance between expected and actual timestamps. Positive = late arrival / late departure. */
function varianceMinutes(expectedIso: string | null | undefined, actualIso: string | null | undefined): number | null {
  if (!expectedIso || !actualIso) return null;
  const ex = new Date(expectedIso).getTime();
  const ac = new Date(actualIso).getTime();
  if (!Number.isFinite(ex) || !Number.isFinite(ac)) return null;
  return Math.round((ac - ex) / 60_000);
}

/** Render a variance with a grace window: within grace = "on time"; late → red; early → green. */
function formatVariance(minutes: number | null, graceMinutes: number | null | undefined): { label: string; tone: string } {
  if (minutes === null) return { label: "—", tone: "text-slate-500" };
  const grace = graceMinutes ?? 10;
  if (Math.abs(minutes) <= grace) return { label: "On time", tone: "text-emerald-300" };
  if (minutes > 0) return { label: `${minutes} min late`, tone: "text-rose-300" };
  return { label: `${Math.abs(minutes)} min early`, tone: "text-sky-300" };
}

type RoleFilter = "ALL" | "MEMBER" | "STAFF" | "COACH" | "ADMIN";

const ROLE_TABS: Array<{ key: RoleFilter; label: string; hint: string }> = [
  { key: "ALL", label: "All", hint: "Everyone who entered" },
  { key: "MEMBER", label: "Members", hint: "Gym members" },
  { key: "STAFF", label: "Staff", hint: "Gym managers, sales, front desk" },
  { key: "COACH", label: "Trainers", hint: "PT coaches, general trainers" },
  { key: "ADMIN", label: "Admins", hint: "Super admins" },
];

/** Short label for the staff/coach designation column. */
function designationLabel(user: UserDirectoryItem | undefined): string {
  if (!user) return "-";
  const value = user.designation || user.role || "";
  if (!value) return "-";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function GymAttendancePage() {
  const { token } = useAuth();
  const { effectiveBranchId } = useBranch();
  const [rows, setRows] = useState<BiometricGymAttendanceRow[]>([]);
  const [userMap, setUserMap] = useState<Map<number, UserDirectoryItem>>(new Map());
  // Expected-shift lookup keyed "{staffId}_{yyyy-MM-dd}". Populated in one
  // bulk call per page render so we don't do N round-trips to users-service.
  // Members aren't included — they don't have scheduled shifts.
  const [expectedByKey, setExpectedByKey] = useState<Map<string, ExpectedShiftDto>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const [activeRole, setActiveRole] = useState<RoleFilter>("ALL");
  const [fromDate, setFromDate] = useState<string>(daysAgoISO(30));
  const [toDate, setToDate] = useState<string>(todayISO());
  const [search, setSearch] = useState("");

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Register: one row per (member_id, visit_date). Branch filtering is
      // applied client-side via user-branch resolution below so we don't have
      // to thread branch-code awareness through the biometric_attendance_logs
      // schema (it's device-scoped, not branch-scoped directly).
      const [registerRows, members, staff, coaches, admins] = await Promise.all([
        engagementService.getBiometricAttendanceRegister(token, { from: fromDate, to: toDate }),
        usersService.searchUsers(token, { role: "MEMBER", active: true }),
        usersService.searchUsers(token, { role: "STAFF", active: true }),
        usersService.searchUsers(token, { role: "COACH", active: true }),
        usersService.searchUsers(token, { role: "ADMIN", active: true }),
      ]);
      const map = new Map<number, UserDirectoryItem>();
      [members, staff, coaches, admins].forEach((list: UserDirectoryItem[]) => {
        list.forEach((u) => {
          if (u.id) map.set(Number(u.id), u);
        });
      });
      setRows(registerRows);
      setUserMap(map);

      // Expected-shift bulk lookup — only for STAFF / COACH / ADMIN rows,
      // since MEMBER rows don't have scheduled shifts. Building the unique
      // (staffId, date) set also dedups when a staff appears on multiple
      // days in the register window.
      const staffLikeRoles = new Set(["STAFF", "COACH", "ADMIN"]);
      const uniquePairs = new Map<string, { staffId: number; date: string }>();
      registerRows.forEach((row) => {
        const user = map.get(row.memberId);
        if (!user) return;
        const role = (user.role || "").toUpperCase();
        if (!staffLikeRoles.has(role)) return;
        const key = `${row.memberId}_${row.visitDate}`;
        if (!uniquePairs.has(key)) {
          uniquePairs.set(key, { staffId: row.memberId, date: row.visitDate });
        }
      });
      if (uniquePairs.size > 0) {
        try {
          const expectedList = await shiftService.getExpectedShiftsBulk(
            token,
            Array.from(uniquePairs.values()),
          );
          const expectedMap = new Map<string, ExpectedShiftDto>();
          expectedList.forEach((e) => {
            expectedMap.set(`${e.staffId}_${e.date}`, e);
          });
          setExpectedByKey(expectedMap);
        } catch {
          // Compliance columns are a nice-to-have; don't fail the whole page.
          setExpectedByKey(new Map());
        }
      } else {
        setExpectedByKey(new Map());
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load attendance.");
    } finally {
      setLoading(false);
    }
  }, [token, fromDate, toDate]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  // Enrich each register row with role/name/branch from the users directory.
  const enrichedRows = useMemo(
    () =>
      rows.map((row) => {
        const user = userMap.get(row.memberId);
        const role = (user?.role || "").toUpperCase();
        return {
          ...row,
          name: user?.name || `#${row.memberId}`,
          mobile: row.deviceUserId,
          role,
          designation: designationLabel(user),
          defaultBranchId: user?.defaultBranchId ? Number(user.defaultBranchId) : undefined,
        };
      }),
    [rows, userMap],
  );

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (activeRole !== "ALL" && row.role !== activeRole) return false;
      // Branch scope: Super Admin "All Branches" → no filter; otherwise show
      // only users whose defaultBranchId matches the header selector.
      if (effectiveBranchId && row.defaultBranchId && row.defaultBranchId !== effectiveBranchId) return false;
      if (needle) {
        const hay = `${row.name} ${row.mobile} ${row.designation}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [enrichedRows, activeRole, effectiveBranchId, search]);

  const counts = useMemo(() => {
    const byRole: Record<string, number> = { MEMBER: 0, STAFF: 0, COACH: 0, ADMIN: 0, UNKNOWN: 0 };
    enrichedRows.forEach((row) => {
      if (!row.role) byRole.UNKNOWN += 1;
      else if (byRole[row.role] !== undefined) byRole[row.role] += 1;
      else byRole.UNKNOWN += 1;
    });
    return {
      total: enrichedRows.length,
      uniqueMembers: new Set(enrichedRows.map((row) => row.memberId)).size,
      byRole,
    };
  }, [enrichedRows]);

  if (loading) return <PageLoader label="Loading gym attendance..." />;

  return (
    <div className="space-y-6 pb-12">
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gym Entry Attendance</h1>
          <p className="text-slate-400">Flap-gate check-ins from the biometric devices. One row per person per day — first entry time.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadAttendance()}
          className="inline-flex rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a51f1b]"
        >
          Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <article className="rounded-2xl border border-white/10 bg-[#111821] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Total Entries</p>
          <p className="mt-2 text-3xl font-bold text-white">{counts.total}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#111821] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Unique People</p>
          <p className="mt-2 text-3xl font-bold text-white">{counts.uniqueMembers}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#111821] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Members</p>
          <p className="mt-2 text-3xl font-bold text-white">{counts.byRole.MEMBER}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#111821] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Staff</p>
          <p className="mt-2 text-3xl font-bold text-white">{counts.byRole.STAFF}</p>
        </article>
        <article className="rounded-2xl border border-white/10 bg-[#111821] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Trainers</p>
          <p className="mt-2 text-3xl font-bold text-white">{counts.byRole.COACH}</p>
        </article>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[#131925] p-2">
        {ROLE_TABS.map((tab) => {
          const isActive = activeRole === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveRole(tab.key)}
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

      <SectionCard title="Attendance Register" subtitle="One row per person per day. Staff and coaches scan on exit → Out + Hours Present populate. Members don't scan out, so those columns show —.">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2.5 text-sm text-white outline-none focus:border-[#c42924]/60" />
          </label>
          <label className="space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2.5 text-sm text-white outline-none focus:border-[#c42924]/60" />
          </label>
          <label className="md:col-span-2 space-y-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Search
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, mobile, designation" className="w-full rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#c42924]/60" />
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#111821]">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Expected</th>
                  <th className="px-4 py-3">In</th>
                  <th className="px-4 py-3">In Variance</th>
                  <th className="px-4 py-3">Out</th>
                  <th className="px-4 py-3">Out Variance</th>
                  <th className="px-4 py-3">Hours Present</th>
                  <th className="px-4 py-3">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-400" colSpan={10}>
                      No gym entries in this window.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    // Item 7: staff and coaches scan on exit; members don't.
                    // For member rows the Out/Hours Present columns render as
                    // "—" because we don't expect a closing scan. For staff /
                    // coach rows with only one scan, show a "no exit scan" hint
                    // so the operator knows the person forgot to scan out.
                    const isStaffLike = row.role === "STAFF" || row.role === "COACH" || row.role === "ADMIN";
                    const hasExit = row.totalPunches > 1;
                    const hoursPresent = hasExit ? staffHoursPresent(row.firstCheckInAt, row.lastPunchAt) : null;
                    const expected = isStaffLike ? expectedByKey.get(`${row.memberId}_${row.visitDate}`) : undefined;
                    const expectedInVariance = expected && !expected.off ? varianceMinutes(expected.expectedInAt, row.firstCheckInAt) : null;
                    const expectedOutVariance = expected && !expected.off && hasExit ? varianceMinutes(expected.expectedOutAt, row.lastPunchAt) : null;
                    const graceMinutes = expected?.blocks?.[0]?.graceMinutes ?? 10;
                    const inVarianceDisplay = formatVariance(expectedInVariance, graceMinutes);
                    const outVarianceDisplay = formatVariance(expectedOutVariance, graceMinutes);
                    return (
                      <tr key={`${row.memberId}-${row.visitDate}`} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 text-slate-200">{formatDateShort(row.visitDate)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-white">{row.name}</p>
                          <p className="text-[11px] text-slate-500">{row.mobile}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                            {row.role || "UNKNOWN"}
                          </span>
                          {row.designation ? <p className="mt-1 text-[11px] text-slate-400">{row.designation}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          {!isStaffLike ? (
                            <span className="text-slate-500">—</span>
                          ) : !expected ? (
                            <span className="text-slate-500">—</span>
                          ) : expected.off ? (
                            <span className="text-amber-300/80">Off</span>
                          ) : (
                            <>
                              <p className="font-mono text-xs text-slate-200">
                                {formatTime12h(expected.expectedInAt)} → {formatTime12h(expected.expectedOutAt)}
                              </p>
                              <p className="text-[11px] text-slate-500">{expected.shiftName}</p>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-200">{formatTime12h(row.firstCheckInAt)}</td>
                        <td className={`px-4 py-3 text-xs font-semibold ${inVarianceDisplay.tone}`}>
                          {isStaffLike && expected && !expected.off ? inVarianceDisplay.label : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {isStaffLike ? (
                            hasExit ? (
                              formatTime12h(row.lastPunchAt)
                            ) : (
                              <span className="text-amber-300/80">no exit scan</span>
                            )
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-xs font-semibold ${outVarianceDisplay.tone}`}>
                          {isStaffLike && expected && !expected.off && hasExit ? outVarianceDisplay.label : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {isStaffLike ? (
                            hoursPresent ?? <span className="text-slate-500">—</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400">{displayDevice(row.deviceSerialNumber)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Showing {filteredRows.length} of {enrichedRows.length} rows
        </p>
      </SectionCard>
    </div>
  );
}
