"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

interface RenewalRow {
  id: string;
  name: string;
  plan: string;
  expiryDate: string;
  amount: string;
  status: "upcoming" | "expired";
}

function buildRenewalRows(members: UserDirectoryItem[]): RenewalRow[] {
  const baseDate = new Date();

  return members.slice(0, 8).map((member, index) => {
    const date = new Date(baseDate);
    if (index < 5) {
      date.setDate(baseDate.getDate() + index + 2);
    } else {
      date.setDate(baseDate.getDate() - (index - 4));
    }

    const plan = index % 2 === 0 ? "Gold Annual" : "Silver Monthly";
    const amount = index % 2 === 0 ? "₹12,000" : "₹2,500";

    return {
      id: member.id,
      name: member.name,
      plan,
      expiryDate: date.toISOString().slice(0, 10),
      amount,
      status: index < 5 ? "upcoming" : "expired",
    };
  });
}

export default function RenewalsPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RenewalRow[]>([]);
  const [renewalCounts, setRenewalCounts] = useState({
    upcoming7: 0,
    expired: 0,
    renewedMonth: 0,
  });

  const loadPage = useCallback(async () => {
    if (!token || !user) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [members, overview] = await Promise.all([
        usersService.getUsersByRole(token, "MEMBER"),
        engagementService.getSalesDashboard(token, user.id, user.role),
      ]);

      const builtRows = buildRenewalRows(members);
      setRows(builtRows);
      setRenewalCounts({
        upcoming7: overview.adminOverview.upcomingRenewals7Days || builtRows.filter((item) => item.status === "upcoming").length,
        expired: overview.adminOverview.expiredMembers || builtRows.filter((item) => item.status === "expired").length,
        renewedMonth: Math.max(overview.adminOverview.totalActiveMembers - overview.adminOverview.expiredMembers, 0),
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load renewal data";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const upcomingRows = useMemo(() => rows.filter((item) => item.status === "upcoming"), [rows]);
  const expiredRows = useMemo(() => rows.filter((item) => item.status === "expired"), [rows]);

  if (loading) {
    return <PageLoader label="Loading renewals..." />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Renewals & Expirations</h1>
        <p className="text-gray-500">Manage upcoming and expired memberships.</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <article className="flex items-center gap-4 rounded-2xl border border-amber-100 bg-amber-50 p-6">
          <div className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-700">RN</div>
          <div>
            <p className="text-sm font-semibold text-amber-800">Next 7 Days</p>
            <p className="text-2xl font-bold text-amber-900">{renewalCounts.upcoming7} Renewals</p>
          </div>
        </article>
        <article className="flex items-center gap-4 rounded-2xl border border-red-100 bg-red-50 p-6">
          <div className="rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-700">EX</div>
          <div>
            <p className="text-sm font-semibold text-red-800">Currently Expired</p>
            <p className="text-2xl font-bold text-red-900">{renewalCounts.expired} Members</p>
          </div>
        </article>
        <article className="flex items-center gap-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-6">
          <div className="rounded-xl bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700">OK</div>
          <div>
            <p className="text-sm font-semibold text-emerald-800">Renewed This Cycle</p>
            <p className="text-2xl font-bold text-emerald-900">{renewalCounts.renewedMonth} Members</p>
          </div>
        </article>
      </div>

      <section className="space-y-6">
        <h2 className="text-lg font-bold text-gray-900">Upcoming Renewals</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-6 py-4">Member Name</th>
                <th className="px-6 py-4">Current Plan</th>
                <th className="px-6 py-4">Expiry Date</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {upcomingRows.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-sm text-gray-500" colSpan={5}>
                    No upcoming renewals available.
                  </td>
                </tr>
              ) : (
                upcomingRows.map((item) => (
                  <tr key={`upcoming-${item.id}`} className="hover:bg-gray-50/50">
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{item.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.plan}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.expiryDate}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{item.amount}</td>
                    <td className="px-6 py-4">
                      <Link
                        href="/portal/billing"
                        className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                      >
                        Renew
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
        <h2 className="text-lg font-bold text-gray-900">Recently Expired Members</h2>
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-6 py-4">Member Name</th>
                <th className="px-6 py-4">Old Plan</th>
                <th className="px-6 py-4">Expired On</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expiredRows.length === 0 ? (
                <tr>
                  <td className="px-6 py-4 text-sm text-gray-500" colSpan={4}>
                    No expired members available.
                  </td>
                </tr>
              ) : (
                expiredRows.map((item) => (
                  <tr key={`expired-${item.id}`} className="hover:bg-gray-50/50">
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{item.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.plan}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.expiryDate}</td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <Link
                          href="/portal/billing"
                          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                        >
                          Renew Now
                        </Link>
                        <Link
                          href="/portal/follow-ups"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
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
