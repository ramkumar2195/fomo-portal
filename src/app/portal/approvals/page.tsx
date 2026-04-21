"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClockAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ToastBanner } from "@/components/common/toast-banner";
import { PageLoader } from "@/components/common/page-loader";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { approvalsService } from "@/lib/api/services/approvals-service";
import {
  APPROVAL_TYPE_DESCRIPTION,
  APPROVAL_TYPE_LABEL,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
} from "@/types/approvals";
import type { SpringPage } from "@/types/pagination";

/**
 * Approval queue. Two tabs:
 *   - "Pending review" — requests waiting for the current approver (the
 *     backend scopes by role/branch; we just render whatever the server
 *     returns)
 *   - "My requests" — everything this staff member has ever submitted,
 *     any status. Lets them watch their own pipeline.
 *
 * Approve / Reject buttons are inline on each pending row. Each opens a
 * small confirm modal so the approver can optionally attach a note. No
 * bulk actions — every risky op is decided individually per DEC-019.
 */

type TabKey = "pending" | "mine";

const STATUS_TONE: Record<ApprovalRequestStatus, string> = {
  PENDING: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  APPROVED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  REJECTED: "border-rose-500/25 bg-rose-500/10 text-rose-100",
  CANCELLED: "border-slate-500/25 bg-slate-500/10 text-slate-200",
  EXPIRED: "border-slate-500/25 bg-slate-500/10 text-slate-300",
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatPayload(payloadJson?: string | null): string {
  if (!payloadJson) return "—";
  try {
    const parsed = JSON.parse(payloadJson);
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" · ");
  } catch {
    return payloadJson;
  }
}

export default function ApprovalsPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [pending, setPending] = useState<SpringPage<ApprovalRequestRecord> | null>(null);
  const [mine, setMine] = useState<SpringPage<ApprovalRequestRecord> | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [decisionModal, setDecisionModal] = useState<
    { mode: "approve" | "reject"; request: ApprovalRequestRecord } | null
  >(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [pendingPage, minePage] = await Promise.all([
        approvalsService.listPending(token),
        approvalsService.listMine(token),
      ]);
      setPending(pendingPage);
      setMine(minePage);
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to load approvals." });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDecision = useCallback(async () => {
    if (!token || !decisionModal) return;
    setDecisionBusy(true);
    try {
      const body = decisionNotes.trim() ? { decisionNotes: decisionNotes.trim() } : undefined;
      if (decisionModal.mode === "approve") {
        await approvalsService.approve(token, decisionModal.request.id, body);
        setToast({ kind: "success", message: "Request approved." });
      } else {
        await approvalsService.reject(token, decisionModal.request.id, body);
        setToast({ kind: "success", message: "Request rejected." });
      }
      setDecisionModal(null);
      setDecisionNotes("");
      await load();
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to record decision." });
    } finally {
      setDecisionBusy(false);
    }
  }, [token, decisionModal, decisionNotes, load]);

  const handleCancel = useCallback(
    async (request: ApprovalRequestRecord) => {
      if (!token) return;
      try {
        await approvalsService.cancel(token, request.id);
        setToast({ kind: "success", message: "Request cancelled." });
        await load();
      } catch (err) {
        setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to cancel." });
      }
    },
    [token, load],
  );

  const activeRows = useMemo(() => {
    const page = activeTab === "pending" ? pending : mine;
    return page?.content ?? [];
  }, [activeTab, pending, mine]);

  if (loading && !pending && !mine) return <PageLoader label="Loading approvals..." />;

  return (
    <div className="space-y-6 pb-12">
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Approvals</h1>
        <p className="text-slate-400">
          Risky operations that need a manager or admin sign-off before they execute. Discounts above
          5%, receipt edits, payment deletes, pause-benefit grants, and backdated subscriptions all
          route through this queue.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
            activeTab === "pending"
              ? "bg-[#c42924] text-white"
              : "border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
          }`}
        >
          Pending review ({pending?.totalElements ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("mine")}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
            activeTab === "mine"
              ? "bg-[#c42924] text-white"
              : "border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
          }`}
        >
          My requests ({mine?.totalElements ?? 0})
        </button>
      </div>

      <SectionCard
        title={activeTab === "pending" ? "Pending review" : "My requests"}
        subtitle={
          activeTab === "pending"
            ? "Requests awaiting your decision. Approving runs the gated action and writes an audit log."
            : "Everything you have submitted — pending, approved, rejected, cancelled, or expired."
        }
      >
        {activeRows.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-12 text-center text-sm text-slate-400">
            {activeTab === "pending" ? "No pending approvals right now." : "You have not submitted any approval requests yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-white/[0.03] text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payload</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => {
                  const typeLabel = APPROVAL_TYPE_LABEL[row.requestType] || row.requestType;
                  const typeDescription = APPROVAL_TYPE_DESCRIPTION[row.requestType] || "";
                  const toneClass = STATUS_TONE[row.status] || STATUS_TONE.PENDING;
                  const isPending = row.status === "PENDING";
                  return (
                    <tr key={row.id} className="border-t border-white/6 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-white">{typeLabel}</div>
                        <div className="text-[11px] text-slate-400">{typeDescription}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-slate-200">
                          {row.targetEntityType} #{row.targetEntityId}
                        </div>
                        {row.branchCode ? (
                          <div className="text-[11px] text-slate-500">Branch {row.branchCode}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-slate-200">Staff #{row.requesterStaffId}</div>
                        {row.requesterDesignation ? (
                          <div className="text-[11px] text-slate-500">{row.requesterDesignation}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-300">{formatDateTime(row.createdAt)}</td>
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
                          {row.status}
                        </span>
                        {row.decidedAt ? (
                          <div className="mt-1 text-[11px] text-slate-500">{formatDateTime(row.decidedAt)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-[12px] text-slate-300 max-w-[280px] truncate">
                        {formatPayload(row.payloadJson)}
                        {row.reason ? (
                          <div className="mt-0.5 text-[11px] italic text-slate-500">"{row.reason}"</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        {activeTab === "pending" && isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setDecisionNotes("");
                                setDecisionModal({ mode: "approve", request: row });
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDecisionNotes("");
                                setDecisionModal({ mode: "reject", request: row });
                              }}
                              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                            >
                              Reject
                            </button>
                          </div>
                        ) : activeTab === "mine" && isPending ? (
                          <button
                            type="button"
                            onClick={() => void handleCancel(row)}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                          >
                            Cancel
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {decisionModal ? (
        <Modal
          open
          onClose={() => {
            if (!decisionBusy) setDecisionModal(null);
          }}
          title={decisionModal.mode === "approve" ? "Approve request" : "Reject request"}
        >
          <div className="space-y-4 text-sm">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-semibold text-white">
                {APPROVAL_TYPE_LABEL[decisionModal.request.requestType] || decisionModal.request.requestType}
              </div>
              <div className="mt-1 text-slate-300">
                Target: {decisionModal.request.targetEntityType} #{decisionModal.request.targetEntityId}
              </div>
              <div className="mt-1 text-slate-300">Payload: {formatPayload(decisionModal.request.payloadJson)}</div>
              {decisionModal.request.reason ? (
                <div className="mt-1 text-slate-400 italic">"{decisionModal.request.reason}"</div>
              ) : null}
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Decision notes (optional)
              </span>
              <textarea
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={decisionModal.mode === "approve" ? "e.g. Verified with manager over call" : "e.g. Not enough justification provided"}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-[#c42924] focus:outline-none"
              />
            </label>

            {decisionModal.mode === "approve" ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <ClockAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Approving runs the gated action immediately and writes an audit log entry. This cannot be undone.
                </span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                disabled={decisionBusy}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDecision()}
                disabled={decisionBusy}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 ${
                  decisionModal.mode === "approve" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-rose-600 hover:bg-rose-500"
                }`}
              >
                {decisionBusy ? "Saving…" : decisionModal.mode === "approve" ? "Confirm approval" : "Confirm rejection"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
