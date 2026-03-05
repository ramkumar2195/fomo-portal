"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { formatDateTime } from "@/lib/formatters";

interface AttendanceRow {
  id: string;
  memberName: string;
  checkInAt?: string;
  checkOutAt?: string;
}

type JsonRecord = Record<string, unknown>;

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function getString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

function mapTodayAttendance(payload: unknown[]): AttendanceRow[] {
  return payload.map((item, index) => {
    const record = toRecord(item);
    return {
      id: getString(record, ["id", "checkInId"]) || `attendance-${index}`,
      memberName: getString(record, ["memberName", "name"]) || "-",
      checkInAt: getString(record, ["checkInAt", "entryTime", "createdAt"]) || undefined,
      checkOutAt: getString(record, ["checkOutAt", "exitTime", "updatedAt"]) || undefined,
    };
  });
}

export default function TrainerAttendancePage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTodayAttendance = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await engagementService.getTodayAttendance(token);
      setRows(mapTodayAttendance(response));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load attendance";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadTodayAttendance();
  }, [loadTodayAttendance]);

  if (loading) {
    return <PageLoader label="Loading attendance..." />;
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Trainer Attendance" subtitle="Placeholder until trainer attendance endpoints are available">
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Current backend exposes member attendance endpoints, not trainer attendance create/update endpoints. This
          section remains read-only for now.
        </p>
      </SectionCard>

      <SectionCard
        title="Today Attendance (Members)"
        actions={
          <button
            type="button"
            onClick={() => void loadTodayAttendance()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Refresh
          </button>
        }
      >
        {error ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2 font-semibold">Member</th>
                <th className="px-2 py-2 font-semibold">Check-in</th>
                <th className="px-2 py-2 font-semibold">Check-out</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-slate-500" colSpan={3}>
                    No attendance records today
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-2 py-3 font-medium text-slate-900">{row.memberName}</td>
                    <td className="px-2 py-3">{formatDateTime(row.checkInAt)}</td>
                    <td className="px-2 py-3">{formatDateTime(row.checkOutAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
