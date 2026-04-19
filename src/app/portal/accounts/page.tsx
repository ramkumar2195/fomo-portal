"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/common/data-table";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "-";
}

function num(row: Row, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

export default function AccountsPage() {
  const { token } = useAuth();
  const { selectedBranchCode, effectiveBranchId } = useBranch();
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingRegisters, setLoadingRegisters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [balanceDue, setBalanceDue] = useState<Row[]>([]);
  const [subscriptions, setSubscriptions] = useState<Row[]>([]);
  const [discountLogs, setDiscountLogs] = useState<Row[]>([]);

  const loadMembers = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await usersService.searchUsers(token, {
        role: "MEMBER",
        // Accounts page populates a member-picker dropdown for ledger views.
        // Only active members should be selectable — ex-members stay reachable
        // via direct member-profile URLs but don't clutter the picker.
        active: true,
        defaultBranchId: effectiveBranchId ? String(effectiveBranchId) : undefined,
      });
      setMembers(list);
      setSelectedMemberId((current) => current || list[0]?.id || "");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load members";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token, effectiveBranchId]);

  const loadRegisters = useCallback(async () => {
    if (!token || !selectedMemberId) {
      return;
    }

    setLoadingRegisters(true);
    setError(null);

    const query = {
      memberId: selectedMemberId,
      ...(selectedBranchCode ? { branchCode: selectedBranchCode } : {}),
    };

    try {
      const [invoiceRows, receiptRows, balanceRows, subscriptionRows, discountRows] = await Promise.all([
        subscriptionService.getInvoiceRegister(token, query),
        subscriptionService.getReceiptRegister(token, query),
        subscriptionService.getBalanceDue(token, query),
        subscriptionService.getSubscriptionRegister(token, query),
        subscriptionService.getDiscountLogs(token, { memberId: selectedMemberId }),
      ]);

      setInvoices(invoiceRows as Row[]);
      setReceipts(receiptRows as Row[]);
      setBalanceDue(balanceRows as Row[]);
      setSubscriptions(subscriptionRows as Row[]);
      setDiscountLogs(discountRows as Row[]);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load account registers";
      setError(message);
    } finally {
      setLoadingRegisters(false);
    }
  }, [token, selectedMemberId, selectedBranchCode]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadMembers();
  }, [token, loadMembers]);

  useEffect(() => {
    if (!selectedMemberId) {
      return;
    }
    void loadRegisters();
  }, [selectedMemberId, loadRegisters]);

  const balanceSummary = useMemo(
    () =>
      balanceDue.reduce<{ totalInvoices: number; totalAmount: number }>(
        (accumulator, row) => ({
          totalInvoices: accumulator.totalInvoices + 1,
          totalAmount: accumulator.totalAmount + num(row, "outstandingAmount", "balanceAmount", "amount"),
        }),
        { totalInvoices: 0, totalAmount: 0 },
      ),
    [balanceDue],
  );

  if (loading) {
    return <PageLoader label="Loading accounts dashboard..." />;
  }

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#121722] p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <label className="block text-sm font-medium text-slate-200 lg:min-w-[360px]">
          Member
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0f141d] px-3 py-2 text-sm text-white"
            value={selectedMemberId}
            onChange={(event) => setSelectedMemberId(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.mobile})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void loadRegisters()}
          className="inline-flex rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Refresh Registers
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Invoices" value={String(invoices.length)} />
        <StatCard label="Receipts" value={String(receipts.length)} />
        <StatCard label="Balance Due Invoices" value={String(balanceSummary.totalInvoices)} />
        <StatCard label="Balance Due Amount" value={formatCurrency(balanceSummary.totalAmount)} />
      </div>

      <SectionCard title="Invoice Register" subtitle="Live member-wise invoice register">
        <DataTable<Row>
          columns={[
            {
              key: "invoiceNumber",
              header: "Invoice #",
              render: (row) => str(row, "invoiceNumber", "invoiceId", "id"),
            },
            {
              key: "amount",
              header: "Amount",
              render: (row) => formatCurrency(num(row, "amount", "totalAmount", "invoiceAmount")),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => str(row, "status", "invoiceStatus"),
            },
            {
              key: "issuedAt",
              header: "Issued At",
              render: (row) => formatDateTime(str(row, "issuedAt", "invoiceDate", "createdAt")),
            },
          ]}
          data={invoices}
          loading={loadingRegisters}
          keyExtractor={(row) => str(row, "invoiceNumber", "invoiceId", "id")}
          emptyMessage="No invoices found for this member."
        />
      </SectionCard>

      <SectionCard title="Receipt Register" subtitle="Live member-wise receipt register">
        <DataTable<Row>
          columns={[
            {
              key: "receiptNumber",
              header: "Receipt #",
              render: (row) => str(row, "receiptNumber", "receiptId", "id"),
            },
            {
              key: "amount",
              header: "Amount",
              render: (row) => formatCurrency(num(row, "amount", "paidAmount", "receiptAmount")),
            },
            {
              key: "paymentMode",
              header: "Payment Mode",
              render: (row) => str(row, "paymentMode", "mode"),
            },
            {
              key: "paidAt",
              header: "Paid At",
              render: (row) => formatDateTime(str(row, "paidAt", "createdAt")),
            },
          ]}
          data={receipts}
          loading={loadingRegisters}
          keyExtractor={(row) => str(row, "receiptNumber", "receiptId", "id")}
          emptyMessage="No receipts found for this member."
        />
      </SectionCard>

      <SectionCard title="Balance Due Register" subtitle="Outstanding invoices for the selected member">
        <DataTable<Row>
          columns={[
            {
              key: "invoiceNumber",
              header: "Invoice #",
              render: (row) => str(row, "invoiceNumber", "invoiceId", "id"),
            },
            {
              key: "planName",
              header: "Plan",
              render: (row) => str(row, "variantName", "planName", "subscriptionName"),
            },
            {
              key: "amount",
              header: "Outstanding",
              render: (row) => formatCurrency(num(row, "outstandingAmount", "balanceAmount", "amount")),
            },
            {
              key: "dueDate",
              header: "Due Date",
              render: (row) => formatDateTime(str(row, "dueDate", "invoiceDueAt", "issuedAt")),
            },
          ]}
          data={balanceDue}
          loading={loadingRegisters}
          keyExtractor={(row) => str(row, "invoiceNumber", "invoiceId", "id")}
          emptyMessage="No outstanding balance for this member."
        />
      </SectionCard>

      <SectionCard title="Subscription Register" subtitle="Live subscription register for the selected member">
        <DataTable<Row>
          columns={[
            {
              key: "variantName",
              header: "Plan",
              render: (row) => str(row, "variantName", "planName", "subscriptionName"),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => str(row, "subscriptionStatus", "status"),
            },
            {
              key: "startDate",
              header: "Start",
              render: (row) => formatDateTime(str(row, "startDate", "activeFrom")),
            },
            {
              key: "endDate",
              header: "End",
              render: (row) => formatDateTime(str(row, "endDate", "activeTill", "expiryDate")),
            },
          ]}
          data={subscriptions}
          loading={loadingRegisters}
          keyExtractor={(row) => str(row, "memberSubscriptionId", "subscriptionId", "id")}
          emptyMessage="No subscriptions found for this member."
        />
      </SectionCard>

      <SectionCard title="Discount Logs" subtitle="Discount adjustments tied to the selected member">
        <DataTable<Row>
          columns={[
            {
              key: "invoiceNumber",
              header: "Invoice #",
              render: (row) => str(row, "invoiceNumber", "invoiceId", "id"),
            },
            {
              key: "discountAmount",
              header: "Discount",
              render: (row) => formatCurrency(num(row, "discountAmount", "amount")),
            },
            {
              key: "discountedBy",
              header: "Discounted By",
              render: (row) => str(row, "discountedByStaffName", "discountedBy", "staffName"),
            },
            {
              key: "createdAt",
              header: "Logged At",
              render: (row) => formatDateTime(str(row, "createdAt", "discountedAt")),
            },
          ]}
          data={discountLogs}
          loading={loadingRegisters}
          keyExtractor={(row) => str(row, "discountLogId", "invoiceId", "id")}
          emptyMessage="No discount logs found for this member."
        />
      </SectionCard>
    </div>
  );
}
