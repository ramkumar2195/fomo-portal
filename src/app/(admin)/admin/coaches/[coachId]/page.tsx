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

interface AttendanceRow {
  attendanceId: number;
  attendanceDate?: string;
  clockInAt?: string;
  clockOutAt?: string;
  workedMinutes: number;
  sessionsCompleted: number;
  notes?: string;
}

interface ClientRow {
  memberId: string;
  memberName: string;
  mobile: string;
  planName: string;
  category: string;
  status: string;
  type: "general" | "pt";
}

const SHIFT_TEMPLATE_OPTIONS = [
  {
    key: "NORMAL_MORNING",
    label: "Normal Morning",
    slots: [{ startTime: "06:00", endTime: "10:00" }],
  },
  {
    key: "NORMAL_EVENING",
    label: "Normal Evening",
    slots: [{ startTime: "17:00", endTime: "21:00" }],
  },
  {
    key: "PREMIUM_MORNING",
    label: "Premium Morning",
    slots: [{ startTime: "05:00", endTime: "09:00" }],
  },
  {
    key: "PREMIUM_EVENING",
    label: "Premium Evening",
    slots: [{ startTime: "18:00", endTime: "22:00" }],
  },
  {
    key: "EVENING_ONLY",
    label: "Evening Shift",
    slots: [{ startTime: "15:00", endTime: "21:00" }],
  },
] as const;

const WEEKDAY_OPTIONS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

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

function formatDate(value?: string): string {
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
    year: "numeric",
  }).format(date);
}

function formatMinutes(minutes: number): string {
  const safeMinutes = Math.max(minutes, 0);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${remainder}m`;
}

function calculateAge(dateOfBirth?: string): string {
  if (!dateOfBirth) {
    return "-";
  }
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return "-";
  }
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? String(age) : "-";
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

function toAttendanceRows(payload: unknown): AttendanceRow[] {
  const records = Array.isArray(toRecord(payload).records) ? (toRecord(payload).records as unknown[]) : [];
  return records.map((item) => {
    const record = toRecord(item);
    return {
      attendanceId: Number(record.attendanceId ?? 0),
      attendanceDate: typeof record.attendanceDate === "string" ? record.attendanceDate : undefined,
      clockInAt: typeof record.clockInAt === "string" ? record.clockInAt : undefined,
      clockOutAt: typeof record.clockOutAt === "string" ? record.clockOutAt : undefined,
      workedMinutes: typeof record.workedMinutes === "number" ? record.workedMinutes : Number(record.workedMinutes ?? 0),
      sessionsCompleted:
        typeof record.sessionsCompleted === "number" ? record.sessionsCompleted : Number(record.sessionsCompleted ?? 0),
      notes: typeof record.notes === "string" ? record.notes : undefined,
    };
  });
}

function buildUpdatePayload(user: UserDirectoryItem, active: boolean) {
  return {
    fullName: user.name,
    email: user.email || `${user.mobile}@fomo.local`,
    mobileNumber: user.mobile,
    role: user.role as "ADMIN" | "STAFF" | "COACH" | "MEMBER",
    active,
    employmentType: user.employmentType as "INTERNAL" | "VENDOR" | undefined,
    designation: user.designation as
      | "SUPER_ADMIN"
      | "GYM_MANAGER"
      | "SALES_MANAGER"
      | "SALES_EXECUTIVE"
      | "FRONT_DESK_EXECUTIVE"
      | "FITNESS_MANAGER"
      | "HEAD_COACH"
      | "PT_COACH"
      | "GENERAL_TRAINER"
      | "YOGA_INSTRUCTOR"
      | "ZUMBA_INSTRUCTOR"
      | "BOXING_INSTRUCTOR"
      | "FREELANCE_TRAINER"
      | "MEMBER"
      | undefined,
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
    defaultTrainerStaffId: user.defaultTrainerStaffId,
  };
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
  const [assignments, setAssignments] = useState<unknown[]>([]);
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [ptCalendarRows, setPtCalendarRows] = useState<unknown[]>([]);
  const [rangeStart, setRangeStart] = useState(toDateInput(initialStart));
  const [rangeEnd, setRangeEnd] = useState(toDateInput(initialEnd));
  const [leaveRequests, setLeaveRequests] = useState<Record<string, unknown>[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [shiftTemplateKey, setShiftTemplateKey] = useState<(typeof SHIFT_TEMPLATE_OPTIONS)[number]["key"]>("NORMAL_MORNING");
  const [selectedShiftDays, setSelectedShiftDays] = useState<string[]>(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]);
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
        const monthStart = new Date();
        monthStart.setDate(1);
        const attendanceFrom = monthStart.toISOString().slice(0, 10);
        const attendanceTo = new Date().toISOString().slice(0, 10);

        const [profile, perf, availability, calendar, assignmentRows, trainerSchedule, trainerLeaves, trainerAttendance, memberDirectory] = await Promise.all([
          usersService.getUserById(token, coachId),
          trainingService.getCoachPerformance(token, coachId),
          trainingService.getTrainerAvailability(token, coachId, 0, 100),
          trainingService.getPtCalendar(token, coachId, 0, 100),
          trainingService.getCoachAssignments(token, coachId),
          trainingService.getTrainerSchedule(token, coachId, rangeStart, rangeEnd),
          usersService.getTrainerLeaveRequests(token, { trainerId: Number(coachId) }),
          usersService.getTrainerAttendanceReport(token, { trainerId: Number(coachId), from: attendanceFrom, to: attendanceTo }),
          usersService.searchUsers(token, { role: "MEMBER" }),
        ]);

        if (!active) {
          return;
        }

        setCoach(profile);
        setPerformance(toRecord(perf));
        setAvailabilityCount(availability.totalElements);
        setCalendarCount(calendar.totalElements);
        setAssignmentCount(assignmentRows.length);
        setAssignments(assignmentRows);
        setMembers(memberDirectory);
        setPtCalendarRows(calendar.content);
        setSchedule(trainerSchedule);
        setLeaveRequests(normalizeLeaveRows(trainerLeaves, coachId));
        setAttendanceRows(toAttendanceRows(trainerAttendance));
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

  const attendanceSummary = useMemo(() => {
    const totalWorkedMinutes = attendanceRows.reduce((sum, row) => sum + row.workedMinutes, 0);
    const totalSessionsCompleted = attendanceRows.reduce((sum, row) => sum + row.sessionsCompleted, 0);
    const openShiftCount = attendanceRows.filter((row) => !row.clockOutAt).length;
    const currentStatus = openShiftCount > 0 ? "Checked In" : attendanceRows.length > 0 ? "Checked Out" : "No Punch";
    return {
      totalWorkedMinutes,
      totalSessionsCompleted,
      openShiftCount,
      currentStatus,
      totalRecords: attendanceRows.length,
    };
  }, [attendanceRows]);

  const clientRows = useMemo<ClientRow[]>(() => {
    const ptMemberIds = new Set<string>();
    const memberMap = new Map(members.map((member) => [String(member.id), member]));

    const ptRows = assignments.map((item) => {
      const record = toRecord(item);
      const memberId = String(record.memberId ?? record.clientId ?? record.id ?? "");
      ptMemberIds.add(memberId);
      const member = memberMap.get(memberId);
      const active = record.active === false ? false : true;
      return {
        memberId,
        memberName: member?.name || `Member #${memberId}`,
        mobile: member?.mobile || "-",
        planName: String(record.packageName ?? record.planName ?? record.subscriptionName ?? "Personal Training"),
        category: String(record.trainingType ?? record.categoryCode ?? "PERSONAL_TRAINING"),
        status: active ? "ACTIVE" : "INACTIVE",
        type: "pt" as const,
      };
    });

    const generalRows = members
      .filter((member) => String(member.defaultTrainerStaffId ?? "") === coachId && !ptMemberIds.has(String(member.id)))
      .map((member) => ({
        memberId: String(member.id),
        memberName: member.name,
        mobile: member.mobile,
        planName: "Gym Membership",
        category: "GENERAL",
        status: member.active === false ? "INACTIVE" : "ACTIVE",
        type: "general" as const,
      }));

    return [...generalRows, ...ptRows].sort((left, right) => left.memberName.localeCompare(right.memberName));
  }, [assignments, coachId, members]);

  const generalClients = useMemo(() => clientRows.filter((row) => row.type === "general"), [clientRows]);
  const ptClients = useMemo(() => clientRows.filter((row) => row.type === "pt"), [clientRows]);

  const ptSessionSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    return (ptCalendarRows || []).reduce<{
      total: number;
      completed: number;
      completedToday: number;
      completedThisMonth: number;
      scheduled: number;
      cancelled: number;
      noShow: number;
    }>(
      (summary, item) => {
        const record = toRecord(item);
        const status = String(record.status ?? "").toUpperCase();
        const sessionDate = String(record.sessionDate ?? record.date ?? record.scheduledAt ?? "");
        const sessionDay = sessionDate.slice(0, 10);
        summary.total += 1;
        if (status === "COMPLETED" || status === "DONE") {
          summary.completed += 1;
          if (sessionDay === today) {
            summary.completedToday += 1;
          }
          if (sessionDay.startsWith(month)) {
            summary.completedThisMonth += 1;
          }
        } else if (status === "SCHEDULED" || status === "UPCOMING" || status === "PENDING") {
          summary.scheduled += 1;
        } else if (status === "NO_SHOW") {
          summary.noShow += 1;
        } else if (status === "CANCELLED" || status === "CANCELED" || status === "RESCHEDULED") {
          summary.cancelled += 1;
        }
        return summary;
      },
      {
        total: 0,
        completed: 0,
        completedToday: 0,
        completedThisMonth: 0,
        scheduled: 0,
        cancelled: 0,
        noShow: 0,
      },
    );
  }, [ptCalendarRows]);

  const selectedShiftTemplate = useMemo(
    () => SHIFT_TEMPLATE_OPTIONS.find((option) => option.key === shiftTemplateKey) || SHIFT_TEMPLATE_OPTIONS[0],
    [shiftTemplateKey],
  );

  const toggleCoachActive = async () => {
    if (!token || !coach) {
      return;
    }

    setStatusSaving(true);
    setError(null);
    try {
      const updated = await usersService.updateUser(token, coach.id, buildUpdatePayload(coach, !coach.active));
      setCoach(updated);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to update coach status.");
    } finally {
      setStatusSaving(false);
    }
  };

  const toggleShiftDay = (day: string) => {
    setSelectedShiftDays((current) =>
      current.includes(day) ? current.filter((item) => item !== day) : [...current, day],
    );
  };

  const applyShiftTemplate = async () => {
    if (!token || !coachId || selectedShiftDays.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      for (const dayOfWeek of selectedShiftDays) {
        for (const slot of selectedShiftTemplate.slots) {
          await trainingService.createTrainerAvailability(token, coachId, {
            dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
          });
        }
      }
      const trainerSchedule = await trainingService.getTrainerSchedule(token, coachId, rangeStart, rangeEnd);
      setSchedule(trainerSchedule);
      setAvailabilityCount(trainerSchedule.availabilityCount);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to apply shift template.");
    } finally {
      setSaving(false);
    }
  };

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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <SurfaceCard title="Coach Profile">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xl font-bold text-slate-800">{coach?.name || `Coach #${coachId}`}</p>
              <p className="text-sm text-slate-500">{coach?.designation ? coach.designation.replaceAll("_", " ") : "Coach"}</p>
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${coach?.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {coach?.active ? "Active" : "Inactive"}
                </span>
                <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  {attendanceSummary.currentStatus}
                </span>
              </div>
            </div>
            <div className="flex items-start justify-end">
              <button
                type="button"
                disabled={statusSaving}
                onClick={() => void toggleCoachActive()}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  coach?.active ? "border border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-emerald-600 text-white hover:bg-emerald-700"
                } disabled:opacity-50`}
              >
                {statusSaving ? "Saving..." : coach?.active ? "Deactivate Coach" : "Activate Coach"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.email || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.mobile || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date of Birth</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{formatDate(coach?.dateOfBirth)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Age</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{calculateAge(coach?.dateOfBirth)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Joined On</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{formatDate(coach?.createdAt)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employment</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.employmentType?.replaceAll("_", " ") || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gender</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.gender || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alternate Mobile</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.alternateMobileNumber || "-"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Emergency Contact</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{coach?.emergencyContactName || "-"}</p>
              <p className="text-sm text-slate-600">{coach?.emergencyContactPhone || "-"}</p>
              <p className="text-xs text-slate-500">{coach?.emergencyContactRelation || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</p>
              <p className="mt-1 text-sm font-medium text-slate-800 whitespace-pre-wrap">{coach?.address || "-"}</p>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Attendance Summary">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Attendance Records</p>
              <p className="mt-2 text-2xl font-bold text-slate-800">{attendanceSummary.totalRecords}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Shifts</p>
              <p className="mt-2 text-2xl font-bold text-slate-800">{attendanceSummary.openShiftCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Worked Time</p>
              <p className="mt-2 text-2xl font-bold text-slate-800">{formatMinutes(attendanceSummary.totalWorkedMinutes)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions Logged</p>
              <p className="mt-2 text-2xl font-bold text-slate-800">{attendanceSummary.totalSessionsCompleted}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            This is the current operational summary from trainer attendance punches. Shift-wise salary and auto-deduction logic can be layered on top of this later.
          </p>
        </SurfaceCard>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="Total Clients">
          <p className="text-2xl font-bold text-slate-800">{clientRows.length}</p>
        </SurfaceCard>
        <SurfaceCard title="General Clients">
          <p className="text-2xl font-bold text-slate-800">{generalClients.length}</p>
        </SurfaceCard>
        <SurfaceCard title="PT Clients">
          <p className="text-2xl font-bold text-slate-800">{ptClients.length || pickNumber(performance, ["ptClients", "totalPtClients"])}</p>
        </SurfaceCard>
        <SurfaceCard title="Assignments">
          <p className="text-2xl font-bold text-slate-800">{assignmentCount}</p>
        </SurfaceCard>
        <SurfaceCard title="PT Active">
          <p className="text-2xl font-bold text-slate-800">{ptClients.filter((row) => row.status === "ACTIVE").length}</p>
        </SurfaceCard>
        <SurfaceCard title="PT Inactive">
          <p className="text-2xl font-bold text-slate-800">{ptClients.filter((row) => row.status !== "ACTIVE").length}</p>
        </SurfaceCard>
        <SurfaceCard title="Class Duties">
          <p className="text-2xl font-bold text-slate-800">{schedule?.classDutyCount ?? 0}</p>
        </SurfaceCard>
        <SurfaceCard title="Approved Leave">
          <p className="text-2xl font-bold text-slate-800">{schedule?.leaveCount ?? 0}</p>
        </SurfaceCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SurfaceCard title="Assigned Clients">
          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">General Clients</h3>
                <span className="text-xs font-medium text-slate-500">{generalClients.length} assigned</span>
              </div>
              {generalClients.length === 0 ? (
                <p className="text-sm text-slate-500">No general clients assigned.</p>
              ) : (
                <CoachClientTable clients={generalClients} />
              )}
            </div>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">PT Clients</h3>
                <span className="text-xs font-medium text-slate-500">{ptClients.length} assigned</span>
              </div>
              {ptClients.length === 0 ? (
                <p className="text-sm text-slate-500">No PT clients assigned.</p>
              ) : (
                <CoachClientTable clients={ptClients} />
              )}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="PT Session Summary">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Total Sessions" value={ptSessionSummary.total} />
            <MetricCard label="Completed" value={ptSessionSummary.completed} />
            <MetricCard label="Completed Today" value={ptSessionSummary.completedToday} />
            <MetricCard label="Completed This Month" value={ptSessionSummary.completedThisMonth} />
            <MetricCard label="Scheduled" value={ptSessionSummary.scheduled} />
            <MetricCard label="Cancelled" value={ptSessionSummary.cancelled} />
            <MetricCard label="No Show" value={ptSessionSummary.noShow} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            This is derived from trainer PT calendar entries and gives the operational daily/monthly session picture until dedicated PT reporting is added.
          </p>
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

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <SurfaceCard title="Shift Foundation">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Use trainer availability as the base for shift assignment. This is the foundation for later round-robin roster and shift-aware attendance/payroll rules.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Shift Template
              <select
                value={shiftTemplateKey}
                onChange={(event) => setShiftTemplateKey(event.target.value as (typeof SHIFT_TEMPLATE_OPTIONS)[number]["key"])}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                {SHIFT_TEMPLATE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <p className="text-sm font-medium text-slate-700">Assign Days</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((day) => {
                  const active = selectedShiftDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleShiftDay(day)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        active ? "bg-[#C42429] text-white" : "border border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-800">{selectedShiftTemplate.label}</p>
              {selectedShiftTemplate.slots.map((slot) => (
                <p key={`${slot.startTime}-${slot.endTime}`}>{slot.startTime} to {slot.endTime}</p>
              ))}
            </div>
            <button
              type="button"
              disabled={saving || selectedShiftDays.length === 0}
              onClick={() => void applyShiftTemplate()}
              className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
            >
              {saving ? "Applying..." : "Apply Shift Template"}
            </button>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Roster Notes">
          <div className="space-y-3 text-sm text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-800">Normal Shift</p>
              <p>Morning 6 AM to 10 AM and evening 5 PM to 9 PM.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-800">Premium Shift</p>
              <p>Morning 5 AM to 9 AM and evening 6 PM to 10 PM. Use this when trainers rotate into premium coverage.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-800">Sunday Coverage</p>
              <p>Assign a 4-hour PT availability window on Sunday for the selected trainer when they are on Sunday roster duty.</p>
            </div>
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-slate-500">
              Full round-robin automation is the next layer. This pass gives you the persistent shift windows that attendance and roster logic can work from.
            </div>
          </div>
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

      <SurfaceCard title="Attendance Register">
        {attendanceRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No trainer attendance records in the selected reporting period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Clock In</th>
                  <th className="px-4 py-3">Clock Out</th>
                  <th className="px-4 py-3">Worked</th>
                  <th className="px-4 py-3">Sessions</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendanceRows.map((row) => (
                  <tr key={row.attendanceId}>
                    <td className="px-4 py-3 text-slate-700">{formatDate(row.attendanceDate)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.clockInAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.clockOutAt)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMinutes(row.workedMinutes)}</td>
                    <td className="px-4 py-3 text-slate-700">{row.sessionsCompleted}</td>
                    <td className="px-4 py-3 text-slate-700">{row.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

function CoachClientTable({ clients }: { clients: ClientRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Member</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {clients.map((client) => (
            <tr key={`${client.type}-${client.memberId}`} className="align-top">
              <td className="px-4 py-3 font-medium text-slate-800">{client.memberName}</td>
              <td className="px-4 py-3 text-slate-700">{client.mobile || "-"}</td>
              <td className="px-4 py-3 text-slate-700">{client.planName}</td>
              <td className="px-4 py-3 text-slate-700">{client.category.replaceAll("_", " ")}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    client.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {client.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
