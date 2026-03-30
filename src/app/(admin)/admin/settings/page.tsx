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
import { subscriptionService, type MembershipPolicySettings, type BillingSettings } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { notificationService, type CommunicationSettings } from "@/lib/api/services/notification-service";
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

type ActiveTab = "rules" | "at-risk" | "leaderboard" | "billing" | "membership-policy" | "staff-permissions" | "communication";

const TAB_LABELS: Record<ActiveTab, string> = {
  rules: "Automation Rules",
  "at-risk": "At-Risk Members",
  leaderboard: "Leaderboard",
  billing: "Billing",
  "membership-policy": "Membership Policy",
  "staff-permissions": "Staff Permissions",
  communication: "Communication",
};

const ALL_TABS: ActiveTab[] = ["rules", "at-risk", "leaderboard", "billing", "membership-policy", "staff-permissions", "communication"];

interface BillingFormState {
  gstPercentage: string;
  invoicePrefix: string;
  nextInvoiceNumber: string;
  receiptPrefix: string;
  nextReceiptNumber: string;
  paymentModesEnabled: string;
  maxDiscountPercent: string;
  lateFeeEnabled: boolean;
  lateFeePercentPerDay: string;
  invoiceFooterText: string;
  hsnSacCode: string;
}

interface MembershipPolicyFormState {
  freezeMinDays: string;
  freezeMaxDays: string;
  maxFreezesPerSubscription: string;
  freezeCooldownDays: string;
  upgradeWindowShortDays: string;
  upgradeWindowMediumDays: string;
  upgradeWindowLongDays: string;
  gracePeriodDays: string;
  autoRenewalEnabled: boolean;
  renewalReminderDaysBefore: string;
  transferEnabled: boolean;
  minPartialPaymentPercent: string;
}

interface CommFormState {
  smsProvider: string;
  smsApiKey: string;
  smsSenderId: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappApiKey: string;
  autoSmsPaymentConfirmation: boolean;
  autoSmsExpiryReminder: boolean;
  expiryReminderDaysBefore: string;
  autoSmsBirthday: boolean;
  autoSmsFollowUpReminder: boolean;
  autoSmsMissedAttendance: boolean;
  missedAttendanceDaysThreshold: string;
}

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "BANK_TRANSFER"];

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
    paymentModesEnabled: "CASH,UPI,CARD,BANK_TRANSFER",
    maxDiscountPercent: "100",
    lateFeeEnabled: false,
    lateFeePercentPerDay: "0",
    invoiceFooterText: "",
    hsnSacCode: "",
  });
  const [policyForm, setPolicyForm] = useState<MembershipPolicyFormState>({
    freezeMinDays: "7",
    freezeMaxDays: "28",
    maxFreezesPerSubscription: "4",
    freezeCooldownDays: "0",
    upgradeWindowShortDays: "7",
    upgradeWindowMediumDays: "15",
    upgradeWindowLongDays: "28",
    gracePeriodDays: "7",
    autoRenewalEnabled: false,
    renewalReminderDaysBefore: "7",
    transferEnabled: true,
    minPartialPaymentPercent: "50",
  });
  const [commForm, setCommForm] = useState<CommFormState>({
    smsProvider: "DISABLED",
    smsApiKey: "",
    smsSenderId: "",
    smsEnabled: false,
    whatsappEnabled: false,
    whatsappApiKey: "",
    autoSmsPaymentConfirmation: false,
    autoSmsExpiryReminder: false,
    expiryReminderDaysBefore: "7",
    autoSmsBirthday: false,
    autoSmsFollowUpReminder: false,
    autoSmsMissedAttendance: false,
    missedAttendanceDaysThreshold: "7",
  });
  const [permissionMatrix, setPermissionMatrix] = useState<Record<string, Row[]>>({});
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
      const [rulesData, riskData, lbData, billingData, policyData, matrixData, commData] = await Promise.all([
        engagementService.listAutomationRules(token).catch(() => []),
        engagementService.getAtRiskMembers(token).catch(() => []),
        engagementService.getGamificationLeaderboard(token).catch(() => []),
        subscriptionService.getBillingSettings(token).catch(() => null),
        subscriptionService.getMembershipPolicySettings(token).catch(() => null),
        usersService.getStaffPermissionMatrix(token).catch(() => ({})),
        notificationService.getCommunicationSettings(token).catch(() => null),
      ]);
      setRules(rulesData as Row[]);
      setAtRisk(riskData as Row[]);
      setLeaderboard(lbData as Row[]);
      if (billingData) {
        setBillingForm({
          gstPercentage: String(billingData.gstPercentage || 5),
          invoicePrefix: billingData.invoicePrefix || "INV",
          nextInvoiceNumber: String(billingData.nextInvoiceNumber || 1),
          receiptPrefix: billingData.receiptPrefix || "RCPT",
          nextReceiptNumber: String(billingData.nextReceiptNumber || 1),
          paymentModesEnabled: billingData.paymentModesEnabled || "CASH,UPI,CARD,BANK_TRANSFER",
          maxDiscountPercent: String(billingData.maxDiscountPercent ?? 100),
          lateFeeEnabled: billingData.lateFeeEnabled || false,
          lateFeePercentPerDay: String(billingData.lateFeePercentPerDay ?? 0),
          invoiceFooterText: billingData.invoiceFooterText || "",
          hsnSacCode: billingData.hsnSacCode || "",
        });
      }
      if (policyData) {
        setPolicyForm({
          freezeMinDays: String(policyData.freezeMinDays),
          freezeMaxDays: String(policyData.freezeMaxDays),
          maxFreezesPerSubscription: String(policyData.maxFreezesPerSubscription),
          freezeCooldownDays: String(policyData.freezeCooldownDays),
          upgradeWindowShortDays: String(policyData.upgradeWindowShortDays),
          upgradeWindowMediumDays: String(policyData.upgradeWindowMediumDays),
          upgradeWindowLongDays: String(policyData.upgradeWindowLongDays),
          gracePeriodDays: String(policyData.gracePeriodDays),
          autoRenewalEnabled: policyData.autoRenewalEnabled,
          renewalReminderDaysBefore: String(policyData.renewalReminderDaysBefore),
          transferEnabled: policyData.transferEnabled,
          minPartialPaymentPercent: String(policyData.minPartialPaymentPercent),
        });
      }
      setPermissionMatrix(matrixData as Record<string, Row[]>);
      if (commData) {
        const c = commData as CommunicationSettings;
        setCommForm({
          smsProvider: c.smsProvider || "DISABLED",
          smsApiKey: "",
          smsSenderId: c.smsSenderId || "",
          smsEnabled: c.smsEnabled,
          whatsappEnabled: c.whatsappEnabled,
          whatsappApiKey: "",
          autoSmsPaymentConfirmation: c.autoSmsPaymentConfirmation,
          autoSmsExpiryReminder: c.autoSmsExpiryReminder,
          expiryReminderDaysBefore: String(c.expiryReminderDaysBefore || 7),
          autoSmsBirthday: c.autoSmsBirthday,
          autoSmsFollowUpReminder: c.autoSmsFollowUpReminder,
          autoSmsMissedAttendance: c.autoSmsMissedAttendance,
          missedAttendanceDaysThreshold: String(c.missedAttendanceDaysThreshold || 7),
        });
      }
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
    const normalizedTab = ALL_TABS.find((tab) => tab === requestedTab);
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
        paymentModesEnabled: billingForm.paymentModesEnabled,
        maxDiscountPercent: Number(billingForm.maxDiscountPercent),
        lateFeeEnabled: billingForm.lateFeeEnabled,
        lateFeePercentPerDay: Number(billingForm.lateFeePercentPerDay),
        invoiceFooterText: billingForm.invoiceFooterText || undefined,
        hsnSacCode: billingForm.hsnSacCode || undefined,
      });
      setBillingForm({
        gstPercentage: String(updated.gstPercentage || gstPercentage),
        invoicePrefix: updated.invoicePrefix || billingForm.invoicePrefix.trim(),
        nextInvoiceNumber: String(updated.nextInvoiceNumber || nextInvoiceNumber),
        receiptPrefix: updated.receiptPrefix || billingForm.receiptPrefix.trim(),
        nextReceiptNumber: String(updated.nextReceiptNumber || nextReceiptNumber),
        paymentModesEnabled: updated.paymentModesEnabled || billingForm.paymentModesEnabled,
        maxDiscountPercent: String(updated.maxDiscountPercent ?? billingForm.maxDiscountPercent),
        lateFeeEnabled: updated.lateFeeEnabled ?? billingForm.lateFeeEnabled,
        lateFeePercentPerDay: String(updated.lateFeePercentPerDay ?? billingForm.lateFeePercentPerDay),
        invoiceFooterText: updated.invoiceFooterText || billingForm.invoiceFooterText,
        hsnSacCode: updated.hsnSacCode || billingForm.hsnSacCode,
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

  const handleSavePolicy = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const payload = {
        freezeMinDays: Number(policyForm.freezeMinDays),
        freezeMaxDays: Number(policyForm.freezeMaxDays),
        maxFreezesPerSubscription: Number(policyForm.maxFreezesPerSubscription),
        freezeCooldownDays: Number(policyForm.freezeCooldownDays),
        upgradeWindowShortDays: Number(policyForm.upgradeWindowShortDays),
        upgradeWindowMediumDays: Number(policyForm.upgradeWindowMediumDays),
        upgradeWindowLongDays: Number(policyForm.upgradeWindowLongDays),
        gracePeriodDays: Number(policyForm.gracePeriodDays),
        autoRenewalEnabled: policyForm.autoRenewalEnabled,
        renewalReminderDaysBefore: Number(policyForm.renewalReminderDaysBefore),
        transferEnabled: policyForm.transferEnabled,
        minPartialPaymentPercent: Number(policyForm.minPartialPaymentPercent),
      };
      const updated = await subscriptionService.updateMembershipPolicySettings(token, payload);
      setPolicyForm({
        freezeMinDays: String(updated.freezeMinDays),
        freezeMaxDays: String(updated.freezeMaxDays),
        maxFreezesPerSubscription: String(updated.maxFreezesPerSubscription),
        freezeCooldownDays: String(updated.freezeCooldownDays),
        upgradeWindowShortDays: String(updated.upgradeWindowShortDays),
        upgradeWindowMediumDays: String(updated.upgradeWindowMediumDays),
        upgradeWindowLongDays: String(updated.upgradeWindowLongDays),
        gracePeriodDays: String(updated.gracePeriodDays),
        autoRenewalEnabled: updated.autoRenewalEnabled,
        renewalReminderDaysBefore: String(updated.renewalReminderDaysBefore),
        transferEnabled: updated.transferEnabled,
        minPartialPaymentPercent: String(updated.minPartialPaymentPercent),
      });
      setToast({ kind: "success", message: "Membership policy updated" });
    } catch {
      setToast({ kind: "error", message: "Failed to update membership policy" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePermission = async (designation: string, actionCode: string, currentAllowed: boolean) => {
    if (!token) return;
    try {
      const updated = await usersService.updateStaffPermission(token, {
        designation,
        actionCode,
        allowed: !currentAllowed,
      });
      setPermissionMatrix(updated as Record<string, Row[]>);
      setToast({ kind: "success", message: `Permission ${!currentAllowed ? "granted" : "revoked"}: ${actionCode} for ${designation}` });
    } catch {
      setToast({ kind: "error", message: "Failed to update permission" });
    }
  };

  const handleSaveCommunication = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        smsProvider: commForm.smsProvider,
        smsSenderId: commForm.smsSenderId || undefined,
        smsEnabled: commForm.smsEnabled,
        whatsappEnabled: commForm.whatsappEnabled,
        autoSmsPaymentConfirmation: commForm.autoSmsPaymentConfirmation,
        autoSmsExpiryReminder: commForm.autoSmsExpiryReminder,
        expiryReminderDaysBefore: Number(commForm.expiryReminderDaysBefore),
        autoSmsBirthday: commForm.autoSmsBirthday,
        autoSmsFollowUpReminder: commForm.autoSmsFollowUpReminder,
        autoSmsMissedAttendance: commForm.autoSmsMissedAttendance,
        missedAttendanceDaysThreshold: Number(commForm.missedAttendanceDaysThreshold),
      };
      if (commForm.smsApiKey) payload.smsApiKey = commForm.smsApiKey;
      if (commForm.whatsappApiKey) payload.whatsappApiKey = commForm.whatsappApiKey;
      await notificationService.updateCommunicationSettings(token, payload);
      setCommForm((prev) => ({ ...prev, smsApiKey: "", whatsappApiKey: "" }));
      setToast({ kind: "success", message: "Communication settings updated" });
    } catch {
      setToast({ kind: "error", message: "Failed to update communication settings" });
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

  const togglePaymentMode = (mode: string) => {
    const modes = billingForm.paymentModesEnabled.split(",").filter(Boolean);
    const updated = modes.includes(mode) ? modes.filter((m) => m !== mode) : [...modes, mode];
    setBillingForm((prev) => ({ ...prev, paymentModesEnabled: updated.join(",") }));
  };

  if (loading) return <PageLoader label="Loading settings..." />;

  // Get sorted designations for the permission matrix
  const designations = Object.keys(permissionMatrix).filter((d) => d !== "MEMBER");
  const allActionCodes = Array.from(
    new Set(
      Object.values(permissionMatrix).flatMap((actions) =>
        (actions as Row[]).map((a) => String(a.actionCode || ""))
      )
    )
  ).filter(Boolean);

  return (
    <div className="space-y-8 pb-12">
      {toast && (
        <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500">Manage automation, billing, membership policy, staff permissions, and communication.</p>
        </div>
        {activeTab === "rules" && (
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
        )}
      </div>

      {/* Tab Toggle */}
      <div className="flex flex-wrap gap-2">
        {ALL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === tab ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Automation Rules Tab ── */}
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

      {/* ── At-Risk Tab ── */}
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

      {/* ── Leaderboard Tab ── */}
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

      {/* ── Billing Tab ── */}
      {activeTab === "billing" && (
        <SectionCard title="Billing Settings" subtitle="Finance settings used across all branches">
          <div className="space-y-6">
            {/* Row 1: GST + Info */}
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
                  onChange={(e) => setBillingForm((c) => ({ ...c, gstPercentage: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  HSN/SAC Code
                </label>
                <input
                  type="text"
                  value={billingForm.hsnSacCode}
                  onChange={(e) => setBillingForm((c) => ({ ...c, hsnSacCode: e.target.value }))}
                  placeholder="e.g. 998312"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
              </div>
            </div>

            {/* Row 2: Invoice / Receipt numbering */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">Invoice Numbering</h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Root Code</label>
                    <input type="text" value={billingForm.invoicePrefix} onChange={(e) => setBillingForm((c) => ({ ...c, invoicePrefix: e.target.value.toUpperCase() }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Next Invoice Number</label>
                    <input type="number" min="1" step="1" value={billingForm.nextInvoiceNumber} onChange={(e) => setBillingForm((c) => ({ ...c, nextInvoiceNumber: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  </div>
                  <p className="text-xs text-slate-500">
                    Preview: {(billingForm.invoicePrefix || "INV").replace(/[^A-Za-z0-9]/g, "").toUpperCase()}/{"{BRANCH}"}/{formatFinancialYearLabel()}/{String(Number(billingForm.nextInvoiceNumber || "1")).padStart(4, "0")}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">Receipt Numbering</h3>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt Root Code</label>
                    <input type="text" value={billingForm.receiptPrefix} onChange={(e) => setBillingForm((c) => ({ ...c, receiptPrefix: e.target.value.toUpperCase() }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Next Receipt Number</label>
                    <input type="number" min="1" step="1" value={billingForm.nextReceiptNumber} onChange={(e) => setBillingForm((c) => ({ ...c, nextReceiptNumber: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  </div>
                  <p className="text-xs text-slate-500">
                    Preview: {(billingForm.receiptPrefix || "RCPT").replace(/[^A-Za-z0-9]/g, "").toUpperCase()}/{"{BRANCH}"}/{formatFinancialYearLabel()}/{String(Number(billingForm.nextReceiptNumber || "1")).padStart(4, "0")}
                  </p>
                </div>
              </div>
            </div>

            {/* Row 3: Payment Modes + Discount/Late Fee */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-900">Payment Modes</h3>
                <div className="mt-4 flex flex-wrap gap-3">
                  {PAYMENT_MODES.map((mode) => {
                    const active = billingForm.paymentModesEnabled.split(",").includes(mode);
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => togglePaymentMode(mode)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-black text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                      >
                        {mode.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Max Discount %</label>
                  <input type="number" min="0" max="100" value={billingForm.maxDiscountPercent} onChange={(e) => setBillingForm((c) => ({ ...c, maxDiscountPercent: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={billingForm.lateFeeEnabled} onChange={(e) => setBillingForm((c) => ({ ...c, lateFeeEnabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                  <label className="text-sm text-slate-700">Enable Late Fee</label>
                </div>
                {billingForm.lateFeeEnabled && (
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Late Fee % per day</label>
                    <input type="number" min="0" step="0.01" value={billingForm.lateFeePercentPerDay} onChange={(e) => setBillingForm((c) => ({ ...c, lateFeePercentPerDay: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  </div>
                )}
              </div>
            </div>

            {/* Row 4: Invoice Footer */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice Footer Text</label>
              <textarea
                value={billingForm.invoiceFooterText}
                onChange={(e) => setBillingForm((c) => ({ ...c, invoiceFooterText: e.target.value }))}
                rows={3}
                placeholder="Terms & conditions, thank you note, etc."
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void handleSaveBilling(false)} disabled={submitting} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400">
                {submitting ? "Saving..." : "Save Billing Settings"}
              </button>
              <button type="button" onClick={() => void handleSaveBilling(true)} disabled={submitting} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:bg-slate-100">
                Save & Close
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Membership Policy Tab ── */}
      {activeTab === "membership-policy" && (
        <div className="space-y-6">
          <SectionCard title="Freeze Rules" subtitle="Controls for membership freeze/pause">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SettingsNumericField label="Min Freeze Days" value={policyForm.freezeMinDays} onChange={(v) => setPolicyForm((c) => ({ ...c, freezeMinDays: v }))} />
              <SettingsNumericField label="Max Freeze Days" value={policyForm.freezeMaxDays} onChange={(v) => setPolicyForm((c) => ({ ...c, freezeMaxDays: v }))} />
              <SettingsNumericField label="Max Freezes Per Sub" value={policyForm.maxFreezesPerSubscription} onChange={(v) => setPolicyForm((c) => ({ ...c, maxFreezesPerSubscription: v }))} />
              <SettingsNumericField label="Cooldown Between (days)" value={policyForm.freezeCooldownDays} onChange={(v) => setPolicyForm((c) => ({ ...c, freezeCooldownDays: v }))} />
            </div>
          </SectionCard>

          <SectionCard title="Upgrade Windows" subtitle="Days from subscription start within which upgrade is allowed">
            <div className="grid gap-4 sm:grid-cols-3">
              <SettingsNumericField label="1-month plans (days)" value={policyForm.upgradeWindowShortDays} onChange={(v) => setPolicyForm((c) => ({ ...c, upgradeWindowShortDays: v }))} />
              <SettingsNumericField label="3-month plans (days)" value={policyForm.upgradeWindowMediumDays} onChange={(v) => setPolicyForm((c) => ({ ...c, upgradeWindowMediumDays: v }))} />
              <SettingsNumericField label="6+ month plans (days)" value={policyForm.upgradeWindowLongDays} onChange={(v) => setPolicyForm((c) => ({ ...c, upgradeWindowLongDays: v }))} />
            </div>
          </SectionCard>

          <SectionCard title="Grace & Renewal" subtitle="Post-expiry grace and renewal reminders">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SettingsNumericField label="Grace Period (days)" value={policyForm.gracePeriodDays} onChange={(v) => setPolicyForm((c) => ({ ...c, gracePeriodDays: v }))} />
              <SettingsNumericField label="Reminder Before Expiry (days)" value={policyForm.renewalReminderDaysBefore} onChange={(v) => setPolicyForm((c) => ({ ...c, renewalReminderDaysBefore: v }))} />
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <input type="checkbox" checked={policyForm.autoRenewalEnabled} onChange={(e) => setPolicyForm((c) => ({ ...c, autoRenewalEnabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                <label className="text-sm font-medium text-slate-700">Auto-Renewal Enabled</label>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Transfer & Payment" subtitle="Transfer and minimum payment rules">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <input type="checkbox" checked={policyForm.transferEnabled} onChange={(e) => setPolicyForm((c) => ({ ...c, transferEnabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                <label className="text-sm font-medium text-slate-700">Transfer Enabled</label>
              </div>
              <SettingsNumericField label="Min Partial Payment %" value={policyForm.minPartialPaymentPercent} onChange={(v) => setPolicyForm((c) => ({ ...c, minPartialPaymentPercent: v }))} />
            </div>
          </SectionCard>

          <div className="flex gap-3">
            <button type="button" onClick={() => void handleSavePolicy()} disabled={submitting} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400">
              {submitting ? "Saving..." : "Save Membership Policy"}
            </button>
          </div>
        </div>
      )}

      {/* ── Staff Permissions Tab ── */}
      {activeTab === "staff-permissions" && (
        <SectionCard title="Staff Action Permissions" subtitle="Toggle capabilities per designation. Changes apply immediately.">
          {designations.length === 0 ? (
            <p className="text-sm text-gray-500">No permission data loaded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                    {designations.map((d) => (
                      <th key={d} className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{d.replace(/_/g, " ")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allActionCodes.map((actionCode) => (
                    <tr key={actionCode} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs font-medium text-slate-700 whitespace-nowrap">{actionCode.replace(/_/g, " ")}</td>
                      {designations.map((designation) => {
                        const actions = (permissionMatrix[designation] || []) as Row[];
                        const perm = actions.find((a) => a.actionCode === actionCode);
                        const allowed = perm ? perm.allowed === true : false;
                        const isOverride = perm ? perm.isOverride === true : false;
                        return (
                          <td key={`${designation}-${actionCode}`} className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => void handleTogglePermission(designation, actionCode, allowed)}
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold transition-colors ${
                                allowed
                                  ? isOverride
                                    ? "bg-green-600 text-white"
                                    : "bg-green-100 text-green-700"
                                  : isOverride
                                    ? "bg-red-600 text-white"
                                    : "bg-gray-100 text-gray-400"
                              }`}
                              title={`${allowed ? "Allowed" : "Denied"}${isOverride ? " (override)" : " (default)"}`}
                            >
                              {allowed ? "\u2713" : "\u2715"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-green-100 text-center text-green-700 text-xs font-bold leading-4">{"\u2713"}</span> Default allowed</span>
                <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-green-600 text-center text-white text-xs font-bold leading-4">{"\u2713"}</span> Override: granted</span>
                <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-gray-100 text-center text-gray-400 text-xs font-bold leading-4">{"\u2715"}</span> Default denied</span>
                <span className="flex items-center gap-1"><span className="inline-block h-4 w-4 rounded bg-red-600 text-center text-white text-xs font-bold leading-4">{"\u2715"}</span> Override: revoked</span>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Communication Tab ── */}
      {activeTab === "communication" && (
        <div className="space-y-6">
          <SectionCard title="SMS Provider" subtitle="Configure SMS gateway for automated messages">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Provider</label>
                <select value={commForm.smsProvider} onChange={(e) => setCommForm((c) => ({ ...c, smsProvider: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  <option value="DISABLED">Disabled</option>
                  <option value="MSG91">MSG91</option>
                  <option value="TWILIO">Twilio</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">API Key</label>
                <input type="password" value={commForm.smsApiKey} onChange={(e) => setCommForm((c) => ({ ...c, smsApiKey: e.target.value }))} placeholder="Enter to update" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Sender ID</label>
                <input type="text" value={commForm.smsSenderId} onChange={(e) => setCommForm((c) => ({ ...c, smsSenderId: e.target.value }))} placeholder="e.g. FOMOGM" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={commForm.smsEnabled} onChange={(e) => setCommForm((c) => ({ ...c, smsEnabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                SMS Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={commForm.whatsappEnabled} onChange={(e) => setCommForm((c) => ({ ...c, whatsappEnabled: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                WhatsApp Enabled
              </label>
            </div>
            {commForm.whatsappEnabled && (
              <div className="mt-4 max-w-sm">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp API Key</label>
                <input type="password" value={commForm.whatsappApiKey} onChange={(e) => setCommForm((c) => ({ ...c, whatsappApiKey: e.target.value }))} placeholder="Enter to update" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </div>
            )}
          </SectionCard>

          <SectionCard title="Auto-Trigger Messages" subtitle="Automated SMS/WhatsApp messages on events">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <input type="checkbox" checked={commForm.autoSmsPaymentConfirmation} onChange={(e) => setCommForm((c) => ({ ...c, autoSmsPaymentConfirmation: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                Payment Confirmation
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <input type="checkbox" checked={commForm.autoSmsBirthday} onChange={(e) => setCommForm((c) => ({ ...c, autoSmsBirthday: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                Birthday Wishes
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <input type="checkbox" checked={commForm.autoSmsFollowUpReminder} onChange={(e) => setCommForm((c) => ({ ...c, autoSmsFollowUpReminder: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                Follow-Up Reminder
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={commForm.autoSmsExpiryReminder} onChange={(e) => setCommForm((c) => ({ ...c, autoSmsExpiryReminder: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                  Expiry Reminder
                </label>
                {commForm.autoSmsExpiryReminder && (
                  <div className="ml-7">
                    <label className="text-xs text-slate-500">Days before expiry</label>
                    <input type="number" min="1" value={commForm.expiryReminderDaysBefore} onChange={(e) => setCommForm((c) => ({ ...c, expiryReminderDaysBefore: e.target.value }))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm ml-2" />
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={commForm.autoSmsMissedAttendance} onChange={(e) => setCommForm((c) => ({ ...c, autoSmsMissedAttendance: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" />
                  Missed Attendance Alert
                </label>
                {commForm.autoSmsMissedAttendance && (
                  <div className="ml-7">
                    <label className="text-xs text-slate-500">Days threshold</label>
                    <input type="number" min="1" value={commForm.missedAttendanceDaysThreshold} onChange={(e) => setCommForm((c) => ({ ...c, missedAttendanceDaysThreshold: e.target.value }))} className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm ml-2" />
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          <div className="flex gap-3">
            <button type="button" onClick={() => void handleSaveCommunication()} disabled={submitting} className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400">
              {submitting ? "Saving..." : "Save Communication Settings"}
            </button>
          </div>
        </div>
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
            <input type="text" value={ruleForm.name} onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </FormField>
          <FormField label="Description">
            <input type="text" value={ruleForm.description} onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </FormField>
          <FormField label="Event Type" required>
            <select value={ruleForm.eventType} onChange={(e) => setRuleForm((f) => ({ ...f, eventType: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="">Select event...</option>
              <option value="ATTENDANCE_STREAK">Attendance Streak</option>
              <option value="INACTIVITY">Inactivity</option>
              <option value="SUBSCRIPTION_EXPIRY">Subscription Expiry</option>
              <option value="BIRTHDAY">Birthday</option>
              <option value="CREDIT_MILESTONE">Credit Milestone</option>
            </select>
          </FormField>
          <FormField label="Action" required>
            <select value={ruleForm.action} onChange={(e) => setRuleForm((f) => ({ ...f, action: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="">Select action...</option>
              <option value="SEND_NOTIFICATION">Send Notification</option>
              <option value="AWARD_CREDITS">Award Credits</option>
              <option value="FLAG_AT_RISK">Flag At-Risk</option>
              <option value="SEND_EMAIL">Send Email</option>
            </select>
          </FormField>
          <FormField label="Threshold (days)">
            <input type="number" value={ruleForm.threshold} onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))} placeholder="e.g. 7" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setShowRuleModal(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600">
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

function SettingsNumericField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
      />
    </div>
  );
}
