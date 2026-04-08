"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ShieldCheck, XCircle } from "lucide-react";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import {
  RenewalQueueItem,
  subscriptionService,
} from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatDateTime } from "@/lib/formatters";

interface RenewalRow extends RenewalQueueItem {
  memberName: string;
}

function toMemberLabel(memberId: string) {
  return memberId ? `Member #${memberId}` : "Unknown member";
}

export default function RenewalsPage() {
  const { token, user } = useAuth();
  const { effectiveBranchId } = useBranch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RenewalRow[]>([]);
  const [activeMembers, setActiveMembers] = useState(0);

  const loadPage = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [members, renewals, overview] = await Promise.all([
        usersService.searchUsers(token, {
          role: "MEMBER",
          defaultBranchId: effectiveBranchId ? String(effectiveBranchId) : undefined,
        }),
        subscriptionService.getRenewalsQueue(token, {
          daysAhead: 30,
        }),
        engagementService.getSalesDashboard(token, user.id, user.role),
      ]);

      const memberNameById = new Map(
        members.map((member) => [String(member.id), member.name || toMemberLabel(String(member.id))]),
      );
      const branchMemberIds = new Set(members.map((member) => String(member.id)));

      const filteredRows = renewals
        .filter((item) => branchMemberIds.size === 0 || branchMemberIds.has(item.memberId))
        .map((item) => ({
          ...item,
          memberName: memberNameById.get(item.memberId) || toMemberLabel(item.memberId),
        }))
        .sort((left, right) => left.daysRemaining - right.daysRemaining);

      setRows(filteredRows);
      setActiveMembers(overview.adminOverview.totalActiveMembers || members.length);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load renewal data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user, effectiveBranchId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const upcomingRows = useMemo(
    () => rows.filter((item) => item.daysRemaining >= 0).sort((left, right) => left.daysRemaining - right.daysRemaining),
    [rows],
  );
  const expiredRows = useMemo(
    () => rows.filter((item) => item.daysRemaining < 0).sort((left, right) => right.daysRemaining - left.daysRemaining),
    [rows],
  );
  const upcoming7 = useMemo(
    () => upcomingRows.filter((item) => item.daysRemaining <= 7).length,
    [upcomingRows],
  );

  if (loading) {
    return <PageLoader label="Loading renewals..." />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Renewals</h1>
        <p className="text-slate-400">Track members who are entering the renewal window or already expired.</p>
      </div>

      {error ? <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <article className="flex items-center gap-4 rounded-[28px] border border-amber-400/20 bg-[#211912] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-sm">
            <CalendarClock className="h-5 w-5 text-amber-200" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Renewals in Next 7 Days</p>
            <p className="text-2xl font-bold text-white">{upcoming7} Renewals</p>
          </div>
        </article>
        <article className="flex items-center gap-4 rounded-[28px] border border-rose-400/20 bg-[#1e1518] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-sm">
            <XCircle className="h-5 w-5 text-rose-200" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Currently Expired</p>
            <p className="text-2xl font-bold text-white">{expiredRows.length} Members</p>
          </div>
        </article>
        <article className="flex items-center gap-4 rounded-[28px] border border-emerald-400/20 bg-[#131d1b] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3 shadow-sm">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Active Members</p>
            <p className="text-2xl font-bold text-white">{activeMembers}</p>
          </div>
        </article>
      </div>

      <section className="space-y-6">
        <h2 className="text-lg font-bold text-white">Upcoming Renewals</h2>
        <div className="overflow-x-auto rounded-[28px] border border-white/8 bg-[#111821] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/[0.03] text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-6 py-4">Member Name</th>
                <th className="px-6 py-4">Plan</th>
                <th className="px-6 py-4">Expiry Date</th>
                <th className="px-6 py-4">Days Left</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {upcomingRows.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-400" colSpan={6}>
                    No upcoming renewals available.
                  </td>
                </tr>
              ) : (
                upcomingRows.map((item) => (
                  <tr key={`upcoming-${item.memberSubscriptionId}`} className="hover:bg-white/[0.03]">
                    <td className="px-6 py-4 text-sm font-semibold text-white">{item.memberName}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{item.variantName}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{formatDateTime(item.endDate)}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{item.daysRemaining}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {item.subscriptionStatus?.toUpperCase() === "PAUSED" ? "Frozen" : item.subscriptionStatus}
                      {item.paymentConfirmed ? " · Paid" : " · Pending"}
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href="/portal/billing"
                        className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        Open Billing
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-bold text-white">Expired Members</h2>
        <div className="overflow-x-auto rounded-[28px] border border-white/8 bg-[#111821] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/[0.03] text-xs font-semibold tracking-wide text-slate-400 uppercase">
                <th className="px-6 py-4">Member Name</th>
                <th className="px-6 py-4">Plan</th>
                <th className="px-6 py-4">Expired On</th>
                <th className="px-6 py-4">Days Overdue</th>
                <th className="px-6 py-4">Payment</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {expiredRows.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-sm text-slate-400" colSpan={6}>
                    No expired members available.
                  </td>
                </tr>
              ) : (
                expiredRows.map((item) => (
                  <tr key={`expired-${item.memberSubscriptionId}`} className="hover:bg-white/[0.03]">
                    <td className="px-6 py-4 text-sm font-semibold text-white">{item.memberName}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{item.variantName}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{formatDateTime(item.endDate)}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{Math.abs(item.daysRemaining)}</td>
                    <td className="px-6 py-4 text-sm text-slate-300">{item.paymentConfirmed ? "Settled" : "Pending"}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <Link
                          href="/portal/billing"
                          className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                        >
                          Renew Now
                        </Link>
                        <Link
                          href="/portal/follow-ups"
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                        >
                          Follow Up
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
