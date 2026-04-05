"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, MessageCircle, PhoneCall } from "lucide-react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { formatDateTime } from "@/lib/formatters";
import { formatInquiryCode } from "@/lib/inquiry-code";
import { resolveStaffId } from "@/lib/staff-id";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { FollowUpRecord } from "@/types/follow-up";
import { InquiryRecord } from "@/types/inquiry";

function getFollowUpSourceType(item: FollowUpRecord): "MEMBER" | "INQUIRY" {
  return item.memberId ? "MEMBER" : "INQUIRY";
}

function getPriority(dueAt: string, overdue: boolean): "HIGH" | "MEDIUM" | "LOW" {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return "MEDIUM";
  }

  const now = new Date();
  if (overdue || dueDate.getTime() <= now.getTime()) {
    return "HIGH";
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const dueStart = new Date(dueDate);
  dueStart.setHours(0, 0, 0, 0);

  if (dueStart.getTime() === todayStart.getTime() || dueStart.getTime() === tomorrowStart.getTime()) {
    return "MEDIUM";
  }

  if (dueStart.getTime() > tomorrowStart.getTime()) {
    return "LOW";
  }

  return "HIGH";
}

function priorityClass(priority: "HIGH" | "MEDIUM" | "LOW"): string {
  if (priority === "HIGH") {
    return "bg-red-600 text-white";
  }
  if (priority === "MEDIUM") {
    return "bg-amber-500 text-white";
  }
  return "bg-slate-400 text-white";
}

function typeClass(type: "MEMBER" | "INQUIRY"): string {
  if (type === "MEMBER") {
    return "bg-emerald-50 text-emerald-700";
  }
  return "bg-blue-50 text-blue-700";
}

function humanizeChannel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getRequirement(item: FollowUpRecord, inquiry?: InquiryRecord): string {
  const fromNotes = (item.notes || "").trim();
  const fromInquiryComment = (inquiry?.followUpComment || "").trim();
  const fromInquiryRemarks = (inquiry?.remarks || "").trim();

  return fromNotes || fromInquiryComment || fromInquiryRemarks || "No requirement added.";
}

function getWhatsAppMessage(item: FollowUpRecord, inquiry?: InquiryRecord): string {
  const requirement = getRequirement(item, inquiry);
  return requirement;
}

function toWhatsAppPhoneNumber(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }

  return digits;
}

export default function FollowUpsPage() {
  const { token, user } = useAuth();
  const { selectedBranchCode, effectiveBranchId } = useBranch();
  const [queue, setQueue] = useState<FollowUpRecord[]>([]);
  const [inquiriesById, setInquiriesById] = useState<Record<number, InquiryRecord>>({});
  const [queueScope, setQueueScope] = useState<"BRANCH" | "MINE">("BRANCH");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [counts, setCounts] = useState({
    todayCount: 0,
    overdueCount: 0,
    upcomingCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const pageSize = 10;

  const loadQueue = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const staffId = resolveStaffId(user);
      const branchScopedQuery = { branchId: effectiveBranchId, branchCode: selectedBranchCode || undefined };
      const queueBaseQuery =
        queueScope === "MINE" && staffId
          ? {
              ...branchScopedQuery,
              assignedToStaffId: staffId,
            }
          : branchScopedQuery;

      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      const [queuePage, todayPage, overduePage, upcomingPage] = await Promise.all([
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            ...queueBaseQuery,
            status: "SCHEDULED",
          },
          Math.max(0, currentPage - 1),
          pageSize,
        ),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            ...queueBaseQuery,
            status: "SCHEDULED",
            dueFrom: startOfToday.toISOString(),
            dueTo: endOfToday.toISOString(),
          },
          0,
          1,
        ),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            ...queueBaseQuery,
            status: "SCHEDULED",
            overdueOnly: true,
          },
          0,
          1,
        ),
        subscriptionFollowUpService.searchFollowUpQueuePaged(
          token,
          {
            ...queueBaseQuery,
            status: "SCHEDULED",
            dueFrom: startOfTomorrow.toISOString(),
          },
          0,
          1,
        ),
      ]);

      const inquiryIndex: Record<number, InquiryRecord> = {};
      let inquiryPage = 0;
      const inquiryPageSize = 200;

      while (true) {
        const inquiriesPage = await subscriptionService.searchInquiriesPaged(token, {}, inquiryPage, inquiryPageSize);
        for (const inquiry of inquiriesPage.content) {
          inquiryIndex[inquiry.inquiryId] = inquiry;
        }

        if (inquiriesPage.last || inquiryPage >= inquiriesPage.totalPages - 1) {
          break;
        }

        inquiryPage += 1;
      }

      setInquiriesById(inquiryIndex);
      setQueue(queuePage.content);
      setCurrentPage(queuePage.number + 1);
      setTotalPages(Math.max(queuePage.totalPages, 1));
      setTotalRows(queuePage.totalElements);
      setCounts({
        todayCount: todayPage.totalElements,
        overdueCount: overduePage.totalElements,
        upcomingCount: upcomingPage.totalElements,
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load follow-up queue";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user, currentPage, selectedBranchCode, effectiveBranchId, queueScope]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [queueScope]);

  const scheduledQueue = useMemo(
    () =>
      queue
        .filter((item) => item.status === "SCHEDULED")
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [queue],
  );

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
      await subscriptionFollowUpService.completeFollowUp(token, followUp.followUpId, {
        completedByStaffId: staffId,
      });
      await loadQueue();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Unable to complete follow-up";
      setError(message);
    } finally {
      setSavingId(null);
    }
  };

  const onCallNow = (inquiry?: InquiryRecord) => {
    const mobile = inquiry?.mobileNumber?.trim();
    if (!mobile) {
      setError("Mobile number missing for this follow-up.");
      return;
    }

    const sanitized = mobile.replace(/[^0-9]/g, "");
    if (!sanitized) {
      setError("Mobile number is invalid.");
      return;
    }

    window.open(`tel:${sanitized}`, "_self");
  };

  const onMessage = (item: FollowUpRecord, inquiry?: InquiryRecord) => {
    const mobile = inquiry?.mobileNumber?.trim();
    if (!mobile) {
      setError("Mobile number missing for this follow-up.");
      return;
    }

    const sanitized = toWhatsAppPhoneNumber(mobile);
    const message = getWhatsAppMessage(item, inquiry);
    window.open(`https://wa.me/${sanitized}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <PageLoader label="Loading follow-ups..." />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Follow-up Management</h1>
        <p className="text-slate-400">Track and manage communications with leads and members.</p>
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
        subtitle="Live queue from follow-up APIs"
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {[
                { value: "BRANCH", label: "Branch Queue" },
                { value: "MINE", label: "My Queue" },
              ].map((option) => {
                const active = queueScope === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setQueueScope(option.value as "BRANCH" | "MINE")}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? "bg-[#c42924] text-white"
                        : "text-slate-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void loadQueue()}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Refresh
            </button>
          </div>
        }
      >
        <p className="mb-4 text-xs text-slate-400">
          {queueScope === "BRANCH"
            ? "Showing all scheduled follow-ups for the selected branch, including balance-due reminders."
            : "Showing only follow-ups currently assigned to your staff account."}
        </p>
        {scheduledQueue.length === 0 ? (
          <p className="text-sm text-gray-500">No follow-ups found.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {scheduledQueue.map((item) => {
              const inquiry = inquiriesById[item.inquiryId];
              const sourceType = getFollowUpSourceType(item);
              const priority = getPriority(item.dueAt, item.overdue);
              const requirement = getRequirement(item, inquiry);
              const clientName = inquiry?.fullName || "Unnamed Client";
              const busy = savingId === item.followUpId;
              const canContact = Boolean(inquiry?.mobileNumber?.trim());
              return (
                <article
                  key={item.followUpId}
                  className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900">{clientName}</p>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${typeClass(sourceType)}`}>
                        {sourceType}
                      </span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${priorityClass(priority)}`}>
                        {priority} PRIORITY
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-slate-600 uppercase">
                        {formatInquiryCode(item.inquiryId, {
                          branchCode: selectedBranchCode,
                          createdAt: item.createdAt,
                        })}
                      </span>
                      {item.overdue ? (
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-rose-700 uppercase">
                          Overdue
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-600">{requirement}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Scheduled for {formatDateTime(item.dueAt)} • Channel: {humanizeChannel(item.channel)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canContact}
                      onClick={() => onCallNow(inquiry)}
                      className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      <PhoneCall className="h-4 w-4" aria-hidden="true" />
                      Call Now
                    </button>
                    <button
                      type="button"
                      disabled={!canContact}
                      onClick={() => onMessage(item, inquiry)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void completeFollowUp(item)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {(currentPage - 1) * pageSize + (scheduledQueue.length > 0 ? 1 : 0)}-
            {(currentPage - 1) * pageSize + scheduledQueue.length} of {totalRows}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs font-semibold text-slate-600">
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
