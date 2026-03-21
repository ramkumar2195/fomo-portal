"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { DataTable } from "@/components/common/data-table";
import { Badge } from "@/components/common/badge";
import { Modal } from "@/components/common/modal";
import { FormField } from "@/components/common/form-field";
import { ToastBanner } from "@/components/common/toast-banner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { formatFinancialYearLabel } from "@/lib/inquiry-code";

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "-";
}

function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
  }
  return 0;
}

type ActiveTab = "rules" | "at-risk" | "leaderboard" | "billing";

interface BillingFormState {
  gstPercentage: string;
  invoicePrefix: string;
  nextInvoiceNumber: string;
  receiptPrefix: string;
  nextReceiptNumber: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("rules");
  const [rules, setRules] = useState<Row[]>([]);
  const [atRisk, setAtRisk] = useState<Row[]>([]);
  const [leaderboard, setLeaderboard] = useState<Row[]>([]);
  const [billingForm, setBillingForm] = useState<BillingFormState>({
    gstPercentage: "5.00",
    invoicePrefix: "INV",
    nextInvoiceNumber: "1",
    receiptPrefix: "RCPT",
    nextReceiptNumber: "1",
  });
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Rule form
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Row | null>(null);
  const [ruleForm, setRuleForm] = useState({ name: "", description: "", eventType: "", action: "", threshold: "" });
  const [submitting, setSubmitting] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [rulesData, riskData, lbData, billingData] = await Promise.all([
        engagementService.listAutomationRules(token),
        engagementService.getAtRiskMembers(token),
        engagementService.getGamificationLeaderboard(token),
        subscriptionService.getBillingSettings(token),
      ]);
      setRules(rulesData as Row[]);
      setAtRisk(riskData as Row[]);
      setLeaderboard(lbData as Row[]);
      setBillingForm({
        gstPercentage: String(billingData.gstPercentage || 5),
        invoicePrefix: billingData.invoicePrefix || "INV",
        nextInvoiceNumber: String(billingData.nextInvoiceNumber || 1),
        receiptPrefix: billingData.receiptPrefix || "RCPT",
        nextReceiptNumber: String(billingData.nextReceiptNumber || 1),
      });
    } catch {
      setToast({ kind: "error", message: "Failed to load settings data" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) {
      setActiveTab("rules");
      return;
    }

    const normalizedTab = (["rules", "at-risk", "leaderboard", "billing"] as ActiveTab[])
      .find((tab) => tab === requestedTab);
    setActiveTab(normalizedTab || "rules");
  }, [searchParams]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tab);
    router.replace(`/admin/settings?${nextParams.toString()}`);
  };

  const handleSaveRule = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: ruleForm.name,
        description: ruleForm.description,
        eventType: ruleForm.eventType,
        action: ruleForm.action,
        ...(ruleForm.threshold ? { threshold: Number(ruleForm.threshold) } : {}),
      };
      if (editingRule) {
        await engagementService.updateAutomationRule(token, num(editingRule, "id", "ruleId"), payload);
        setToast({ kind: "success", message: "Rule updated" });
      } else {
        await engagementService.createAutomationRule(token, payload);
        setToast({ kind: "success", message: "Rule created" });
      }
      setShowRuleModal(false);
      setEditingRule(null);
      setRuleForm({ name: "", description: "", eventType: "", action: "", threshold: "" });
      void loadData();
    } catch {
      setToast({ kind: "error", message: "Failed to save rule" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!token || deleteId === null) return;
    try {
      await engagementService.deleteAutomationRule(token, deleteId);
      setToast({ kind: "success", message: "Rule deleted" });
      setDeleteId(null);
      void loadData();
    } catch {
      setToast({ kind: "error", message: "Failed to delete rule" });
    }
  };

  const handleDailyRun = async () => {
    if (!token) return;
    try {
      await engagementService.triggerDailyRun(token);
      setToast({ kind: "success", message: "Daily automation run triggered" });
      void loadData();
    } catch {
      setToast({ kind: "error", message: "Failed to trigger daily run" });
    }
  };

  const handleSaveBilling = async (closeAfterSave = false) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const gstPercentage = Number(billingForm.gstPercentage);
      if (!Number.isFinite(gstPercentage) || gstPercentage < 0) {
        setToast({ kind: "error", message: "GST percentage must be a valid non-negative number." });
        return;
      }
      const nextInvoiceNumber = Number(billingForm.nextInvoiceNumber);
      const nextReceiptNumber = Number(billingForm.nextReceiptNumber);
      if (!Number.isFinite(nextInvoiceNumber) || nextInvoiceNumber <= 0) {
        setToast({ kind: "error", message: "Next invoice number must be a positive number." });
        return;
      }
      if (!Number.isFinite(nextReceiptNumber) || nextReceiptNumber <= 0) {
        setToast({ kind: "error", message: "Next receipt number must be a positive number." });
        return;
      }
      const updated = await subscriptionService.updateBillingSettings(token, {
        gstPercentage,
        invoicePrefix: billingForm.invoicePrefix.trim(),
        nextInvoiceNumber,
        receiptPrefix: billingForm.receiptPrefix.trim(),
        nextReceiptNumber,
      });
      setBillingForm({
        gstPercentage: String(updated.gstPercentage || gstPercentage),
        invoicePrefix: updated.invoicePrefix || billingForm.invoicePrefix.trim(),
        nextInvoiceNumber: String(updated.nextInvoiceNumber || nextInvoiceNumber),
        receiptPrefix: updated.receiptPrefix || billingForm.receiptPrefix.trim(),
        nextReceiptNumber: String(updated.nextReceiptNumber || nextReceiptNumber),
      });
      setToast({ kind: "success", message: "Billing settings updated" });
      if (closeAfterSave) {
        handleTabChange("rules");
      }
    } catch {
      setToast({ kind: "error", message: "Failed to update billing settings" });
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (rule: Row) => {
    setEditingRule(rule);
    setRuleForm({
      name: str(rule, "name", "ruleName"),
      description: str(rule, "description", "desc"),
      eventType: str(rule, "eventType", "trigger"),
      action: str(rule, "action", "actionType"),
      threshold: String(num(rule, "threshold", "thresholdDays") || ""),
    });
    setShowRuleModal(true);
  };

  if (loading) return <PageLoader label="Loading settings..." />;

  return (
    <div className="space-y-8 pb-12">
      {toast && (
        <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Automation & Settings</h1>
          <p className="text-gray-500">Engagement rules, at-risk alerts, and gamification.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingRule(null);
              setRuleForm({ name: "", description: "", eventType: "", action: "", threshold: "" });
              setShowRuleModal(true);
            }}
            className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            New Rule
          </button>
          <button
            type="button"
            onClick={() => void handleDailyRun()}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Run Daily Jobs
          </button>
        </div>
      </div>

      {/* Tab Toggle */}
      <div className="flex gap-2">
        {(["rules", "at-risk", "leaderboard", "billing"] as ActiveTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
              activeTab === tab ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab === "at-risk"
              ? "At-Risk Members"
              : tab === "leaderboard"
                ? "Leaderboard"
                : tab === "billing"
                  ? "Billing"
                  : "Automation Rules"}
          </button>
        ))}
      </div>

      {activeTab === "rules" && (
        <SectionCard title="Automation Rules" subtitle="Rules that drive engagement workflows">
          <DataTable<Row>
            columns={[
              { key: "name", header: "Name", render: (r) => str(r, "name", "ruleName") },
              { key: "eventType", header: "Trigger", render: (r) => str(r, "eventType", "trigger") },
              { key: "action", header: "Action", render: (r) => str(r, "action", "actionType") },
              { key: "threshold", header: "Threshold", render: (r) => str(r, "threshold", "thresholdDays") },
              {
                key: "active",
                header: "Status",
                render: (r) => {
                  const active = r.active === true || r.enabled === true;
                  return <Badge variant={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>;
                },
              },
              {
                key: "actions",
                header: "Actions",
                render: (r) => (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(num(r, "id", "ruleId"))}
                      className="text-sm font-medium text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            data={rules}
            keyExtractor={(r) => str(r, "id", "ruleId", "name")}
            emptyMessage="No automation rules configured."
          />
        </SectionCard>
      )}

      {activeTab === "at-risk" && (
        <SectionCard title="At-Risk Members" subtitle="Members flagged by engagement automation">
          <DataTable<Row>
            columns={[
              { key: "member", header: "Member", render: (r) => str(r, "memberName", "name") },
              { key: "riskScore", header: "Risk Score", render: (r) => str(r, "riskScore", "score") },
              { key: "reason", header: "Reason", render: (r) => str(r, "reason", "riskReason", "flagReason") },
              { key: "lastActive", header: "Last Active", render: (r) => str(r, "lastActiveDate", "lastAttendance", "lastSeen") },
              {
                key: "severity",
                header: "Severity",
                render: (r) => {
                  const score = num(r, "riskScore", "score");
                  const variant = score >= 80 ? "error" : score >= 50 ? "warning" : "info";
                  return <Badge variant={variant}>{score >= 80 ? "High" : score >= 50 ? "Medium" : "Low"}</Badge>;
                },
              },
            ]}
            data={atRisk}
            keyExtractor={(r) => str(r, "memberId", "id", "memberName")}
            emptyMessage="No at-risk members detected."
          />
        </SectionCard>
      )}

      {activeTab === "billing" && (
        <SectionCard title="Billing Settings" subtitle="Common finance settings used across all branches">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  GST Percentage
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={billingForm.gstPercentage}
                  onChange={(event) => setBillingForm((current) => ({ ...current, gstPercentage: event.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Used for invoice calculation across subscription billing flows.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-5">
                <h2 className="text-sm font-semibold text-slate-900">Current Billing Behaviour</h2>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Invoice is generated when a subscription is created.</li>
                  <li>Receipt is generated only when payment is collected.</li>
                  <li>Partial payment is supported and updates balance due.</li>
                  <li>Membership activation is allowed when any payment is collected.</li>
                </ul>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">Invoice Numbering</h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Invoice Root Code
                    </label>
                    <input
                      type="text"
                      value={billingForm.invoicePrefix}
                      onChange={(event) => setBillingForm((current) => ({ ...current, invoicePrefix: event.target.value.toUpperCase() }))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Next Invoice Number
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={billingForm.nextInvoiceNumber}
                      onChange={(event) => setBillingForm((current) => ({ ...current, nextInvoiceNumber: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Preview: {(billingForm.invoicePrefix || "INV").replace(/[^A-Za-z0-9]/g, "").toUpperCase()}/{"{BRANCH_CODE}"}/{formatFinancialYearLabel()}/{String(Number(billingForm.nextInvoiceNumber || "1")).padStart(4, "0")}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">Receipt Numbering</h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Receipt Root Code
                    </label>
                    <input
                      type="text"
                      value={billingForm.receiptPrefix}
                      onChange={(event) => setBillingForm((current) => ({ ...current, receiptPrefix: event.target.value.toUpperCase() }))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Next Receipt Number
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={billingForm.nextReceiptNumber}
                      onChange={(event) => setBillingForm((current) => ({ ...current, nextReceiptNumber: event.target.value }))}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    Preview: {(billingForm.receiptPrefix || "RCPT").replace(/[^A-Za-z0-9]/g, "").toUpperCase()}/{"{BRANCH_CODE}"}/{formatFinancialYearLabel()}/{String(Number(billingForm.nextReceiptNumber || "1")).padStart(4, "0")}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSaveBilling(false)}
                disabled={submitting}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400"
              >
                {submitting ? "Saving..." : "Save Billing Settings"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveBilling(true)}
                disabled={submitting}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
              >
                Save & Close
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === "leaderboard" && (
        <SectionCard title="Monthly Leaderboard" subtitle="Top members by engagement score">
          <DataTable<Row>
            columns={[
              { key: "rank", header: "#", render: (r) => str(r, "rank", "position", "id") },
              { key: "member", header: "Member", render: (r) => str(r, "memberName", "name", "userName") },
              { key: "score", header: "Score", render: (r) => str(r, "score", "totalScore", "points") },
              { key: "streak", header: "Streak", render: (r) => str(r, "streak", "attendanceStreak", "currentStreak") },
              { key: "credits", header: "Credits Earned", render: (r) => str(r, "creditsEarned", "credits", "totalCredits") },
            ]}
            data={leaderboard}
            keyExtractor={(r) => str(r, "memberId", "id", "memberName")}
            emptyMessage="No leaderboard data. Run daily jobs to refresh."
          />
        </SectionCard>
      )}

      {/* Rule Create/Edit Modal */}
      <Modal
        open={showRuleModal}
        onClose={() => setShowRuleModal(false)}
        title={editingRule ? "Edit Automation Rule" : "Create Automation Rule"}
        size="md"
      >
        <div className="space-y-4">
          <FormField label="Rule Name" required>
            <input
              type="text"
              value={ruleForm.name}
              onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Description">
            <input
              type="text"
              value={ruleForm.description}
              onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Event Type" required>
            <select
              value={ruleForm.eventType}
              onChange={(e) => setRuleForm((f) => ({ ...f, eventType: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select event...</option>
              <option value="ATTENDANCE_STREAK">Attendance Streak</option>
              <option value="INACTIVITY">Inactivity</option>
              <option value="SUBSCRIPTION_EXPIRY">Subscription Expiry</option>
              <option value="BIRTHDAY">Birthday</option>
              <option value="CREDIT_MILESTONE">Credit Milestone</option>
            </select>
          </FormField>
          <FormField label="Action" required>
            <select
              value={ruleForm.action}
              onChange={(e) => setRuleForm((f) => ({ ...f, action: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select action...</option>
              <option value="SEND_NOTIFICATION">Send Notification</option>
              <option value="AWARD_CREDITS">Award Credits</option>
              <option value="FLAG_AT_RISK">Flag At-Risk</option>
              <option value="SEND_EMAIL">Send Email</option>
            </select>
          </FormField>
          <FormField label="Threshold (days)">
            <input
              type="number"
              value={ruleForm.threshold}
              onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))}
              placeholder="e.g. 7"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowRuleModal(false)}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSaveRule()}
            disabled={submitting || !ruleForm.name || !ruleForm.eventType || !ruleForm.action}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Saving..." : editingRule ? "Update Rule" : "Create Rule"}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Rule"
        message="Are you sure you want to delete this automation rule?"
        confirmLabel="Delete"
        onConfirm={() => void handleDeleteRule()}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
