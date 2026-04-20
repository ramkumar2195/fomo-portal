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
import { Modal } from "@/components/common/modal";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { shiftService, type ExpectedShiftDto, type ShiftDefinitionDto, type StaffShiftAssignmentDto, type DayOfWeek } from "@/lib/api/services/shift-service";
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

/**
 * Returns Mon-Sun ISO dates for the week that contains the given date.
 * Weeks start on Monday to match the FOMO shift doc and the attendance
 * register's week-boundary logic.
 */
function weekDates(anchor: Date): string[] {
  // JS getDay: 0=Sunday, 1=Monday...6=Saturday. Shift so 0=Monday.
  const dayOffset = (anchor.getDay() + 6) % 7;
  const monday = new Date(anchor);
  monday.setDate(monday.getDate() - dayOffset);
  monday.setHours(0, 0, 0, 0);
  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function formatCellDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function dayOfWeekFromIso(iso: string): DayOfWeek {
  const d = new Date(`${iso}T00:00:00`);
  const map: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  return map[d.getDay()];
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

  // --- "This Week" roster view state ---
  // Week offset: 0 = current week, +1 = next, -1 = previous. Operator can
  // scrub forward to review next week's auto-rotation before it fires, or
  // backward to audit what actually ran.
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekExpected, setWeekExpected] = useState<Map<string, ExpectedShiftDto>>(new Map());
  const [weekLoading, setWeekLoading] = useState(false);
  // Cell-click override modal
  const [overrideCell, setOverrideCell] = useState<{ staffId: number; staffName: string; date: string } | null>(null);
  const [overrideChoice, setOverrideChoice] = useState<"" | "OFF" | string>("");
  const [overrideBusy, setOverrideBusy] = useState(false);

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

  // Compute this-week's Mon-Sun dates shifted by weekOffset.
  const weekRange = useMemo(() => {
    const base = new Date();
    if (weekOffset !== 0) {
      base.setDate(base.getDate() + weekOffset * 7);
    }
    return weekDates(base);
  }, [weekOffset]);

  // Bulk-load expected shifts for all staff × this week's dates. One request,
  // indexed by "${staffId}_${date}" for O(1) cell lookup during render.
  const loadWeekRoster = useCallback(async () => {
    if (!token || staffList.length === 0) return;
    setWeekLoading(true);
    try {
      const pairs: Array<{ staffId: number; date: string }> = [];
      staffList.forEach((u) => {
        if (!u.id) return;
        weekRange.forEach((date) => {
          pairs.push({ staffId: Number(u.id), date });
        });
      });
      const results = await shiftService.getExpectedShiftsBulk(token, pairs);
      const map = new Map<string, ExpectedShiftDto>();
      results.forEach((r) => {
        map.set(`${r.staffId}_${r.date}`, r);
      });
      setWeekExpected(map);
    } catch {
      setWeekExpected(new Map());
    } finally {
      setWeekLoading(false);
    }
  }, [token, staffList, weekRange]);

  useEffect(() => {
    void loadWeekRoster();
  }, [loadWeekRoster]);

  const submitOverride = useCallback(async () => {
    if (!token || !overrideCell) return;
    setOverrideBusy(true);
    try {
      const shiftDefinitionId =
        overrideChoice === "OFF" ? null
        : overrideChoice === "" ? undefined
        : Number(overrideChoice);
      if (shiftDefinitionId === undefined) {
        setToast({ kind: "error", message: "Pick a shift or OFF." });
        return;
      }
      await shiftService.upsertAssignment(token, {
        staffId: overrideCell.staffId,
        dayOfWeek: dayOfWeekFromIso(overrideCell.date),
        shiftDefinitionId,
        effectiveFrom: overrideCell.date,
        effectiveTo: overrideCell.date,
        source: "OVERRIDE",
        notes: "manual override from This Week view",
      });
      setToast({ kind: "success", message: "Override saved." });
      setOverrideCell(null);
      setOverrideChoice("");
      await loadWeekRoster();
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to save override." });
    } finally {
      setOverrideBusy(false);
    }
  }, [token, overrideCell, overrideChoice, loadWeekRoster]);

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

      <SectionCard
        title="This Week's Roster"
        subtitle="Computed from defaults + rotation + overrides. Click any cell to override a single day (leave, swap, manual cover)."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              ◂ Prev
            </button>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {weekOffset === 0 ? "This Week" : weekOffset === 1 ? "Next Week" : weekOffset === -1 ? "Last Week" : `${weekOffset > 0 ? "+" : ""}${weekOffset} wks`}
            </span>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Next ▸
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              disabled={weekOffset === 0}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
            >
              Today
            </button>
          </div>
        }
      >
        {weekLoading ? (
          <p className="text-sm text-slate-400">Loading roster…</p>
        ) : staffList.length === 0 ? (
          <p className="text-sm text-slate-400">No staff or coaches to display.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="sticky left-0 bg-[#111821] px-4 py-3">Staff</th>
                  {weekRange.map((date) => (
                    <th key={date} className="px-3 py-3 text-left min-w-[110px]">
                      <div className="font-semibold text-white">{DAY_SHORT[dayOfWeekFromIso(date)]}</div>
                      <div className="text-[10px] font-normal text-slate-500">{formatCellDate(date)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {staffList.map((u) => {
                  const sid = Number(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02]">
                      <td className="sticky left-0 bg-[#111821] px-4 py-2.5">
                        <div className="font-medium text-white">{u.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {u.designation || u.role}
                        </div>
                      </td>
                      {weekRange.map((date) => {
                        const exp = weekExpected.get(`${sid}_${date}`);
                        // Cell visual state
                        const isOff = exp?.off === true;
                        const hasShift = exp && !exp.off && exp.shiftCode;
                        // Detect OVERRIDE via the shape — if the response
                        // came from an override row, it's already surfaced in
                        // shiftCode; we can't distinguish OVERRIDE vs ROTATION
                        // vs DEFAULT here without extra metadata. The backend
                        // precedence guarantees correctness regardless, so
                        // visual tone just reflects on/off.
                        return (
                          <td key={date} className="px-1 py-1">
                            <button
                              type="button"
                              onClick={() => {
                                setOverrideCell({ staffId: sid, staffName: u.name || "Staff", date });
                                setOverrideChoice(
                                  exp?.off ? "OFF"
                                  : exp?.shiftCode ? String(definitions.find((d) => d.code === exp.shiftCode)?.id || "")
                                  : ""
                                );
                              }}
                              className={`block w-full rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                                hasShift
                                  ? "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-100"
                                  : isOff
                                  ? "border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/15 text-amber-100"
                                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-slate-400"
                              }`}
                            >
                              {hasShift ? (
                                <>
                                  <div className="font-semibold truncate">
                                    {exp?.shiftName?.replace(/^PT Trainer /, "PT ").replace(/^General Trainer /, "GT ") || exp?.shiftCode}
                                  </div>
                                  <div className="font-mono text-[10px] opacity-80">
                                    {exp?.expectedInAt ? new Date(exp.expectedInAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : ""}
                                    {exp?.expectedOutAt ? `–${new Date(exp.expectedOutAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}` : ""}
                                  </div>
                                </>
                              ) : isOff ? (
                                <div className="font-semibold">Off</div>
                              ) : (
                                <div className="text-slate-500">— not set —</div>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Green = scheduled on shift · Amber = off / on leave · Grey = no assignment configured. Click a cell to override a single day. For permanent changes use the Weekly Defaults section below.
        </p>
      </SectionCard>

      <Modal
        open={Boolean(overrideCell)}
        onClose={() => {
          setOverrideCell(null);
          setOverrideChoice("");
        }}
        title={overrideCell ? `Override · ${overrideCell.staffName} · ${formatCellDate(overrideCell.date)}` : "Override"}
      >
        <div className="space-y-4 text-sm">
          <p className="text-slate-400">
            This change writes a single-day override for {overrideCell ? formatCellDate(overrideCell.date) : "this date"}. It wins over any default or rotation assignment for just that day.
          </p>
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Shift for the day</span>
            <select
              value={overrideChoice}
              onChange={(e) => setOverrideChoice(e.target.value)}
              disabled={overrideBusy}
              className="w-full rounded-xl border border-white/10 bg-[#0f141d] px-4 py-2.5 text-sm text-white outline-none focus:border-[#c42924]/60"
            >
              <option value="" disabled>
                — pick a shift —
              </option>
              <option value="OFF">OFF (on leave / day off)</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {describeDefinition(d)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOverrideCell(null);
                setOverrideChoice("");
              }}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitOverride()}
              disabled={overrideBusy || overrideChoice === ""}
              className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:opacity-50"
            >
              {overrideBusy ? "Saving…" : "Save Override"}
            </button>
          </div>
        </div>
      </Modal>

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
