"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Briefcase,
  Calendar,
  CalendarCheck,
  Clock,
  Dumbbell,
  FileClock,
  History,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Users,
  UserRound,
} from "lucide-react";
import { WeeklyCalendar, WeeklyCalendarDay, WeeklyCalendarEvent, WeeklyCalendarFreeSlot } from "@/components/common/weekly-calendar";
import { Modal } from "@/components/common/modal";
import { ToastBanner } from "@/components/common/toast-banner";
import { AttendanceAccessSection } from "@/components/portal/attendance-access-section";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService, BiometricAttendanceLogRecord, BiometricDeviceRecord, MemberBiometricEnrollmentRecord } from "@/lib/api/services/engagement-service";
import { isRealBiometricDevice } from "@/lib/biometric-device-filter";
import { usePollingEnrollments } from "@/hooks/use-polling-enrollments";
import { branchService } from "@/lib/api/services/branch-service";
import { trainingService, TrainerScheduleEntry, TrainerScheduleResponse } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { canAssignTrainerScheduleSlots, canEditTrainerProfile, canOperatePtSessions } from "@/lib/access-policy";
import { BranchResponse } from "@/types/admin";
import { UserDirectoryItem } from "@/types/models";

type TabKey = "overview" | "schedule" | "clients" | "sessions" | "attendance";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "schedule", label: "Weekly Schedule" },
  { key: "clients", label: "Client List" },
  { key: "sessions", label: "PT Sessions" },
  { key: "attendance", label: "Attendance" },
];

interface ClientRow {
  memberId: string;
  assignmentId?: string;
  memberName: string;
  mobile: string;
  planName: string;
  category: string;
  status: string;
  startDate?: string;
  endDate?: string;
  coupleGroupId?: string;
  slotSummary?: string;
  totalSessions?: number;
  importedCompletedSessions?: number;
  importedPendingSessions?: number;
  importedNoShowSessions?: number;
  importedCancelledSessions?: number;
  importedReschedulesUsed?: number;
  rescheduleLimit?: number;
  type: "general" | "pt";
}

interface ScheduleSlotSelection {
  mode: "assign" | "session-actions";
  dayKey: string;
  startTime: string;
  endTime: string;
  entry?: TrainerScheduleEntry;
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function normalizePin(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

function pickString(payload: unknown, keys: string[]): string {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
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

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + 6);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function toDayKey(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return toLocalDateKey(parsed);
}

function toTimeKey(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toTimeString().slice(0, 5);
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function formatDayLabel(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short" }).format(date);
}

function getEntryStart(entry: TrainerScheduleEntry): Date | null {
  if (!entry.startAt) return null;
  const parsed = new Date(entry.startAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEntryEnd(entry: TrainerScheduleEntry): Date | null {
  if (!entry.endAt) return null;
  const parsed = new Date(entry.endAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function withinHoursBefore(startAt: Date | null, hours: number): boolean {
  if (!startAt) return false;
  const diffMs = startAt.getTime() - Date.now();
  return diffMs <= hours * 60 * 60 * 1000;
}

function hoursUntilEntry(startAt: Date | null): number | null {
  if (!startAt) return null;
  return (startAt.getTime() - Date.now()) / (60 * 60 * 1000);
}

function canStartNow(entry: TrainerScheduleEntry): boolean {
  const startAt = getEntryStart(entry);
  const endAt = getEntryEnd(entry);
  if (!startAt || !endAt) return false;
  const now = Date.now();
  return now >= startAt.getTime() && now <= endAt.getTime();
}

function hasStarted(entry: TrainerScheduleEntry): boolean {
  const startAt = getEntryStart(entry);
  return Boolean(startAt && Date.now() >= startAt.getTime());
}

function hasEnded(entry: TrainerScheduleEntry): boolean {
  const endAt = getEntryEnd(entry);
  return Boolean(endAt && Date.now() > endAt.getTime());
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function timeToMinutes(value: string): number {
  const [hourText, minuteText] = value.slice(0, 5).split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 0;
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const normalized = Math.max(0, value);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return timeToMinutes(leftStart) < timeToMinutes(rightEnd) && timeToMinutes(rightStart) < timeToMinutes(leftEnd);
}

function dayNameFromDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "MONDAY";
  return ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][parsed.getDay()];
}

function normalizeDayOfWeek(value: unknown): string {
  if (typeof value === "number") {
    return ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"][value] || "";
  }
  return String(value || "").toUpperCase();
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
        <Icon className="h-4 w-4 text-slate-500" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.025] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        </div>
        <span className="rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-slate-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {helper ? <p className="mt-3 text-xs leading-5 text-slate-500">{helper}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#111826] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</h2>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function DetailCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-white">{value || "-"}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

const DESIGNATION_LABELS: Record<string, string> = {
  PT_COACH: "Personal Trainer",
  PERSONAL_TRAINER: "Personal Trainer",
  GENERAL_TRAINER: "General Trainer",
  HEAD_COACH: "Head Coach",
  YOGA_INSTRUCTOR: "Yoga Instructor",
  ZUMBA_INSTRUCTOR: "Zumba Instructor",
  BOXING_INSTRUCTOR: "Boxing Instructor",
  FREELANCE_TRAINER: "Freelance Trainer",
};

function humanizeDesignation(value?: string): string {
  if (!value) return "-";
  const normalized = value.toUpperCase();
  if (DESIGNATION_LABELS[normalized]) return DESIGNATION_LABELS[normalized];
  return normalized.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatEmploymentType(value?: string): string {
  if (!value) return "-";
  const normalized = value.toUpperCase();
  if (normalized === "INTERNAL") return "Internal";
  if (normalized === "VENDOR") return "Vendor";
  return normalized.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatStatus(active?: boolean): string {
  if (active === false) return "Inactive";
  return "Active";
}

function formatGender(value?: string): string {
  if (!value) return "-";
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDataScope(value?: string): string {
  if (!value) return "-";
  const normalized = value.toUpperCase();
  if (normalized === "ASSIGNED_ONLY") return "Assigned clients only";
  if (normalized === "BRANCH") return "Branch assigned";
  if (normalized === "GLOBAL") return "All branches";
  return normalized.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatShiftText(value?: string): string {
  if (!value) return "-";
  return value.replace(/\s*\|\s*/g, " + ").replace(/_/g, " ");
}

function formatDurationMinutes(minutes: number): string {
  if (!minutes) return "0h";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours && remaining) return `${hours}h ${remaining}m`;
  if (hours) return `${hours}h`;
  return `${remaining}m`;
}

function formatAvailabilityWindow(payload: unknown): string {
  const start = pickString(payload, ["startTime", "start"]);
  const end = pickString(payload, ["endTime", "end"]);
  if (!start || !end) return "";
  return `${formatTimeDisplay(start)} - ${formatTimeDisplay(end)}`;
}

function formatTimeDisplay(value?: string): string {
  if (!value) return "-";
  const time = toTimeKey(value).slice(0, 5);
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText || "0");
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeText(value?: string): string {
  if (!value) return "-";
  return value
    .split(/\s*\+\s*|\s*\|\s*|,\s*/)
    .map((part) => {
      const range = part.match(/(\d{1,2}:\d{2})(?::\d{2})?\s*[-–]\s*(\d{1,2}:\d{2})(?::\d{2})?/);
      if (!range) return part.trim();
      return `${formatTimeDisplay(range[1])} - ${formatTimeDisplay(range[2])}`;
    })
    .filter(Boolean)
    .join(" + ");
}

function normalizeParsedTime(hourValue: number, minuteValue: number, suffix?: string): string {
  let hour = hourValue;
  const normalizedSuffix = suffix?.toLowerCase();
  if (normalizedSuffix === "pm" && hour < 12) hour += 12;
  if (normalizedSuffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minuteValue).padStart(2, "0")}`;
}

function parseShiftWindows(value?: string): Array<{ startTime: string; endTime: string }> {
  if (!value) return [];
  const normalized = value
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/&/g, "|");
  return normalized
    .split(/\s*\|\s*|,\s*/)
    .map((part) => {
      const match = part.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (!match) return null;
      const startHour = Number(match[1]);
      const startMinute = Number(match[2] || "0");
      const endHour = Number(match[4]);
      const endMinute = Number(match[5] || "0");
      const startSuffix = match[3] || match[6];
      const endSuffix = match[6] || match[3];
      if ([startHour, startMinute, endHour, endMinute].some((number) => Number.isNaN(number))) return null;
      return {
        startTime: normalizeParsedTime(startHour, startMinute, startSuffix),
        endTime: normalizeParsedTime(endHour, endMinute, endSuffix),
      };
    })
    .filter((window): window is { startTime: string; endTime: string } => Boolean(window));
}

interface AttendanceRow {
  attendanceId: number;
  attendanceDate?: string;
  clockInAt?: string;
  clockOutAt?: string;
  workedMinutes: number;
  sessionsCompleted: number;
  notes?: string;
}

interface PtDisplayRow extends ClientRow {
  memberIds: string[];
  sessions: unknown[];
  sessionRegisterMemberId: string;
  sessionRegisterAssignmentId?: string;
}

function humanizeWords(value?: string): string {
  if (!value) return "-";
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPortalPlanName(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const normalized = raw.toUpperCase();
  const durationMatch = normalized.match(/(?:_|-|\s)(\d+M|\d+\+\d+\s*M|\d+\+\d+M)$/);
  const duration = durationMatch?.[1]?.replace(/\s+/g, "") || "";

  if (normalized.includes("COUPLE") && normalized.includes("PT") && normalized.includes("LEVEL")) {
    const levelMatch = normalized.match(/LEVEL[_-]?(\d+)/);
    return `Couple PT Level ${levelMatch?.[1] || ""}${duration ? ` · ${duration}` : ""}`.trim();
  }
  if (normalized.includes("PT") && normalized.includes("LEVEL")) {
    const levelMatch = normalized.match(/LEVEL[_-]?(\d+)/);
    return `PT Level ${levelMatch?.[1] || ""}${duration ? ` · ${duration}` : ""}`.trim();
  }
  if (normalized.includes("CORE PLUS")) {
    return `Core Plus${duration ? ` · ${duration}` : ""}`;
  }
  if (normalized.includes("CORE")) {
    return `Core${duration ? ` · ${duration}` : ""}`;
  }
  if (normalized.includes("BLACK")) {
    return `Black${duration ? ` · ${duration}` : ""}`;
  }
  if (normalized.includes("FLEX")) {
    return humanizeWords(raw).replace(/\s+/g, " ");
  }
  return humanizeWords(raw).replace(/^Fomo\s+/i, "");
}

function ClientTable({
  clients,
  onRowClick,
}: {
  clients: ClientRow[];
  onRowClick: (client: ClientRow) => void;
}) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage((current) => {
      const totalPages = Math.max(1, Math.ceil(clients.length / pageSize));
      return Math.min(current, totalPages);
    });
  }, [clients.length]);
  if (clients.length === 0) {
    return <p className="text-sm text-slate-400">No clients assigned.</p>;
  }
  const totalPages = Math.max(1, Math.ceil(clients.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedClients = clients.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
            <th className="px-3 py-2">Member</th>
            <th className="px-3 py-2">Mobile</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Assignment</th>
          </tr>
        </thead>
        <tbody>
          {pagedClients.map((client) => (
            <tr
              key={`${client.memberId}-${client.type}-${client.assignmentId || ""}`}
              className="cursor-pointer border-b border-white/5 hover:bg-white/[0.04]"
              onClick={() => onRowClick(client)}
            >
              <td className="px-3 py-2 text-white">{client.memberName}</td>
              <td className="px-3 py-2 text-slate-300">{client.mobile || "-"}</td>
              <td className="px-3 py-2 text-slate-300">{client.status}</td>
              <td className="px-3 py-2 text-slate-300">{client.planName}</td>
              <td className="px-3 py-2 text-slate-300">{client.slotSummary || "Assigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {clients.length > pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-300">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TrainerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const trainerId = String(params.trainerId || "");
  const { token, user, accessMetadata } = useAuth();

  const initialStart = startOfWeek(new Date());
  const initialEnd = endOfWeek(initialStart);

  const [trainer, setTrainer] = useState<UserDirectoryItem | null>(null);
  const [assignments, setAssignments] = useState<unknown[]>([]);
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [schedule, setSchedule] = useState<TrainerScheduleResponse | null>(null);
  const [rangeStart, setRangeStart] = useState(toDateInput(initialStart));
  const [rangeEnd, setRangeEnd] = useState(toDateInput(initialEnd));
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedScheduleSlot, setSelectedScheduleSlot] = useState<ScheduleSlotSelection | null>(null);
  const [slotAssignmentForm, setSlotAssignmentForm] = useState({
    scheduleType: "PT" as "PT" | "GROUP_CLASS" | "ONBOARDING",
    memberId: "",
    rescheduleSessionId: "",
    rescheduleReason: "",
    packageName: "Personal Training",
    className: "",
    startDate: rangeStart,
    endDate: "",
    totalSessions: "0",
    completedSessions: "0",
    pendingSessions: "0",
  });
  const [saving, setSaving] = useState(false);
  const [ptSessions, setPtSessions] = useState<unknown[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionPage, setSessionPage] = useState(1);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [biometricDevices, setBiometricDevices] = useState<BiometricDeviceRecord[]>([]);
  const [biometricLogs, setBiometricLogs] = useState<BiometricAttendanceLogRecord[]>([]);
  const [enrollments, setEnrollments] = useState<MemberBiometricEnrollmentRecord[]>([]);
  // Poll the enrollments endpoint every 3s while any row is PENDING so a
  // freshly-submitted face-scan flips to ENROLLED in the UI without a
  // full-page refresh. Hook auto-stops once nothing is pending.
  usePollingEnrollments({
    token,
    userId: trainerId,
    enabled: activeTab === "attendance",
    initial: enrollments,
    onUpdate: setEnrollments,
  });
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [accessActionError, setAccessActionError] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [viewSessionsFor, setViewSessionsFor] = useState<{ memberName: string; sessions: unknown[] } | null>(null);
  const [clientSessionMap, setClientSessionMap] = useState<Record<string, { memberName: string; sessions: unknown[]; assignmentId?: string }>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    mobile: "",
    defaultBranchId: "",
    employmentType: "",
    designation: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    dateOfBirth: "",
    gender: "",
    address: "",
    totalExperienceYears: "",
    maxClientCapacity: "",
    shiftTimings: "",
    assignedCategory: "",
  });

  const canOperatePtSessionActions = canOperatePtSessions(user, accessMetadata);
  const canEditTrainerDetails = canEditTrainerProfile(user, accessMetadata);
  const canAssignScheduleSlots = canAssignTrainerScheduleSlots(user, accessMetadata);

  useEffect(() => {
    if (!token || !trainerId) return;
    let active = true;
    (async () => {
      try {
        const [profile, assignmentRows, trainerSchedule, memberDirectory, branchPage] = await Promise.all([
          usersService.getUserById(token, trainerId),
          trainingService.getCoachAssignments(token, trainerId),
          trainingService.getTrainerSchedule(token, trainerId, rangeStart, rangeEnd),
          usersService.searchUsers(token, { role: "MEMBER" }),
          branchService.listBranches(token, { size: 100 }).catch(() => null),
        ]);
        if (!active) return;
        setTrainer(profile);
        setAssignments(assignmentRows);
        setSchedule(trainerSchedule);
        setMembers(memberDirectory);
        setBranches(branchPage?.content ?? []);
        setError(null);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load trainer profile.");
      }
    })();
    return () => {
      active = false;
    };
  }, [token, trainerId, rangeStart, rangeEnd]);

  useEffect(() => {
    const checkWeek = () => {
      const start = startOfWeek(new Date());
      const end = endOfWeek(start);
      const startKey = toLocalDateKey(start);
      const endKey = toLocalDateKey(end);
      if (startKey !== rangeStart || endKey !== rangeEnd) {
        setRangeStart(startKey);
        setRangeEnd(endKey);
      }
    };
    checkWeek();
    const interval = setInterval(checkWeek, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [rangeStart, rangeEnd]);

  const refreshScheduleContext = useCallback(async () => {
    if (!token || !trainerId) return;
    const [assignmentRows, trainerSchedule, memberDirectory] = await Promise.all([
      trainingService.getCoachAssignments(token, trainerId),
      trainingService.getTrainerSchedule(token, trainerId, rangeStart, rangeEnd),
      usersService.searchUsers(token, { role: "MEMBER" }),
    ]);
    setAssignments(assignmentRows);
    setSchedule(trainerSchedule);
    setMembers(memberDirectory);
  }, [token, trainerId, rangeStart, rangeEnd]);

  useEffect(() => {
    if (!token || (activeTab !== "sessions" && activeTab !== "overview" && activeTab !== "schedule")) return;
    let active = true;
    (async () => {
      setSessionsLoading(true);
      try {
        const assignmentRows = assignments.length > 0 ? assignments : await trainingService.getCoachAssignments(token, trainerId);
        const memberDirectory = members.length > 0 ? members : await usersService.searchUsers(token, { role: "MEMBER" });
        if (!active) return;
        const memberMap = new Map(memberDirectory.map((member) => [String(member.id), member]));
        const sessionRows: unknown[] = [];
        const sessionMap: Record<string, { memberName: string; sessions: unknown[]; assignmentId?: string }> = {};
        for (const assign of assignmentRows) {
          const record = toRecord(assign);
          const assignId = pickString(record, ["id", "assignmentId"]);
          if (!assignId) continue;
          try {
            const sessions = await trainingService.getPtSessionsByAssignment(token, assignId);
            const memberId = pickString(record, ["memberId", "clientId", "id"]);
            const member = memberMap.get(String(memberId));
            const memberName = member?.name || pickString(record, ["memberName", "clientName"]) || `Member #${memberId}`;
            const mapped = sessions.map((row) => ({
              ...toRecord(row),
              memberName,
            }));
            sessionRows.push(...mapped);
            sessionMap[String(memberId)] = {
              memberName,
              sessions: mapped,
              assignmentId: assignId,
            };
          } catch {
            // skip
          }
        }
        // Deduplicate sessions — couple assignments share sessions via resolveSharedAssignmentIds
        const seenIds = new Set<string>();
        const dedupedSessions = sessionRows.filter((row) => {
          const rec = toRecord(row);
          const sid = String(rec.id ?? rec.sessionId ?? "");
          if (!sid || seenIds.has(sid)) return false;
          seenIds.add(sid);
          return true;
        });
        setPtSessions(dedupedSessions);
        setClientSessionMap(sessionMap);
      } catch {
        setPtSessions([]);
        setClientSessionMap({});
      } finally {
        if (active) setSessionsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, activeTab, assignments, members, trainerId]);

  useEffect(() => {
    if (!token || (activeTab !== "attendance" && activeTab !== "overview")) return;
    let active = true;
    (async () => {
      try {
        const trainerPin = normalizePin(String(trainer?.mobile || ""));
        const [report, devices, allLogs, enrollmentRows] = await Promise.all([
          usersService.getTrainerAttendanceReport(token, { trainerId: Number(trainerId) }),
          engagementService.listBiometricDevices(token).catch(() => []),
          engagementService.getBiometricLogs(token).catch(() => []),
          engagementService.getMemberBiometricEnrollments(token, trainerId).catch(() => []),
        ]);
        if (!active) return;
        const entries = Array.isArray(report)
          ? report
          : Array.isArray(toRecord(report).entries)
            ? (toRecord(report).entries as unknown[])
            : [];
        setAttendanceRows(
          entries.map((item) => {
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
          }),
        );
        setBiometricDevices(Array.isArray(devices) ? devices.filter(isRealBiometricDevice) : []);
        setBiometricLogs(
          Array.isArray(allLogs)
            ? allLogs.filter((entry) => String(entry.deviceUserId || "") === trainerPin)
            : [],
        );
        setEnrollments(Array.isArray(enrollmentRows) ? enrollmentRows : []);
        setAccessActionError(null);
      } catch {
        if (!active) return;
        setAttendanceRows([]);
        setBiometricDevices([]);
        setBiometricLogs([]);
        setEnrollments([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, activeTab, trainerId, trainer]);

  const handleAccessAction = async (
    action: "ADD_USER" | "RE_ADD_USER" | "BLOCK_USER" | "UNBLOCK_USER" | "DELETE_USER",
    serial: string,
  ) => {
    if (!token || !trainerId || !serial) return;
    const pin = normalizePin(String(trainer?.mobile || ""));
    if (!pin) {
      setAccessActionError("Trainer mobile number is required to sync with the biometric device.");
      return;
    }
    setAccessBusy(true);
    setAccessActionError(null);
    try {
      const payload = {
        serialNumber: serial,
        pin,
        name: trainer?.name || "Trainer",
        memberId: Number(trainerId),
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
        await engagementService.deleteBiometricUser(token, payload);
      }
      setToast({ kind: "success", message: "Biometric device action queued." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update biometric access.";
      setAccessActionError(message);
      setToast({ kind: "error", message });
    } finally {
      setAccessBusy(false);
    }
  };

  const clientRows = useMemo<ClientRow[]>(() => {
    const memberMap = new Map(members.map((member) => [String(member.id), member]));
    const today = new Date().toISOString().slice(0, 10);
    const ptCoverageByMemberId = new Map<string, string>();
    const ptScheduleEntries = (schedule?.entries ?? []).filter((entry) => entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT");
    for (const entry of ptScheduleEntries) {
      const memberId = String(entry.memberId ?? "");
      if (!memberId) continue;
      const existing = ptCoverageByMemberId.get(memberId) ?? "";
      const dayLabel = new Date(`${toDayKey(entry.startAt)}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" });
      const timeLabel = formatTimeDisplay(entry.startAt);
      const nextLabel = `${dayLabel} ${timeLabel}`;
      if (!existing.includes(nextLabel)) {
        ptCoverageByMemberId.set(memberId, existing ? `${existing} · ${nextLabel}` : nextLabel);
      }
    }
    const ptRows = assignments.map((item) => {
      const record = toRecord(item);
      const memberId = pickString(record, ["memberId", "clientId", "id"]);
      const member = memberMap.get(String(memberId));
      const startDate = pickString(record, ["startDate"]);
      const endDate = pickString(record, ["endDate"]);
      const activeFlag = record.active !== false && pickString(record, ["active"]).toUpperCase() !== "FALSE";
      const dateActive = (!startDate || startDate <= today) && (!endDate || endDate >= today);
      return {
        memberId,
        assignmentId: pickString(record, ["id", "assignmentId"]),
        memberName: member?.name || pickString(record, ["memberName", "clientName", "name"]) || `Member #${memberId}`,
        mobile: member?.mobile || "-",
        planName: pickString(record, ["planName", "productName", "subscriptionName", "packageName"]) || "Personal Training",
        category: pickString(record, ["categoryCode", "productCategoryCode", "type", "trainingType"]) || "PERSONAL_TRAINING",
        status: activeFlag && dateActive ? "ACTIVE" : "INACTIVE",
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        coupleGroupId: pickString(record, ["coupleGroupId"]),
        slotSummary: ptCoverageByMemberId.get(String(memberId)) || undefined,
        totalSessions: pickNumber(record, ["totalSessions", "includedSessions", "sessionCount"]),
        importedCompletedSessions: pickNumber(record, ["importedCompletedSessions", "legacyCompletedSessions"]),
        importedPendingSessions: pickNumber(record, ["importedPendingSessions", "legacyPendingSessions"]),
        importedNoShowSessions: pickNumber(record, ["importedNoShowSessions", "legacyNoShowSessions"]),
        importedCancelledSessions: pickNumber(record, ["importedCancelledSessions", "legacyCancelledSessions"]),
        importedReschedulesUsed: pickNumber(record, ["importedReschedulesUsed", "legacyReschedulesUsed"]),
        rescheduleLimit: pickNumber(record, ["rescheduleLimit", "cancelAllowanceLimit"]),
        type: "pt" as const,
      };
    });
    const ptMemberIds = new Set(ptRows.map((row) => String(row.memberId)));
    const generalRows = members
      .filter((member) => String(member.defaultTrainerStaffId ?? "") === trainerId && !ptMemberIds.has(String(member.id)))
      .map((member) => ({
        memberId: String(member.id),
        memberName: member.name,
        mobile: member.mobile || "-",
        planName: "Gym Membership",
        category: "GENERAL",
        status: member.active === false ? "INACTIVE" : "ACTIVE",
        slotSummary: "General assignment",
        type: "general" as const,
      }));
    return [...generalRows, ...ptRows].sort((left, right) => left.memberName.localeCompare(right.memberName));
  }, [assignments, members, schedule, trainerId]);

  const generalClients = useMemo(() => clientRows.filter((row) => row.type === "general"), [clientRows]);
  const ptClients = useMemo(() => clientRows.filter((row) => row.type === "pt"), [clientRows]);
  const activePtClients = useMemo(() => ptClients.filter((row) => row.status === "ACTIVE"), [ptClients]);
  const historicalPtClients = useMemo(() => ptClients.filter((row) => row.status !== "ACTIVE"), [ptClients]);
  const assignablePtClients = useMemo(() => activePtClients.filter((row) => Boolean(row.assignmentId)), [activePtClients]);
  const groupPtClients = useCallback((clients: ClientRow[]): PtDisplayRow[] => {
    const grouped = new Map<string, PtDisplayRow>();
    for (const client of clients) {
      const key = client.coupleGroupId ? `couple-${client.coupleGroupId}` : `single-${client.memberId}`;
      const existing = grouped.get(key);
      const memberSessions = clientSessionMap[String(client.memberId)]?.sessions ?? [];
      if (!existing) {
        grouped.set(key, {
          ...client,
          memberName: client.memberName,
          mobile: client.mobile || "-",
          planName: formatPortalPlanName(client.planName),
          slotSummary: client.slotSummary || undefined,
          memberIds: [client.memberId],
          sessions: [...memberSessions],
          sessionRegisterMemberId: client.memberId,
          sessionRegisterAssignmentId: client.assignmentId,
        });
        continue;
      }
      const nameParts = new Set(existing.memberName.split(" & ").map((value) => value.trim()).filter(Boolean));
      nameParts.add(client.memberName);
      existing.memberName = Array.from(nameParts).join(" & ");
      const mobileParts = new Set(existing.mobile.split(" / ").map((value) => value.trim()).filter(Boolean));
      if (client.mobile && client.mobile !== "-") mobileParts.add(client.mobile);
      existing.mobile = Array.from(mobileParts).join(" / ") || "-";
      if (!existing.slotSummary && client.slotSummary) {
        existing.slotSummary = client.slotSummary;
      } else if (existing.slotSummary && client.slotSummary && !existing.slotSummary.includes(client.slotSummary)) {
        existing.slotSummary = `${existing.slotSummary} · ${client.slotSummary}`;
      }
      if (!existing.sessionRegisterAssignmentId && client.assignmentId) {
        existing.sessionRegisterAssignmentId = client.assignmentId;
        existing.sessionRegisterMemberId = client.memberId;
      }
      if (!existing.planName || existing.planName === "-" || existing.planName === formatPortalPlanName(existing.planName)) {
        existing.planName = formatPortalPlanName(client.planName || existing.planName);
      }
      existing.memberIds = Array.from(new Set([...existing.memberIds, client.memberId]));
      existing.totalSessions = Math.max(existing.totalSessions || 0, client.totalSessions || 0);
      existing.importedCompletedSessions = Math.max(existing.importedCompletedSessions || 0, client.importedCompletedSessions || 0);
      existing.importedPendingSessions = Math.max(existing.importedPendingSessions || 0, client.importedPendingSessions || 0);
      existing.importedNoShowSessions = Math.max(existing.importedNoShowSessions || 0, client.importedNoShowSessions || 0);
      existing.importedCancelledSessions = Math.max(existing.importedCancelledSessions || 0, client.importedCancelledSessions || 0);
      existing.importedReschedulesUsed = Math.max(existing.importedReschedulesUsed || 0, client.importedReschedulesUsed || 0);
      existing.rescheduleLimit = Math.max(existing.rescheduleLimit || 0, client.rescheduleLimit || 0);
      const seenSessionKeys = new Set(existing.sessions.map((session) => {
        const record = toRecord(session);
        return pickString(record, ["id"]) || `${pickString(record, ["sessionDate"])}-${pickString(record, ["sessionTime"])}-${pickString(record, ["status"])}`;
      }));
      for (const session of memberSessions) {
        const record = toRecord(session);
        const sessionKey = pickString(record, ["id"]) || `${pickString(record, ["sessionDate"])}-${pickString(record, ["sessionTime"])}-${pickString(record, ["status"])}`;
        if (seenSessionKeys.has(sessionKey)) continue;
        seenSessionKeys.add(sessionKey);
        existing.sessions.push(session);
      }
    }
    return Array.from(grouped.values()).sort((left, right) => left.memberName.localeCompare(right.memberName));
  }, [clientSessionMap]);
  const groupedActivePtClients = useMemo(() => groupPtClients(activePtClients), [activePtClients, groupPtClients]);
  const groupedHistoricalPtClients = useMemo(() => groupPtClients(historicalPtClients), [groupPtClients, historicalPtClients]);
  const schedulePtMemberIds = useMemo(
    () =>
      new Set(
        (schedule?.entries ?? [])
          .filter((entry) => entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT")
          .map((entry) => String(entry.memberId ?? ""))
          .filter(Boolean),
      ),
    [schedule],
  );
  const uniquePtMemberIds = new Set(activePtClients.map((row) => String(row.memberId)));
  const displayPtClientCount = Math.max(uniquePtMemberIds.size, schedulePtMemberIds.size);
  const displayTotalClientCount = generalClients.length + displayPtClientCount;
  const couplePtGroups = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    const addName = (groupId: string, name?: string) => {
      if (!groupId || !name) return;
      if (!groups.has(groupId)) groups.set(groupId, new Set<string>());
      groups.get(groupId)?.add(name);
    };

    for (const client of activePtClients) {
      if (client.coupleGroupId) {
        addName(client.coupleGroupId, client.memberName);
      }
    }

    for (const entry of schedule?.entries ?? []) {
      if (!entry.couple && !entry.coupleGroupId && !entry.secondaryMemberName) continue;
      const groupId = String(entry.coupleGroupId || `${entry.memberId || entry.memberName}-${entry.secondaryMemberId || entry.secondaryMemberName}`);
      addName(groupId, entry.memberName || entry.label);
      addName(groupId, entry.secondaryMemberName);
    }

    return Array.from(groups.entries())
      .map(([groupId, names]) => ({
        groupId,
        names: Array.from(names).filter(Boolean),
      }))
      .filter((group) => group.names.length > 0)
      .sort((left, right) => left.names.join(" & ").localeCompare(right.names.join(" & ")));
  }, [activePtClients, schedule]);
  const couplePtNameMap = useMemo(
    () => new Map(couplePtGroups.map((group) => [group.groupId, group.names.join(" & ")])),
    [couplePtGroups],
  );
  const formatScheduleMemberLabel = (entry: TrainerScheduleEntry) => {
    if (entry.coupleGroupId) {
      const grouped = couplePtNameMap.get(String(entry.coupleGroupId));
      if (grouped) return grouped;
    }
    const primary = entry.memberName || entry.label || "PT Session";
    if (entry.secondaryMemberName) {
      return `${primary} & ${entry.secondaryMemberName}`;
    }
    return primary;
  };

  const calendarDays = useMemo<WeeklyCalendarDay[]>(() => {
    const start = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
    const days: WeeklyCalendarDay[] = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length < 7) {
      if (cursor.getDay() !== 0) {
        days.push({
          key: toLocalDateKey(cursor),
          label: cursor.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }),
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [rangeStart, rangeEnd]);

  const effectiveAvailabilityRows = useMemo(() => {
    const apiAvailabilityRows = Array.isArray(schedule?.availability) ? schedule!.availability : [];
    if (apiAvailabilityRows.length > 0) return apiAvailabilityRows;
    const shiftWindows = parseShiftWindows(trainer?.shiftTimings);
    if (shiftWindows.length === 0) return [];
    return calendarDays.flatMap((day) =>
      shiftWindows.map((window) => ({
        dayOfWeek: dayNameFromDate(day.key),
        startTime: window.startTime,
        endTime: window.endTime,
      })),
    );
  }, [calendarDays, schedule, trainer?.shiftTimings]);

  const openMemberTraining = (memberId?: number, assignmentId?: number) => {
    if (!memberId) return;
    const assignmentQuery = assignmentId ? `&assignmentId=${assignmentId}` : "";
    router.push(`/admin/members/${memberId}?tab=personal-training&section=session-register${assignmentQuery}`);
  };

  const openFreeSlotAssignment = (slot: { dayKey: string; startTime: string; endTime: string }) => {
    if (!canAssignScheduleSlots) {
      setToast({ kind: "error", message: "Only authorized administrators can assign trainer calendar slots." });
      return;
    }
    setSelectedScheduleSlot({ mode: "assign", ...slot });
    setSlotAssignmentForm({
      scheduleType: "PT",
      memberId: "",
      rescheduleSessionId: "",
      rescheduleReason: "",
      packageName: "Personal Training",
      className: "",
      startDate: slot.dayKey,
      endDate: "",
      totalSessions: "0",
      completedSessions: "0",
      pendingSessions: "0",
    });
  };

  const openScheduleSessionActions = (entry: TrainerScheduleEntry) => {
    setSelectedScheduleSlot({
      mode: "session-actions",
      dayKey: toDayKey(entry.startAt),
      startTime: toTimeKey(entry.startAt),
      endTime: toTimeKey(entry.endAt),
      entry,
    });
  };

  const materializeScheduleEntrySession = useCallback(async (entry: TrainerScheduleEntry, note: string): Promise<number> => {
    if (!token) {
      throw new Error("Login session is required.");
    }
    if (entry.entryType === "PT_SESSION" && entry.referenceId) {
      return Number(entry.referenceId);
    }
    const assignmentId = Number(entry.assignmentId || 0);
    const memberId = Number(entry.memberId || 0);
    const sessionDate = toDayKey(entry.startAt);
    const sessionTime = toTimeKey(entry.startAt);
    if (!assignmentId || !memberId || !sessionDate || !sessionTime) {
      throw new Error("PT slot details are incomplete for this action.");
    }
    const created = await trainingService.createPtSession(token, {
      assignmentId,
      coachId: Number(trainerId),
      memberId,
      sessionDate,
      sessionTime,
      notes: note,
    });
    const createdId = Number(pickString(toRecord(created), ["id", "sessionId"]) || 0);
    if (!createdId) {
      throw new Error("PT session was created but no session ID was returned.");
    }
    return createdId;
  }, [token, trainerId]);

  const freeCalendarSlots = useMemo<WeeklyCalendarFreeSlot[]>(() => {
    if (!canAssignScheduleSlots) return [];
    const availabilityRows = effectiveAvailabilityRows;
    const entries = schedule?.entries ?? [];
    const slots: WeeklyCalendarFreeSlot[] = [];
    for (const day of calendarDays) {
      const dayName = dayNameFromDate(day.key);
      const dayEntries = entries.filter((entry) => toDayKey(entry.startAt) === day.key);
      for (const availability of availabilityRows) {
        const record = toRecord(availability);
        if (normalizeDayOfWeek(record.dayOfWeek) !== dayName) continue;
        const availabilityStart = pickString(record, ["startTime"]).slice(0, 5);
        const availabilityEnd = pickString(record, ["endTime"]).slice(0, 5);
        let cursor = timeToMinutes(availabilityStart);
        const end = timeToMinutes(availabilityEnd);
        while (cursor + 60 <= end) {
          const startTime = minutesToTime(cursor);
          const endTime = minutesToTime(cursor + 60);
          const occupied = dayEntries.some((entry) =>
            rangesOverlap(startTime, endTime, toTimeKey(entry.startAt), toTimeKey(entry.endAt)),
          );
          if (!occupied) {
            slots.push({
              id: `${day.key}-${startTime}-${endTime}`,
              dayKey: day.key,
              startTime,
              endTime,
              label: "Available · Add",
              onClick: () => openFreeSlotAssignment({ dayKey: day.key, startTime, endTime }),
            });
          }
          cursor += 60;
        }
      }
    }
    return slots;
  }, [calendarDays, canAssignScheduleSlots, effectiveAvailabilityRows, schedule]);

  const assignmentCancelAllowance = useMemo(() => {
    const liveUsedByAssignmentId = new Map<string, number>();
    for (const session of ptSessions) {
      const record = toRecord(session);
      const assignmentId = pickString(record, ["assignmentId", "clientAssignmentId"]);
      if (!assignmentId) continue;
      const status = pickString(record, ["status"]).toUpperCase();
      const hasReplacement = Boolean(pickString(record, ["rescheduledFromId", "replacementOfSessionId"]));
      if (hasReplacement || status === "RESCHEDULED") {
        liveUsedByAssignmentId.set(assignmentId, (liveUsedByAssignmentId.get(assignmentId) || 0) + 1);
      }
    }

    const allowance = new Map<string, { limit: number; used: number; remaining: number }>();
    for (const assignment of assignments) {
      const record = toRecord(assignment);
      const assignmentId = pickString(record, ["id", "assignmentId"]);
      if (!assignmentId) continue;
      const configuredLimit = pickNumber(record, ["rescheduleLimit", "cancelAllowanceLimit"]);
      const totalSessions = pickNumber(record, ["totalSessions", "includedSessions", "sessionCount"]);
      const derivedLimit = totalSessions > 0 ? Math.max(Math.ceil(totalSessions / 13) * 3, 3) : 0;
      const limit = configuredLimit > 0 ? Math.max(configuredLimit, derivedLimit) : derivedLimit;
      const importedUsed = pickNumber(record, ["importedReschedulesUsed", "legacyReschedulesUsed"]);
      const used = importedUsed + (liveUsedByAssignmentId.get(assignmentId) || 0);
      allowance.set(assignmentId, {
        limit,
        used,
        remaining: limit > 0 ? Math.max(limit - used, 0) : 0,
      });
    }
    return allowance;
  }, [assignments, ptSessions]);

  const buildScheduleEntryActions = useCallback((entry: TrainerScheduleEntry): WeeklyCalendarEvent["actions"] => {
    const hoursRemaining = hoursUntilEntry(getEntryStart(entry));
    const inProgress = String(entry.status || "").toUpperCase() === "IN_PROGRESS";
    const status = String(entry.status || "").toUpperCase();
    const isPendingState = !["COMPLETED", "CANCELLED", "CANCELED", "NO_SHOW", "IN_PROGRESS"].includes(status);
    const canStart = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && canStartNow(entry) && isPendingState;
    const slotStarted = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && hasStarted(entry);
    const slotEnded = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && hasEnded(entry);
    const entryAllowance = entry.assignmentId ? assignmentCancelAllowance.get(String(entry.assignmentId)) : undefined;
    const cancelAllowanceAvailable = !entryAllowance || entryAllowance.limit <= 0 || entryAllowance.remaining > 0;
    const canCancel = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT")
      && hoursRemaining !== null
      && hoursRemaining >= 8
      && isPendingState
      && cancelAllowanceAvailable;
    const canNoShow = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && slotStarted && isPendingState;
    const canMarkCompleted = (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && slotEnded && isPendingState;
    const actions: WeeklyCalendarEvent["actions"] = [];

    if (canOperatePtSessionActions && (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && !inProgress) {
      if (canStart) {
        actions.push({
          label: "Start Session",
          onClick: async () => {
            try {
              if (!token) return;
              const sessionId = await materializeScheduleEntrySession(entry, "Created from trainer weekly schedule for session start.");
              await trainingService.startSession(token, sessionId, "PORTAL");
              await refreshScheduleContext();
              setToast({ kind: "success", message: "Session started successfully." });
            } catch (err) {
              setToast({ kind: "error", message: err instanceof Error ? err.message : "Unable to start session." });
            }
          },
        });
      }
      if (canCancel) {
        actions.push({
          label: "Cancel Session",
          onClick: async () => {
            try {
              if (!token) return;
              const sessionId = await materializeScheduleEntrySession(entry, "Created from trainer weekly schedule for cancellation.");
              await trainingService.cancelPtSession(token, sessionId);
              await refreshScheduleContext();
              setToast({ kind: "success", message: "Session cancelled successfully." });
            } catch (err) {
              setToast({ kind: "error", message: err instanceof Error ? err.message : "Unable to cancel session." });
            }
          },
          tone: "danger",
        });
      }
      if (canMarkCompleted) {
        actions.push({
          label: "Mark Completed",
          onClick: async () => {
            try {
              if (!token) return;
              const sessionId = await materializeScheduleEntrySession(entry, "Created from trainer weekly schedule for manual completion.");
              await trainingService.markSessionComplete(token, sessionId);
              await refreshScheduleContext();
              setToast({ kind: "success", message: "Session marked completed." });
            } catch (err) {
              setToast({ kind: "error", message: err instanceof Error ? err.message : "Unable to complete session." });
            }
          },
        });
      }
      if (canNoShow) {
        actions.push({
          label: "No Show",
          onClick: async () => {
            try {
              if (!token) return;
              const sessionId = await materializeScheduleEntrySession(entry, "Created from trainer weekly schedule for no-show.");
              await trainingService.markSessionNoShow(token, sessionId);
              await refreshScheduleContext();
              setToast({ kind: "success", message: "Session marked as no-show." });
            } catch (err) {
              setToast({ kind: "error", message: err instanceof Error ? err.message : "Unable to mark no-show." });
            }
          },
          tone: "danger",
        });
      }
    }

    if ((entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && entry.memberId) {
      actions.push({
        label: "Open Session Register",
        onClick: () => openMemberTraining(entry.memberId, entry.assignmentId),
      });
    }

    return actions;
  }, [assignmentCancelAllowance, canOperatePtSessionActions, materializeScheduleEntrySession, refreshScheduleContext, token]);

  const calendarEvents = useMemo<WeeklyCalendarEvent[]>(() => {
    return (schedule?.entries ?? []).map((entry) => {
      const dayKey = toDayKey(entry.startAt);
      const dayName = dayNameFromDate(dayKey);
      const dayAvailabilityRows = effectiveAvailabilityRows.filter(
        (availability) => normalizeDayOfWeek(toRecord(availability).dayOfWeek) === dayName,
      );
      const eventStart = toTimeKey(entry.startAt);
      const eventEnd = toTimeKey(entry.endAt);
      const hasAvailabilityForDay = dayAvailabilityRows.length > 0;
      const insideConfiguredShift = dayAvailabilityRows.some((availability) => {
        const record = toRecord(availability);
        const availabilityStart = pickString(record, ["startTime"]).slice(0, 5);
        const availabilityEnd = pickString(record, ["endTime"]).slice(0, 5);
        if (!availabilityStart || !availabilityEnd || !eventStart || !eventEnd) return false;
        return timeToMinutes(availabilityStart) <= timeToMinutes(eventStart) && timeToMinutes(availabilityEnd) >= timeToMinutes(eventEnd);
      });
      const outsideConfiguredShift =
        hasAvailabilityForDay
        && (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT")
        && !insideConfiguredShift;
      const status = String(entry.status || "").toUpperCase();
      const slotEnded = entry.entryType === "PT_SESSION" && hasEnded(entry);
      const actions = buildScheduleEntryActions(entry) ?? [];

      return {
        id: `${entry.entryType}-${entry.referenceId ?? entry.startAt}`,
        dayKey,
        startTime: eventStart,
        endTime: eventEnd,
        title: formatScheduleMemberLabel(entry),
        subtitle:
          entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT"
            ? entry.couple
              ? "Couple Personal Training"
              : "Personal Training"
            : entry.entryType === "CLASS_DUTY"
              ? "Group Class"
              : entry.entryType.replaceAll("_", " "),
        meta:
          (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "COMPLETED"
            ? "Completed"
            : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "NO_SHOW"
              ? "No Show"
              : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && (status === "CANCELLED" || status === "CANCELED")
                ? "Cancelled"
                : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "RESCHEDULED"
                  ? "Rescheduled"
                  : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "IN_PROGRESS"
                    ? "In Progress"
                    : "",
        tone:
          entry.entryType === "CLASS_DUTY"
            ? "violet"
            : entry.entryType === "LEAVE"
              ? "rose"
              : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "COMPLETED"
                ? "emerald"
                : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "NO_SHOW"
                  ? "rose"
                  : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && (status === "CANCELLED" || status === "CANCELED" || status === "RESCHEDULED")
                    ? "slate"
                    : (entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT") && status === "IN_PROGRESS"
                      ? "amber"
                      : entry.entryType === "PT_SESSION" && slotEnded && status === "SCHEDULED"
                        ? "amber"
                        : outsideConfiguredShift
                          ? "sky"
                          : entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT"
                            ? "emerald"
                            : "slate",
        onClick: actions.length > 0 ? () => openScheduleSessionActions(entry) : undefined,
      };
    });
  }, [buildScheduleEntryActions, effectiveAvailabilityRows, schedule]);

  const submitFreeSlotAssignment = async () => {
    if (!token || !trainer || !selectedScheduleSlot || selectedScheduleSlot.mode !== "assign") return;
    if (!canAssignScheduleSlots) {
      setError("Only authorized administrators can assign trainer calendar slots.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (slotAssignmentForm.scheduleType === "GROUP_CLASS" || slotAssignmentForm.scheduleType === "ONBOARDING") {
        const className = slotAssignmentForm.className.trim();
        if (!className) {
          setError("Enter the class name for this slot.");
          return;
        }
        await trainingService.createClassSchedule(token, {
          className,
          classType: "GROUP",
          branchCode: String(trainer.defaultBranchId || "CARM"),
          trainerId: Number(trainerId),
          trainerName: trainer.name || "",
          startAt: `${selectedScheduleSlot.dayKey}T${selectedScheduleSlot.startTime}:00`,
          endAt: `${selectedScheduleSlot.dayKey}T${selectedScheduleSlot.endTime}:00`,
          capacity: 20,
          bookedCount: 0,
          notes: "Scheduled from trainer weekly calendar",
        });
      } else {
        const selectedClient = activePtClients.find((client) => String(client.memberId) === slotAssignmentForm.memberId);
        if (!selectedClient || !selectedClient.assignmentId) {
          setError("Select an active PT client to assign this slot.");
          return;
        }
        await trainingService.createPtSession(token, {
          assignmentId: Number(selectedClient.assignmentId),
          sessionDate: selectedScheduleSlot.dayKey,
          sessionTime: selectedScheduleSlot.startTime,
          coachId: Number(trainerId),
          memberId: Number(selectedClient.memberId),
          notes: "Scheduled from trainer weekly calendar",
        });
      }
      await refreshScheduleContext();
      setSelectedScheduleSlot(null);
      setToast({
        kind: "success",
        message: "Slot assigned.",
      });
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Unable to assign slot.");
    } finally {
      setSaving(false);
    }
  };

  const sessionPageSize = 10;
  const ptEntitlementByMemberId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of assignments) {
      const record = toRecord(item);
      const memberId = pickString(record, ["memberId", "clientId", "id"]);
      if (!memberId) continue;
      const totalSessions = pickNumber(record, ["totalSessions", "includedSessions", "sessionCount"]);
      if (totalSessions > 0) {
        map.set(String(memberId), totalSessions);
      }
    }
    return map;
  }, [assignments]);

  const sessionSummaries = useMemo(() => {
    const summaries = groupedActivePtClients.map((client) => {
      const sessions = client.sessions ?? [];
      const liveCompletedSessions = sessions.filter((s) => pickString(s, ["status"]).toUpperCase() === "COMPLETED").length;
      const liveCancelledSessions = sessions.filter((s) => {
        const status = pickString(s, ["status"]).toUpperCase();
        return status === "CANCELLED" || status === "CANCELED";
      }).length;
      const liveNoShowSessions = sessions.filter((s) => pickString(s, ["status"]).toUpperCase() === "NO_SHOW").length;
      const totalEntitlement = Math.max(
        client.totalSessions || 0,
        ...client.memberIds.map((memberId) => ptEntitlementByMemberId.get(String(memberId)) || 0),
        sessions.length,
      );
      const importedCompletedSessions = client.importedCompletedSessions || 0;
      const importedPendingSessions = client.importedPendingSessions || 0;
      const importedNoShowSessions = client.importedNoShowSessions || 0;
      const importedCancelledSessions = client.importedCancelledSessions || 0;
      const hasImportedSnapshot =
        totalEntitlement > 0
        && (importedCompletedSessions > 0 || importedPendingSessions > 0 || importedNoShowSessions > 0 || importedCancelledSessions > 0)
        && importedCompletedSessions + importedPendingSessions + importedNoShowSessions <= totalEntitlement;
      const completedSessions = hasImportedSnapshot ? importedCompletedSessions : liveCompletedSessions;
      const noShowSessions = hasImportedSnapshot ? importedNoShowSessions : liveNoShowSessions;
      const cancelledSessions = hasImportedSnapshot ? importedCancelledSessions : liveCancelledSessions;
      const pendingSessions = Math.max(totalEntitlement - (completedSessions + noShowSessions), 0);
      const trainerCountedSessions = completedSessions;
      const memberConsumedSessions = completedSessions + noShowSessions;
      return {
        memberId: client.memberId,
        memberName: client.memberName,
        assignmentId: client.sessionRegisterAssignmentId || client.assignmentId,
        planName: client.planName,
        slotSummary: client.slotSummary || "-",
        totalSessions: totalEntitlement,
        completedSessions,
        pendingSessions,
        cancelledSessions,
        noShowSessions,
        trainerCountedSessions,
        memberConsumedSessions,
        sessions,
        sessionRegisterMemberId: client.sessionRegisterMemberId,
      };
    });
    return summaries.sort((a, b) => a.memberName.localeCompare(b.memberName));
  }, [groupedActivePtClients, ptEntitlementByMemberId]);
  const sessionTotalPages = Math.max(1, Math.ceil(sessionSummaries.length / sessionPageSize));
  const safeSessionPage = Math.min(sessionPage, sessionTotalPages);
  const pagedSessionSummaries = sessionSummaries.slice(
    (safeSessionPage - 1) * sessionPageSize,
    safeSessionPage * sessionPageSize,
  );
  const todayDateKey = toLocalDateKey(new Date());
  const weekStartKey = rangeStart;
  const weekEndKey = rangeEnd;
  const currentMonthKey = todayDateKey.slice(0, 7);
  const ptSessionStats = useMemo(() => {
    let completedToday = 0;
    let completedThisWeek = 0;
    let completedThisMonth = 0;
    let cancelled = 0;
    let noShow = 0;
    for (const summary of sessionSummaries) {
      cancelled += summary.cancelledSessions;
      noShow += summary.noShowSessions;
      for (const row of summary.sessions) {
        const record = toRecord(row);
        const status = pickString(record, ["status"]).toUpperCase();
        const sessionDate = pickString(record, ["sessionDate", "date"]) || toDayKey(pickString(record, ["startAt"]));
        if (status === "COMPLETED") {
          if (sessionDate === todayDateKey) completedToday += 1;
          if (sessionDate >= weekStartKey && sessionDate <= weekEndKey) completedThisWeek += 1;
          if (sessionDate.startsWith(currentMonthKey)) completedThisMonth += 1;
        }
      }
    }
    return {
      activePtClients: activePtClients.length,
      completedToday,
      completedThisWeek,
      completedThisMonth,
      cancelled,
      noShow,
    };
  }, [activePtClients.length, currentMonthKey, sessionSummaries, todayDateKey, weekEndKey, weekStartKey]);
  const todayKey = todayDateKey;
  const todayScheduleEntries = (schedule?.entries ?? []).filter((entry) => toDayKey(entry.startAt) === todayKey);
  const todayPtEntries = todayScheduleEntries.filter((entry) => entry.entryType === "PT_SESSION" || entry.entryType === "PT_SLOT");
  const completedPtThisMonth = ptSessions.filter((session) => {
    const record = toRecord(session);
    const status = pickString(record, ["status"]).toUpperCase();
    const sessionDate = pickString(record, ["sessionDate", "date"]) || toDayKey(pickString(record, ["startAt"]));
    return status === "COMPLETED" && sessionDate.startsWith(currentMonthKey);
  }).length;
  const todaysAvailabilityWindows = effectiveAvailabilityRows
    .filter((availability) => normalizeDayOfWeek(toRecord(availability).dayOfWeek) === dayNameFromDate(todayKey))
    .map((availability) => formatAvailabilityWindow(availability))
    .filter(Boolean);
  const weeklyAvailabilityDays = new Set(
    effectiveAvailabilityRows
      .map((availability) => normalizeDayOfWeek(toRecord(availability).dayOfWeek))
      .filter(Boolean),
  );
  const currentWorkingShift =
    todaysAvailabilityWindows.length > 0
      ? todaysAvailabilityWindows.join(" + ")
      : formatTimeText(formatShiftText(trainer?.shiftTimings));
  const todayAttendance = attendanceRows.find((row) => toDayKey(row.attendanceDate) === todayKey);
  const latestAttendanceRow = attendanceRows
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.clockOutAt || left.clockInAt || left.attendanceDate || "").getTime();
      const rightTime = new Date(right.clockOutAt || right.clockInAt || right.attendanceDate || "").getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })[0];
  const latestBiometricLog = biometricLogs
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.punchTimestamp || "").getTime();
      const rightTime = new Date(right.punchTimestamp || "").getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    })[0];
  const attendanceStatus = todayAttendance?.clockInAt
    ? todayAttendance.clockOutAt
      ? "Shift completed"
      : "Checked in"
    : latestBiometricLog && toDayKey(latestBiometricLog.punchTimestamp) === todayKey
      ? "Biometric punch recorded"
      : "Not recorded";
  const latestPunchLabel =
    latestAttendanceRow?.clockOutAt || latestAttendanceRow?.clockInAt
      ? formatDateTime(latestAttendanceRow.clockOutAt || latestAttendanceRow.clockInAt)
      : latestBiometricLog?.punchTimestamp
        ? formatDateTime(latestBiometricLog.punchTimestamp)
        : "-";
  const branchKey = String(trainer?.defaultBranchId || "");
  const matchedBranch = branches.find((branch) => {
    const id = String(branch.id || "");
    const code = String(branch.branchCode || "");
    return Boolean(branchKey && (branchKey === id || branchKey.toUpperCase() === code.toUpperCase() || branchKey.toUpperCase() === branch.name.toUpperCase()));
  });
  const branchLabel = matchedBranch?.name || branchKey || "CARM";
  const trainerCapacity = trainer?.maxClientCapacity ? String(trainer.maxClientCapacity) : "-";
  const trainerExperience =
    trainer?.totalExperienceYears !== undefined && trainer.totalExperienceYears !== null
      ? `${trainer.totalExperienceYears} years`
      : "-";

  if (!trainerId) {
    return <div className="p-6 text-sm text-slate-400">Trainer not found.</div>;
  }

  return (
    <div className="space-y-6">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
      {error ? <ToastBanner kind="error" message={error} onClose={() => setError(null)} /> : null}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0f1726]">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(196,36,41,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <button
                type="button"
                onClick={() => router.push("/portal/trainers")}
                className="mt-1 rounded-full border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
              >
                <ArrowLeft className="inline h-3 w-3" /> Back
              </button>
              <div className="flex min-w-0 gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.08] text-xl font-bold text-white">
                  {trainer?.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={trainer.profileImageUrl} alt={trainer.name || "Trainer"} className="h-full w-full object-cover" />
                  ) : (
                    (trainer?.name || "T").slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-bold text-white">{trainer?.name || "Trainer"}</h1>
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                      {formatStatus(trainer?.active)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-300">{humanizeDesignation(trainer?.designation)}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" /> {trainer?.mobile || "-"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" /> {trainer?.email || "-"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {branchLabel}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200">
                {formatEmploymentType(trainer?.employmentType)}
              </div>
              {canEditTrainerDetails ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!trainer) return;
                    setEditForm({
                      name: trainer.name || "",
                      email: trainer.email || "",
                      mobile: trainer.mobile || "",
                      defaultBranchId: matchedBranch?.branchCode || String(trainer.defaultBranchId || "CARM"),
                      employmentType: trainer.employmentType || "",
                      designation: trainer.designation || "",
                      emergencyContactName: trainer.emergencyContactName || "",
                      emergencyContactPhone: trainer.emergencyContactPhone || "",
                      dateOfBirth: trainer.dateOfBirth || "",
                      gender: trainer.gender || "",
                      address: trainer.address || "",
                      totalExperienceYears: trainer.totalExperienceYears !== undefined ? String(trainer.totalExperienceYears) : "",
                      maxClientCapacity: trainer.maxClientCapacity !== undefined ? String(trainer.maxClientCapacity) : "",
                      shiftTimings: trainer.shiftTimings || "",
                      assignedCategory: trainer.assignedCategory || "",
                    });
                    setEditOpen(true);
                  }}
                  className="rounded-full border border-[#C42429]/40 bg-[#C42429] px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-[#C42429]/20 hover:bg-[#ab1e22]"
                >
                  <Pencil className="inline h-3 w-3" /> Edit Profile
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-7">
          <OverviewMetric icon={Users} label="Total Clients" value={String(displayTotalClientCount)} helper="PT plus general assignments" />
          <OverviewMetric icon={Dumbbell} label="PT Clients" value={String(displayPtClientCount)} helper="Current active PT clients" />
          <OverviewMetric icon={Users} label="Couple PT" value={String(couplePtGroups.length)} helper="Active couple groups" />
          <OverviewMetric icon={UserRound} label="General Clients" value={String(generalClients.length)} helper="Default trainer assignments" />
          <OverviewMetric icon={BadgeCheck} label="Active PT" value={String(activePtClients.length)} helper="Active PT packages" />
          <OverviewMetric icon={CalendarCheck} label="Today" value={String(todayPtEntries.length)} helper="Scheduled PT sessions" />
          <OverviewMetric icon={Activity} label="This Month" value={String(completedPtThisMonth)} helper="Completed PT sessions" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              activeTab === tab.key ? "bg-[#C42429] text-white" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="Trainer Snapshot">
            <div className="grid gap-3 md:grid-cols-2">
              <DetailCard label="Email" value={trainer?.email || "-"} />
              <DetailCard label="Mobile" value={trainer?.mobile || "-"} />
              <DetailCard label="Emergency Contact" value={trainer?.emergencyContactName || "-"} helper={trainer?.emergencyContactPhone || undefined} />
              <DetailCard label="Date of Birth" value={formatDate(trainer?.dateOfBirth)} />
              <DetailCard label="Gender" value={formatGender(trainer?.gender)} />
              <DetailCard label="Designation" value={humanizeDesignation(trainer?.designation)} />
              <DetailCard label="Employment Type" value={formatEmploymentType(trainer?.employmentType)} />
              <DetailCard label="Home Branch" value={branchLabel} />
              <DetailCard label="Experience" value={trainerExperience} />
              <DetailCard label="Client Capacity" value={trainerCapacity} />
              <DetailCard label="Assigned Category" value={formatShiftText(trainer?.assignedCategory)} />
              <DetailCard label="Data Scope" value={formatDataScope(trainer?.dataScope)} />
              <div className="md:col-span-2">
                <DetailCard label="Address" value={trainer?.address || "-"} />
              </div>
            </div>
          </Panel>
          <Panel title="Operational Snapshot">
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Clock className="h-4 w-4" /> Current Working Shift
                </div>
                <p className="mt-2 text-base font-semibold text-white">{currentWorkingShift}</p>
                <p className="mt-1 text-xs text-slate-500">Taken from configured weekly availability, then trainer shift timing fallback.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailCard
                  label="Weekly Coverage"
                  value={`${weeklyAvailabilityDays.size || 0} days`}
                  helper={`${schedule?.ptSessionCount ?? 0} PT sessions · ${schedule?.classDutyCount ?? 0} classes this week`}
                />
                <DetailCard label="Historical PT" value={String(historicalPtClients.length)} helper="Inactive or expired PT assignments" />
                <DetailCard label="Attendance Today" value={attendanceStatus} helper={todayAttendance ? `${formatDurationMinutes(todayAttendance.workedMinutes)} recorded` : undefined} />
                <DetailCard label="Last Punch" value={latestPunchLabel} helper="Last attendance/check-out equivalent available" />
                <DetailCard label="Branch Access" value={formatDataScope(trainer?.dataScope)} helper="Controls which client records this trainer can access" />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Users className="h-4 w-4" /> Couple PT
                </div>
                {couplePtGroups.length === 0 ? (
                  <p className="text-sm text-slate-400">No active couple PT groups assigned.</p>
                ) : (
                  <div className="space-y-2">
                    {couplePtGroups.slice(0, 5).map((group) => (
                      <div key={group.groupId} className="rounded-xl bg-white/[0.04] px-3 py-2">
                        <p className="text-sm font-semibold text-white">{group.names.join(" & ")}</p>
                        <p className="text-xs text-slate-500">Couple PT</p>
                      </div>
                    ))}
                    {couplePtGroups.length > 5 ? (
                      <p className="text-xs text-slate-500">+{couplePtGroups.length - 5} more couple PT groups.</p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <Briefcase className="h-4 w-4" /> Today&apos;s Workload
                </div>
                {todayScheduleEntries.length === 0 ? (
                  <p className="text-sm text-slate-400">No scheduled items for today.</p>
                ) : (
                  <div className="space-y-2">
                    {todayScheduleEntries.slice(0, 4).map((entry) => (
                      <div key={`${entry.entryType}-${entry.referenceId ?? entry.startAt}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{formatScheduleMemberLabel(entry)}</p>
                          <p className="text-xs text-slate-500">{entry.entryType === "CLASS_DUTY" ? "Group Class" : entry.couple ? "Couple PT" : "Personal Training"}</p>
                        </div>
                        <span className="text-xs font-semibold text-slate-300">{formatTimeDisplay(entry.startAt)}</span>
                      </div>
                    ))}
                    {todayScheduleEntries.length > 4 ? (
                      <p className="text-xs text-slate-500">+{todayScheduleEntries.length - 4} more scheduled items today.</p>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <ShieldCheck className="mr-2 inline h-4 w-4" />
                Attendance is calculated from biometric punches where the last punch near the shift end acts as the check-out equivalent.
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeTab === "schedule" ? (
        <Panel title="Weekly Schedule">
          <div className="mb-4 flex items-center justify-between text-sm text-slate-400">
            <span>Week of {formatDayLabel(rangeStart)}</span>
          </div>
          <WeeklyCalendar
            days={calendarDays}
            events={calendarEvents}
            freeSlots={freeCalendarSlots}
            emptyLabel="No scheduled items in this range."
            showEventTime={false}
            showFreeSlotTime={false}
          />
        </Panel>
      ) : null}

      {activeTab === "clients" ? (
        <div className="space-y-4">
          <Panel title="PT Clients">
            <ClientTable
              clients={groupedActivePtClients}
              onRowClick={(client) => {
                const ptClient = client as PtDisplayRow;
                openMemberTraining(
                  Number(ptClient.sessionRegisterMemberId || client.memberId),
                  ptClient.sessionRegisterAssignmentId ? Number(ptClient.sessionRegisterAssignmentId) : undefined,
                );
              }}
            />
          </Panel>
          {groupedHistoricalPtClients.length > 0 ? (
            <Panel title="PT Client History">
              <ClientTable
                clients={groupedHistoricalPtClients}
                onRowClick={(client) => {
                  const ptClient = client as PtDisplayRow;
                  openMemberTraining(
                    Number(ptClient.sessionRegisterMemberId || client.memberId),
                    ptClient.sessionRegisterAssignmentId ? Number(ptClient.sessionRegisterAssignmentId) : undefined,
                  );
                }}
              />
            </Panel>
          ) : null}
          <Panel title="General Clients">
            <ClientTable
              clients={generalClients}
              onRowClick={(client) => router.push(`/admin/members/${client.memberId}`)}
            />
          </Panel>
        </div>
      ) : null}

      {activeTab === "sessions" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard icon={Users} label="Active PT Clients" value={String(ptSessionStats.activePtClients)} />
            <StatCard icon={CalendarCheck} label="Completed Today" value={String(ptSessionStats.completedToday)} />
            <StatCard icon={Calendar} label="Completed This Week" value={String(ptSessionStats.completedThisWeek)} />
            <StatCard icon={Calendar} label="Completed This Month" value={String(ptSessionStats.completedThisMonth)} />
            <StatCard icon={Clock} label="Cancelled" value={String(ptSessionStats.cancelled)} />
            <StatCard icon={Activity} label="No Show" value={String(ptSessionStats.noShow)} />
          </div>
          <Panel title="PT Sessions">
            {sessionsLoading ? (
              <p className="text-sm text-slate-400">Loading PT sessions...</p>
            ) : sessionSummaries.length === 0 ? (
              <p className="text-sm text-slate-400">No PT sessions recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-2">Client</th>
                      <th className="px-3 py-2">Package</th>
                      <th className="px-3 py-2">Coverage</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Completed</th>
                      <th className="px-3 py-2">Pending</th>
                      <th className="px-3 py-2">Cancelled</th>
                      <th className="px-3 py-2">Member Consumed</th>
                      <th className="px-3 py-2">No Show</th>
                      <th className="px-3 py-2">Trainer Counted</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSessionSummaries.map((summary) => (
                      <tr key={`${summary.memberId}`} className="border-b border-white/5">
                        <td className="px-3 py-2 text-white">
                          <button
                            type="button"
                            className="text-left hover:underline"
                            onClick={() => router.push(`/admin/members/${summary.memberId}?tab=personal-training`)}
                          >
                            {summary.memberName}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{summary.planName}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.slotSummary}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.totalSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.completedSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.pendingSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.cancelledSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.memberConsumedSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.noShowSessions}</td>
                        <td className="px-3 py-2 text-slate-300">{summary.trainerCountedSessions}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              title="Open Session Register"
                              onClick={() => openMemberTraining(Number(summary.sessionRegisterMemberId || summary.memberId), summary.assignmentId ? Number(summary.assignmentId) : undefined)}
                              className="rounded-lg bg-[#c42429]/20 p-2 text-rose-100 hover:bg-[#c42429]/30"
                            >
                              <FileClock className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Open Session History"
                              onClick={() => setViewSessionsFor({ memberName: summary.memberName, sessions: summary.sessions })}
                              className="rounded-lg bg-white/[0.06] p-2 text-slate-200 hover:bg-white/[0.12]"
                            >
                              <History className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sessionSummaries.length > sessionPageSize ? (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
                <span>
                  Page {safeSessionPage} of {sessionTotalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSessionPage((current) => Math.max(1, current - 1))}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setSessionPage((current) => Math.min(sessionTotalPages, current + 1))}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === "attendance" ? (
        <div className="space-y-4">
          <AttendanceAccessSection
            pin={normalizePin(String(trainer?.mobile || ""))}
            devices={biometricDevices}
            enrollments={enrollments}
            logs={biometricLogs}
            actionBusy={accessBusy}
            actionError={accessActionError}
            onAction={handleAccessAction}
          />
          <Panel title="Daily Attendance Register">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <StatCard
                icon={Calendar}
                label="Total Records"
                value={String(attendanceRows.length)}
              />
              <StatCard
                icon={Users}
                label="Total Worked Minutes"
                value={String(attendanceRows.reduce((sum, row) => sum + row.workedMinutes, 0))}
              />
              <StatCard
                icon={Dumbbell}
                label="Sessions Completed"
                value={String(attendanceRows.reduce((sum, row) => sum + row.sessionsCompleted, 0))}
              />
            </div>
            {attendanceRows.length === 0 ? (
              <p className="text-sm text-slate-400">No attendance records found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Check In</th>
                      <th className="px-3 py-2">Check Out</th>
                      <th className="px-3 py-2">Worked</th>
                      <th className="px-3 py-2">Sessions</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map((row) => (
                      <tr key={row.attendanceId} className="border-b border-white/5">
                        <td className="px-3 py-2 text-slate-200">{formatDate(row.attendanceDate)}</td>
                        <td className="px-3 py-2 text-slate-300">{formatDateTime(row.clockInAt)}</td>
                        <td className="px-3 py-2 text-slate-300">{formatDateTime(row.clockOutAt)}</td>
                        <td className="px-3 py-2 text-slate-300">{row.workedMinutes}</td>
                        <td className="px-3 py-2 text-slate-300">{row.sessionsCompleted}</td>
                        <td className="px-3 py-2 text-slate-300">{row.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      <Modal
        open={Boolean(viewSessionsFor)}
        onClose={() => setViewSessionsFor(null)}
        title={viewSessionsFor ? `${viewSessionsFor.memberName} · Sessions` : "Sessions"}
        size="lg"
      >
        {viewSessionsFor && viewSessionsFor.sessions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {viewSessionsFor.sessions.map((row, index) => {
                  const record = toRecord(row);
                  return (
                    <tr key={`${pickString(record, ["id"])}-${index}`} className="border-b border-white/5">
                      <td className="px-3 py-2 text-slate-200">{pickString(record, ["sessionDate"]) || "-"}</td>
                      <td className="px-3 py-2 text-slate-300">{pickString(record, ["sessionTime"]) || "-"}</td>
                      <td className="px-3 py-2 text-slate-300">{pickString(record, ["status"]) || "SCHEDULED"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No sessions recorded.</p>
        )}
      </Modal>

      <Modal
        open={selectedScheduleSlot?.mode === "assign"}
        onClose={() => setSelectedScheduleSlot(null)}
        title="Add Slot"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
	            {selectedScheduleSlot ? (
	              <span>
	                Free slot: {formatDayLabel(selectedScheduleSlot.dayKey)} · {formatTimeDisplay(selectedScheduleSlot.startTime)} to {formatTimeDisplay(selectedScheduleSlot.endTime)}
	              </span>
	            ) : null}
          </div>
          <label className="block text-sm font-medium text-slate-700">
            Session Type
            <select
              value={slotAssignmentForm.scheduleType}
              onChange={(event) =>
                setSlotAssignmentForm((current) => ({
                  ...current,
                  scheduleType: event.target.value as "PT" | "GROUP_CLASS" | "ONBOARDING",
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="PT">Personal Training</option>
              <option value="GROUP_CLASS">Group Class</option>
              <option value="ONBOARDING">Onboarding</option>
            </select>
          </label>
          {slotAssignmentForm.scheduleType === "GROUP_CLASS" || slotAssignmentForm.scheduleType === "ONBOARDING" ? (
            <label className="block text-sm font-medium text-slate-700">
              Class Name
              <input
                value={slotAssignmentForm.className}
                onChange={(event) => setSlotAssignmentForm((current) => ({ ...current, className: event.target.value }))}
                placeholder={slotAssignmentForm.scheduleType === "ONBOARDING" ? "Onboarding" : "Kickboxing"}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              />
            </label>
          ) : (
            <label className="block text-sm font-medium text-slate-700">
              PT Client
              <select
                value={slotAssignmentForm.memberId}
                onChange={(event) => setSlotAssignmentForm((current) => ({ ...current, memberId: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">Select PT client</option>
                {assignablePtClients
                  .slice()
                  .sort((left, right) => left.memberName.localeCompare(right.memberName))
                  .map((client) => (
                    <option key={client.memberId} value={client.memberId}>
                      {client.memberName} · {client.mobile || "No mobile"}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setSelectedScheduleSlot(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitFreeSlotAssignment()}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : slotAssignmentForm.scheduleType === "PT"
                  ? "Assign PT"
                  : "Assign Class"}
          </button>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Trainer"
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input
              value={editForm.name}
              onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              value={editForm.email}
              onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Mobile
            <input
              value={editForm.mobile}
              onChange={(event) => setEditForm((current) => ({ ...current, mobile: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Emergency Contact Name
            <input
              value={editForm.emergencyContactName}
              onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Emergency Contact Number
            <input
              value={editForm.emergencyContactPhone}
              onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Date of Birth
            <input
              type="date"
              value={editForm.dateOfBirth}
              onChange={(event) => setEditForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Gender
            <select
              value={editForm.gender}
              onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Branch
            <select
              value={editForm.defaultBranchId}
              onChange={(event) => setEditForm((current) => ({ ...current, defaultBranchId: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select branch</option>
              {branches.map((branch) => {
                const value = branch.branchCode || String(branch.id);
                return (
                  <option key={branch.id} value={value}>
                    {branch.name}
                  </option>
                );
              })}
              {branches.length === 0 ? <option value={editForm.defaultBranchId}>{branchLabel}</option> : null}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Employment Type
            <select
              value={editForm.employmentType}
              onChange={(event) => setEditForm((current) => ({ ...current, employmentType: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select employment type</option>
              <option value="INTERNAL">Internal</option>
              <option value="VENDOR">Vendor</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Designation
            <select
              value={editForm.designation}
              onChange={(event) => setEditForm((current) => ({ ...current, designation: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select designation</option>
              <option value="PERSONAL_TRAINER">Personal Trainer</option>
              <option value="GENERAL_TRAINER">General Trainer</option>
              <option value="HEAD_COACH">Head Coach</option>
              <option value="YOGA_INSTRUCTOR">Yoga Instructor</option>
              <option value="ZUMBA_INSTRUCTOR">Zumba Instructor</option>
              <option value="BOXING_INSTRUCTOR">Boxing Instructor</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Experience (years)
            <input
              type="number"
              min="0"
              value={editForm.totalExperienceYears}
              onChange={(event) => setEditForm((current) => ({ ...current, totalExperienceYears: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Client Capacity
            <input
              type="number"
              min="0"
              value={editForm.maxClientCapacity}
              onChange={(event) => setEditForm((current) => ({ ...current, maxClientCapacity: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Assigned Category
            <input
              value={editForm.assignedCategory}
              onChange={(event) => setEditForm((current) => ({ ...current, assignedCategory: event.target.value }))}
              placeholder="PT, Boxing, Kickboxing"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Shift Timing
            <input
              value={editForm.shiftTimings}
              onChange={(event) => setEditForm((current) => ({ ...current, shiftTimings: event.target.value }))}
              placeholder="06:00-10:00 | 17:00-21:00"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700 md:col-span-2">
            Address
            <textarea
              value={editForm.address}
              onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setEditOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              if (!token || !trainer) return;
              setSaving(true);
              try {
                const normalizedEmploymentType: "INTERNAL" | "VENDOR" | undefined =
                  editForm.employmentType.toUpperCase() === "INTERNAL"
                    ? "INTERNAL"
                    : editForm.employmentType.toUpperCase() === "VENDOR"
                      ? "VENDOR"
                      : (trainer.employmentType as "INTERNAL" | "VENDOR" | undefined);
	                const normalizedDesignation = (editForm.designation || trainer.designation || undefined) as
	                  | string
	                  | undefined;
	                const experienceYears = editForm.totalExperienceYears.trim() ? Number(editForm.totalExperienceYears) : undefined;
	                const clientCapacity = editForm.maxClientCapacity.trim() ? Number(editForm.maxClientCapacity) : undefined;
	                const updated = await usersService.updateUser(token, trainer.id, {
	                  fullName: editForm.name || trainer.name,
	                  email: editForm.email || trainer.email,
	                  mobileNumber: editForm.mobile || trainer.mobile,
	                  role: "COACH",
	                  employmentType: normalizedEmploymentType,
	                  designation: normalizedDesignation as any,
	                  defaultBranchId: editForm.defaultBranchId || String(trainer.defaultBranchId || "CARM"),
	                  emergencyContactName: editForm.emergencyContactName || undefined,
	                  emergencyContactPhone: editForm.emergencyContactPhone || undefined,
	                  dateOfBirth: editForm.dateOfBirth || undefined,
	                  gender: editForm.gender || undefined,
	                  address: editForm.address || undefined,
	                  totalExperienceYears: experienceYears !== undefined && Number.isFinite(experienceYears) ? experienceYears : undefined,
	                  maxClientCapacity: clientCapacity !== undefined && Number.isFinite(clientCapacity) ? clientCapacity : undefined,
	                  shiftTimings: editForm.shiftTimings || undefined,
	                  assignedCategory: editForm.assignedCategory || undefined,
	                  active: trainer.active !== false,
	                });
                setTrainer(updated);
                setEditOpen(false);
              } catch (err) {
                setToast({ kind: "error", message: err instanceof Error ? err.message : "Unable to update trainer." });
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </Modal>

      <Modal
        open={selectedScheduleSlot?.mode === "session-actions"}
        onClose={() => setSelectedScheduleSlot(null)}
        title="Session Actions"
        size="sm"
      >
        <div className="space-y-4">
          {selectedScheduleSlot?.entry ? (
            <>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-sm font-semibold text-white">{formatScheduleMemberLabel(selectedScheduleSlot.entry)}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {selectedScheduleSlot.entry.couple ? "Couple Personal Training" : "Personal Training"} · {formatDayLabel(selectedScheduleSlot.dayKey)} · {formatTimeDisplay(selectedScheduleSlot.startTime)} to {formatTimeDisplay(selectedScheduleSlot.endTime)}
                </p>
              </div>
              <div className="space-y-2">
                {(buildScheduleEntryActions(selectedScheduleSlot.entry) ?? []).map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      setSelectedScheduleSlot(null);
                      action.onClick();
                    }}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold ${
                      action.tone === "danger"
                        ? "border-rose-400/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
                        : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    }`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
