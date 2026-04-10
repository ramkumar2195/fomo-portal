"use client";

import { BiometricAttendanceLogRecord, BiometricDeviceRecord, MemberBiometricEnrollmentRecord } from "@/lib/api/services/engagement-service";

interface AttendanceAccessSectionProps {
  pin: string;
  devices: BiometricDeviceRecord[];
  enrollments: MemberBiometricEnrollmentRecord[];
  logs: BiometricAttendanceLogRecord[];
  actionBusy: boolean;
  actionError?: string | null;
  onAction: (action: "ADD_USER" | "RE_ADD_USER" | "BLOCK_USER" | "UNBLOCK_USER" | "DELETE_USER", serial: string) => void;
}

function normalizeEnrollmentStatus(value?: string): "NOT_ADDED" | "PENDING" | "ENROLLED" | "BLOCKED" | "DELETED" | "FAILED" {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === "PENDING" ||
    normalized === "ENROLLED" ||
    normalized === "BLOCKED" ||
    normalized === "DELETED" ||
    normalized === "FAILED"
  ) {
    return normalized;
  }
  return "NOT_ADDED";
}

function accessEnrollmentLabel(value?: string): string {
  const normalized = normalizeEnrollmentStatus(value);
  if (normalized === "ENROLLED") return "Enrolled";
  if (normalized === "BLOCKED") return "Blocked";
  if (normalized === "PENDING") return "Pending";
  if (normalized === "FAILED") return "Failed";
  return "Not Enrolled";
}

function accessEnrollmentTone(value?: string): string {
  const normalized = normalizeEnrollmentStatus(value);
  if (normalized === "ENROLLED") return "border-emerald-400/30 bg-emerald-500/15 text-emerald-200";
  if (normalized === "BLOCKED") return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  if (normalized === "PENDING") return "border-amber-400/30 bg-amber-500/15 text-amber-200";
  if (normalized === "FAILED") return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  return "border-white/10 bg-white/[0.06] text-slate-300";
}

function isBiometricDeviceOnline(device: BiometricDeviceRecord): boolean {
  const status = String(device.status || "").trim().toUpperCase();
  return status.includes("ONLINE") || status.includes("CONNECTED") || status.includes("ACTIVE");
}

function biometricDeviceStatusLabel(device: BiometricDeviceRecord): string {
  return isBiometricDeviceOnline(device) ? "Online" : "Offline";
}

function biometricDeviceStatusTone(device: BiometricDeviceRecord): string {
  return isBiometricDeviceOnline(device) ? "text-emerald-300" : "text-slate-500";
}

function isRealBiometricDevice(device: BiometricDeviceRecord): boolean {
  const serial = String(device.serialNumber || "").trim().toUpperCase();
  return Boolean(serial) && !serial.startsWith("TEST");
}

function friendlyBiometricDeviceName(device: BiometricDeviceRecord, index: number): string {
  const configuredName = String(device.deviceName || "").trim();
  if (configuredName) return configuredName;
  const serial = String(device.serialNumber || "").trim();
  const fallbackNames = ["Main Entrance - Two", "Main Entrance - One"];
  return fallbackNames[index] || (serial ? `ESSL Device ${index + 1}` : `ESSL Device ${index + 1}`);
}

function deriveOverallDeviceAccessStatus(statuses: string[]): string {
  const normalized = statuses.map((value) => normalizeEnrollmentStatus(value));
  const enrolledCount = normalized.filter((value) => value === "ENROLLED").length;
  const blockedCount = normalized.filter((value) => value === "BLOCKED").length;
  const pendingCount = normalized.filter((value) => value === "PENDING").length;
  const failedCount = normalized.filter((value) => value === "FAILED").length;
  const totalTracked = normalized.filter((value) => value !== "NOT_ADDED" && value !== "DELETED").length;

  if (failedCount > 0) return "Failed";
  if (pendingCount > 0) return "Pending";
  if (normalized.length > 0 && blockedCount === normalized.length) return "Blocked";
  if (enrolledCount === 0 && totalTracked === 0) return "Not Added";
  if (enrolledCount === normalized.length && normalized.length > 0) return "Added";
  return "Partially Added";
}

function formatLocalDateTimeParts(value?: string): { dateLabel: string; timeLabel: string } {
  if (!value) {
    return { dateLabel: "-", timeLabel: "-" };
  }
  const normalized = value.trim().replace("T", " ");
  const [datePart = "", timePart = ""] = normalized.split(" ");
  const [year, month, day] = datePart.split("-").map((part) => Number(part));
  if (year && month && day) {
    const localDate = new Date(year, month - 1, day);
    const dateLabel = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(localDate);
    const timeLabel = timePart ? timePart.slice(0, 5) : "-";
    return { dateLabel, timeLabel };
  }
  return { dateLabel: value, timeLabel: "-" };
}

function attendanceEventLabel(entry: BiometricAttendanceLogRecord): string {
  const direction = String(entry.direction || "").trim().toUpperCase();
  const punchStatus = String(entry.punchStatus || "").trim().toUpperCase();
  if (direction.includes("OUT") || punchStatus.includes("OUT")) return "Check-out";
  if (direction.includes("IN") || punchStatus.includes("IN") || punchStatus === "255") return "Check-in";
  return "Access";
}

function attendanceEventTone(label: string): string {
  const normalized = label.toUpperCase();
  if (normalized.includes("OUT")) return "text-amber-300";
  if (normalized.includes("IN")) return "text-emerald-300";
  return "text-slate-200";
}

function attendanceRecordStatusTone(label: string): string {
  const normalized = label.toUpperCase();
  if (normalized.includes("SUCCESS") || normalized.includes("RECORDED")) return "text-emerald-300";
  if (normalized.includes("FAILED")) return "text-rose-300";
  return "text-slate-300";
}

export function AttendanceAccessSection({
  pin,
  devices,
  enrollments,
  logs,
  actionBusy,
  actionError,
  onAction,
}: AttendanceAccessSectionProps) {
  const availableDevices = devices.filter((device) => isRealBiometricDevice(device));
  const onlineDevices = availableDevices.filter((device) => isBiometricDeviceOnline(device));
  const enrollmentByDeviceSerial = new Map(
    enrollments.map((enrollment) => [String(enrollment.deviceSerialNumber || ""), enrollment]),
  );
  const overallStatus = deriveOverallDeviceAccessStatus(
    availableDevices.map((device) => enrollmentByDeviceSerial.get(String(device.serialNumber || ""))?.status || "NOT_ADDED"),
  );

  const attendanceRows = logs
    .map((entry, index) => {
      const device = availableDevices.find((item) => item.serialNumber === entry.deviceSerialNumber);
      const { dateLabel, timeLabel } = formatLocalDateTimeParts(entry.punchTimestamp);
      return {
        id: entry.id || `${entry.deviceSerialNumber || "device"}-${entry.punchTimestamp || index}`,
        dateLabel,
        timeLabel,
        deviceLabel: device ? friendlyBiometricDeviceName(device, availableDevices.indexOf(device)) : String(entry.deviceSerialNumber || "ESSL Device"),
        eventLabel: attendanceEventLabel(entry),
        statusLabel: entry.processed ? "Recorded" : "Success",
      };
    })
    .sort((left, right) => `${right.dateLabel} ${right.timeLabel}`.localeCompare(`${left.dateLabel} ${left.timeLabel}`));

  return (
    <div className="space-y-6">
      {actionError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Access Status", value: overallStatus },
          { label: "Biometric PIN", value: pin || "-" },
          { label: "Total Check-ins", value: String(attendanceRows.length) },
          { label: "Devices", value: String(availableDevices.length) },
        ].map((entry) => (
          <div key={entry.label} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{entry.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
        <h2 className="text-lg font-bold text-white">Manage Access Devices</h2>
        <p className="mt-1 text-sm text-slate-400">{onlineDevices.length} control point{onlineDevices.length === 1 ? "" : "s"} online</p>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          {availableDevices.length ? (
            availableDevices.map((device, index) => {
              const serial = String(device.serialNumber || "");
              const enrollment = enrollmentByDeviceSerial.get(serial);
              const deviceEnrollmentStatus = enrollment?.status || "NOT_ADDED";
              const normalizedEnrollmentStatus = normalizeEnrollmentStatus(deviceEnrollmentStatus);
              const showAddAction = normalizedEnrollmentStatus === "NOT_ADDED" || normalizedEnrollmentStatus === "DELETED" || normalizedEnrollmentStatus === "FAILED";
              const showBlockAction = normalizedEnrollmentStatus === "ENROLLED";
              const showUnblockAction = normalizedEnrollmentStatus === "BLOCKED";
              const showReAddAction = normalizedEnrollmentStatus !== "PENDING";
              return (
                <div key={serial || index} className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{friendlyBiometricDeviceName(device, index)}</h3>
                      <p className="mt-1 text-sm text-slate-400">{serial || "Serial not available"}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${accessEnrollmentTone(deviceEnrollmentStatus)}`}>
                      {accessEnrollmentLabel(deviceEnrollmentStatus)}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${isBiometricDeviceOnline(device) ? "bg-emerald-400" : "bg-slate-500"}`} />
                    <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${biometricDeviceStatusTone(device)}`}>{biometricDeviceStatusLabel(device)}</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {showAddAction ? (
                      <button type="button" onClick={() => onAction("ADD_USER", serial)} disabled={actionBusy || !serial} className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50">
                        {actionBusy ? "Working..." : "Add User"}
                      </button>
                    ) : null}
                    {showReAddAction ? (
                      <button type="button" onClick={() => onAction("RE_ADD_USER", serial)} disabled={actionBusy || !serial} className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50">
                        {actionBusy ? "Working..." : "Re-add"}
                      </button>
                    ) : null}
                    {showBlockAction ? (
                      <button type="button" onClick={() => onAction("BLOCK_USER", serial)} disabled={actionBusy || !serial} className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50">
                        {actionBusy ? "Working..." : "Block"}
                      </button>
                    ) : null}
                    {showUnblockAction ? (
                      <button type="button" onClick={() => onAction("UNBLOCK_USER", serial)} disabled={actionBusy || !serial} className="rounded-xl bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50">
                        {actionBusy ? "Working..." : "Unblock"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => onAction("DELETE_USER", serial)} disabled={actionBusy || !serial} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.06] disabled:opacity-50">
                      {actionBusy ? "Working..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center text-sm text-slate-400">
              No biometric devices are available for this branch yet.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
        <h2 className="text-lg font-bold text-white">Attendance Logs</h2>
        <p className="mt-1 text-sm text-slate-400">Recent access records recorded from the biometric devices</p>
        <div className="mt-4 overflow-hidden rounded-[24px] border border-white/8 bg-[#0f1726]">
          <div className="grid grid-cols-[1.15fr_0.9fr_1.2fr_1fr_0.9fr] gap-3 border-b border-white/8 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span>Date</span>
            <span>Time</span>
            <span>Device</span>
            <span>Event Type</span>
            <span>Status</span>
          </div>
          {attendanceRows.length ? (
            attendanceRows.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[1.15fr_0.9fr_1.2fr_1fr_0.9fr] gap-3 border-b border-white/6 px-5 py-4 text-sm last:border-b-0">
                <span className="font-medium text-white">{entry.dateLabel}</span>
                <span className="text-slate-300">{entry.timeLabel}</span>
                <span className="text-slate-200">{entry.deviceLabel}</span>
                <span className={`font-semibold ${attendanceEventTone(entry.eventLabel)}`}>{entry.eventLabel}</span>
                <span className={`font-semibold ${attendanceRecordStatusTone(entry.statusLabel)}`}>{entry.statusLabel}</span>
              </div>
            ))
          ) : (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No attendance logs are available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
