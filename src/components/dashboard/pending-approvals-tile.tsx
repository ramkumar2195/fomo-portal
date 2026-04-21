"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { approvalsService } from "@/lib/api/services/approvals-service";

/**
 * Compact dashboard tile showing the count of pending approval requests
 * the current user can decide on. Backend scopes by role + branch (DEC-019)
 * so we don't filter on the client.
 *
 * Renders nothing if the user can't approve (anyone other than SUPER_ADMIN
 * or GYM_MANAGER) — caller should also gate at the parent level so the
 * fetch never fires for non-approvers.
 */
export function PendingApprovalsTile() {
  const { token, user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const isApprover = user?.role === "ADMIN"
    || user?.designation === "SUPER_ADMIN"
    || user?.designation === "GYM_MANAGER";

  useEffect(() => {
    if (!token || !isApprover) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    approvalsService
      .pendingCount(token)
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

  if (!isApprover) return null;

  const tone =
    count && count > 0
      ? "border-amber-500/40 bg-amber-500/10"
      : "border-white/10 bg-white/[0.03]";

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
            Pending Approvals
          </p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {loading ? "—" : count ?? 0}
          </p>
          <p className="text-xs text-slate-400">
            {count && count > 0
              ? "Risky operations awaiting your decision"
              : "Nothing in the queue right now"}
          </p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-300" />
    </Link>
  );
}
