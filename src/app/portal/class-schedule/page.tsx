"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { hasCapability } from "@/lib/access-policy";
import { trainingService } from "@/lib/api/services/training-service";
import { formatDateTime } from "@/lib/formatters";
import { ClassScheduleItem } from "@/types/models";

interface ToastState {
  kind: "success" | "error";
  message: string;
}

const VIEW_CAPABILITIES = [
  "CLASS_SCHEDULE_VIEW",
  "SCHEDULE_VIEW",
  "OPERATIONS_VIEW",
  "CLASS_SCHEDULE_MANAGE",
] as const;

export default function ClassSchedulePage() {
  const { token, user, accessMetadata } = useAuth();
  const canView = hasCapability(user, accessMetadata, VIEW_CAPABILITIES, true);

  const [rows, setRows] = useState<ClassScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const loadRows = useCallback(async () => {
    if (!token || !canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const schedules = await trainingService.listClassSchedules(token);
      setRows(schedules);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load class schedules";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoading(false);
    }
  }, [token, canView]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!canView) {
    return (
      <SectionCard title="Class Schedule" subtitle="Capabilities are controlled by designation metadata">
        <p className="text-sm text-slate-500">You do not have permission to view class schedules.</p>
      </SectionCard>
    );
  }

  if (loading) {
    return <PageLoader label="Loading class schedules..." />;
  }

  return (
    <div className="space-y-5">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <SectionCard
        title="Class Schedule"
        subtitle="Read-only list from /api/training/class-schedules (latest backend contract)"
        actions={
          <button
            type="button"
            onClick={() => void loadRows()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Refresh
          </button>
        }
      >
        {error ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Create, update, and delete actions are hidden because current backend contract exposes class-schedules GET only.
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-3 py-2 font-semibold">Class</th>
                <th className="px-3 py-2 font-semibold">Timing</th>
                <th className="px-3 py-2 font-semibold">Trainer</th>
                <th className="px-3 py-2 font-semibold">Occupancy</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={5}>
                    No class schedules found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">{row.className}</p>
                      {row.notes ? <p className="text-xs text-slate-500">{row.notes}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <p>{formatDateTime(row.startTime)}</p>
                      <p className="text-xs text-slate-500">to {formatDateTime(row.endTime)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p>{row.trainerName || "-"}</p>
                      <p className="text-xs text-slate-500">{row.trainerId || ""}</p>
                    </td>
                    <td className="px-3 py-3">
                      {row.occupancy}/{row.capacity}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                          row.active === false
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {row.active === false ? "INACTIVE" : "ACTIVE"}
                      </span>
                    </td>
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
