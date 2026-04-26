"use client";

import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { approvalsService } from "@/lib/api/services/approvals-service";

/**
 * DISCOUNT approval submit modal (Phase 2B-2 / B3.4 / DEC-019).
 *
 * <p>Triggered by a creation flow (createMember / addOn / renew / upgrade)
 * that received a {@code DISCOUNT_APPROVAL_REQUIRED} response — usually
 * because the operator's designation can't apply &gt; 5% directly.
 * Submits a DISCOUNT approval request to the backend approvals queue;
 * once a manager approves, the executor re-runs the original creation
 * with the discount-gate bypassed.
 *
 * <p>Caller is responsible for providing the same {@code request} body
 * that the original creation call would have used — it gets serialised
 * verbatim into the approval payload and re-deserialised on the backend.
 */
export function DiscountApprovalModal({
  open,
  onClose,
  flow,
  memberId,
  request,
  branchCode,
  discountPercent,
  approverRole,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  /** Which subscription-creation path the rejected submit was hitting. */
  flow: "CREATE" | "ADDON" | "RENEW" | "UPGRADE";
  memberId: number;
  /** The full original request body — serialised into the approval payload as-is. */
  request: Record<string, unknown>;
  branchCode?: string;
  discountPercent: number;
  approverRole: string;
  onSubmitted: (info: { requestId: number }) => void;
}) {
  const { token } = useAuth();
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const payload = JSON.stringify({ flow, memberId, request });
      const result = await approvalsService.submit(token, {
        requestType: "DISCOUNT",
        targetEntityType: "MEMBER",
        targetEntityId: memberId,
        branchCode,
        payloadJson: payload,
        reason: reason.trim() || `Discount of ${discountPercent}% on ${flow} for member ${memberId}`,
      });
      onSubmitted({ requestId: result.id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit approval request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="Submit discount for approval"
      size="md"
      closeOnOverlayClick={false}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-100">
          <div className="font-semibold">
            Discount of {discountPercent}% requires {approverRole} approval.
          </div>
          <div className="mt-1 text-amber-100/80 text-xs">
            Your role can&rsquo;t apply this discount directly. Submit a request and a {approverRole.replace(/_/g, " ").toLowerCase()} will review.
            Once approved, the {flow.toLowerCase()} will run automatically with the discount applied.
          </div>
        </div>

        <label className="block space-y-2">
          <span className="font-medium text-slate-200">
            Reason <span className="font-normal text-slate-500">(optional, visible to approver + auditor)</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. New-member promo, corporate referral, makeup for service issue"
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
            disabled={busy}
            className="flex-[2] rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:opacity-60"
          >
            {busy ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
