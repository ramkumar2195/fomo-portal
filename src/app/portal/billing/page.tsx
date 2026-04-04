"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { DataTable } from "@/components/common/data-table";
import { Badge } from "@/components/common/badge";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { formatCurrency, formatDateTime } from "@/lib/formatters";

type TabKey = "invoices" | "receipts" | "balance" | "subscriptions" | "discounts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "invoices", label: "Invoices" },
  { key: "receipts", label: "Receipts" },
  { key: "balance", label: "Balance Due" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "discounts", label: "Discount Logs" },
];

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

interface FinanceState {
  dashboard: Record<string, unknown>;
  invoices: Row[];
  receipts: Row[];
  balance: Row[];
  subscriptions: Row[];
  discounts: Row[];
}

const EMPTY: FinanceState = {
  dashboard: {},
  invoices: [],
  receipts: [],
  balance: [],
  subscriptions: [],
  discounts: [],
};

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const { selectedBranchCode } = useBranch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<FinanceState>(EMPTY);
  const [activeTab, setActiveTab] = useState<TabKey>("invoices");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });

  const loadFinance = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const query = {
      ...(dateRange.from ? { from: dateRange.from } : {}),
      ...(dateRange.to ? { to: dateRange.to } : {}),
      ...(selectedBranchCode ? { branchCode: selectedBranchCode } : {}),
    };
    try {
      const [dashboard, invoices, receipts, balance, subscriptions, discounts] =
        await Promise.all([
          subscriptionService.getFinanceDashboard(token, query),
          subscriptionService.getInvoiceRegister(token, query),
          subscriptionService.getReceiptRegister(token, query),
          subscriptionService.getBalanceDue(token, query),
          subscriptionService.getSubscriptionRegister(token, query),
          subscriptionService.getDiscountLogs(token, query),
        ]);
      setState({
        dashboard: dashboard as Record<string, unknown>,
        invoices: invoices as Row[],
        receipts: receipts as Row[],
        balance: balance as Row[],
        subscriptions: subscriptions as Row[],
        discounts: discounts as Row[],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load finance data");
    } finally {
      setLoading(false);
    }
  }, [token, dateRange, selectedBranchCode]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) {
      setActiveTab("invoices");
      return;
    }

    const normalizedTab = TABS.find((tab) => tab.key === requestedTab)?.key;
    setActiveTab(normalizedTab || "invoices");
  }, [searchParams]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tab);
    router.replace(`/portal/billing?${nextParams.toString()}`);
  };

  if (loading) return <PageLoader label="Loading finance dashboard..." />;

  const d = state.dashboard as Row;
  const totalInvoiced = num(d, "totalInvoiced", "invoiceTotal", "totalAmount");
  const totalOutstanding = num(d, "totalOutstanding", "outstanding", "balanceDue");
  const totalInvoices = num(d, "invoicesIssued", "totalInvoices", "invoiceCount");
  const totalCollected = num(d, "totalCollected", "collected", "paidAmount");

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Finance Dashboard</h1>
          <p className="text-slate-400">Revenue, collections, and financial registers.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadFinance()}
          className="inline-flex rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {/* Date Range Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">From</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
            className="rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">To</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
            className="rounded-lg border border-white/10 bg-[#121722] px-3 py-2 text-sm text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadFinance()}
          className="rounded-lg border border-white/10 bg-[#121722] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
        >
          Apply
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Invoiced" value={formatCurrency(totalInvoiced)} />
        <StatCard label="Collections" value={formatCurrency(totalCollected)} />
        <StatCard
          label="Outstanding"
          value={formatCurrency(totalOutstanding)}
          hint="Balance due across all members"
        />
        <StatCard label="Total Invoices" value={String(totalInvoices)} />
      </div>

      {/* Tabbed Registers */}
      <SectionCard title="Financial Registers">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-white/10 pb-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                activeTab === tab.key
                  ? "bg-[#1b2230] text-white"
                  : "bg-[#171d29] text-slate-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "invoices" && (
          <DataTable<Row>
            columns={[
              {
                key: "invoiceNumber",
                header: "Invoice #",
                render: (r) => str(r, "invoiceNumber", "invoiceId", "id"),
              },
              {
                key: "memberName",
                header: "Member",
                render: (r) => str(r, "memberName", "member", "customerName", "memberId"),
              },
              {
                key: "amount",
                header: "Amount",
                render: (r) =>
                  formatCurrency(num(r, "total", "amount", "totalAmount", "invoiceAmount", "invoiceTotal")),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const s = str(r, "status", "invoiceStatus");
                  const variant = s.toLowerCase().includes("paid")
                    ? "success"
                    : s.toLowerCase().includes("overdue")
                      ? "error"
                      : "info";
                  return <Badge variant={variant}>{s}</Badge>;
                },
              },
              {
                key: "dueDate",
                header: "Due Date",
                render: (r) => formatDateTime(str(r, "dueAt", "dueDate", "due")),
              },
              {
                key: "createdAt",
                header: "Created",
                render: (r) => formatDateTime(str(r, "issuedAt", "createdAt", "invoiceDate")),
              },
            ]}
            data={state.invoices}
            keyExtractor={(r) => str(r, "invoiceNumber", "invoiceId", "id")}
            emptyMessage="No invoices found for the selected period."
          />
        )}

        {activeTab === "receipts" && (
          <DataTable<Row>
            columns={[
              {
                key: "receiptNumber",
                header: "Receipt #",
                render: (r) => str(r, "receiptNumber", "receiptId", "id"),
              },
              {
                key: "memberName",
                header: "Member",
                render: (r) => str(r, "memberName", "member", "memberId"),
              },
              {
                key: "amount",
                header: "Amount",
                render: (r) =>
                  formatCurrency(num(r, "paidAmount", "amount", "receiptAmount", "total")),
              },
              {
                key: "paymentMode",
                header: "Payment Mode",
                render: (r) => str(r, "paymentMode", "mode", "method"),
              },
              {
                key: "paidAt",
                header: "Paid At",
                render: (r) => formatDateTime(str(r, "paidAt", "paymentDate", "createdAt")),
              },
            ]}
            data={state.receipts}
            keyExtractor={(r) => str(r, "receiptNumber", "receiptId", "id")}
            emptyMessage="No receipts found for the selected period."
          />
        )}

        {activeTab === "balance" && (
          <DataTable<Row>
            columns={[
              {
                key: "memberName",
                header: "Member",
                render: (r) => str(r, "memberName", "member", "memberId"),
              },
              {
                key: "totalDue",
                header: "Balance Due",
                render: (r) =>
                  formatCurrency(num(r, "outstandingAmount", "totalDue", "balanceDue", "outstanding")),
              },
              {
                key: "lastPaymentDate",
                header: "Last Payment",
                render: (r) =>
                  formatDateTime(str(r, "lastPaymentDate", "lastPaidAt", "paidAt")),
              },
              {
                key: "overdueDays",
                header: "Overdue Days",
                render: (r) => str(r, "overdueDays", "daysOverdue"),
              },
            ]}
            data={state.balance}
            keyExtractor={(r) => str(r, "memberId", "memberName", "id")}
            emptyMessage="No outstanding balances."
          />
        )}

        {activeTab === "subscriptions" && (
          <DataTable<Row>
            columns={[
              {
                key: "memberName",
                header: "Member",
                render: (r) => str(r, "memberName", "member", "memberId"),
              },
              {
                key: "planName",
                header: "Plan",
                render: (r) => str(r, "planName", "variantName", "productName", "plan"),
              },
              {
                key: "status",
                header: "Status",
                render: (r) => {
                  const s = str(r, "status", "subscriptionStatus");
                  const variant =
                    s.toLowerCase() === "active"
                      ? "success"
                      : s.toLowerCase() === "expired"
                        ? "error"
                        : "warning";
                  return <Badge variant={variant}>{s}</Badge>;
                },
              },
              {
                key: "startDate",
                header: "Start",
                render: (r) => formatDateTime(str(r, "startDate", "activatedAt")),
              },
              {
                key: "endDate",
                header: "End",
                render: (r) => formatDateTime(str(r, "endDate", "expiresAt")),
              },
              {
                key: "amount",
                header: "Amount",
                render: (r) =>
                  formatCurrency(num(r, "total", "invoiceTotal", "amount", "totalAmount", "price")),
              },
            ]}
            data={state.subscriptions}
            keyExtractor={(r) => str(r, "subscriptionId", "id", "memberName")}
            emptyMessage="No subscription records found."
          />
        )}

        {activeTab === "discounts" && (
          <DataTable<Row>
            columns={[
              {
                key: "memberName",
                header: "Member",
                render: (r) => str(r, "memberName", "member", "memberId"),
              },
              {
                key: "discountAmount",
                header: "Discount",
                render: (r) =>
                  formatCurrency(num(r, "discountAmount", "amount", "discount")),
              },
              {
                key: "reason",
                header: "Reason",
                render: (r) => str(r, "reason", "notes", "remarks"),
              },
              {
                key: "staffName",
                header: "Approved By",
                render: (r) =>
                  str(r, "staffName", "discountedByStaffName", "approvedBy"),
              },
              {
                key: "createdAt",
                header: "Date",
                render: (r) => formatDateTime(str(r, "createdAt", "discountDate")),
              },
            ]}
            data={state.discounts}
            keyExtractor={(r) => str(r, "id", "memberName", "createdAt") + str(r, "discountAmount")}
            emptyMessage="No discount logs found."
          />
        )}
      </SectionCard>
    </div>
  );
}
