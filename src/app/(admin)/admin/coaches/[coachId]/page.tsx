"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AdminPageFrame, SurfaceCard, TabStrip } from "@/components/admin/page-frame";
import { WeeklyCalendar, WeeklyCalendarDay, WeeklyCalendarEvent } from "@/components/common/weekly-calendar";
import { useAuth } from "@/contexts/auth-context";
import { Modal } from "@/components/common/modal";
import { ApiError } from "@/lib/api/http-client";
import {
  TrainerScheduleEntry,
  TrainerScheduleResponse,
  trainingService,
} from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function normalizeLeaveRows(payload: unknown, coachId: string): Record<string, unknown>[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((item) => toRecord(item))
    .filter((item) => String(item.staffId ?? "") === coachId);
}

function pickNumber(payload: unknown, keys: string[]): number {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfWeek(date: Date): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + 6);
  next.setHours(23, 59, 59, 999);
  return next;
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDayLabel(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function entryAccent(entryType: string): string {
  switch (entryType) {
    case "CLASS_DUTY":
      return "border-violet-200 bg-violet-50";
    case "LEAVE":
      return "border-rose-200 bg-rose-50";
    default:
      return "border-slate-200 bg-white";
  }
}

function toDayKey(value?: string): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function toTimeKey(value?: string): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toTimeString().slice(0, 5);
  }
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

export default function CoachProfilePage() {
  const params = useParams<{ coachId: string }>();
  const coachId = params.coachId;
  const { token, user } = useAuth();

  const initialStart = startOfWeek(new Date());
  const initialEnd = endOfWeek(initialStart);

  const [coach, setCoach] = useState<UserDirectoryItem | null>(null);
  const [performance, setPerformance] = useState<Record<string, unknown>>({});
  const [schedule, setSchedule] = useState<TrainerScheduleResponse | null>(null);
  const [availabilityCount, setAvailabilityCount] = useState(0);
  const [calendarCount, setCalendarCount] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [rangeStart, setRangeStart] = useState(toDateInput(initialStart));
  const [rangeEnd, setRangeEnd] = useState(toDateInput(initialEnd));
  const [leaveRequests, setLeaveRequests] = useState<Record<string, unknown>[]>([]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: "CASUAL",
    fromDate: rangeStart,
    toDate: rangeStart,
    reason: "",
  });
  const [availabilityForm, setAvailabilityForm] = useState({
    dayOfWeek: "MONDAY",
    startTime: "06:00",
    endTime: "10:00",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !coachId) {
      return;
    }

    let active = true;

    (async () => {
      setError(null);

      try {
        const [profile, perf, availability, calendar, assignments, trainerSchedule, trainerLeaves] = await Promise.all([
          usersService.getUserById(token, coachId),
          trainingService.getCoachPerformance(token, coachId),
          trainingService.getTrainerAvailability(token, coachId, 0, 100),
          trainingService.getPtCalendar(token, coachId, 0, 100),
          trainingService.getCoachAssignments(token, coachId),
          trainingService.getTrainerSchedule(token, coachId, rangeStart, rangeEnd),
          usersService.getTrainerLeaveRequests(token, { trainerId: Number(coachId) }),
        ]);

        if (!active) {
          return;
        }

        setCoach(profile);
        setPerformance(toRecord(perf));
        setAvailabilityCount(availability.totalElements);
        setCalendarCount(calendar.totalElements);
        setAssignmentCount(assignments.length);
        setSchedule(trainerSchedule);
        setLeaveRequests(normalizeLeaveRows(trainerLeaves, coachId));
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load coach profile.");
      }
    })();

    return () => {
      active = false;
    };
  }, [coachId, rangeEnd, rangeStart, token]);

  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, TrainerScheduleEntry[]>();
    for (const entry of schedule?.entries ?? []) {
      const key = entry.startAt?.slice(0, 10) || "unscheduled";
      const bucket = grouped.get(key) ?? [];
      bucket.push(entry);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [schedule]);

  const calendarDays = useMemo<WeeklyCalendarDay[]>(() => {
    const start = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return [];
    }
    const days: WeeklyCalendarDay[] = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length < 7) {
      const key = cursor.toISOString().slice(0, 10);
      const label = cursor.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
      days.push({ key, label });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [rangeEnd, rangeStart]);

  const calendarEvents = useMemo<WeeklyCalendarEvent[]>(() => {
    return (schedule?.entries ?? []).map((entry) => ({
      id: `${entry.entryType}-${entry.referenceId ?? entry.startAt}`,
      dayKey: toDayKey(entry.startAt),
      startTime: toTimeKey(entry.startAt),
      endTime: toTimeKey(entry.endAt),
      title: entry.label,
      subtitle: entry.entryType.replaceAll("_", " "),
      meta: entry.memberId ? `Member #${entry.memberId}` : entry.status || entry.notes || "",
      tone: entry.entryType === "CLASS_DUTY" ? "violet" : entry.entryType === "LEAVE" ? "rose" : "sky",
    }));
  }, [schedule]);

  const submitAvailability = async () => {
    if (!token || !coachId) {
      return;
    }
    setSaving(true);
    try {
      await trainingService.createTrainerAvailability(token, coachId, {
        dayOfWeek: availabilityForm.dayOfWeek,
        startTime: availabilityForm.startTime,
        endTime: availabilityForm.endTime,
      });
      const trainerSchedule = await trainingService.getTrainerSchedule(token, coachId, rangeStart, rangeEnd);
      setSchedule(trainerSchedule);
      setAvailabilityCount(trainerSchedule.availabilityCount);
      setAvailabilityModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to save trainer availability.");
    } finally {
      setSaving(false);
    }
  };

  const submitLeave = async () => {
    if (!token || !coachId || !user) {
      return;
    }
    setSaving(true);
    try {
      await usersService.createTrainerLeaveRequest(token, {
        trainerId: Number(coachId),
        requestedByStaffId: Number(user.id || 0),
        leaveType: leaveForm.leaveType,
        fromDate: leaveForm.fromDate,
        toDate: leaveForm.toDate,
        reason: leaveForm.reason || undefined,
      });
      const trainerLeaves = await usersService.getTrainerLeaveRequests(token, { trainerId: Number(coachId) });
      setLeaveRequests(normalizeLeaveRows(trainerLeaves, coachId));
      setLeaveModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to submit leave request.");
    } finally {
      setSaving(false);
    }
  };

  const updateLeaveStatus = async (leaveId: number, status: string) => {
    if (!token) {
      return;
    }
    setSaving(true);
    try {
      await usersService.updateTrainerLeaveRequestStatus(token, leaveId, status);
      const [trainerSchedule, trainerLeaves] = await Promise.all([
        trainingService.getTrainerSchedule(token, coachId, rangeStart, rangeEnd),
        usersService.getTrainerLeaveRequests(token, { trainerId: Number(coachId) }),
      ]);
      setSchedule(trainerSchedule);
      setLeaveRequests(normalizeLeaveRows(trainerLeaves, coachId));
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to update leave request.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPageFrame
      title={coach?.name || `Coach #${coachId}`}
      description="Coach schedule, PT load, class duties, and leave windows"
      searchPlaceholder="Search sessions, client, programs..."
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <TabStrip tabs={["Overview", "Schedule", "Clients", "Programs", "Revenue", "Performance"]} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="PT Clients">
          <p className="text-2xl font-bold text-slate-800">{pickNumber(performance, ["ptClients", "totalPtClients"])}</p>
        </SurfaceCard>
        <SurfaceCard title="Assignments">
          <p className="text-2xl font-bold text-slate-800">{assignmentCount}</p>
        </SurfaceCard>
        <SurfaceCard title="Class Duties">
          <p className="text-2xl font-bold text-slate-800">{schedule?.classDutyCount ?? 0}</p>
        </SurfaceCard>
        <SurfaceCard title="Approved Leave">
          <p className="text-2xl font-bold text-slate-800">{schedule?.leaveCount ?? 0}</p>
        </SurfaceCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <SurfaceCard title="Schedule Window">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              From
              <input
                type="date"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              To
              <input
                type="date"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p>Availability slots: <span className="font-semibold text-slate-800">{availabilityCount}</span></p>
              <p>PT calendar entries: <span className="font-semibold text-slate-800">{calendarCount}</span></p>
              <p>Range entries: <span className="font-semibold text-slate-800">{schedule?.entries.length ?? 0}</span></p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setAvailabilityModalOpen(true)}
                className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
              >
                Add Availability
              </button>
              <button
                type="button"
                onClick={() => setLeaveModalOpen(true)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Add Leave
              </button>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Weekly Schedule">
          <div className="mb-4 text-sm text-slate-500">Calendar view of PT sessions, class duties, and approved leave in the selected range.</div>
          <WeeklyCalendar days={calendarDays} events={calendarEvents} emptyLabel="No PT sessions, class duties, or approved leave in this date range." />
          {entriesByDay.length > 0 ? (
            <div className="mt-4 space-y-4">
              {entriesByDay.map(([day, entries]) => (
                <div key={day} className="space-y-3 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">{formatDayLabel(entries[0]?.startAt || day)}</h3>
                    <span className="text-xs font-medium text-slate-500">{entries.length} items</span>
                  </div>
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <div
                        key={`${entry.entryType}-${entry.referenceId ?? entry.startAt}`}
                        className={`rounded-xl border px-3 py-3 ${entryAccent(entry.entryType)}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                            <p className="text-xs uppercase tracking-wide text-slate-500">{entry.entryType.replaceAll("_", " ")}</p>
                          </div>
                          <div className="text-right text-xs text-slate-600">
                            <p>{formatDateTime(entry.startAt)}</p>
                            <p>{formatDateTime(entry.endAt)}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                          {entry.status ? <span>Status: <span className="font-semibold text-slate-800">{entry.status}</span></span> : null}
                          {entry.memberId ? <span>Member ID: <span className="font-semibold text-slate-800">{entry.memberId}</span></span> : null}
                          {entry.notes ? <span>Notes: <span className="font-semibold text-slate-800">{entry.notes}</span></span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <SurfaceCard title="Availability Master">
          {Array.isArray(schedule?.availability) && schedule!.availability.length > 0 ? (
            <div className="space-y-2">
              {schedule!.availability.map((slot, index) => {
                const record = toRecord(slot);
                return (
                  <div key={`${record.id ?? index}`} className="rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
                    <p className="font-semibold text-slate-800">{String(record.dayOfWeek ?? "-")}</p>
                    <p>{String(record.startTime ?? "-")} to {String(record.endTime ?? "-")}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No availability configured yet.
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard title="Leave Management">
          {leaveRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No leave requests for this coach.
            </div>
          ) : (
            <div className="space-y-2">
              {leaveRequests.map((leave) => {
                const row = toRecord(leave);
                const leaveId = Number(row.leaveRequestId ?? row.id ?? 0);
                const status = String(row.status ?? "PENDING");
                return (
                  <div key={String(leaveId)} className="rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-800">{String(row.leaveType ?? "-")}</p>
                        <p>{String(row.fromDate ?? "-")} to {String(row.toDate ?? "-")}</p>
                        <p className="text-xs text-slate-500">{String(row.reason ?? "No reason added")}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{status}</span>
                    </div>
                    {status === "PENDING" ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void updateLeaveStatus(leaveId, "APPROVED")}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void updateLeaveStatus(leaveId, "REJECTED")}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </section>

      <Modal open={availabilityModalOpen} onClose={() => setAvailabilityModalOpen(false)} title="Add Trainer Availability" size="sm">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Day
            <select
              value={availabilityForm.dayOfWeek}
              onChange={(event) => setAvailabilityForm((current) => ({ ...current, dayOfWeek: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              {["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Start Time
            <input
              type="time"
              value={availabilityForm.startTime}
              onChange={(event) => setAvailabilityForm((current) => ({ ...current, startTime: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            End Time
            <input
              type="time"
              value={availabilityForm.endTime}
              onChange={(event) => setAvailabilityForm((current) => ({ ...current, endTime: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setAvailabilityModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitAvailability()}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Availability"}
          </button>
        </div>
      </Modal>

      <Modal open={leaveModalOpen} onClose={() => setLeaveModalOpen(false)} title="Add Coach Leave" size="sm">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Leave Type
            <select
              value={leaveForm.leaveType}
              onChange={(event) => setLeaveForm((current) => ({ ...current, leaveType: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              {["CASUAL", "SICK", "EARNED", "COMP_OFF", "LOP"].map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            From
            <input
              type="date"
              value={leaveForm.fromDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, fromDate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            To
            <input
              type="date"
              value={leaveForm.toDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, toDate: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Reason
            <textarea
              value={leaveForm.reason}
              onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setLeaveModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitLeave()}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Submit Leave"}
          </button>
        </div>
      </Modal>
    </AdminPageFrame>
  );
}
