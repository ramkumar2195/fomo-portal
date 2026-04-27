"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { approvalsService } from "@/lib/api/services/approvals-service";

/**
 * Compact dashboard tile for the approval queue (DEC-019).
 *
 * <p>Two modes, auto-selected by role:
 * <ul>
 *   <li><b>Approver mode</b> (SUPER_ADMIN / ADMIN / GYM_MANAGER) — count of
 *       requests awaiting their decision (calls {@code /approvals/pending/count}).</li>
 *   <li><b>Submitter mode</b> (issue #5 — every other staff designation) —
 *       count of the operator's own pending submissions (calls
 *       {@code /approvals/mine}, filters to status PENDING). Closes the gap
 *       where Sales / Front Desk / Fitness staff could submit DISCOUNT,
 *       VOID_*, DELETE_PAYMENT, BACKDATE_SUBSCRIPTION requests but had no
 *       way to see them on their dashboard.</li>
 * </ul>
 */
export function PendingApprovalsTile() {
  const { token, user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const isApprover = user?.role === "ADMIN"
    || user?.designation === "SUPER_ADMIN"
    || user?.designation === "GYM_MANAGER";

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const work = isApprover
      ? approvalsService.pendingCount(token)
      : approvalsService
          .listMine(token, 0, 50)
          .then((page) => page.content.filter((r) => r.status === "PENDING").length);
    work
      .then((value) => {
        if (!cancelled) setCount(value);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, isApprover]);

  const tone =
    count && count > 0
      ? "border-amber-500/40 bg-amber-500/10"
      : "border-white/10 bg-white/[0.03]";

  const heading = isApprover ? "Pending Approvals" : "My Submitted Approvals";
  const emptyHint = isApprover
    ? "Nothing in the queue right now"
    : "No pending approval requests submitted by you";
  const activeHint = isApprover
    ? "Risky operations awaiting your decision"
    : "Awaiting approver decision — track here";

  return (
    <Link
      href="/portal/approvals"
      className={`flex items-center justify-between gap-4 rounded-2xl border px-5 py-4 transition hover:bg-white/[0.06] ${tone}`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-white/[0.06] p-2">
          <ShieldCheck className="h-5 w-5 text-amber-200" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {heading}
          </p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {loading ? "—" : count ?? 0}
          </p>
          <p className="text-xs text-slate-400">
            {count && count > 0 ? activeHint : emptyHint}
          </p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
