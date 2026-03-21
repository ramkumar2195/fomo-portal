"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { DataTable } from "@/components/common/data-table";
import { Badge } from "@/components/common/badge";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import {
  AttendanceReportSnapshot,
  engagementService,
} from "@/lib/api/services/engagement-service";
import { formatDateTime } from "@/lib/formatters";

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "-";
}

function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function resolveGymId(selectedBranchId?: string, defaultBranchId?: string): number | null {
  const candidate = selectedBranchId && selectedBranchId !== "default"
    ? selectedBranchId
    : defaultBranchId && defaultBranchId !== "default"
      ? defaultBranchId
      : "";
  if (!candidate) {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function TrainerAttendancePage() {
  const { token, user } = useAuth();
  const { selectedBranchId } = useBranch();
  const [rows, setRows] = useState<Row[]>([]);
  const [report, setReport] = useState<AttendanceReportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<"today" | "report">("today");
  const [reportRange, setReportRange] = useState<{ from: string; to: string }>({ from: "", to: "" });

  const loadTodayAttendance = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await engagementService.getTodayAttendance(token);
      setRows(response as Row[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load attendance");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadTodayAttendance();
  }, [loadTodayAttendance]);

  const handleScan = async () => {
    if (!token || !scanCode.trim()) return;
    setScanning(true);
    try {
      const gymId = resolveGymId(selectedBranchId, user?.defaultBranchId);
      const staffId = Number(user?.id || "0");
      if (!gymId || !staffId) {
        throw new Error("Missing branch or staff context for attendance scan.");
      }
      await engagementService.scanQrAttendance(token, { token: scanCode.trim(), gymId, staffId });
      setToast({ kind: "success", message: "Check-in recorded!" });
      setScanCode("");
      void loadTodayAttendance();
    } catch (scanError) {
      setToast({
        kind: "error",
        message: scanError instanceof Error ? scanError.message : "Scan failed. Invalid code or already checked in.",
      });
    } finally {
      setScanning(false);
    }
  };

  const handleCheckout = async (checkInId: number) => {
    if (!token) return;
    try {
      const staffId = Number(user?.id || "0");
      if (!staffId) {
        throw new Error("Missing staff context for checkout.");
      }
      await engagementService.checkoutAttendance(token, checkInId, { staffId });
      setToast({ kind: "success", message: "Checked out successfully" });
      void loadTodayAttendance();
    } catch (checkoutError) {
      setToast({
        kind: "error",
        message: checkoutError instanceof Error ? checkoutError.message : "Checkout failed",
      });
    }
  };

  const loadReport = async () => {
    if (!token) return;
    try {
      const gymId = resolveGymId(selectedBranchId, user?.defaultBranchId);
      const data = await engagementService.getAttendanceReport(token, {
        ...reportRange,
        ...(gymId ? { gymId } : {}),
      });
      setReport(data);
    } catch (reportError) {
      setToast({
        kind: "error",
        message: reportError instanceof Error ? reportError.message : "Failed to load attendance report",
      });
    }
  };

  if (loading) return <PageLoader label="Loading attendance..." />;

  return (
    <div className="space-y-8 pb-12">
      {toast && (
        <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PT Session Check-In</h1>
          <p className="text-gray-500">Scan member QR to record PT session attendance. Gym entry uses ESSL biometric.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTodayAttendance()}
          className="inline-flex rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* QR Scan Section */}
      <SectionCard title="QR Check-In" subtitle="Scan member QR code to record PT session attendance">
        <div className="flex gap-3">
          <input
            type="text"
            value={scanCode}
            onChange={(e) => setScanCode(e.target.value)}
            placeholder="Scan or paste QR token..."
            className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleScan();
            }}
          />
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning || !scanCode.trim()}
            className="rounded-xl bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {scanning ? "Scanning..." : "Check In"}
          </button>
        </div>
      </SectionCard>

      {/* Tab Toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("today")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            activeTab === "today" ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Today&apos;s Attendance
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("report")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            activeTab === "report" ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Attendance Report
        </button>
      </div>

      {activeTab === "today" && (
        <SectionCard title="Today&apos;s Check-Ins">
          <DataTable<Row>
            columns={[
              { key: "member", header: "Member", render: (r) => str(r, "memberName", "name", "member") },
              {
                key: "checkIn",
                header: "Check-In",
                render: (r) => formatDateTime(str(r, "checkInAt", "entryTime", "createdAt")),
              },
              {
                key: "checkOut",
                header: "Check-Out",
                render: (r) => {
                  const v = str(r, "checkOutAt", "exitTime");
                  return v !== "-" ? formatDateTime(v) : <Badge variant="warning">Active</Badge>;
                },
              },
              {
                key: "actions",
                header: "Action",
                render: (r) => {
                  const checkOutVal = str(r, "checkOutAt", "exitTime");
                  const checkInId = num(r, "id", "checkInId");
                  if (checkOutVal !== "-" || checkInId === 0) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => void handleCheckout(checkInId)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                      Checkout
                    </button>
                  );
                },
              },
            ]}
            data={rows}
            keyExtractor={(r) => str(r, "id", "checkInId", "memberName")}
            emptyMessage="No attendance records today."
          />
        </SectionCard>
      )}

      {activeTab === "report" && (
        <SectionCard title="Attendance Report">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">From</label>
              <input
                type="date"
                value={reportRange.from}
                onChange={(e) => setReportRange((p) => ({ ...p, from: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">To</label>
              <input
                type="date"
                value={reportRange.to}
                onChange={(e) => setReportRange((p) => ({ ...p, to: e.target.value }))}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadReport()}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Load Report
            </button>
          </div>
          {report ? (
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Total Check-Ins</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{report.totalCheckIns}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Total Check-Outs</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{report.totalCheckOuts}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Currently Inside</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{report.currentlyInside}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">Unique Members</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{report.uniqueMembers}</p>
              </div>
            </div>
          ) : null}
          <DataTable<Row>
            columns={[
              { key: "member", header: "Member", render: (r) => str(r, "memberName", "name") },
              { key: "date", header: "Date", render: (r) => str(r, "date", "checkInDate") },
              { key: "checkIn", header: "Check-In", render: (r) => formatDateTime(str(r, "checkInAt", "entryTime")) },
              { key: "checkOut", header: "Check-Out", render: (r) => formatDateTime(str(r, "checkOutAt", "exitTime")) },
              { key: "duration", header: "Duration", render: (r) => str(r, "duration", "timeSpent", "durationMinutes") },
            ]}
            data={report?.records || []}
            keyExtractor={(r) => str(r, "id", "checkInId", "memberName") + str(r, "date", "checkInAt")}
            emptyMessage="Select a date range and click 'Load Report' to view attendance data."
          />
        </SectionCard>
      )}
    </div>
  );
}
