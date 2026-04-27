"use client";

/**
 * Dashboard widget: "Today's Check-ins".
 *
 * Shows the number of unique people who walked in through the flap gate
 * today, broken down by gender (Male / Female) and role (Members /
 * Staff+Trainers). Each of the five stat cards is clickable: opens a
 * wide modal showing the filtered list with their first check-in time,
 * entries count, mobile, and plan/designation.
 *
 * Data composition: we deliberately do NOT add a cross-service aggregate
 * endpoint in engagement-service. Instead we reuse the existing
 * {@code GET /api/attendance/biometric/register?from=today&to=today} and
 * join with {@code users-service} search results client-side. This keeps
 * the dedup rule (5-min collapse) centralised in one backend place and
 * avoids the gender column leaking into the engagement schema.
 *
 * Visible to SUPER_ADMIN, GYM_MANAGER, FRONT_DESK_EXECUTIVE — the roles
 * that make live floor decisions. Branch-scoped via {@code useBranch()}
 * so Super Admin respects the header selector and Gym Manager is
 * auto-scoped.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { usersService } from "@/lib/api/services/users-service";
import type { BiometricGymAttendanceRow } from "@/lib/api/services/engagement-service";
import type { UserDirectoryItem } from "@/types/models";

type RoleKey = "MEMBER" | "STAFF" | "COACH" | "ADMIN" | "UNKNOWN";
type GenderKey = "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";

/** Drill-down filter applied to the modal when one of the 5 stat cards is clicked. */
type CheckInFilter = "ALL" | "MALE" | "FEMALE" | "MEMBERS" | "STAFF_AND_COACHES";

const REFRESH_INTERVAL_MS = 60_000;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeGender(value?: string | null): GenderKey {
  const v = (value || "").trim().toUpperCase();
  if (v === "M" || v === "MALE") return "MALE";
  if (v === "F" || v === "FEMALE") return "FEMALE";
  if (v === "OTHER" || v === "O" || v === "NON_BINARY" || v === "TRANSGENDER") return "OTHER";
  return "UNKNOWN";
}

function normalizeRole(value?: string | null): RoleKey {
  const v = (value || "").trim().toUpperCase();
  if (v === "MEMBER" || v === "STAFF" || v === "COACH" || v === "ADMIN") return v as RoleKey;
  return "UNKNOWN";
}

function formatTime12h(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

function modalTitleFor(filter: CheckInFilter, count: number): string {
  switch (filter) {
    case "MALE":
      return `Today's Male Check-ins · ${count}`;
    case "FEMALE":
      return `Today's Female Check-ins · ${count}`;
    case "MEMBERS":
      return `Today's Member Check-ins · ${count}`;
    case "STAFF_AND_COACHES":
      return `Today's Staff & Trainer Check-ins · ${count}`;
    default:
      return `Today's Check-ins · ${count} visit${count === 1 ? "" : "s"}`;
  }
}

export function TodayCheckInsTile() {
  const { token } = useAuth();
  const { effectiveBranchId } = useBranch();
  const [rows, setRows] = useState<BiometricGymAttendanceRow[]>([]);
  const [userMap, setUserMap] = useState<Map<number, UserDirectoryItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CheckInFilter | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const today = todayISO();
      const [register, members, staff, coaches, admins] = await Promise.all([
        engagementService.getBiometricAttendanceRegister(token, { from: today, to: today }),
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
      setRows(register);
      setUserMap(map);
    } catch {
      // Tile is non-critical; if the fetch fails we simply don't update state.
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    // Auto-refresh — the tile is meant to be a live "who's here now" view.
    const interval = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  // Enrich register rows with user info and apply the branch filter.
  const enriched = useMemo(
    () =>
      rows
        .map((row) => {
          const user = userMap.get(row.memberId);
          return {
            ...row,
            name: user?.name || `#${row.memberId}`,
            mobile: user?.mobile,
            // For Members the membership plan would be ideal here, but the
            // UserDirectoryItem doesn't carry it; surface the designation
            // as a fallback (works correctly for STAFF/COACH; Members get
            // an em-dash since no per-row plan join exists at this layer).
            plan: user?.designation,
            gender: normalizeGender(user?.gender),
            role: normalizeRole(user?.role),
            designation: user?.designation,
            defaultBranchId: user?.defaultBranchId ? Number(user.defaultBranchId) : undefined,
          };
        })
        .filter((row) => {
          // Only apply branch filter if we know both values. "All Branches"
          // (Super Admin) leaves effectiveBranchId undefined and every row
          // passes.
          if (effectiveBranchId && row.defaultBranchId && row.defaultBranchId !== effectiveBranchId) {
            return false;
          }
          return true;
        })
        .sort((a, b) => new Date(b.firstCheckInAt).getTime() - new Date(a.firstCheckInAt).getTime()),
    [rows, userMap, effectiveBranchId],
  );

  const counts = useMemo(() => {
    const byGender: Record<GenderKey, number> = { MALE: 0, FEMALE: 0, OTHER: 0, UNKNOWN: 0 };
    const byRole: Record<RoleKey, number> = { MEMBER: 0, STAFF: 0, COACH: 0, ADMIN: 0, UNKNOWN: 0 };
    enriched.forEach((row) => {
      byGender[row.gender] += 1;
      byRole[row.role] += 1;
    });
    return { total: enriched.length, byGender, byRole };
  }, [enriched]);

  // Apply the active drill-down filter to the modal's row list.
  const filteredRows = useMemo(() => {
    if (!filter || filter === "ALL") return enriched;
    if (filter === "MALE") return enriched.filter((r) => r.gender === "MALE");
    if (filter === "FEMALE") return enriched.filter((r) => r.gender === "FEMALE");
    if (filter === "MEMBERS") return enriched.filter((r) => r.role === "MEMBER");
    if (filter === "STAFF_AND_COACHES") return enriched.filter((r) => r.role === "STAFF" || r.role === "COACH");
    return enriched;
  }, [enriched, filter]);

  return (
    <>
      <SectionCard
        title="Today's Check-ins"
        subtitle="Live view of everyone who's walked in through the flap gate today — click any tile for the full list"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {/* Issue: each stat is now its own button — clicking opens the
                modal pre-filtered to that segment. The legacy "View all"
                button is gone since clicking "Total Visits" does the same
                thing now (and the per-segment clicks are more useful for
                the operator's typical "who's male and here?" question). */}
            <CheckInStatTile
              label="Total Visits"
              value={counts.total}
              tone="white"
              disabled={counts.total === 0}
              onClick={() => setFilter("ALL")}
            />
            <CheckInStatTile
              label="Male"
              value={counts.byGender.MALE}
              tone="sky"
              disabled={counts.byGender.MALE === 0}
              onClick={() => setFilter("MALE")}
            />
            <CheckInStatTile
              label="Female"
              value={counts.byGender.FEMALE}
              tone="rose"
              disabled={counts.byGender.FEMALE === 0}
              onClick={() => setFilter("FEMALE")}
            />
            <CheckInStatTile
              label="Members"
              value={counts.byRole.MEMBER}
              tone="emerald"
              disabled={counts.byRole.MEMBER === 0}
              onClick={() => setFilter("MEMBERS")}
            />
            <CheckInStatTile
              label="Staff + Trainers"
              value={counts.byRole.STAFF + counts.byRole.COACH}
              tone="amber"
              disabled={counts.byRole.STAFF + counts.byRole.COACH === 0}
              onClick={() => setFilter("STAFF_AND_COACHES")}
            />
          </div>
        )}
        {counts.byGender.UNKNOWN > 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            {counts.byGender.UNKNOWN} check-in{counts.byGender.UNKNOWN === 1 ? "" : "s"} missing gender on the profile.
          </p>
        ) : null}
      </SectionCard>

      <Modal
        open={filter !== null}
        title={modalTitleFor(filter || "ALL", filteredRows.length)}
        onClose={() => setFilter(null)}
        size="xxl"
      >
        {filteredRows.length === 0 ? (
          <p className="text-sm text-slate-400">No matching check-ins recorded today yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Mobile</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Plan / Designation</th>
                  <th className="px-4 py-3">Gender</th>
                  <th className="px-4 py-3">First Check-in</th>
                  <th className="px-4 py-3">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {filteredRows.map((row) => (
                  <tr key={`${row.memberId}-${row.visitDate}`} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-medium text-white">{row.name}</td>
                    <td className="px-4 py-2.5 text-slate-300">{row.mobile || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {row.role === "UNKNOWN" ? "—" : row.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{row.plan || row.designation || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-300">{row.gender === "UNKNOWN" ? "—" : row.gender}</td>
                    <td className="px-4 py-2.5 text-slate-200">{formatTime12h(row.firstCheckInAt)}</td>
                    <td className="px-4 py-2.5 text-slate-300">
                      {row.totalPunches === 1 ? "1" : `${row.totalPunches} entries`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}

function CheckInStatTile({
  label,
  value,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  value: number;
  tone: "white" | "sky" | "rose" | "emerald" | "amber";
  disabled: boolean;
  onClick: () => void;
}) {
  const valueClass = {
    white: "text-white",
    sky: "text-sky-200",
    rose: "text-rose-200",
    emerald: "text-emerald-200",
    amber: "text-amber-200",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Show ${label.toLowerCase()} check-ins`}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-[#c42924] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </button>
  );
}
