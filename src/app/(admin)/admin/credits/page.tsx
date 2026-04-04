"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { DataTable } from "@/components/common/data-table";
import { Badge } from "@/components/common/badge";
import { Modal } from "@/components/common/modal";
import { FormField } from "@/components/common/form-field";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";

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
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export default function CreditsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Row[]>([]);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Award modal
  const [showAward, setShowAward] = useState(false);
  const [awardForm, setAwardForm] = useState({ memberId: "", amount: "", reason: "" });
  const [submitting, setSubmitting] = useState(false);

  // Adjust modal
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ memberId: "", amount: "", reason: "", type: "CREDIT" });

  // Wallet lookup
  const [lookupMemberId, setLookupMemberId] = useState("");
  const [walletData, setWalletData] = useState<Row | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // Ledger
  const [ledger, setLedger] = useState<Row[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerTotal, setLedgerTotal] = useState(0);

  const loadRules = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await engagementService.getCreditRules(token);
      const list = Array.isArray(data) ? data : (data as Row).rules ?? (data as Row).content ?? [];
      setRules(Array.isArray(list) ? (list as Row[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load credit rules");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleToggleRule = async (ruleId: number, currentActive: boolean) => {
    if (!token) return;
    try {
      await engagementService.patchCreditRuleActive(token, ruleId, !currentActive);
      setToast({ kind: "success", message: `Rule ${!currentActive ? "activated" : "deactivated"}` });
      void loadRules();
    } catch {
      setToast({ kind: "error", message: "Failed to update rule" });
    }
  };

  const handleBootstrap = async () => {
    if (!token) return;
    try {
      await engagementService.bootstrapDefaultRules(token);
      setToast({ kind: "success", message: "Default credit rules bootstrapped" });
      void loadRules();
    } catch {
      setToast({ kind: "error", message: "Failed to bootstrap rules" });
    }
  };

  const handleAward = async () => {
    if (!token || !awardForm.memberId || !awardForm.amount) return;
    setSubmitting(true);
    try {
      await engagementService.awardCredits(token, {
        memberId: Number(awardForm.memberId),
        amount: Number(awardForm.amount),
        reason: awardForm.reason || "Manual award",
      });
      setToast({ kind: "success", message: "Credits awarded successfully" });
      setShowAward(false);
      setAwardForm({ memberId: "", amount: "", reason: "" });
    } catch {
      setToast({ kind: "error", message: "Failed to award credits" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjust = async () => {
    if (!token || !adjustForm.memberId || !adjustForm.amount) return;
    setSubmitting(true);
    try {
      await engagementService.adjustCredits(token, {
        memberId: Number(adjustForm.memberId),
        amount: adjustForm.type === "DEBIT" ? -Math.abs(Number(adjustForm.amount)) : Math.abs(Number(adjustForm.amount)),
        reason: adjustForm.reason || "Manual adjustment",
      });
      setToast({ kind: "success", message: `Credits ${adjustForm.type === "DEBIT" ? "debited" : "credited"} successfully` });
      setShowAdjust(false);
      setAdjustForm({ memberId: "", amount: "", reason: "", type: "CREDIT" });
    } catch {
      setToast({ kind: "error", message: "Failed to adjust credits" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWalletLookup = async () => {
    if (!token || !lookupMemberId) return;
    setWalletLoading(true);
    setWalletData(null);
    setLedger([]);
    try {
      const data = await engagementService.getCreditsWallet(token, lookupMemberId);
      setWalletData(data as Row);
      void loadLedger(lookupMemberId, 0);
    } catch {
      setToast({ kind: "error", message: "Unable to find wallet for this member" });
    } finally {
      setWalletLoading(false);
    }
  };

  const loadLedger = async (memberId: string, page: number) => {
    if (!token) return;
    setLedgerLoading(true);
    try {
      const data = await engagementService.getCreditsLedger(token, memberId, page, 10);
      const pageData = data as Row;
      const content = (pageData.content ?? []) as Row[];
      setLedger(content);
      setLedgerPage(page);
      setLedgerTotal(num(pageData, "totalPages"));
    } catch {
      setToast({ kind: "error", message: "Unable to load credit ledger" });
    } finally {
      setLedgerLoading(false);
    }
  };

  if (loading) return <PageLoader label="Loading credit rules..." />;

  return (
    <div className="space-y-8 pb-12">
      {toast && (
        <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Credits & Wallet</h1>
          <p className="text-slate-400">Manage credit rules, award, adjust, and view member credits.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowAward(true)}
            className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Award Credits
          </button>
          <button
            type="button"
            onClick={() => setShowAdjust(true)}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Adjust Credits
          </button>
          <button
            type="button"
            onClick={() => void handleBootstrap()}
            className="rounded-xl border border-white/10 bg-[#121722] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            Bootstrap Defaults
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Credit Rules */}
      <SectionCard title="Credit Rules" subtitle="Configure how credits are earned and managed">
        <DataTable<Row>
          columns={[
            { key: "name", header: "Rule Name", render: (r) => str(r, "name", "ruleName", "eventType") },
            { key: "description", header: "Description", render: (r) => str(r, "description", "desc") },
            { key: "credits", header: "Credits", render: (r) => String(num(r, "credits", "creditAmount", "amount")) },
            { key: "eventType", header: "Trigger Event", render: (r) => str(r, "eventType", "trigger", "type") },
            {
              key: "active",
              header: "Status",
              render: (r) => {
                const active = r.active === true || r.active === "true";
                return <Badge variant={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>;
              },
            },
            {
              key: "actions",
              header: "Actions",
              render: (r) => {
                const ruleId = num(r, "id", "ruleId");
                const active = r.active === true || r.active === "true";
                return (
                  <button
                    type="button"
                    onClick={() => void handleToggleRule(ruleId, active)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    {active ? "Deactivate" : "Activate"}
                  </button>
                );
              },
            },
          ]}
          data={rules}
          keyExtractor={(r) => str(r, "id", "ruleId", "name")}
          emptyMessage="No credit rules configured. Click 'Bootstrap Defaults' to create standard rules."
        />
      </SectionCard>

      {/* Member Wallet Lookup */}
      <SectionCard title="Member Wallet Lookup" subtitle="Look up a member's credit balance and transaction history">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-200">Member ID</label>
            <input
              type="number"
              value={lookupMemberId}
              onChange={(e) => setLookupMemberId(e.target.value)}
              placeholder="Enter member ID"
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleWalletLookup()}
            disabled={walletLoading || !lookupMemberId}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {walletLoading ? "Loading..." : "Lookup"}
          </button>
        </div>

        {walletData && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-[#171d29] p-4">
              <p className="text-xs font-medium text-slate-400 uppercase">Balance</p>
              <p className="mt-1 text-xl font-bold text-white">{num(walletData, "balance", "totalCredits", "availableCredits")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#171d29] p-4">
              <p className="text-xs font-medium text-slate-400 uppercase">Earned</p>
              <p className="mt-1 text-xl font-bold text-green-700">{num(walletData, "totalEarned", "earned")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#171d29] p-4">
              <p className="text-xs font-medium text-slate-400 uppercase">Spent</p>
              <p className="mt-1 text-xl font-bold text-rose-700">{num(walletData, "totalSpent", "spent", "redeemed")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#171d29] p-4">
              <p className="text-xs font-medium text-slate-400 uppercase">Expired</p>
              <p className="mt-1 text-xl font-bold text-gray-500">{num(walletData, "totalExpired", "expired")}</p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Credit Ledger */}
      {walletData && (
        <SectionCard title="Credit Ledger" subtitle={`Transaction history for member #${lookupMemberId}`}>
          {ledgerLoading ? (
            <p className="text-sm text-slate-400">Loading ledger...</p>
          ) : (
            <>
              <DataTable<Row>
                columns={[
                  { key: "createdAt", header: "Date", render: (r) => str(r, "createdAt", "date", "timestamp").substring(0, 16) },
                  { key: "type", header: "Type", render: (r) => {
                    const type = str(r, "type", "transactionType", "eventType");
                    return <Badge variant={type.includes("EARN") || type.includes("CREDIT") || type.includes("AWARD") ? "success" : type.includes("REDEEM") || type.includes("DEBIT") ? "error" : "neutral"}>{type}</Badge>;
                  }},
                  { key: "amount", header: "Amount", render: (r) => {
                    const amt = num(r, "amount", "credits");
                    return <span className={amt >= 0 ? "text-green-700 font-semibold" : "text-rose-700 font-semibold"}>{amt >= 0 ? `+${amt}` : String(amt)}</span>;
                  }},
                  { key: "balance", header: "Balance", render: (r) => String(num(r, "balance", "runningBalance")) },
                  { key: "reason", header: "Reason", render: (r) => str(r, "reason", "description", "note") },
                ]}
                data={ledger}
                keyExtractor={(r) => str(r, "id", "ledgerId") + str(r, "createdAt")}
                emptyMessage="No transactions found."
              />
              {ledgerTotal > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={ledgerPage === 0}
                    onClick={() => void loadLedger(lookupMemberId, ledgerPage - 1)}
                    className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-400">Page {ledgerPage + 1} of {ledgerTotal}</span>
                  <button
                    type="button"
                    disabled={ledgerPage >= ledgerTotal - 1}
                    onClick={() => void loadLedger(lookupMemberId, ledgerPage + 1)}
                    className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </SectionCard>
      )}

      {/* Award Credits Modal */}
      <Modal open={showAward} onClose={() => setShowAward(false)} title="Award Credits" size="sm">
        <div className="space-y-4">
          <FormField label="Member ID" required>
            <input
              type="number"
              value={awardForm.memberId}
              onChange={(e) => setAwardForm((f) => ({ ...f, memberId: e.target.value }))}
              placeholder="Enter member ID"
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Credits Amount" required>
            <input
              type="number"
              value={awardForm.amount}
              onChange={(e) => setAwardForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="Number of credits"
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Reason">
            <input
              type="text"
              value={awardForm.reason}
              onChange={(e) => setAwardForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Reason for awarding"
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setShowAward(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300">Cancel</button>
          <button
            type="button"
            onClick={() => void handleAward()}
            disabled={submitting || !awardForm.memberId || !awardForm.amount}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Awarding..." : "Award Credits"}
          </button>
        </div>
      </Modal>

      {/* Adjust Credits Modal */}
      <Modal open={showAdjust} onClose={() => setShowAdjust(false)} title="Adjust Credits" size="sm">
        <div className="space-y-4">
          <FormField label="Member ID" required>
            <input
              type="number"
              value={adjustForm.memberId}
              onChange={(e) => setAdjustForm((f) => ({ ...f, memberId: e.target.value }))}
              placeholder="Enter member ID"
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Adjustment Type" required>
            <select
              value={adjustForm.type}
              onChange={(e) => setAdjustForm((f) => ({ ...f, type: e.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
            >
              <option value="CREDIT">Credit (Add)</option>
              <option value="DEBIT">Debit (Remove)</option>
            </select>
          </FormField>
          <FormField label="Amount" required>
            <input
              type="number"
              value={adjustForm.amount}
              onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="Number of credits"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Reason">
            <input
              type="text"
              value={adjustForm.reason}
              onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Reason for adjustment"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setShowAdjust(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300">Cancel</button>
          <button
            type="button"
            onClick={() => void handleAdjust()}
            disabled={submitting || !adjustForm.memberId || !adjustForm.amount}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Adjusting..." : "Adjust Credits"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
