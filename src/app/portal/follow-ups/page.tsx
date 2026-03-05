"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { formatDateTime } from "@/lib/formatters";
import { resolveStaffId } from "@/lib/staff-id";
import { FollowUpRecord } from "@/types/follow-up";

function formatDateOnly(value: string): string {
  return value.slice(0, 10);
}

function statusClass(status: string): string {
  if (status === "SCHEDULED") {
    return "bg-blue-50 text-blue-700 border-blue-100";
  }
  if (status === "COMPLETED") {
    return "bg-green-50 text-green-700 border-green-100";
  }
  if (status === "MISSED") {
    return "bg-amber-50 text-amber-700 border-amber-100";
  }

  return "bg-rose-50 text-rose-700 border-rose-100";
}

export default function FollowUpsPage() {
  const { token, user } = useAuth();
  const [queue, setQueue] = useState<FollowUpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadQueue = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const staffId = resolveStaffId(user);
      const list = await subscriptionFollowUpService.searchFollowUpQueue(token, {
        assignedToStaffId: staffId || undefined,
      });
      setQueue(list);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load follow-up queue";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const counts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = queue.filter((item) => item.dueAt.slice(0, 10) === today && item.status === "SCHEDULED").length;
    const overdueCount = queue.filter((item) => item.overdue && item.status === "SCHEDULED").length;
    const upcomingCount = queue.filter((item) => item.dueAt.slice(0, 10) > today && item.status === "SCHEDULED").length;

    return { todayCount, overdueCount, upcomingCount };
  }, [queue]);

  const completeFollowUp = async (followUp: FollowUpRecord) => {
    if (!token) {
      return;
    }

    const staffId = resolveStaffId(user);
    if (staffId === null) {
      setError("Numeric staff ID is required to complete follow-ups.");
      return;
    }

    setSavingId(followUp.followUpId);
    try {
      const updated = await subscriptionFollowUpService.completeFollowUp(token, followUp.followUpId, {
        completedByStaffId: staffId,
      });
      setQueue((prev) => prev.map((item) => (item.followUpId === updated.followUpId ? updated : item)));
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Unable to complete follow-up";
      setError(message);
    } finally {
      setSavingId(null);
    }
  };

  const markStatus = async (followUp: FollowUpRecord, status: "MISSED" | "CANCELLED") => {
    if (!token) {
      return;
    }

    setSavingId(followUp.followUpId);
    try {
      const updated = await subscriptionFollowUpService.updateFollowUp(token, followUp.followUpId, { status });
      setQueue((prev) => prev.map((item) => (item.followUpId === updated.followUpId ? updated : item)));
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : `Unable to mark ${status.toLowerCase()}`;
      setError(message);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <PageLoader label="Loading follow-ups..." />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Follow-up Management</h1>
        <p className="text-gray-500">Track and manage communications with leads and members.</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <article className="rounded-2xl border border-blue-100 bg-blue-50 p-6">
          <p className="text-sm font-semibold text-blue-800">Today&apos;s Follow-ups</p>
          <p className="mt-1 text-3xl font-bold text-blue-900">{counts.todayCount}</p>
          <p className="mt-1 text-xs text-blue-700">Due today</p>
        </article>
        <article className="rounded-2xl border border-red-100 bg-red-50 p-6">
          <p className="text-sm font-semibold text-red-800">Overdue Follow-ups</p>
          <p className="mt-1 text-3xl font-bold text-red-900">{counts.overdueCount}</p>
          <p className="mt-1 text-xs text-red-700">Needs urgent attention</p>
        </article>
        <article className="rounded-2xl border border-emerald-100 bg-emerald-50 p-6">
          <p className="text-sm font-semibold text-emerald-800">Upcoming Follow-ups</p>
          <p className="mt-1 text-3xl font-bold text-emerald-900">{counts.upcomingCount}</p>
          <p className="mt-1 text-xs text-emerald-700">Scheduled ahead</p>
        </article>
      </div>

      <SectionCard
        title="Scheduled Follow-ups"
        actions={
          <button
            type="button"
            onClick={() => void loadQueue()}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        }
      >
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">No follow-ups found.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {queue.map((item) => {
              const busy = savingId === item.followUpId;
              return (
                <article key={item.followUpId} className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900">Inquiry #{item.inquiryId}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(item.status)}`}>
                        {item.status}
                      </span>
                      {item.overdue ? (
                        <span className="rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                          Overdue
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-600">{item.notes || item.customMessage || "No notes available."}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Channel: {item.channel} • Due: {formatDateTime(item.dueAt)} ({formatDateOnly(item.dueAt)})
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || item.status === "COMPLETED"}
                      onClick={() => void completeFollowUp(item)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      disabled={busy || item.status === "MISSED"}
                      onClick={() => void markStatus(item, "MISSED")}
                      className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Mark Missed
                    </button>
                    <button
                      type="button"
                      disabled={busy || item.status === "CANCELLED"}
                      onClick={() => void markStatus(item, "CANCELLED")}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
