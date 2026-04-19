"use client";

/**
 * Dashboard widget: "Today's Check-ins".
 *
 * Shows the number of unique people who walked in through the flap gate so
 * far today, with a male/female breakdown and a role split (members vs
 * staff vs coaches). Clicking "View all" opens a modal listing every person
 * with their first check-in time.
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
import { ArrowRight } from "lucide-react";
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

export function TodayCheckInsTile() {
  const { token } = useAuth();
  const { effectiveBranchId } = useBranch();
  const [rows, setRows] = useState<BiometricGymAttendanceRow[]>([]);
  const [userMap, setUserMap] = useState<Map<number, UserDirectoryItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

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

  return (
    <>
      <SectionCard
        title="Today's Check-ins"
        subtitle="Live view of everyone who's walked in through the flap gate today"
        actions={
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={enriched.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        }
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Total Visits</p>
              <p className="mt-2 text-3xl font-bold text-white">{counts.total}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Male</p>
              <p className="mt-2 text-2xl font-semibold text-sky-200">{counts.byGender.MALE}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Female</p>
              <p className="mt-2 text-2xl font-semibold text-rose-200">{counts.byGender.FEMALE}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Members</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-200">{counts.byRole.MEMBER}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Staff + Trainers</p>
              <p className="mt-2 text-2xl font-semibold text-amber-200">{counts.byRole.STAFF + counts.byRole.COACH}</p>
            </div>
          </div>
        )}
        {counts.byGender.UNKNOWN > 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            {counts.byGender.UNKNOWN} check-in{counts.byGender.UNKNOWN === 1 ? "" : "s"} missing gender on the profile.
          </p>
        ) : null}
      </SectionCard>

      <Modal
        open={modalOpen}
        title={`Today's Check-ins · ${counts.total} visits`}
        onClose={() => setModalOpen(false)}
      >
        {enriched.length === 0 ? (
          <p className="text-sm text-slate-400">No gym entries recorded today yet.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role / Designation</th>
                  <th className="px-4 py-3">Gender</th>
                  <th className="px-4 py-3">First Check-in</th>
                  <th className="px-4 py-3">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {enriched.map((row) => (
                  <tr key={`${row.memberId}-${row.visitDate}`} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-medium text-white">{row.name}</td>
                    <td className="px-4 py-2.5 text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {row.role === "UNKNOWN" ? "—" : row.role}
                      </span>
                      {row.designation ? <span className="ml-2 text-slate-400">{row.designation}</span> : null}
                    </td>
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
