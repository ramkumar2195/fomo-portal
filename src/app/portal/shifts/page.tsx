"use client";

/**
 * Shifts management page — list shift definitions (PT Standard Split, PT
 * Early-Late Split, PT 4 Straight, GT Weekday Split, GT Sunday Straight,
 * Sunday Morning Cover) and assign staff to them per day of the week.
 *
 * <p>Phase 1 scope: read-only list of seeded definitions + a per-staff
 * Mon-Sun grid where you pick a shift (or OFF) per day. Creating new
 * definitions or editing blocks is an admin-only future surface — the
 * six seeded templates cover every real FOMO role today.
 *
 * <p>The rotation engine (weekly early-late rotation, Sunday morning
 * round-robin, conditional GT Saturday off) is not part of this page —
 * it's M5. For Phase 1, assign each staff their default shift per day and
 * the compliance columns on the attendance register will surface
 * on-time / late / absent signals against that default. Once rotations
 * land, the engine writes ROTATION-source assignment rows which take
 * precedence over DEFAULT rows automatically.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { shiftService, type ShiftDefinitionDto, type StaffShiftAssignmentDto, type DayOfWeek } from "@/lib/api/services/shift-service";
import { usersService } from "@/lib/api/services/users-service";
import type { UserDirectoryItem } from "@/types/models";

const DAYS: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function formatHHmm(value: string): string {
  if (!value) return "-";
  const [h, m] = value.split(":");
  const hh = Number(h);
  if (!Number.isFinite(hh)) return value;
  const ampm = hh < 12 ? "AM" : "PM";
  const display = hh % 12 === 0 ? 12 : hh % 12;
  return `${display}:${m} ${ampm}`;
}

function describeDefinition(def: ShiftDefinitionDto): string {
  if (!def.blocks || def.blocks.length === 0) return "(no blocks)";
  return def.blocks
    .slice()
    .sort((a, b) => a.blockIndex - b.blockIndex)
    .map((b) => `${formatHHmm(b.startTime)}–${formatHHmm(b.endTime)}`)
    .join(" + ");
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ShiftsPage() {
  const { token } = useAuth();
  const [definitions, setDefinitions] = useState<ShiftDefinitionDto[]>([]);
  const [staffList, setStaffList] = useState<UserDirectoryItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<StaffShiftAssignmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const loadBaseData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [defs, staff, coaches] = await Promise.all([
        shiftService.listDefinitions(token),
        usersService.searchUsers(token, { role: "STAFF", active: true }),
        usersService.searchUsers(token, { role: "COACH", active: true }),
      ]);
      setDefinitions(defs);
      const roster = [...staff, ...coaches].filter(
        (u) => u.designation && u.designation !== "HEAD_COACH",  // exclude roles with no shift
      );
      setStaffList(roster);
      if (!selectedStaffId && roster.length > 0) {
        setSelectedStaffId(Number(roster[0].id));
      }
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to load shifts." });
    } finally {
      setLoading(false);
    }
  }, [token, selectedStaffId]);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  const loadAssignmentsForStaff = useCallback(async (staffId: number) => {
    if (!token) return;
    try {
      const list = await shiftService.listAssignmentsForStaff(token, staffId);
      setAssignments(list);
    } catch {
      setAssignments([]);
    }
  }, [token]);

  useEffect(() => {
    if (selectedStaffId) void loadAssignmentsForStaff(selectedStaffId);
  }, [selectedStaffId, loadAssignmentsForStaff]);

  // Map dayOfWeek -> chosen shiftDefinitionId (null = OFF explicit; undefined = unconfigured)
  const perDayChoice: Record<DayOfWeek, number | null | undefined> = useMemo(() => {
    const map = {} as Record<DayOfWeek, number | null | undefined>;
    DAYS.forEach((d) => {
      const today = todayISO();
      const effective = assignments
        .filter((a) => a.dayOfWeek === d)
        .filter((a) => a.effectiveFrom <= today && (!a.effectiveTo || a.effectiveTo >= today))
        .sort((a, b) => {
          const sourceOrder = { OVERRIDE: 0, ROTATION: 1, DEFAULT: 2 } as const;
          const sa = sourceOrder[a.source || "DEFAULT"];
          const sb = sourceOrder[b.source || "DEFAULT"];
          if (sa !== sb) return sa - sb;
          return (b.effectiveFrom || "").localeCompare(a.effectiveFrom || "");
        })[0];
      if (!effective) map[d] = undefined;
      else map[d] = effective.shiftDefinitionId ?? null;
    });
    return map;
  }, [assignments]);

  const handlePickShift = async (day: DayOfWeek, shiftDefinitionId: number | null) => {
    if (!token || !selectedStaffId) return;
    setSaving(true);
    try {
      await shiftService.upsertAssignment(token, {
        staffId: selectedStaffId,
        dayOfWeek: day,
        shiftDefinitionId,
        effectiveFrom: todayISO(),
        source: "DEFAULT",
      });
      await loadAssignmentsForStaff(selectedStaffId);
      setToast({ kind: "success", message: "Assignment saved." });
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to save assignment." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader label="Loading shifts..." />;

  const selectedStaff = staffList.find((u) => Number(u.id) === selectedStaffId);

  return (
    <div className="space-y-6 pb-12">
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Shifts &amp; Roster</h1>
        <p className="text-slate-400">
          Manage shift templates and assign them to staff + coaches per day of the week. Rotation and Sunday round-robin
          land in Phase 2 — for now, set each staff&rsquo;s default weekday shift.
        </p>
      </div>

      <SectionCard title="Shift Templates" subtitle="Seeded from the FOMO roster document. Operators won't usually edit these; contact an admin to add new templates.">
        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#111821]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Hours / Blocks</th>
                <th className="px-4 py-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {definitions.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-400" colSpan={5}>
                    No shift definitions found. Restart users-service to trigger the seed runner.
                  </td>
                </tr>
              ) : (
                definitions.map((d) => (
                  <tr key={d.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{d.code}</td>
                    <td className="px-4 py-3 font-medium text-white">{d.name}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
                        {d.shiftType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <span className="font-mono">{describeDefinition(d)}</span>
                      <span className="ml-2 text-xs text-slate-500">({d.totalHours || "?"}h)</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{d.description || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Staff Weekly Assignments" subtitle="Pick a shift (or OFF) per day for each staff member. Saved immediately.">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Staff
            <select
              value={selectedStaffId || ""}
              onChange={(e) => setSelectedStaffId(Number(e.target.value) || null)}
              className="min-w-[280px] rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2.5 text-sm text-white outline-none focus:border-[#c42924]/60"
            >
              {staffList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role} {u.designation ? `· ${u.designation}` : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedStaff ? (
            <div className="text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Role:</span> {selectedStaff.role}{" "}
                {selectedStaff.designation ? `(${selectedStaff.designation})` : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#111821]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {DAYS.map((d) => {
                const choice = perDayChoice[d];
                const def = choice ? definitions.find((x) => x.id === choice) : null;
                const displayState =
                  choice === undefined
                    ? "unset"
                    : choice === null
                      ? "off"
                      : "assigned";
                return (
                  <tr key={d} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{DAY_SHORT[d]}</td>
                    <td className="px-4 py-3">
                      <select
                        value={choice === null ? "OFF" : choice ? String(choice) : ""}
                        disabled={saving || !selectedStaffId}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") return; // unset — no backend change
                          if (v === "OFF") void handlePickShift(d, null);
                          else void handlePickShift(d, Number(v));
                        }}
                        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2 text-sm text-white outline-none focus:border-[#c42924]/60"
                      >
                        <option value="" disabled>
                          — pick a shift —
                        </option>
                        <option value="OFF">OFF (no shift this day)</option>
                        {definitions.map((def) => (
                          <option key={def.id} value={def.id}>
                            {def.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {displayState === "unset"
                        ? <span className="text-amber-300/80">not configured yet</span>
                        : displayState === "off"
                          ? <span className="text-slate-500">Off</span>
                          : def
                            ? <span className="font-mono text-xs">{describeDefinition(def)}</span>
                            : <span className="text-slate-500">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
