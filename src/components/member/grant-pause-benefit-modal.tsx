"use client";

import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { approvalsService } from "@/lib/api/services/approvals-service";

/**
 * Manual grant of additional PAUSE_BENEFIT (freeze) days. Behaviour depends
 * on the caller's role (DEC-019):
 *
 *   - **ADMIN** or **GYM_MANAGER** → direct API call writes the entitlement
 *     top-up immediately. Toast on success; member's freeze balance updates.
 *   - **Anyone else** (SALES_EXECUTIVE, FRONT_DESK_EXECUTIVE, etc.) →
 *     submits an approval request. A GYM_MANAGER reviews it via
 *     /portal/approvals; on approval, the same backend executor runs.
 *
 * Either way, the member eventually ends up with more pause-benefit days
 * on their active entitlement, with a ledger + audit row linking back to
 * the grant. The modal surfaces "direct" vs "needs approval" in its
 * submit button label so the operator knows what will happen.
 */
export function GrantPauseBenefitModal({
  open,
  onClose,
  memberId,
  memberName,
  branchCode,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  memberId: number;
  memberName?: string;
  branchCode?: string;
  onSuccess: (result: { direct: boolean; message: string }) => void;
}) {
  const { token, user } = useAuth();
  const [days, setDays] = useState<string>("7");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGrantDirectly =
    user?.role === "ADMIN" ||
    user?.designation === "SUPER_ADMIN" ||
    user?.designation === "GYM_MANAGER";

  const parsedDays = Number(days);
  const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 90;

  const handleSubmit = async () => {
    if (!token) return;
    if (!daysValid) {
      setError("Days must be a whole number between 1 and 90.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmedReason = reason.trim();
      if (canGrantDirectly) {
        await subscriptionService.grantPauseBenefit(token, memberId, {
          days: parsedDays,
          reason: trimmedReason || undefined,
          idempotencyKey: `DIRECT_GRANT_${memberId}_${Date.now()}`,
        });
        onSuccess({
          direct: true,
          message: `Granted ${parsedDays} extra pause-benefit day${parsedDays === 1 ? "" : "s"}.`,
        });
      } else {
        const payload = {
          days: parsedDays,
          ...(trimmedReason ? { reason: trimmedReason } : {}),
        };
        await approvalsService.submit(token, {
          requestType: "GRANT_PAUSE_BENEFIT",
          targetEntityType: "MEMBER",
          targetEntityId: memberId,
          branchCode,
          payloadJson: JSON.stringify(payload),
          reason: trimmedReason || undefined,
        });
        onSuccess({
          direct: false,
          message: "Grant submitted for approval. A manager will review it shortly.",
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record grant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Grant Pause Benefit Days"
      size="md"
      closeOnOverlayClick={false}
    >
      <div className="space-y-4 text-sm">
        {memberName ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Member</p>
            <p className="mt-1.5 text-base font-semibold text-white">{memberName}</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-100">
          {canGrantDirectly ? (
            <>Your role can grant directly. Days will be added to the member&apos;s active pause-benefit entitlement as soon as you submit.</>
          ) : (
            <>Your role requires manager approval. This will submit a request to the approvals queue; a manager will review and the days will be added on approval.</>
          )}
        </div>

        <label className="block space-y-2">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-slate-200">Days to grant</span>
            <span className="text-xs text-slate-500">1 – 90</span>
          </div>
          <input
            type="number"
            min={1}
            max={90}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-semibold text-white"
          />
        </label>

        <label className="block space-y-2">
          <span className="font-medium text-slate-200">
            Reason <span className="font-normal text-slate-500">(optional, visible to approver + auditor)</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Verbal commitment at renewal, Feb 15"
            className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm text-white placeholder-slate-500"
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex w-full gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy || !daysValid}
            className="flex-[2] rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:opacity-60"
          >
            {busy
              ? "Saving…"
              : canGrantDirectly
                ? `Grant ${parsedDays || "—"} day${parsedDays === 1 ? "" : "s"}`
                : "Submit for approval"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
