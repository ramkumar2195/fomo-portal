"use client";

import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { approvalsService } from "@/lib/api/services/approvals-service";

/**
 * Generic submit-for-approval modal for the four B4-B7 risky ops
 * (Phase 2B-3..6 / DEC-019). Triggered when an action handler catches
 * {@link import("@/lib/api/http-client").ApiError#riskyOpApproval} on
 * a 400 response.
 *
 * <p>One component handles all four types — the call sites pass the
 * detected {@code requestType}, the {@code payload} that re-runs the
 * exact same mutation after approval, the human {@code targetEntityType}
 * and {@code targetEntityId}, and a label for the action verb. The
 * approval request goes onto the unified queue at /portal/approvals;
 * once SUPER_ADMIN approves, the executor calls the matching service
 * method with the gate bypassed.
 */
export function RiskyOpApprovalModal({
  open,
  onClose,
  requestType,
  targetEntityType,
  targetEntityId,
  payload,
  branchCode,
  approverRole,
  actionLabel,
  contextSummary,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  requestType: "VOID_RECEIPT" | "VOID_INVOICE" | "DELETE_PAYMENT" | "BACKDATE_SUBSCRIPTION";
  /** Audit pointer; mirrors approval_requests.target_entity_type. */
  targetEntityType: "RECEIPT" | "INVOICE" | "SUBSCRIPTION" | "MEMBER";
  targetEntityId: number;
  /** Goes verbatim into approval_requests.payload_json (the executor parses it). */
  payload: Record<string, unknown>;
  branchCode?: string;
  approverRole: string;
  /** Verb shown in the modal title, e.g. "Void receipt", "Backdate subscription". */
  actionLabel: string;
  /** One-line description of the affected entity, e.g. "Receipt RC/2026-04/00123 — ₹5,200". */
  contextSummary: string;
  onSubmitted: (info: { requestId: number }) => void;
}) {
  const { token } = useAuth();
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token) return;
    if (!reason.trim()) {
      setError("Reason is required so the approver and auditor see what's being requested.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Reason is duplicated into the payload so the executor can re-stamp
      // the audit row with the exact text the requester wrote (the executor
      // doesn't trust approver edits to override the original justification).
      const result = await approvalsService.submit(token, {
        requestType,
        targetEntityType,
        targetEntityId,
        branchCode,
        payloadJson: JSON.stringify({ ...payload, reason: reason.trim() }),
        reason: reason.trim(),
      });
      onSubmitted({ requestId: result.id });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit approval request.");
    } finally {
      setBusy(false);
    }
  };

  const approverHuman = approverRole.replace(/_/g, " ").toLowerCase();

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={`Submit "${actionLabel}" for approval`}
      size="md"
      closeOnOverlayClick={false}
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-100">
          <div className="font-semibold">{actionLabel} requires {approverRole} approval.</div>
          <div className="mt-1 text-xs text-amber-100/80">
            Your role can&rsquo;t do this directly. Submit a request and a {approverHuman} will review.
            Once approved, the action runs automatically.
          </div>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Affecting</div>
          <div className="mt-1 font-medium text-white">{contextSummary}</div>
        </div>

        <label className="block space-y-2">
          <span className="font-medium text-slate-200">
            Reason <span className="font-normal text-slate-500">(required, visible to approver + auditor)</span>
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. Wrong amount; member intended ₹3,500 not ₹5,200"
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
